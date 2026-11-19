// No Nest application, HTTP listener, Redis, storage or inference provider is started.
// All SQL changes are confined to a random schema, removed in finally.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
require('reflect-metadata');

const load = (file) =>
  require(
    path.join(
      process.env.WORKFLOW_BUILD_ROOT || path.join(__dirname, '../dist/src'),
      file,
    ),
  );
const conflict = (error) => error.getStatus?.() === 409;
const forbidden = (error) => error.getStatus?.() === 403;
const hidden = (error) => error.getStatus?.() === 404;

test('Workflow DTO rejects missing versions, missing reasons, extra properties and malformed classifications', async () => {
  const { ValidationPipe } = require('@nestjs/common');
  const { ReviewIncidentDto, RejectIncidentDto, AssignmentVersionDto } = load(
    'modules/incidents/dto/incident-workflow.dto',
  );
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const check = (body, metatype) =>
    pipe.transform(body, { type: 'body', metatype });
  for (const [body, type] of [
    [{}, AssignmentVersionDto],
    [{ expectedVersion: 1, rejectionReason: 'OTHER' }, RejectIncidentDto],
    [{ expectedVersion: 1, role: 'ADMIN' }, ReviewIncidentDto],
  ]) {
    await assert.rejects(
      () => check(body, type),
      (error) => error.getStatus() === 400,
    );
  }
});

test('Workflow controllers keep JWT and role guards on every operation', () => {
  const { IncidentWorkflowController } = load(
    'modules/incidents/incident-workflow.controller',
  );
  const { AssignmentsController } = load(
    'modules/assignments/assignments.controller',
  );
  for (const controller of [
    IncidentWorkflowController,
    AssignmentsController,
  ]) {
    for (const name of Object.getOwnPropertyNames(controller.prototype).filter(
      (name) => name !== 'constructor',
    )) {
      const handler = controller.prototype[name];
      assert.deepEqual(
        Reflect.getMetadata('__guards__', handler).map((guard) => guard.name),
        ['JwtAuthGuard', 'RoleGuard'],
      );
      const roles = Reflect.getMetadata('roles', handler);
      if (name !== 'list')
        assert.ok(roles.length > 0 && !roles.includes('CITIZEN'));
    }
  }
  for (const name of ['review', 'accept', 'reject', 'close']) {
    assert.deepEqual(
      Reflect.getMetadata('roles', IncidentWorkflowController.prototype[name]),
      ['ADMIN', 'SUPERVISOR'],
    );
  }
});

test('Nest resolves the new modules without starting an application or opening services', async () => {
  require('dotenv').config({ quiet: true });
  const { Test } = require('@nestjs/testing');
  const { ConfigService } = require('@nestjs/config');
  const { AppModule } = load('app.module');
  const { DatabaseService } = load('database/database.service');
  const { envSchema } = load('config/env.config');
  const config = new ConfigService(
    envSchema.parse({
      ...process.env,
      MINIO_ENABLED: 'false',
      MINIO_KNOWLEDGE_BUCKET: undefined,
      AI_ENABLED: 'false',
      AI_WORKER_ENABLED: 'false',
    }),
  );
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue({})
    .overrideProvider(ConfigService)
    .useValue(config)
    .compile();
  try {
    const { IncidentWorkflowService } = load(
      'modules/incidents/incident-workflow.service',
    );
    assert.ok(module.get(IncidentWorkflowService));
  } finally {
    await module.close();
  }
});

