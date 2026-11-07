const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
require('reflect-metadata');

const load = (file) =>
  require(
    path.join(
      process.env.WORKFLOW_BUILD_ROOT || path.join(__dirname, '../dist/src'),
      file,
    ),
  );

test('Chat routes require JWT and use DTOs for bounded messages', async () => {
  const { ValidationPipe } = require('@nestjs/common');
  const { ChatController } = load('modules/chat/chat.controller');
  const { CreateChatMessageDto } = load('modules/chat/chat.dto');
  assert.deepEqual(
    Reflect.getMetadata('__guards__', ChatController).map(
      (guard) => guard.name,
    ),
    ['JwtAuthGuard', 'RoleGuard'],
  );
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const clientRequestId = randomUUID();
  const dto = await pipe.transform(
    {
      clientRequestId,
      content: '  Consulta  ',
      trackingCode: 'wq-2026-000001',
    },
    { type: 'body', metatype: CreateChatMessageDto },
  );
  assert.equal(dto.content, 'Consulta');
  assert.equal(dto.trackingCode, 'WQ-2026-000001');
  await assert.rejects(
    () =>
      pipe.transform(
        { clientRequestId, content: ' ' },
        { type: 'body', metatype: CreateChatMessageDto },
      ),
    { status: 400 },
  );
});

