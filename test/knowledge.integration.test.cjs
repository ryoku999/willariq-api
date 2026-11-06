const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const { readFile } = require('node:fs/promises');
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

test('Markdown decoding, section-aware splitting and ADMIN route guards', () => {
  const { decodeMarkdown, markdownChunks } = load(
    'modules/knowledge/knowledge-input',
  );
  const { KnowledgeController } = load(
    'modules/knowledge/knowledge.controller',
  );
  assert.deepEqual(Reflect.getMetadata('roles', KnowledgeController), [
    'ADMIN',
  ]);
  assert.deepEqual(
    Reflect.getMetadata('__guards__', KnowledgeController).map(
      (guard) => guard.name,
    ),
    ['JwtAuthGuard', 'RoleGuard'],
  );
  for (const bad of [
    Buffer.from([0xff]),
    Buffer.from('a\0b'),
    Buffer.from('%PDF-1.7'),
  ]) {
    assert.throws(() => decodeMarkdown(bad), { status: 400 });
  }
  const input =
    '# Trámites\r\n## Requisitos\r\nPresentar el formulario.\r\n```md\r\n# Ejemplo\r\n```\r\n## Atención\r\nDe lunes a viernes.';
  const fragments = markdownChunks(decodeMarkdown(Buffer.from(input)), 200, 30);
  assert.deepEqual(
    fragments.map(({ section }) => section),
    [['Trámites'], ['Trámites', 'Requisitos'], ['Trámites', 'Atención']],
  );
  assert.ok(fragments[1].content.includes('# Ejemplo'));
});

