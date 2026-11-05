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

test('Notification and audit endpoints declare the required JWT and role guards', () => {
  const { NotificationsController } = load(
    'modules/notifications/notifications.controller',
  );
  const { AuditQueryController } = load('modules/audit/audit-query.controller');
  for (const controller of [NotificationsController, AuditQueryController]) {
    assert.deepEqual(
      Reflect.getMetadata('__guards__', controller).map((guard) => guard.name),
      ['JwtAuthGuard', 'RoleGuard'],
    );
  }
  assert.deepEqual(Reflect.getMetadata('roles', NotificationsController), []);
  assert.deepEqual(Reflect.getMetadata('roles', AuditQueryController), [
    'ADMIN',
  ]);
});

test(
  'Notification ownership, replay protection and sanitized audit queries in PostgreSQL',
  {
    skip: process.env.RUN_NOTIFICATION_AUDIT_INTEGRATION_TESTS !== '1',
    timeout: 30000,
  },
  async () => {
    require('dotenv').config({ quiet: true });
    const { Pool } = require('pg');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { PrismaClient } = load('generated/prisma/client');
    const { NotificationsService } = load(
      'modules/notifications/notifications.service',
    );
    const { writeNotification } = load(
      'modules/notifications/write-notification',
    );
    const { AuditQueryService } = load('modules/audit/audit-query.service');
    const schema = `willariq_inbox_test_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    let pool,
      db,
      created = false;
    const migration = (folder) =>
      readFile(
        path.join(__dirname, '../prisma/migrations', folder, 'migration.sql'),
        'utf8',
      );

    try {
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path=${schema},public`,
      });
      await pool.query(await migration('20260916021124_init'));
      db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });

      const addUser = (digit) =>
        db.user.create({
          data: {
            firstName: 'Prueba',
            role: 'CITIZEN',
            dni: digit.repeat(8),
            phone: digit.repeat(9),
            passwordHash: 'fixture',
          },
        });
      const owner = await addUser('1');
      const other = await addUser('2');
      const legacyId = randomUUID();
      await pool.query(
        "INSERT INTO notifications (id, \"userId\", type, title, body) VALUES ($1,$2,'GENERAL','Historica','Aviso anterior')",
        [legacyId, owner.id],
      );

      await pool.query(
        await migration('20261105040000_notification_event_key'),
      );
      const inbox = new NotificationsService(db);
      assert.equal(
        (await inbox.list(owner.id, { page: 1, limit: 20 })).items[0].id,
        legacyId,
      );
      const event = {
        eventKey: 'incident:test:v2',
        userId: owner.id,
        type: 'GENERAL',
        title: 'Aviso',
        body: 'Prueba',
      };
      const write = (entry) =>
        db.$transaction((tx) => writeNotification(tx, entry));
      const results = await Promise.all([write(event), write(event)]);
      assert.equal(
        results.reduce((total, result) => total + result.count, 0),
        1,
      );
      assert.equal((await write({ ...event, userId: other.id })).count, 1);
      const item = await db.notification.findFirstOrThrow({
        where: { userId: owner.id, eventKey: event.eventKey },
      });
      assert.equal(item.status, 'SENT');
      await assert.rejects(() => inbox.markRead(other.id, item.id), {
        status: 404,
      });
      assert.equal((await inbox.unreadCount(owner.id)).count, 2);
      const [first, second] = await Promise.all([
        inbox.markRead(owner.id, item.id),
        inbox.markRead(owner.id, item.id),
      ]);
      assert.equal(first.readAt.getTime(), second.readAt.getTime());
      assert.equal((await write(event)).count, 0);
      assert.equal(
        (await inbox.list(owner.id, { page: 1, limit: 1, unreadOnly: true }))
          .pagination.total,
        1,
      );
      assert.deepEqual(await inbox.markAllRead(owner.id), { updated: 1 });
      assert.deepEqual(await inbox.markAllRead(owner.id), { updated: 0 });
      assert.deepEqual(await inbox.unreadCount(owner.id), { count: 0 });
      assert.deepEqual(await inbox.unreadCount(other.id), { count: 1 });
      assert.equal(
        (await inbox.markRead(owner.id, item.id)).readAt.getTime(),
        first.readAt.getTime(),
      );

      const audit = new AuditQueryService(db);
      const row = await db.auditLog.create({
        data: {
          userId: owner.id,
          action: 'INCIDENT_ASSIGNED',
          entityType: 'Incident',
          entityId: 'CASE-1',
          ipAddress: '192.0.2.1',
          userAgent: 'private client',
          oldValue: { status: 'ACCEPTED', passwordHash: 'private' },
          newValue: {
            status: 'ASSIGNED',
            token: 'private',
            reason: 'private note',
            assignment: {
              id: item.id,
              status: 'ASSIGNED',
              secretKey: 'private',
            },
          },
        },
      });
      const list = await audit.list({
        page: 1,
        limit: 20,
        actorId: owner.id,
        action: 'INCIDENT_ASSIGNED',
        entityType: 'Incident',
        entityId: 'CASE-1',
        from: row.createdAt.toISOString(),
        to: row.createdAt.toISOString(),
      });
      assert.equal(list.pagination.total, 1);
      assert.equal(list.items[0].id, row.id);
      assert.equal('newValue' in list.items[0], false);
      assert.equal(
        (await audit.list({ page: 1, limit: 20, actorId: other.id })).pagination
          .total,
        0,
      );
      const detail = await audit.find(row.id);
      assert.deepEqual(detail.oldValue, { status: 'ACCEPTED' });
      assert.deepEqual(detail.newValue, {
        status: 'ASSIGNED',
        assignment: { id: item.id, status: 'ASSIGNED' },
      });
      assert.equal('ipAddress' in detail, false);
      assert.equal('userAgent' in detail, false);
      await assert.rejects(() => audit.find(randomUUID()), { status: 404 });
      await assert.rejects(
        () =>
          audit.list({
            page: 1,
            limit: 20,
            from: '2026-11-06T00:00:00Z',
            to: '2026-11-05T00:00:00Z',
          }),
        { status: 400 },
      );
    } finally {
      try {
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