test(
  'Chat queue, source validation, authorization and close are consistent in PostgreSQL',
  {
    skip: process.env.RUN_CHAT_INTEGRATION_TESTS !== '1',
    timeout: 45000,
  },
  async () => {
    require('dotenv').config({ quiet: true });
    const { Pool } = require('pg');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { ConfigService } = require('@nestjs/config');
    const { PrismaClient } = load('generated/prisma/client');
    const { AiSchemaService } = load('modules/ai-config/ai-schema.service');
    const { IncidentAccessService } = load(
      'modules/incidents/incident-access.service',
    );
    const { ClassificationProviderService } = load(
      'modules/incident-ai/providers/classification-provider.service',
    );
    const { EmbeddingProviderService } = load(
      'modules/knowledge/embedding-provider.service',
    );
    const { KnowledgeRetrievalService } = load(
      'modules/knowledge/knowledge-retrieval.service',
    );
    const { ChatDispatcherService } = load(
      'modules/chat/chat-dispatcher.service',
    );
    const { ChatService } = load('modules/chat/chat.service');
    const { ChatProcessor } = load('modules/chat/chat-processor.service');
    const { UNAVAILABLE_TRACKING } = load('modules/chat/chat.types');
    const schema = `willariq_chat_test_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const model = 'nvidia/nemotron-3.5-embed-1b:free';
    const calls = [];
    let mode = 'valid';
    let pool,
      db,
      created = false;
    const mock = createServer((req, res) => {
      const parts = [];
      req.on('data', (part) => parts.push(part));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(parts).toString());
        calls.push({ path: req.url, body });
        res.setHeader('Content-Type', 'application/json');
        if (req.url.endsWith('/embeddings')) {
          res.end(
            JSON.stringify({
              model,
              data: [
                { index: 0, embedding: mode === 'no-hit' ? [0, 1] : [1, 0] },
              ],
            }),
          );
          return;
        }
        if (mode === 'timeout') return;
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    answer: 'Presente la solicitud en mesa de partes.',
                    citations: mode === 'invalid-citation' ? [99] : [1],
                  }),
                },
              },
            ],
          }),
        );
      });
    });

    try {
      mock.listen(0, '127.0.0.1');
      await once(mock, 'listening');
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path=${schema},public`,
      });
      const migrations = path.join(__dirname, '../prisma/migrations');
      for (const folder of (await readdir(migrations, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))) {
        await pool.query(
          await readFile(
            path.join(migrations, folder.name, 'migration.sql'),
            'utf8',
          ),
        );
      }
      db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
      await db.embeddingProfile.create({
        data: {
          model,
          dimensions: 2,
          timeoutMs: 1000,
          batchSize: 4,
          active: true,
        },
      });
      const config = new ConfigService({
        CHAT_ENABLED: true,
        CHAT_MUNICIPAL_CONTACT: 'https://municipio.example/atencion',
        CHAT_MAX_MESSAGE_CHARS: 4000,
        CHAT_MAX_HISTORY_MESSAGES: 20,
        RAG_TOP_K: 5,
        RAG_MIN_SIMILARITY: 0.7,
        RAG_MAX_CONTEXT_TOKENS: 4000,
        OPENROUTER_API_KEY: 'fixture',
        OPENROUTER_BASE_URL: `http://127.0.0.1:${mock.address().port}/api/v1`,
        OUTBOX_POLL_INTERVAL_MS: 0,
        OUTBOX_BATCH_SIZE: 10,
      });
      const schemaService = new AiSchemaService();
      const access = new IncidentAccessService();
      const chat = new ChatService(db, config, access, schemaService);
      const deliveries = [];
      const queue = {
        async publish(id) {
          deliveries.push(id);
        },
      };
      const dispatch = new ChatDispatcherService(db, config, queue);
      const processor = new ChatProcessor(
        db,
        config,
        queue,
        access,
        new EmbeddingProviderService(config),
        new KnowledgeRetrievalService(db),
        new ClassificationProviderService(config),
        schemaService,
      );
      const users = await Promise.all(
        ['1', '2'].map((digit) =>
          db.user.create({
            data: {
              firstName: 'Fixture',
              dni: digit.repeat(8),
              phone: digit.repeat(9),
              passwordHash: 'fixture',
            },
          }),
        ),
      );
      const [citizen, other] = users;
      const code = 'WQ-2026-000001';
      await db.incident.create({
        data: {
          trackingCode: code,
          reporterId: other.id,
          clientRequestId: randomUUID(),
          originalMessage: 'Detalle interno',
          latitude: -12,
          longitude: -77,
        },
      });
      const session = await chat.create(citizen.id, { title: 'Trámites' });
      assert.equal(
        (await chat.list(other.id, { page: 1, limit: 20 })).items.length,
        0,
      );
      await assert.rejects(() => chat.detail(other.id, session.id), {
        status: 404,
      });
      const page = { page: 1, limit: 20 };
      const send = (content, clientRequestId = randomUUID()) =>
        chat.submit(citizen.id, session.id, { content, clientRequestId });
      const latest = async (actor = citizen) =>
        (await chat.messages(actor, session.id, page)).items.find(
          (msg) => msg.role === 'ASSISTANT',
        );
      const run = async (job) => {
        await dispatch.tick();
        assert.equal(deliveries.at(-1), job.id);
        await processor.run(job.id);
      };
      const trackingInput = {
        content: `Estado de ${code}`,
        clientRequestId: randomUUID(),
      };
      const [tracking, replay] = await Promise.all([
        send(trackingInput.content, trackingInput.clientRequestId),
        send(trackingInput.content, trackingInput.clientRequestId),
      ]);
      assert.equal(tracking.job.id, replay.job.id);
      await assert.rejects(
        () => send('Otro mensaje', trackingInput.clientRequestId),
        { status: 409 },
      );
      await assert.rejects(() => send('Un mensaje en paralelo'), {
        status: 409,
      });
      await assert.rejects(() => chat.job(other.id, tracking.job.id), {
        status: 404,
      });
      await run(tracking.job);
      assert.equal((await latest()).content, UNAVAILABLE_TRACKING);
      const unknown = await send('Estado WQ-2026-999999');
      await run(unknown.job);
      assert.equal((await latest()).content, UNAVAILABLE_TRACKING);
      assert.equal(calls.length, 0);

      await db.user.update({
        where: { id: citizen.id },
        data: { role: 'SUPERVISOR' },
      });
      const ownScope = await send(trackingInput.content);
      await run(ownScope.job);
      assert.match(
        (await latest({ ...citizen, role: 'SUPERVISOR' })).content,
        new RegExp(code),
      );
      await db.user.update({
        where: { id: citizen.id },
        data: { role: 'CITIZEN' },
      });
      assert.equal((await latest()).content, UNAVAILABLE_TRACKING);
      assert.equal(calls.length, 0);

      const responseSchema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          answer: { type: 'string' },
          citations: { type: 'array', items: { type: 'integer' } },
        },
        required: ['answer', 'citations'],
      };
      await db.promptVersion.create({
        data: {
          name: 'municipal',
          version: 1,
          capability: 'CHATBOT',
          active: true,
          systemPrompt: 'Asistente municipal de prueba.',
          responseSchema,
        },
      });
      await db.aiRoute.create({
        data: {
          capability: 'CHATBOT',
          provider: 'OPENROUTER',
          model: 'fixture/chat',
          priority: 1,
          timeoutMs: 1000,
        },
      });
      const empty = await send('¿Cuáles son los requisitos?');
      await run(empty.job);
      assert.match((await latest()).content, /municipio\.example/);
      assert.equal(calls.length, 0);

      const doc = await db.knowledgeDocument.create({
        data: { title: 'Licencias', sourceType: 'PROCEDURE', status: 'READY' },
      });
      const embedding = await db.aiJob.create({
        data: {
          type: 'EMBEDDING_DOCUMENT',
          status: 'COMPLETED',
          knowledgeDocumentId: doc.id,
        },
      });
      const chunk = randomUUID();
      await db.$executeRaw`INSERT INTO knowledge_chunks (id, "documentId", "embeddingJobId", "chunkIndex", content, metadata, "embeddingModel", "embeddingDimensions", embedding, "updatedAt")
      VALUES (${chunk}::uuid, ${doc.id}::uuid, ${embedding.id}::uuid, 0, 'Presentar solicitud en mesa de partes.', '{"section":["Requisitos"]}'::jsonb, ${model}, 2, '[1,0]'::vector, now())`;
      await db.knowledgePublication.create({
        data: { documentId: doc.id, jobId: embedding.id, model, dimensions: 2 },
      });

      const question = await send('¿Dónde presento mi solicitud?');
      await run(question.job);
      const completed = await chat.job(citizen.id, question.job.id);
      assert.equal(completed.status, 'COMPLETED');
      const answer = await latest();
      assert.equal(completed.finalOutput.messageId, answer.id);
      assert.deepEqual(answer.metadata.sources, [
        {
          ref: 1,
          chunkId: chunk,
          documentId: doc.id,
          title: 'Licencias',
          section: ['Requisitos'],
          chunkIndex: 0,
        },
      ]);
      assert.equal(
        await db.aiJobKnowledgeChunk.count({
          where: { jobId: question.job.id, chunkId: chunk },
        }),
        1,
      );
      const generation = calls.at(-1);
      assert.equal(generation.path, '/api/v1/chat/completions');
      assert.equal(calls.at(-2).body.input_type, 'search_query');
      assert.ok(!JSON.stringify(calls).includes(code));
      assert.match(generation.body.messages[0].content, /datos no confiables/);

      mode = 'no-hit';
      const low = await send('Consulta ajena al corpus');
      await run(low.job);
      assert.equal(calls.at(-1).path, '/api/v1/embeddings');
      assert.deepEqual((await latest()).metadata.sources, []);

      mode = 'invalid-citation';
      const invalid = await send('Respuesta con cita inventada');
      await run(invalid.job);
      assert.equal(
        (await chat.job(citizen.id, invalid.job.id)).errorSummary,
        'INVALID_CHAT_RESPONSE',
      );
      assert.equal(
        await db.aiJobKnowledgeChunk.count({
          where: { jobId: invalid.job.id },
        }),
        0,
      );

      mode = 'timeout';
      const timeout = await send('Otra pregunta');
      await dispatch.tick();
      await assert.rejects(() => processor.run(timeout.job.id), {
        message: 'TIMEOUT',
      });
      assert.equal(
        (await chat.job(citizen.id, timeout.job.id)).status,
        'QUEUED',
      );
      await chat.close(citizen.id, session.id);
      await processor.run(timeout.job.id);
      assert.equal(
        (await chat.job(citizen.id, timeout.job.id)).status,
        'CANCELLED',
      );
      await assert.rejects(() => send('Conversación cerrada'), { status: 409 });
      assert.equal((await chat.close(citizen.id, session.id)).status, 'CLOSED');
    } finally {
      try {
        if (mock.listening) {
          mock.closeAllConnections();
          await new Promise((resolve) => mock.close(resolve));
        }
        if (db) await db.$disconnect();
        if (pool) await pool.end();
      } finally {
        try {
          if (created) await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
        } finally {
          await adminPool.end();
        }
      }
    }
  },
);
