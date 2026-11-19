// Build first; opt in with RUN_AI_CONFIG_INTEGRATION_TESTS=1.
// Uses only a disposable PostgreSQL schema. No provider/MinIO/Redis requests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test(
  'Versioned AI configuration: HTTP + PostgreSQL',
  {
    skip: process.env.RUN_AI_CONFIG_INTEGRATION_TESTS !== '1',
    timeout: 120000,
  },
  async (t) => {
    require('reflect-metadata');
    require('dotenv').config({ quiet: true });
    const { Pool } = require('pg');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { Test } = require('@nestjs/testing');
    const { ConfigService } = require('@nestjs/config');
    const { ValidationPipe } = require('@nestjs/common');
    const { JwtService } = require('@nestjs/jwt');
    const { getStorageToken } = require('@nestjs/throttler');
    const request = require('supertest');
    const { PrismaClient } = require('../dist/src/generated/prisma/client');
    const { AppModule } = require('../dist/src/app.module');
    const { envSchema } = require('../dist/src/config/env.config');
    const {
      DatabaseService,
    } = require('../dist/src/database/database.service');
    const {
      ResponseInterceptor,
    } = require('../dist/src/shared/interceptors/response.interceptor');
    const {
      canonicalJson,
    } = require('../dist/src/modules/ai-config/ai-schema.service');
    const initial = await readFile(
      path.join(
        __dirname,
        '../prisma/migrations/20260916021124_init/migration.sql',
      ),
      'utf8',
    );
    const migration = await readFile(
      path.join(
        __dirname,
        '../prisma/migrations/20261015180000_ai_prompt_activation/migration.sql',
      ),
      'utf8',
    );
    assert.ok(
      !initial.includes('"public".') && !migration.includes('"public".'),
    );
    const fixture = JSON.parse(
      await readFile(
        path.join(__dirname, '../docs/ai/incident-classification-v1.json'),
        'utf8',
      ),
    );
    const sample = JSON.parse(
      await readFile(
        path.join(
          __dirname,
          '../docs/ai/incident-classification-output-example.json',
        ),
        'utf8',
      ),
    );
    const schema = `willariq_ai_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(schema, /^willariq_ai_test_[a-f0-9]{32}$/);
    const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    let testPool,
      prisma,
      app,
      schemaCreated = false;
    t.after(async () => {
      try {
        if (app) await app.close();
      } finally {
        try {
          if (prisma) await prisma.$disconnect();
          if (testPool) await testPool.end();
        } finally {
          try {
            if (schemaCreated) {
              assert.match(schema, /^willariq_ai_test_[a-f0-9]{32}$/);
              await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
              assert.equal(
                (
                  await adminPool.query(
                    'SELECT 1 FROM pg_namespace WHERE nspname=$1',
                    [schema],
                  )
                ).rowCount,
                0,
              );
            }
          } finally {
            await adminPool.end();
          }
        }
      }
    });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    testPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await testPool.query(initial);
    await testPool.query(
      await readFile(
        path.join(
          __dirname,
          '../prisma/migrations/20261105050000_account_session_version/migration.sql',
        ),
        'utf8',
      ),
    );
    prisma = new PrismaClient({ adapter: new PrismaPg(testPool, { schema }) });
    await t.test(
      'migration refuses duplicate active prompts without changing historical data',
      async () => {
        const ids = [randomUUID(), randomUUID()];
        for (const [index, id] of ids.entries())
          await prisma.promptVersion.create({
            data: {
              id,
              name: 'legacy',
              version: index + 1,
              capability: 'CHATBOT',
              systemPrompt: 'legacy',
              active: true,
            },
          });
        const connection = await testPool.connect();
        try {
          await assert.rejects(
            connection.query(migration),
            /varios prompts activos/,
          );
        } finally {
          await connection.query('ROLLBACK');
          connection.release();
        }
        assert.equal(
          await prisma.promptVersion.count({
            where: { id: { in: ids }, active: true },
          }),
          2,
        );
        await prisma.promptVersion.deleteMany({ where: { id: { in: ids } } });
        await testPool.query(migration);
        const inserted = await testPool.query(
          'INSERT INTO prompt_versions (id,name,version,capability,"systemPrompt") VALUES ($1,$2,1,$3,$4) RETURNING active',
          [randomUUID(), 'db-default', 'CHATBOT', 'test'],
        );
        assert.equal(inserted.rows[0].active, false);
        await prisma.promptVersion.deleteMany({
          where: { name: 'db-default' },
        });
      },
    );

    await testPool.query(
      await readFile(
        path.join(
          __dirname,
          '../prisma/migrations/20261106090000_markdown_knowledge/migration.sql',
        ),
        'utf8',
      ),
    );
    const config = new ConfigService({
      ...envSchema.parse({
        ...process.env,
        MINIO_ENABLED: 'false',
        MINIO_KNOWLEDGE_BUCKET: undefined,
      }),
      MINIO_ENABLED: false,
      AI_ENABLED: false,
      AI_WORKER_ENABLED: false,
      CEREBRAS_API_KEY: 'test-credential-never-send',
      GROQ_API_KEY: '',
      OPENROUTER_API_KEY: '',
    });
    const fetchMock = t.mock.method(globalThis, 'fetch', () => {
      throw new Error('This phase must never call providers');
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue(prisma)
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(getStorageToken())
      .useValue({
        increment: async () => ({
          totalHits: 1,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    const users = [];
    for (const [index, role] of [
      'ADMIN',
      'CITIZEN',
      'SUPERVISOR',
      'OPERATOR',
    ].entries()) {
      users.push(
        await prisma.user.create({
          data: {
            firstName: `AI fixture ${index}`,
            dni: String(60000000 + index),
            phone: String(960000000 + index),
            passwordHash: 'fixture-no-login',
            role,
          },
        }),
      );
    }
    const tokens = await Promise.all(
      users.map((user) =>
        app.get(JwtService).signAsync({ sub: user.id, role: user.role }),
      ),
    );
    const http = (method, route, user = 0) =>
      request(app.getHttpServer())
        [method](`/api/admin/ai${route}`)
        .set('Authorization', `Bearer ${tokens[user]}`);
    let v1, v2, route1, route2;
    const routeBody = (overrides = {}) => ({
      capability: 'INCIDENT_CLASSIFICATION',
      provider: 'CEREBRAS',
      model: 'offline-test-model',
      priority: 1,
      ...overrides,
    });
    const promptBody = (overrides = {}) => ({ ...fixture, ...overrides });

    await t.test(
      'every endpoint is ADMIN-only with real JWT guards',
      async () => {
        const routes = [
          ['get', '/prompts'],
          ['post', '/prompts'],
          ['get', `/prompts/${randomUUID()}`],
          ['post', `/prompts/${randomUUID()}/activate`],
          ['post', `/prompts/${randomUUID()}/deactivate`],
          ['post', `/prompts/${randomUUID()}/validate-output`],
          ['get', '/routes'],
          ['post', '/routes'],
          ['patch', `/routes/${randomUUID()}`],
          ['put', '/routes/priorities'],
          ['get', '/providers/status'],
          ['post', '/config/check'],
          ['get', '/contracts/incident-classification'],
        ];
        for (const [method, route] of routes) {
          for (const user of [1, 2, 3])
            await http(method, route, user).expect(403);
        }
        await request(app.getHttpServer())
          .get('/api/admin/ai/prompts')
          .expect(401);
      },
    );
    await t.test(
      'creates inactive version with complete contract, hashes and audit',
      async () => {
        v1 = (await http('post', '/prompts').send(fixture).expect(201)).body
          .data;
        assert.equal(v1.active, false);
        assert.equal(
          v1.promptHash,
          createHash('sha256').update(fixture.systemPrompt).digest('hex'),
        );
        assert.equal(
          v1.schemaHash,
          createHash('sha256')
            .update(canonicalJson(v1.responseSchema))
            .digest('hex'),
        );
        const contract = (
          await http('get', '/contracts/incident-classification').expect(200)
        ).body.data;
        assert.deepEqual(v1.responseSchema, contract.responseSchema);
        assert.equal(
          await prisma.auditLog.count({
            where: { entityId: v1.id, action: 'AI_PROMPT_CREATED' },
          }),
          1,
        );
        await http('post', '/prompts').send(fixture).expect(409);
      },
    );
    await t.test(
      'validates DTOs, immutable fields and bounded JSON Schema profile',
      async () => {
        for (const invalid of [
          { name: 'Bad Name' },
          { version: 0 },
          { version: '2' },
          { systemPrompt: '  ' },
          { active: true },
          { promptHash: 'x' },
          { responseSchema: null },
          { capability: 'INVALID' },
          { responseSchema: { type: 'object', additionalProperties: true } },
          {
            responseSchema: {
              type: 'object',
              additionalProperties: false,
              properties: { unexpected: { type: 'string' } },
            },
          },
          {
            responseSchema: {
              type: 'object',
              additionalProperties: false,
              $ref: 'https://example.invalid/schema',
            },
          },
          {
            responseSchema: {
              type: 'object',
              additionalProperties: false,
              description: 'x'.repeat(33000),
            },
          },
        ])
          await http('post', '/prompts')
            .send(promptBody({ version: 2, ...invalid }))
            .expect(400);
        await http('patch', `/prompts/${v1.id}`)
          .send({ systemPrompt: 'overwrite' })
          .expect(404);
        await http('delete', `/prompts/${v1.id}`).expect(404);
        await http('get', '/prompts/wrong-id').expect(400);
        await http('get', `/prompts/${randomUUID()}`).expect(404);
      },
    );
    await t.test(
      'lists metadata without full prompts and filters true/false correctly',
      async () => {
        const listed = (
          await http(
            'get',
            '/prompts?active=false&capability=INCIDENT_CLASSIFICATION&page=1&limit=1',
          ).expect(200)
        ).body.data;
        assert.equal(listed.pagination.total, 1);
        assert.ok(!('systemPrompt' in listed.items[0]));
        assert.ok(!('responseSchema' in listed.items[0]));
        for (const query of [
          'active=invalid',
          'limit=101',
          'version=zero',
          'capability=BAD',
        ])
          await http('get', `/prompts?${query}`).expect(400);
        assert.equal(
          (await http('get', `/prompts/${v1.id}`).expect(200)).body.data
            .systemPrompt,
          fixture.systemPrompt,
        );
      },
    );
    await t.test(
      'offline output validation accepts sample and rejects incompatible data without tokens',
      async () => {
        const valid = (
          await http('post', `/prompts/${v1.id}/validate-output`)
            .send(sample)
            .expect(200)
        ).body.data;
        assert.equal(valid.valid, true);
        assert.equal(valid.externalRequestsMade, false);
        for (const changes of [
          { type: 'FAKE' },
          { aiConfidence: 2 },
          { reporterId: users[0].id },
          { urgency: 'CRITICAL', requiresSupervision: false },
          { aiConfidence: 0.3, requiresSupervision: false },
        ]) {
          const invalid = (
            await http('post', `/prompts/${v1.id}/validate-output`)
              .send({ output: { ...sample.output, ...changes } })
              .expect(200)
          ).body.data;
          assert.equal(invalid.valid, false);
          assert.ok(invalid.errors.length);
        }
        await http('post', `/prompts/${v1.id}/validate-output`)
          .send({ output: [] })
          .expect(400);
      },
    );
    await t.test(
      'activation is idempotent and diagnostic distinguishes configuration from execution',
      async () => {
        const activated = (
          await http('post', `/prompts/${v1.id}/activate`).expect(200)
        ).body.data;
        assert.equal(activated.active, true);
        await http('post', `/prompts/${v1.id}/activate`).expect(200);
        assert.equal(
          await prisma.auditLog.count({
            where: { entityId: v1.id, action: 'AI_PROMPT_ACTIVATED' },
          }),
          1,
        );
        const checked = (
          await http('post', '/config/check')
            .send({ capability: 'INCIDENT_CLASSIFICATION' })
            .expect(200)
        ).body.data.items[0];
        assert.equal(checked.configurationReady, false);
        assert.equal(checked.executionImplemented, true);
        assert.deepEqual(checked.issues, ['ENABLED_ROUTE_REQUIRED']);
      },
    );
    await t.test(
      'new versions never modify old content, even when both activations race',
      async () => {
        v2 = (
          await http('post', '/prompts')
            .send(
              promptBody({
                version: 2,
                systemPrompt: fixture.systemPrompt + '\nVersion de prueba 2.',
              }),
            )
            .expect(201)
        ).body.data;
        const replies = await Promise.all([
          http('post', `/prompts/${v1.id}/activate`),
          http('post', `/prompts/${v2.id}/activate`),
        ]);
        assert.ok(replies.every((reply) => reply.status === 200));
        assert.equal(
          await prisma.promptVersion.count({
            where: { capability: fixture.capability, active: true },
          }),
          1,
        );
        assert.equal(
          (await prisma.promptVersion.findUnique({ where: { id: v1.id } }))
            .systemPrompt,
          fixture.systemPrompt,
        );
        await http('post', `/prompts/${v2.id}/activate`).expect(200);
        await assert.rejects(
          prisma.promptVersion.update({
            where: { id: v1.id },
            data: { active: true },
          }),
          { code: 'P2002' },
        );
      },
    );
    await t.test(
      'creates disabled route without requiring a provider key and protects priority uniqueness',
      async () => {
        route1 = (await http('post', '/routes').send(routeBody()).expect(201))
          .body.data;
        assert.equal(route1.enabled, false);
        assert.equal(route1.timeoutMs, 30000);
        route2 = (
          await http('post', '/routes')
            .send(
              routeBody({
                provider: 'GROQ',
                model: 'another-offline-model',
                priority: 2,
              }),
            )
            .expect(201)
        ).body.data;
        await http('post', '/routes').send(routeBody()).expect(409);
        const listed = (
          await http(
            'get',
            '/routes?enabled=false&capability=INCIDENT_CLASSIFICATION',
          ).expect(200)
        ).body.data;
        assert.deepEqual(
          listed.items.map((item) => item.id),
          [route1.id, route2.id],
        );
      },
    );
    await t.test(
      'route validation rejects unknown fields, invalid booleans and unsafe model names',
      async () => {
        for (const invalid of [
          { provider: 'INVALID' },
          { priority: 0 },
          { priority: '3' },
          { enabled: 'true' },
          { timeoutMs: 0 },
          { timeoutMs: 120001 },
          { model: ' model with spaces ' },
          { apiKey: 'never-in-db' },
          { baseUrl: 'http://localhost' },
          { enabled: null },
        ])
          await http('post', '/routes')
            .send(routeBody({ priority: 3, ...invalid }))
            .expect(400);
        await http('patch', `/routes/${route1.id}`).send({}).expect(400);
        await http('patch', `/routes/${route1.id}`)
          .send({ priority: 8 })
          .expect(400);
        await http('patch', `/routes/${route1.id}`)
          .send({ provider: 'GROQ' })
          .expect(400);
        await http('get', '/routes?enabled=not-bool').expect(400);
        await http('patch', `/routes/${randomUUID()}`)
          .send({ enabled: false })
          .expect(404);
      },
    );
    await t.test(
      'enabling checks credential and active contract; status never exposes keys',
      async () => {
        await http('patch', `/routes/${route2.id}`)
          .send({ enabled: true })
          .expect(409);
        const enabled = (
          await http('patch', `/routes/${route1.id}`)
            .send({ enabled: true, timeoutMs: 15000 })
            .expect(200)
        ).body.data;
        assert.equal(enabled.enabled, true);
        const checked = (
          await http('post', '/config/check')
            .send({ capability: fixture.capability })
            .expect(200)
        ).body.data.items[0];
        assert.equal(checked.configurationReady, true);
        assert.equal(checked.executionImplemented, true);
        const status = (await http('get', '/providers/status').expect(200)).body
          .data;
        assert.equal(
          status.items.find((item) => item.provider === 'CEREBRAS')
            .credentialConfigured,
          true,
        );
        assert.equal(
          status.items.find((item) => item.provider === 'GROQ')
            .credentialConfigured,
          false,
        );
        assert.ok(
          !JSON.stringify(status).includes('test-credential-never-send'),
        );
        assert.ok(
          status.items.every((item) => item.availability === 'NOT_CHECKED'),
        );
      },
    );
    await t.test(
      'cannot remove required prompt while routes enabled; replacement preserves prior jobs',
      async () => {
        await http('post', `/prompts/${v2.id}/deactivate`).expect(409);
        const job = await prisma.aiJob.create({
          data: {
            type: 'INCIDENT_ANALYSIS',
            promptVersionId: v2.id,
            promptHash: v2.promptHash,
            responseSchemaHash: v2.schemaHash,
            requestedById: users[0].id,
          },
        });
        await http('post', `/prompts/${v1.id}/activate`).expect(200);
        assert.equal(
          (await prisma.aiJob.findUnique({ where: { id: job.id } }))
            .promptVersionId,
          v2.id,
        );
        assert.equal(
          (await prisma.promptVersion.findUnique({ where: { id: v2.id } }))
            .systemPrompt,
          v2.systemPrompt,
        );
      },
    );
    await t.test(
      'reorders atomically without unique collisions, requires complete capability set',
      async () => {
        const reordered = (
          await http('put', '/routes/priorities')
            .send({
              capability: fixture.capability,
              routeIds: [route2.id, route1.id],
            })
            .expect(200)
        ).body.data;
        assert.deepEqual(
          reordered.items.map((item) => [item.id, item.priority]),
          [
            [route2.id, 1],
            [route1.id, 2],
          ],
        );
        await http('put', '/routes/priorities')
          .send({ capability: fixture.capability, routeIds: [route1.id] })
          .expect(409);
        await http('put', '/routes/priorities')
          .send({
            capability: fixture.capability,
            routeIds: [route1.id, randomUUID()],
          })
          .expect(409);
        await http('put', '/routes/priorities')
          .send({
            capability: fixture.capability,
            routeIds: [route1.id, route1.id],
          })
          .expect(400);
        await http('put', '/routes/priorities')
          .send({ capability: 'CHATBOT', routeIds: [route1.id, route2.id] })
          .expect(409);
        const again = (
          await http('put', '/routes/priorities')
            .send({
              capability: fixture.capability,
              routeIds: [route2.id, route1.id],
            })
            .expect(200)
        ).body.data;
        assert.equal(again.items[0].model, route2.model);
      },
    );
    await t.test(
      'concurrent reorder and activation maintain one active version and a valid order',
      async () => {
        const replies = await Promise.all([
          http('put', '/routes/priorities').send({
            capability: fixture.capability,
            routeIds: [route1.id, route2.id],
          }),
          http('put', '/routes/priorities').send({
            capability: fixture.capability,
            routeIds: [route2.id, route1.id],
          }),
          http('post', `/prompts/${v2.id}/activate`),
        ]);
        assert.ok(replies.every((reply) => reply.status === 200));
        const routes = await prisma.aiRoute.findMany({
          where: { capability: fixture.capability },
          orderBy: { priority: 'asc' },
        });
        assert.deepEqual(
          routes.map((route) => route.priority),
          [1, 2],
        );
        assert.equal(
          await prisma.promptVersion.count({
            where: { capability: fixture.capability, active: true },
          }),
          1,
        );
      },
    );
    await t.test(
      'audit failure rolls back new versions, activation and route reordering',
      async () => {
        const beforePrompts = await prisma.promptVersion.findMany({
          orderBy: { id: 'asc' },
        });
        const beforeRoutes = await prisma.aiRoute.findMany({
          orderBy: { id: 'asc' },
        });
        await testPool.query(
          "ALTER TABLE audit_logs ADD CONSTRAINT test_reject_ai_audit CHECK (action NOT LIKE 'AI_%') NOT VALID",
        );
        try {
          await http('post', '/prompts')
            .send(promptBody({ version: 3 }))
            .expect(500);
          const inactive = beforePrompts.find((prompt) => !prompt.active);
          await http('post', `/prompts/${inactive.id}/activate`).expect(500);
          await http('patch', `/routes/${route1.id}`)
            .send({ model: 'updated-model' })
            .expect(500);
          const reversed = [...beforeRoutes]
            .sort((a, b) => b.priority - a.priority)
            .map((route) => route.id);
          await http('put', '/routes/priorities')
            .send({ capability: fixture.capability, routeIds: reversed })
            .expect(500);
        } finally {
          await testPool.query(
            'ALTER TABLE audit_logs DROP CONSTRAINT test_reject_ai_audit',
          );
        }
        assert.deepEqual(
          await prisma.promptVersion.findMany({ orderBy: { id: 'asc' } }),
          beforePrompts,
        );
        assert.deepEqual(
          await prisma.aiRoute.findMany({ orderBy: { id: 'asc' } }),
          beforeRoutes,
        );
      },
    );
    await t.test(
      'disabled routes permit prompt deactivation; configured secret alone is insufficient',
      async () => {
        await http('patch', `/routes/${route1.id}`)
          .send({ enabled: false })
          .expect(200);
        const active = await prisma.promptVersion.findFirst({
          where: { capability: fixture.capability, active: true },
        });
        await http('post', `/prompts/${active.id}/deactivate`).expect(200);
        await http('post', `/prompts/${active.id}/deactivate`).expect(200);
        await http('patch', `/routes/${route1.id}`)
          .send({ enabled: true })
          .expect(409);
        const check = (
          await http('post', '/config/check')
            .send({ capability: fixture.capability })
            .expect(200)
        ).body.data.items[0];
        assert.ok(check.issues.includes('ACTIVE_PROMPT_REQUIRED'));
        assert.ok(check.issues.includes('ENABLED_ROUTE_REQUIRED'));
      },
    );
    await t.test(
      'chat schemas use bounded local validation; embedding routes do not require system prompts',
      async () => {
        const prompt = (
          await http('post', '/prompts')
            .send({
              name: 'municipal-chat',
              version: 1,
              capability: 'CHATBOT',
              systemPrompt: 'Responde con fuentes municipales.',
              responseSchema: {
                type: 'object',
                additionalProperties: false,
                properties: { answer: { type: 'string', maxLength: 2000 } },
                required: ['answer'],
              },
            })
            .expect(201)
        ).body.data;
        await http('post', `/prompts/${prompt.id}/activate`).expect(200);
        await http('post', '/routes')
          .send(routeBody({ capability: 'CHATBOT', enabled: true }))
          .expect(201);
        await http('post', '/routes')
          .send(routeBody({ capability: 'EMBEDDING', enabled: true }))
          .expect(201);
        const embedding = (
          await http('post', '/config/check')
            .send({ capability: 'EMBEDDING' })
            .expect(200)
        ).body.data.items[0];
        assert.equal(embedding.configurationReady, true);
        assert.equal(embedding.activePromptId, null);
        assert.equal(embedding.providerVerification, 'NOT_CHECKED');
        assert.equal(fetchMock.mock.callCount(), 0);
      },
    );
  },
);
