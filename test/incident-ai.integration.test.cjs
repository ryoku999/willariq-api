// Opt-in integration: disposable PostgreSQL schema + unique Redis queue prefix.
// Provider HTTP is intercepted: no real inference calls or charges.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test(
  'Incident classification: HTTP, outbox, Redis and worker',
  {
    skip: process.env.RUN_INCIDENT_AI_INTEGRATION_TESTS !== '1',
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
    const { Queue } = require('bullmq');
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
      IncidentQueueService,
      INCIDENT_QUEUE,
    } = require('../dist/src/infrastructure/queue/incident-queue.service');
    const {
      ClassificationProcessor,
    } = require('../dist/src/modules/incident-ai/processors/classification.processor');
    const {
      ClassificationProviderService,
      ProviderFailure,
    } = require('../dist/src/modules/incident-ai/providers/classification-provider.service');
    const {
      OutboxDispatcherService,
    } = require('../dist/src/modules/incident-ai/outbox-dispatcher.service');
    const schema = `willariq_classifier_test_${randomUUID().replaceAll('-', '')}`;
    const prefix = `test-willariq-${randomUUID()}`;
    assert.match(schema, /^willariq_classifier_test_[a-f0-9]{32}$/);
    assert.match(prefix, /^test-willariq-[a-f0-9-]{36}$/);
    const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    let app,
      prisma,
      testPool,
      created = false,
      queueService;
    const env = envSchema.parse({
      ...process.env,
      MINIO_ENABLED: 'false',
      MINIO_KNOWLEDGE_BUCKET: undefined,
      AI_ENABLED: 'true',
      AI_WORKER_ENABLED: 'false',
      BULLMQ_PREFIX: prefix,
      OUTBOX_POLL_INTERVAL_MS: '250',
      AI_JOB_HEARTBEAT_SECONDS: '1',
      AI_JOB_LEASE_SECONDS: '10',
      AI_JOB_MAX_TOTAL_MS: '5000',
      AI_JOB_MAX_ROUNDS: '1',
    });
    const config = new ConfigService({
      ...env,
      CEREBRAS_API_KEY: 'test-never-send',
      GROQ_API_KEY: 'test-never-send',
      OPENROUTER_API_KEY: 'test-never-send',
    });
    t.after(async () => {
      try {
        config.set('AI_ENABLED', false);
        config.set('AI_WORKER_ENABLED', false);
        if (app) await app.close();
        if (queueService) {
          assert.match(prefix, /^test-willariq-[a-f0-9-]{36}$/);
          const cleanup = new Queue(INCIDENT_QUEUE, {
            prefix,
            connection: {
              host: env.REDIS_HOST,
              port: env.REDIS_PORT,
              password: env.REDIS_PASSWORD || undefined,
              db: env.REDIS_DB,
              maxRetriesPerRequest: 1,
              commandTimeout: 3000,
            },
          });
          cleanup.on('error', () => {});
          try {
            await cleanup.obliterate({ force: true });
          } finally {
            await cleanup.close();
          }
        }
      } finally {
        try {
          if (prisma) await prisma.$disconnect();
          if (testPool) await testPool.end();
        } finally {
          try {
            if (created) {
              assert.match(schema, /^willariq_classifier_test_[a-f0-9]{32}$/);
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
    created = true;
    testPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    for (const folder of [
      '20260916021124_init',
      '20261015180000_ai_prompt_activation',
      '20261105040000_notification_event_key',
      '20261105050000_account_session_version',
      '20261106090000_markdown_knowledge',
    ]) {
      const sql = await readFile(
        path.join(__dirname, '../prisma/migrations', folder, 'migration.sql'),
        'utf8',
      );
      assert.ok(!sql.includes('"public".'));
      await testPool.query(sql);
    }
    prisma = new PrismaClient({ adapter: new PrismaPg(testPool, { schema }) });
    const module = await Test.createTestingModule({ imports: [AppModule] })
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
    app = module.createNestApplication({ logger: false });
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
    queueService = app.get(IncidentQueueService);
    const processor = app.get(ClassificationProcessor);
    const provider = app.get(ClassificationProviderService);
    const dispatcher = app.get(OutboxDispatcherService);
    const fixture = JSON.parse(
      await readFile(
        path.join(__dirname, '../docs/ai/incident-classification-v1.json'),
        'utf8',
      ),
    );
    const output = JSON.parse(
      await readFile(
        path.join(
          __dirname,
          '../docs/ai/incident-classification-output-example.json',
        ),
        'utf8',
      ),
    ).output;
    const {
      AiSchemaService,
    } = require('../dist/src/modules/ai-config/ai-schema.service');
    const prompt = await prisma.promptVersion.create({
      data: {
        ...fixture,
        active: true,
        responseSchema: app.get(AiSchemaService).classificationContract(),
      },
    });
    const route = await prisma.aiRoute.create({
      data: {
        capability: 'INCIDENT_CLASSIFICATION',
        provider: 'CEREBRAS',
        model: 'offline-test',
        priority: 1,
        enabled: true,
        timeoutMs: 1000,
      },
    });
    const users = [];
    for (const [index, role] of [
      'CITIZEN',
      'ADMIN',
      'SUPERVISOR',
      'CITIZEN',
      'OPERATOR',
    ].entries())
      users.push(
        await prisma.user.create({
          data: {
            firstName: `Classifier fixture ${index}`,
            dni: String(61000000 + index),
            phone: String(961000000 + index),
            passwordHash: 'no-login',
            role,
          },
        }),
      );
    const tokens = await Promise.all(
      users.map((user) =>
        app.get(JwtService).signAsync({ sub: user.id, role: user.role }),
      ),
    );
    const http = (method, url, user = 0) =>
      request(app.getHttpServer())
        [method](`/api${url}`)
        .set('Authorization', `Bearer ${tokens[user]}`);
    const create = async (text = 'Hay basura acumulada junto al mercado') =>
      (
        await http('post', '/incidents')
          .send({
            clientRequestId: randomUUID(),
            originalMessage: text,
            latitude: -12.04,
            longitude: -77.03,
          })
          .expect(201)
      ).body.data;
    const submit = async (incident) =>
      (
        await http('post', `/incidents/${incident.id}/submit`)
          .send({ expectedVersion: incident.version })
          .expect(202)
      ).body.data;
    const waitFor = async (fn) => {
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        const result = await fn();
        if (result) return result;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.fail('Timed out waiting for isolated job');
    };
    let mode = 'success',
      calls = 0;
    const fetchMock = t.mock.method(
      globalThis,
      'fetch',
      async (_url, options) => {
        calls++;
        assert.equal(options.redirect, 'error');
        assert.ok(options.signal);
        const body = JSON.parse(options.body);
        assert.equal(body.response_format.type, 'json_object');
        assert.ok(!body.messages[1].content.includes('reporterId'));
        if (mode === '429')
          return new Response('private-error-test-never-expose', {
            status: 429,
            headers: { 'retry-after': '0' },
          });
        if (mode === 'invalid')
          return new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: 'stop',
                  message: { content: '{"category":"INVALID"}' },
                },
              ],
            }),
          );
        if (mode === 'timeout')
          return new Promise((_resolve, reject) =>
            options.signal.addEventListener('abort', () =>
              reject(new Error('private-timeout-details')),
            ),
          );
        if (mode === 'network')
          throw new Error('Authorization Bearer private-key-never-expose');
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: JSON.stringify(output) },
              },
            ],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 20,
              total_tokens: 35,
            },
          }),
        );
      },
    );

    await t.test('guards, ownership and strict expectedVersion', async () => {
      const incident = await create();
      await request(app.getHttpServer())
        .post(`/api/incidents/${incident.id}/submit`)
        .send({ expectedVersion: 1 })
        .expect(401);
      await http('post', `/incidents/${incident.id}/submit`, 1)
        .send({ expectedVersion: 1 })
        .expect(403);
      await http('post', `/incidents/${incident.id}/submit`, 3)
        .send({ expectedVersion: 1 })
        .expect(404);
      await http('post', `/incidents/${incident.id}/submit`)
        .send({ expectedVersion: '1' })
        .expect(400);
      await http('post', `/incidents/${incident.id}/submit`)
        .send({ expectedVersion: 99 })
        .expect(409);
      await http('get', `/incidents/${incident.id}/ai-jobs`, 3).expect(404);
      await http('get', '/admin/queues/outbox').expect(403);
    });

    await t.test(
      'audit failure rolls back submission and outbox together',
      async () => {
        const incident = await create();
        await testPool.query(
          "ALTER TABLE audit_logs ADD CONSTRAINT test_reject_submit_audit CHECK (action <> 'INCIDENT_SUBMITTED') NOT VALID",
        );
        try {
          await http('post', `/incidents/${incident.id}/submit`)
            .send({ expectedVersion: incident.version })
            .expect(500);
          assert.equal(
            await prisma.aiJob.count({ where: { incidentId: incident.id } }),
            0,
          );
          assert.equal(
            (
              await prisma.incident.findUniqueOrThrow({
                where: { id: incident.id },
              })
            ).status,
            'RECEIVED',
          );
        } finally {
          await testPool.query(
            'ALTER TABLE audit_logs DROP CONSTRAINT test_reject_submit_audit',
          );
        }
      },
    );

    let firstIncident, firstJob;
    await t.test(
      'concurrent submit creates exactly one snapshot/job/outbox',
      async () => {
        firstIncident = await create();
        const results = await Promise.all(
          [1, 2].map(() =>
            http('post', `/incidents/${firstIncident.id}/submit`).send({
              expectedVersion: 1,
            }),
          ),
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [202, 409]);
        firstJob = results.find((r) => r.status === 202).body.data.jobId;
        const job = await prisma.aiJob.findUniqueOrThrow({
          where: { id: firstJob },
        });
        assert.equal(job.promptVersionId, prompt.id);
        assert.equal(job.incidentVersion, 2);
        assert.equal(job.inputPayload.systemPrompt, fixture.systemPrompt);
        assert.equal(
          await prisma.aiJob.count({ where: { incidentId: firstIncident.id } }),
          1,
        );
        assert.equal(
          await prisma.queueOutbox.count({ where: { aggregateId: firstJob } }),
          1,
        );
      },
    );

    await t.test(
      'strict valid classification + history + audit + notification; duplicate deliveries are harmless',
      async () => {
        const before = calls;
        await processor.process(firstJob);
        await processor.process(firstJob);
        assert.equal(calls - before, 1);
        const incident = await prisma.incident.findUniqueOrThrow({
          where: { id: firstIncident.id },
          include: { entities: true },
        });
        assert.equal(incident.status, 'IN_REVIEW');
        assert.equal(incident.version, 3);
        assert.equal(incident.classificationSource, 'AI');
        assert.equal(incident.originalMessage, firstIncident.originalMessage);
        assert.equal(incident.entities.length, output.entities.length);
        assert.equal(
          await prisma.notification.count({
            where: { data: { path: ['jobId'], equals: firstJob } },
          }),
          1,
        );
        const detail = (
          await http('get', `/admin/ai/jobs/${firstJob}`, 1).expect(200)
        ).body.data;
        assert.equal(detail.status, 'COMPLETED');
        assert.equal(detail.attempts[0].totalTokens, 35);
        assert.ok(!JSON.stringify(detail).includes(fixture.systemPrompt));
        assert.ok(!JSON.stringify(detail).includes('test-never-send'));
        await http('get', `/admin/ai/jobs/${firstJob}`).expect(403);
        const list = (
          await http('get', `/incidents/${firstIncident.id}/ai-jobs`).expect(
            200,
          )
        ).body.data;
        assert.equal(list.items[0].id, firstJob);
        assert.ok(!('attempts' in list.items[0]));
        await http('post', `/incidents/${firstIncident.id}/ai/retry`, 1)
          .send({ expectedVersion: 3 })
          .expect(409);
      },
    );

    let failedIncident, failedJob;
    for (const [failureMode, expected] of [
      ['429', 'RATE_LIMITED'],
      ['invalid', 'INVALID_RESPONSE'],
      ['timeout', 'TIMEOUT'],
      ['network', 'FAILED'],
    ]) {
      await t.test(
        `${failureMode}: bounded failure, sanitized diagnostics and manual fallback`,
        async () => {
          mode = failureMode;
          const incident = await create();
          const sent = await submit(incident);
          await processor.process(sent.jobId);
          const job = await prisma.aiJob.findUniqueOrThrow({
            where: { id: sent.jobId },
            include: { attempts: true },
          });
          assert.equal(job.status, 'FAILED');
          assert.equal(job.attempts[0].status, expected);
          const current = await prisma.incident.findUniqueOrThrow({
            where: { id: incident.id },
          });
          assert.equal(current.status, 'IN_REVIEW');
          assert.equal(current.classificationSource, 'MANUAL_WITHOUT_AI');
          assert.equal(current.requiresSupervision, true);
          assert.ok(
            !JSON.stringify(
              (await http('get', `/admin/ai/jobs/${sent.jobId}`, 1)).body,
            ).includes('private-'),
          );
          failedIncident = current;
          failedJob = sent.jobId;
        },
      );
    }
    mode = 'success';

    await t.test(
      'retry creates linked job, keeps failed attempts, rejects non-manager operator',
      async () => {
        await http('post', `/incidents/${failedIncident.id}/ai/retry`, 4)
          .send({ expectedVersion: failedIncident.version })
          .expect(404);
        const retried = (
          await http('post', `/incidents/${failedIncident.id}/ai/retry`, 2)
            .send({ expectedVersion: failedIncident.version })
            .expect(202)
        ).body.data;
        assert.equal(
          (
            await prisma.aiJob.findUniqueOrThrow({
              where: { id: retried.jobId },
            })
          ).retryOfJobId,
          failedJob,
        );
        await processor.process(retried.jobId);
        assert.equal(
          (await prisma.aiJob.findUniqueOrThrow({ where: { id: failedJob } }))
            .status,
          'FAILED',
        );
        assert.equal(
          (
            await prisma.aiJob.findUniqueOrThrow({
              where: { id: retried.jobId },
            })
          ).status,
          'COMPLETED',
        );
      },
    );

    await t.test(
      'route priority fallback persists every provider attempt',
      async () => {
        const secondary = await prisma.aiRoute.create({
          data: {
            capability: 'INCIDENT_CLASSIFICATION',
            provider: 'GROQ',
            model: 'offline-fallback',
            priority: 2,
            enabled: true,
            timeoutMs: 1000,
          },
        });
        const original = provider.classify.bind(provider);
        const mock = t.mock.method(provider, 'classify', async (r, s, ms) => {
          if (r.provider === 'CEREBRAS')
            throw new ProviderFailure('RATE_LIMITED');
          return original(r, s, ms);
        });
        try {
          const incident = await create();
          const sent = await submit(incident);
          await processor.process(sent.jobId);
          const job = await prisma.aiJob.findUniqueOrThrow({
            where: { id: sent.jobId },
            include: { attempts: { orderBy: { sequence: 'asc' } } },
          });
          assert.equal(job.finalProvider, 'GROQ');
          assert.deepEqual(
            job.attempts.map((a) => a.status),
            ['RATE_LIMITED', 'SUCCESS'],
          );
        } finally {
          mock.mock.restore();
          await prisma.aiRoute.delete({ where: { id: secondary.id } });
        }
      },
    );

    await t.test(
      'stale incident cannot be overwritten by old AI result',
      async () => {
        const incident = await create();
        const sent = await submit(incident);
        await prisma.incident.update({
          where: { id: incident.id },
          data: {
            classificationSource: 'HUMAN',
            improvedDescription: 'Human decision',
            version: { increment: 1 },
          },
        });
        await processor.process(sent.jobId);
        const current = await prisma.incident.findUniqueOrThrow({
          where: { id: incident.id },
        });
        assert.equal(current.improvedDescription, 'Human decision');
        const job = await prisma.aiJob.findUniqueOrThrow({
          where: { id: sent.jobId },
        });
        assert.equal(job.status, 'CANCELLED');
        assert.equal(job.resultApplied, false);
      },
    );

    await t.test(
      'expired worker lease recovers without losing the original deadline',
      async () => {
        const incident = await create();
        const sent = await submit(incident);
        const startedAt = new Date(Date.now() - 20000);
        await prisma.aiJob.update({
          where: { id: sent.jobId },
          data: {
            status: 'PROCESSING',
            processingToken: randomUUID(),
            processingLeaseUntil: new Date(Date.now() - 1000),
            startedAt,
          },
        });
        await processor.process(sent.jobId);
        const job = await prisma.aiJob.findUniqueOrThrow({
          where: { id: sent.jobId },
        });
        assert.equal(job.status, 'FAILED');
        assert.equal(job.errorSummary, 'TIME_BUDGET_EXCEEDED');
        assert.equal(job.startedAt.getTime(), startedAt.getTime());
      },
    );

    await t.test(
      'pending evidence blocks submit; disabled AI explicitly chooses manual review',
      async () => {
        const incident = await create();
        const intent = await prisma.evidenceUploadIntent.create({
          data: {
            incidentId: incident.id,
            requestedById: users[0].id,
            bucket: 'test-private',
            objectKey: 'test',
            fileName: 'test.jpg',
            declaredMimeType: 'image/jpeg',
            declaredSizeBytes: 100n,
            expiresAt: new Date(Date.now() + 60000),
          },
        });
        await http('post', `/incidents/${incident.id}/submit`)
          .send({ expectedVersion: 1 })
          .expect(409);
        await prisma.evidenceUploadIntent.update({
          where: { id: intent.id },
          data: { status: 'REJECTED' },
        });
        config.set('AI_ENABLED', false);
        try {
          const sent = await submit(incident);
          assert.equal(sent.jobId, null);
          assert.equal(sent.status, 'IN_REVIEW');
          assert.equal(sent.analysisMode, 'MANUAL_WITHOUT_AI');
        } finally {
          config.set('AI_ENABLED', true);
        }
      },
    );

    await t.test(
      'snapshot keeps the original model after route changes',
      async () => {
        const incident = await create();
        const sent = await submit(incident);
        await prisma.aiRoute.update({
          where: { id: route.id },
          data: { model: 'changed-after-submission' },
        });
        try {
          await processor.process(sent.jobId);
          assert.equal(
            (
              await prisma.aiJob.findUniqueOrThrow({
                where: { id: sent.jobId },
              })
            ).finalModel,
            'offline-test',
          );
        } finally {
          await prisma.aiRoute.update({
            where: { id: route.id },
            data: { model: 'offline-test' },
          });
        }
      },
    );

    await t.test(
      'a live lease rejects duplicate workers and heartbeat extends ownership',
      async () => {
        const incident = await create();
        const sent = await submit(incident);
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        let started = false;
        const original = provider.classify.bind(provider);
        const mock = t.mock.method(provider, 'classify', async (...args) => {
          started = true;
          await gate;
          return original(...args);
        });
        const running = processor.process(sent.jobId);
        try {
          await waitFor(async () => started);
          const initial = await prisma.aiJob.findUniqueOrThrow({
            where: { id: sent.jobId },
          });
          await processor.process(sent.jobId);
          await waitFor(
            async () =>
              (
                await prisma.aiJob.findUniqueOrThrow({
                  where: { id: sent.jobId },
                })
              ).heartbeatAt > initial.heartbeatAt,
          );
          assert.equal(mock.mock.callCount(), 1);
        } finally {
          release();
          await running;
          mock.mock.restore();
        }
        assert.equal(
          (await prisma.aiJob.findUniqueOrThrow({ where: { id: sent.jobId } }))
            .status,
          'COMPLETED',
        );
      },
    );

    await t.test('DEAD outbox retry is ADMIN-only and audited', async () => {
      const incident = await create();
      const sent = await submit(incident);
      const entry = await prisma.queueOutbox.findUniqueOrThrow({
        where: {
          eventType_aggregateId: {
            eventType: 'INCIDENT_CLASSIFICATION_REQUESTED',
            aggregateId: sent.jobId,
          },
        },
      });
      await prisma.queueOutbox.update({
        where: { id: entry.id },
        data: { status: 'DEAD' },
      });
      await http('post', `/admin/queues/outbox/${entry.id}/retry`, 2).expect(
        403,
      );
      await http('post', `/admin/queues/outbox/${entry.id}/retry`, 1).expect(
        202,
      );
      assert.equal(
        await prisma.auditLog.count({
          where: { action: 'OUTBOX_RETRIED', entityId: entry.id },
        }),
        1,
      );
      await processor.process(sent.jobId);
    });

    await t.test(
      'Redis publishing failure keeps business data; later dispatch runs a real BullMQ worker',
      async () => {
        const publishMock = t.mock.method(queueService, 'publish', async () => {
          throw new Error('simulated Redis offline');
        });
        const incident = await create();
        const sent = await submit(incident);
        await waitFor(
          async () =>
            await prisma.queueOutbox.findFirst({
              where: {
                aggregateId: sent.jobId,
                attempts: { gt: 0 },
                status: 'PENDING',
              },
            }),
        );
        assert.equal(
          (
            await prisma.incident.findUniqueOrThrow({
              where: { id: incident.id },
            })
          ).status,
          'AI_ANALYSIS',
        );
        publishMock.mock.restore();
        queueService.start((id) => processor.process(id));
        try {
          await waitFor(
            async () =>
              (
                await prisma.aiJob.findUniqueOrThrow({
                  where: { id: sent.jobId },
                })
              ).status === 'COMPLETED',
          );
        } catch {
          const job = await prisma.aiJob.findUniqueOrThrow({
            where: { id: sent.jobId },
          });
          const entry = await prisma.queueOutbox.findFirst({
            where: { aggregateId: sent.jobId },
          });
          assert.fail(
            JSON.stringify({
              status: job.status,
              errorSummary: job.errorSummary,
              bullAttempts: job.bullAttempts,
              outboxStatus: entry?.status,
              attempts: entry?.attempts,
              lastError: entry?.lastError,
              queue: await queueService.health(),
            }),
          );
        }
        assert.equal(
          (
            await prisma.incident.findUniqueOrThrow({
              where: { id: incident.id },
            })
          ).status,
          'IN_REVIEW',
        );
        const health = (await http('get', '/health', 1).expect(200)).body.data;
        assert.equal(health.services.database, true);
        assert.equal(health.services.redis, true);
      },
    );
    await t.test(
      'published job removed from isolated Redis queue is reconciled from PostgreSQL',
      async () => {
        const isolatedQueue = queueService.queue();
        await isolatedQueue.pause();
        const incident = await create();
        const sent = await submit(incident);
        try {
          await waitFor(async () =>
            prisma.queueOutbox.findFirst({
              where: { aggregateId: sent.jobId, status: 'PUBLISHED' },
            }),
          );
          const lost = await isolatedQueue.getJob(sent.jobId);
          assert.ok(lost);
          await lost.remove();
          await prisma.aiJob.update({
            where: { id: sent.jobId },
            data: { updatedAt: new Date(Date.now() - 60000) },
          });
          await waitFor(async () =>
            prisma.queueOutbox.findFirst({
              where: {
                aggregateId: sent.jobId,
                attempts: { gte: 2 },
                status: 'PUBLISHED',
              },
            }),
          );
        } finally {
          await isolatedQueue.resume();
        }
        await waitFor(
          async () =>
            (
              await prisma.aiJob.findUniqueOrThrow({
                where: { id: sent.jobId },
              })
            ).status === 'COMPLETED',
        );
      },
    );

    await t.test(
      'unreachable Redis health and shutdown are bounded',
      async () => {
        const unavailable = new IncidentQueueService(
          new ConfigService({ ...env, REDIS_HOST: '127.0.0.1', REDIS_PORT: 1 }),
        );
        const began = Date.now();
        try {
          assert.equal((await unavailable.health()).available, false);
        } finally {
          await unavailable.beforeApplicationShutdown();
        }
        assert.ok(Date.now() - began < 6000);
      },
    );

    assert.ok(fetchMock.mock.callCount() > 0);
    assert.ok(await prisma.aiRoute.findUnique({ where: { id: route.id } }));
  },
);