test(
  'Human review and assignments: isolated PostgreSQL transactions',
  {
    skip: process.env.RUN_INCIDENT_WORKFLOW_INTEGRATION_TESTS !== '1',
    timeout: 90000,
  },
  async (t) => {
    require('dotenv').config({ quiet: true });
    const { Pool } = require('pg');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { PrismaClient } = load('generated/prisma/client');
    const { IncidentWorkflowService } = load(
      'modules/incidents/incident-workflow.service',
    );
    const { IncidentAccessService } = load(
      'modules/incidents/incident-access.service',
    );
    const { IncidentsService } = load('modules/incidents/incidents.service');
    const { AuditService } = load('modules/audit/audit.service');
    const { MunicipalAreasService } = load(
      'modules/municipal-areas/municipal-areas.service',
    );
    const { MunicipalAreaMembersService } = load(
      'modules/municipal-areas/members/municipal-area-members.service',
    );
    const { UsersService } = load('modules/users/users.service');
    const schema = `willariq_workflow_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(schema, /^willariq_workflow_test_[a-f0-9]{32}$/);
    const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    let pool,
      db,
      created = false;
    try {
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path=${schema},public`,
      });
      for (const name of [
        '20260916021124_init',
        '20261015180000_ai_prompt_activation',
        '20261105030000_active_incident_assignment',
        '20261105040000_notification_event_key',
        '20261105050000_account_session_version',
        '20261106090000_markdown_knowledge',
      ]) {
        const sql = await readFile(
          path.join(__dirname, '../prisma/migrations', name, 'migration.sql'),
          'utf8',
        );
        assert.ok(!sql.includes('"public".'));
        await pool.query(sql);
      }
      db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
      const access = new IncidentAccessService();
      const audit = new AuditService(db);
      const workflow = new IncidentWorkflowService(db, audit, access);
      const incidents = new IncidentsService(db, audit, access, null);
      const areas = new MunicipalAreasService(db, audit);
      const members = new MunicipalAreaMembersService(db, audit);
      const users = new UsersService(db, audit);
      const accounts = {};
      let n = 0;
      for (const [name, role] of [
        ['admin', 'ADMIN'],
        ['supervisor', 'SUPERVISOR'],
        ['manager', 'OPERATOR'],
        ['operator', 'OPERATOR'],
        ['other', 'OPERATOR'],
        ['citizen', 'CITIZEN'],
        ['stranger', 'CITIZEN'],
      ]) {
        n++;
        accounts[name] = await db.user.create({
          data: {
            firstName: name,
            dni: String(n).padStart(8, '0'),
            phone: String(n).padStart(9, '0'),
            passwordHash: 'fixture-not-for-login',
            role,
          },
        });
      }
      const { admin, supervisor, manager, operator, other, citizen, stranger } =
        accounts;
      const area = await areas.create(
        admin.id,
        { code: 'LIMPIEZA', name: 'Limpieza Publica' },
        {},
      );
      const foreignArea = await areas.create(
        admin.id,
        { code: 'OTRA', name: 'Otra area' },
        {},
      );
      await members.addMember(
        admin,
        area.id,
        { userId: manager.id, role: 'MANAGER' },
        {},
      );
      await members.addMember(
        admin,
        area.id,
        { userId: operator.id, role: 'OPERATOR' },
        {},
      );
      await members.addMember(
        admin,
        foreignArea.id,
        { userId: other.id, role: 'MANAGER' },
        {},
      );
      const classification = {
        improvedDescription: 'Se reporta basura.',
        recommendedAction: 'Evaluar recoleccion.',
        type: 'ENVIRONMENT',
        category: 'GARBAGE_ACCUMULATION',
        urgency: 'LOW',
        sentiment: 'NEUTRAL',
        requiresSupervision: false,
        keywords: ['basura'],
        entities: [],
      };
      const make = (data = {}) =>
        db.incident.create({
          data: {
            reporterId: citizen.id,
            clientRequestId: randomUUID(),
            trackingCode: randomUUID().slice(0, 25),
            originalMessage: 'Basura',
            latitude: -12,
            longitude: -77,
            status: 'IN_REVIEW',
            classificationSource: 'AI',
            ...Object.fromEntries(
              Object.entries(classification).filter(
                ([key]) => key !== 'entities',
              ),
            ),
            ...data,
          },
        });
      const versions = (result) => ({
        expectedVersion: result.incident.version,
        assignmentId: result.assignment.id,
        expectedAssignmentVersion: result.assignment.version,
      });

      await t.test(
        'dashboard metrics reuse scope for operator, manager and global roles',
        async () => {
          const { DashboardController } = load(
            'modules/incidents/dashboard.controller',
          );
          const dashboard = new DashboardController(db, access);
          const resolvedAt = new Date(Date.now() - 60_000);
          const visible = await make({
            status: 'RESOLVED',
            urgency: 'LOW',
            resolvedAt,
            createdAt: new Date(resolvedAt.getTime() - 600_000),
          });
          const hiddenCase = await make({
            status: 'RESOLVED',
            urgency: 'CRITICAL',
            resolvedAt,
            createdAt: new Date(resolvedAt.getTime() - 3600_000),
          });
          const waiting = await make({ status: 'IN_REVIEW', urgency: 'HIGH' });
          await db.incidentAssignment.createMany({
            data: [
              {
                incidentId: visible.id,
                areaId: area.id,
                operatorId: operator.id,
                status: 'COMPLETED',
              },
              {
                incidentId: hiddenCase.id,
                areaId: foreignArea.id,
                operatorId: other.id,
                status: 'COMPLETED',
              },
            ],
          });
          const personal = await dashboard.summary(operator);
          assert.equal(personal.total, 1);
          assert.deepEqual(personal.byUrgency, [{ urgency: 'LOW', count: 1 }]);
          assert.equal(personal.resolution.averageMinutes, 10);
          const managed = await dashboard.summary(manager);
          assert.equal(managed.total, 1);
          assert.deepEqual(managed.managedAreaIds, [area.id]);
          for (const actor of [admin, supervisor]) {
            const global = await dashboard.summary(actor);
            assert.equal(global.total, 3);
            assert.equal(global.resolution.averageMinutes, 35);
          }
          await db.incident.deleteMany({
            where: { id: { in: [visible.id, hiddenCase.id, waiting.id] } },
          });
        },
      );

      await t.test(
        'global review; stale version and operator decision denied; manual fallback can be completed',
        async () => {
          const i = await make({
            classificationSource: 'MANUAL_WITHOUT_AI',
            type: null,
            category: null,
          });
          await assert.rejects(
            () =>
              workflow.decide(admin, i.id, { expectedVersion: 1 }, true, {}),
            conflict,
          );
          await assert.rejects(
            async () =>
              workflow.review(
                operator,
                i.id,
                { ...classification, expectedVersion: 1, reason: 'Revision' },
                {},
              ),
            forbidden,
          );
          const reviewed = await workflow.review(
            supervisor,
            i.id,
            {
              ...classification,
              expectedVersion: 1,
              reason: 'Revision de reporte',
            },
            {},
          );
          assert.equal(reviewed.incident.classificationSource, 'HUMAN');
          await assert.rejects(
            () =>
              workflow.decide(admin, i.id, { expectedVersion: 1 }, true, {}),
            conflict,
          );
          const accepted = await workflow.decide(
            admin,
            i.id,
            { expectedVersion: reviewed.incident.version },
            true,
            {},
          );
          assert.equal(accepted.incident.status, 'ACCEPTED');
        },
      );

      await t.test(
        'complete flow, ownership, supervision, membership and close guards',
        async () => {
          const i = await make({ requiresSupervision: true });
          await assert.rejects(
            async () =>
              workflow.decide(manager, i.id, { expectedVersion: 1 }, true, {}),
            forbidden,
          );
          let result = await workflow.decide(
            admin,
            i.id,
            { expectedVersion: 1 },
            true,
            {},
          );
          await assert.rejects(
            () =>
              workflow.assign(
                admin,
                i.id,
                {
                  expectedVersion: result.incident.version,
                  areaId: area.id,
                  operatorId: other.id,
                },
                {},
              ),
            conflict,
          );
          result = await workflow.assign(
            admin,
            i.id,
            {
              expectedVersion: result.incident.version,
              areaId: area.id,
              operatorId: operator.id,
            },
            {},
          );
          assert.equal(result.incident.status, 'ASSIGNED');
          await assert.rejects(
            () =>
              workflow.close(
                admin,
                i.id,
                { expectedVersion: result.incident.version },
                {},
              ),
            conflict,
          );
          await assert.rejects(
            () =>
              workflow.workByAssignment(
                manager,
                result.assignment.id,
                versions(result),
                'accept',
                {},
              ),
            forbidden,
          );
          await assert.rejects(
            () =>
              workflow.workByAssignment(
                other,
                result.assignment.id,
                versions(result),
                'accept',
                {},
              ),
            hidden,
          );
          await assert.rejects(
            () => workflow.work(operator, i.id, versions(result), 'start', {}),
            conflict,
          );
          await assert.rejects(
            () =>
              areas.updateStatus(admin.id, area.id, { status: 'INACTIVE' }, {}),
            conflict,
          );
          await assert.rejects(
            () => members.removeMember(admin, area.id, operator.id, {}),
            conflict,
          );
          await assert.rejects(
            () =>
              users.updateStatus(
                admin.id,
                operator.id,
                { status: 'INACTIVE' },
                {},
              ),
            conflict,
          );
          await assert.rejects(
            () =>
              users.updateRole(admin.id, operator.id, { role: 'CITIZEN' }, {}),
            conflict,
          );
          result = await workflow.workByAssignment(
            operator,
            result.assignment.id,
            versions(result),
            'accept',
            {},
          );
          assert.equal(result.assignment.status, 'ACCEPTED');
          assert.equal(result.incident.status, 'ASSIGNED');
          result = await workflow.work(
            operator,
            i.id,
            versions(result),
            'start',
            {},
          );
          const { EvidenceService } = load('modules/evidence/evidence.service');
          const evidence = new EvidenceService(
            db,
            access,
            { enabled: true, evidenceBucket: 'test-only' },
            {},
            audit,
            {
              getOrThrow: (key) =>
                ({
                  EVIDENCE_MAX_IMAGE_BYTES: 5242880,
                  EVIDENCE_MAX_FILES_PER_INCIDENT: 5,
                  EVIDENCE_MAX_TOTAL_BYTES_PER_INCIDENT: 26214400,
                })[key],
            },
          );
          await evidence.assertCanUpload(operator, i.id);
          await assert.rejects(
            () => evidence.assertCanUpload(manager, i.id),
            forbidden,
          );
          await assert.rejects(
            () => evidence.assertCanUpload(citizen, i.id),
            conflict,
          );
          const intent = await db.evidenceUploadIntent.create({
            data: {
              incidentId: i.id,
              requestedById: operator.id,
              bucket: 'test-only',
              objectKey: randomUUID(),
              fileName: 'image.png',
              declaredMimeType: 'image/png',
              declaredSizeBytes: 100,
              expiresAt: new Date(Date.now() + 60000),
            },
          });
          await assert.rejects(
            () =>
              workflow.work(
                operator,
                i.id,
                { ...versions(result), resolutionSummary: 'Trabajo realizado' },
                'resolve',
                {},
              ),
            conflict,
          );
          await db.evidenceUploadIntent.update({
            where: { id: intent.id },
            data: { status: 'EXPIRED' },
          });

          result = await workflow.work(
            operator,
            i.id,
            {
              ...versions(result),
              resolutionSummary: 'Se retiro la basura y se limpio el lugar.',
            },
            'resolve',
            {},
          );
          assert.equal(result.assignment.status, 'COMPLETED');
          result = await workflow.close(
            supervisor,
            i.id,
            { expectedVersion: result.incident.version },
            {},
          );
          assert.equal(result.incident.status, 'CLOSED');
          assert.equal(
            (await workflow.list(operator, { page: 1, limit: 20 })).items
              .length,
            1,
          );
          await assert.rejects(
            () => workflow.list(stranger, { page: 1, limit: 20 }, i.id),
            hidden,
          );
          assert.ok(
            (await db.auditLog.count({ where: { entityId: i.id } })) >= 6,
          );
          assert.ok(
            (await db.notification.count({ where: { userId: citizen.id } })) >=
              6,
          );
        },
      );

      await t.test(
        'race creates one active assignment, SQL index blocks direct duplicate, reassign preserves trace, cancel returns ACCEPTED',
        async () => {
          const i = await make({ status: 'ACCEPTED' });
          const requests = await Promise.allSettled(
            [1, 2].map(() =>
              workflow.assign(
                admin,
                i.id,
                {
                  expectedVersion: 1,
                  areaId: area.id,
                  operatorId: operator.id,
                },
                {},
              ),
            ),
          );
          assert.equal(
            requests.filter((r) => r.status === 'fulfilled').length,
            1,
          );
          assert.ok(
            conflict(requests.find((r) => r.status === 'rejected').reason),
          );
          let result = requests.find((r) => r.status === 'fulfilled').value;
          await assert.rejects(
            () =>
              db.incidentAssignment.create({
                data: { incidentId: i.id, areaId: area.id, status: 'ASSIGNED' },
              }),
            (e) => e.code === 'P2002',
          );
          await assert.rejects(
            () =>
              workflow.assign(
                manager,
                i.id,
                {
                  ...versions(result),
                  areaId: foreignArea.id,
                  operatorId: other.id,
                  reason: 'Cambio',
                },
                {},
                true,
              ),
            forbidden,
          );
          const previousId = result.assignment.id;
          result = await workflow.assign(
            manager,
            i.id,
            {
              ...versions(result),
              areaId: area.id,
              operatorId: operator.id,
              reason: 'Reorganizacion',
            },
            {},
            true,
          );
          assert.equal(result.assignment.replacesId, previousId);
          assert.equal(
            (
              await db.incidentAssignment.findUnique({
                where: { id: previousId },
              })
            ).status,
            'REASSIGNED',
          );
          await assert.rejects(
            () =>
              workflow.workByAssignment(
                operator,
                result.assignment.id,
                { ...versions(result), reason: 'No corresponde' },
                'cancel',
                {},
              ),
            forbidden,
          );
          result = await workflow.workByAssignment(
            manager,
            result.assignment.id,
            { ...versions(result), reason: 'Reprogramar' },
            'cancel',
            {},
          );
          assert.equal(result.incident.status, 'ACCEPTED');
          assert.equal(result.assignment.status, 'CANCELLED');
          assert.equal(
            await db.incidentAssignment.count({
              where: {
                incidentId: i.id,
                status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] },
              },
            }),
            0,
          );
          await assert.rejects(
            () => workflow.list(operator, { page: 1, limit: 20 }, i.id),
            hidden,
          );
        },
      );

      await t.test(
        'area-only assignment, inactive assignee and competing membership removal',
        async () => {
          const i = await make({ status: 'ACCEPTED' });
          let result = await workflow.assign(
            admin,
            i.id,
            { expectedVersion: 1, areaId: foreignArea.id },
            {},
          );
          await assert.rejects(
            () =>
              workflow.workByAssignment(
                other,
                result.assignment.id,
                versions(result),
                'accept',
                {},
              ),
            forbidden,
          );
          result = await workflow.assign(
            other,
            i.id,
            {
              ...versions(result),
              areaId: foreignArea.id,
              operatorId: other.id,
              reason: 'Responsable designado',
            },
            {},
            true,
          );
          assert.equal(result.assignment.operatorId, other.id);
          result = await workflow.workByAssignment(
            admin,
            result.assignment.id,
            { ...versions(result), reason: 'Fin de prueba' },
            'cancel',
            {},
          );
          await users.updateStatus(
            admin.id,
            other.id,
            { status: 'INACTIVE' },
            {},
          );
          await assert.rejects(
            () =>
              workflow.assign(
                admin,
                i.id,
                {
                  expectedVersion: result.incident.version,
                  areaId: foreignArea.id,
                  operatorId: other.id,
                },
                {},
              ),
            conflict,
          );
          await users.updateStatus(
            admin.id,
            other.id,
            { status: 'ACTIVE' },
            {},
          );
          const race = await Promise.allSettled([
            workflow.assign(
              admin,
              i.id,
              {
                expectedVersion: result.incident.version,
                areaId: foreignArea.id,
                operatorId: other.id,
              },
              {},
            ),
            members.removeMember(admin, foreignArea.id, other.id, {}),
          ]);
          assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
          const active = await db.incidentAssignment.count({
            where: { incidentId: i.id, status: 'ASSIGNED' },
          });
          const membership = await db.municipalAreaMember.findUnique({
            where: {
              areaId_userId: { areaId: foreignArea.id, userId: other.id },
            },
          });
          assert.ok(!active || membership.active);
        },
      );

      await t.test(
        'audit failure rolls back decision and all side effects',
        async () => {
          const i = await make();
          const broken = new IncidentWorkflowService(
            db,
            {
              record: async () => {
                throw new Error('audit unavailable');
              },
            },
            access,
          );
          await assert.rejects(
            () => broken.decide(admin, i.id, { expectedVersion: 1 }, true, {}),
            /audit unavailable/,
          );
          assert.equal(
            (await db.incident.findUnique({ where: { id: i.id } })).version,
            1,
          );
          assert.equal(
            await db.incidentHistory.count({ where: { incidentId: i.id } }),
            0,
          );
        },
      );

      await t.test(
        'reject is terminal, and administrative cancellation fences pending AI',
        async () => {
          const rejected = await make();
          await workflow.decide(
            supervisor,
            rejected.id,
            {
              expectedVersion: 1,
              rejectionReason: 'OUT_OF_SCOPE',
              reason: 'Fuera de competencia municipal',
            },
            false,
            {},
          );
          await assert.rejects(
            () =>
              workflow.decide(
                admin,
                rejected.id,
                { expectedVersion: 2 },
                true,
                {},
              ),
            conflict,
          );
          const i = await make({ status: 'AI_ANALYSIS' });
          const job = await db.aiJob.create({
            data: {
              incidentId: i.id,
              type: 'INCIDENT_ANALYSIS',
              status: 'PROCESSING',
            },
          });
          await assert.rejects(
            () =>
              incidents.cancel(
                citizen,
                i.id,
                { expectedVersion: 1, reason: 'Cancelar' },
                {},
              ),
            conflict,
          );
          const result = await incidents.cancel(
            admin,
            i.id,
            { expectedVersion: 1, reason: 'Duplicado confirmado' },
            {},
          );
          assert.equal(result.status, 'CANCELLED');
          assert.equal(
            (await db.aiJob.findUnique({ where: { id: job.id } })).status,
            'CANCELLED',
          );
        },
      );
    } finally {
      if (db) await db.$disconnect();
      if (pool) await pool.end();
      if (created) {
        assert.match(schema, /^willariq_workflow_test_[a-f0-9]{32}$/);
        await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
      await adminPool.end();
    }
  },
);