test(
  'Markdown jobs preserve publications across failures and archive excludes retrieval',
  {
    skip: process.env.RUN_KNOWLEDGE_INTEGRATION_TESTS !== '1',
    timeout: 45000,
  },
  async () => {
    require('dotenv').config({ quiet: true });
    const { Pool } = require('pg');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { ConfigService } = require('@nestjs/config');
    const { PrismaClient } = load('generated/prisma/client');
    const { KnowledgeService } = load('modules/knowledge/knowledge.service');
    const { KnowledgeProcessor } = load(
      'modules/knowledge/knowledge-processor.service',
    );
    const { KnowledgeDispatcherService } = load(
      'modules/knowledge/knowledge-dispatcher.service',
    );
    const { EmbeddingProviderService } = load(
      'modules/knowledge/embedding-provider.service',
    );
    const { KnowledgeRetrievalService } = load(
      'modules/knowledge/knowledge-retrieval.service',
    );
    const { AuditService } = load('modules/audit/audit.service');
    const schema = `willariq_knowledge_test_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const model = 'nvidia/nemotron-3.5-embed-1b:free';
    const vector = [1, ...Array(2047).fill(0)];
    let mode = 'valid';
    const requests = [];
    const server = createServer((req, res) => {
      const buffers = [];
      req.on('data', (chunk) => buffers.push(chunk));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(buffers).toString());
        requests.push({
          path: req.url,
          authorization: req.headers.authorization,
          body,
        });
        if (mode === 'limit') {
          res.writeHead(429).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            model: body.model,
            data: body.input
              .map((_, index) => ({
                index,
                embedding: mode === 'malformed' ? [1, 2] : vector,
              }))
              .reverse(),
          }),
        );
      });
    });
    let pool,
      db,
      created = false;
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path=${schema},public`,
      });
      for (const name of [
        '20260916021124_init',
        '20261105050000_account_session_version',
        '20261106090000_markdown_knowledge',
      ]) {
        await pool.query(
          await readFile(
            path.join(__dirname, '../prisma/migrations', name, 'migration.sql'),
            'utf8',
          ),
        );
      }
      db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
      const config = new ConfigService({
        MINIO_KNOWLEDGE_BUCKET: 'fixture-knowledge',
        KNOWLEDGE_MAX_DOCUMENT_BYTES: 1048576,
        KNOWLEDGE_CHUNK_TARGET_CHARS: 800,
        KNOWLEDGE_CHUNK_OVERLAP_CHARS: 100,
        OPENROUTER_EMBEDDING_MODEL: model,
        OPENROUTER_EMBEDDING_DIMENSIONS: 2048,
        OPENROUTER_EMBEDDING_BATCH_SIZE: 4,
        OPENROUTER_EMBEDDING_TIMEOUT_MS: 1000,
        OPENROUTER_BASE_URL: `http://127.0.0.1:${server.address().port}/api/v1`,
        OPENROUTER_API_KEY: 'fixture-key',
        OUTBOX_POLL_INTERVAL_MS: 0,
        OUTBOX_BATCH_SIZE: 2,
      });
      const objects = new Map();
      const storage = {
        enabled: true,
        async put(bucket, key, bytes) {
          objects.set(`${bucket}/${key}`, bytes);
        },
        async get(bucket, key) {
          return Readable.from([objects.get(`${bucket}/${key}`)]);
        },
        async remove(bucket, key) {
          objects.delete(`${bucket}/${key}`);
        },
      };
      const queued = [];
      const queue = {
        async publish(id) {
          queued.push(id);
        },
      };
      const knowledge = new KnowledgeService(
        db,
        config,
        storage,
        new AuditService(db),
      );
      const dispatcher = new KnowledgeDispatcherService(db, config, queue);
      const processor = new KnowledgeProcessor(
        db,
        queue,
        knowledge,
        new EmbeddingProviderService(config),
      );
      const search = new KnowledgeRetrievalService(db);
      const admin = await db.user.create({
        data: {
          firstName: 'Admin',
          dni: '00000001',
          phone: '900000001',
          role: 'ADMIN',
          passwordHash: 'fixture',
        },
      });
      const body = { title: 'Licencias', sourceType: 'PROCEDURE' };
      const buffer = Buffer.from(
        '# Requisitos\nPresentar una solicitud.\n\n# Horarios\nAtención de lunes a viernes.',
      );
      const file = {
        buffer,
        originalname: 'licencias.md',
        mimetype: 'text/markdown',
      };
      await assert.rejects(
        () =>
          knowledge.upload(admin.id, body, {
            ...file,
            originalname: 'licencias.pdf',
          }),
        { status: 400 },
      );
      assert.equal(objects.size, 0);
      const doc = await knowledge.upload(admin.id, body, file);
      assert.equal(doc.status, 'DRAFT');
      assert.deepEqual(await knowledge.content(doc.id), buffer);
      await assert.rejects(() => knowledge.publish(admin.id, doc.id), {
        status: 409,
      });
      const [job, duplicate] = await Promise.all([
        knowledge.process(admin.id, doc.id),
        knowledge.process(admin.id, doc.id),
      ]);
      assert.equal(job.id, duplicate.id);
      await dispatcher.tick();
      assert.deepEqual(queued, [job.id]);
      mode = 'limit';
      await assert.rejects(() => processor.run(job.id), {
        message: 'RATE_LIMITED',
      });
      assert.equal(
        (await knowledge.jobs(doc.id, { page: 1, limit: 20 })).items[0].status,
        'QUEUED',
      );
      mode = 'valid';
      await processor.run(job.id);
      assert.equal((await knowledge.detail(doc.id)).status, 'READY');
      assert.equal((await knowledge.process(admin.id, doc.id)).id, job.id);
      assert.equal(
        (await search.findPublished(vector, knowledge.profile, 10)).length,
        0,
      );
      const published = await knowledge.publish(admin.id, doc.id);
      assert.equal(published.publications[0].jobId, job.id);
      const hits = await search.findPublished(vector, knowledge.profile, 10);
      assert.equal(hits.length, 2);
      assert.ok(hits.every((hit) => hit.score === 1));
      assert.ok(hits.some((hit) => hit.section[0] === 'Horarios'));
      assert.equal(requests.at(-1).path, '/api/v1/embeddings');
      assert.equal(requests.at(-1).authorization, 'Bearer fixture-key');
      assert.equal(requests.at(-1).body.input_type, 'search_document');

      const originalProfile = knowledge.profile;
      config.set('OPENROUTER_EMBEDDING_MODEL', 'fixture/next-model:free');
      const next = await knowledge.process(admin.id, doc.id);
      assert.notEqual(next.id, job.id);
      await dispatcher.tick();
      mode = 'malformed';
      await processor.run(next.id);
      assert.equal((await knowledge.detail(doc.id)).status, 'ERROR');
      assert.equal(
        (await db.aiJob.findUniqueOrThrow({ where: { id: next.id } }))
          .errorSummary,
        'INVALID_EMBEDDING_VECTOR',
      );
      assert.equal(
        (await search.findPublished(vector, originalProfile, 10)).length,
        2,
      );
      assert.equal(
        (await search.findPublished(vector, knowledge.profile, 10)).length,
        0,
      );

      mode = 'valid';
      const replacement = await knowledge.process(admin.id, doc.id);
      await dispatcher.tick();
      await processor.run(replacement.id);
      await knowledge.publish(admin.id, doc.id);
      assert.equal((await knowledge.detail(doc.id)).publications.length, 2);
      assert.equal(
        (await search.findPublished(vector, originalProfile, 10)).length,
        2,
      );
      await knowledge.archive(admin.id, doc.id);
      assert.equal(
        (await search.findPublished(vector, originalProfile, 10)).length,
        0,
      );
      assert.equal(
        (await search.findPublished(vector, knowledge.profile, 10)).length,
        0,
      );
      assert.equal(objects.size, 1);
      await assert.rejects(() => knowledge.process(admin.id, doc.id), {
        status: 409,
      });
    } finally {
      try {
        if (server.listening)
          await new Promise((resolve) => server.close(resolve));
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
