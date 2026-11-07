// Real PostgreSQL in a disposable schema. SMTP is replaced by an in-memory mailer.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
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

test('Account lifecycle validates new credentials and protects authenticated routes', async () => {
  const { ValidationPipe } = require('@nestjs/common');
  const { AccountController } = load('modules/account/account.controller');
  const { SetAccountEmailDto, AccountTokenDto } = load(
    'modules/account/account.dto',
  );
  for (const name of [
    'setEmail',
    'requestVerification',
    'change',
    'logoutAll',
  ]) {
    assert.deepEqual(
      Reflect.getMetadata('__guards__', AccountController.prototype[name]).map(
        (guard) => guard.name,
      ),
      ['JwtAuthGuard', 'RoleGuard'],
    );
  }
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const email = await pipe.transform(
    { email: '  TEST@EXAMPLE.COM  ', currentPassword: 'test-pass' },
    { type: 'body', metatype: SetAccountEmailDto },
  );
  assert.equal(email.email, 'test@example.com');
  await assert.rejects(
    () =>
      pipe.transform(
        { token: 'invalid' },
        { type: 'body', metatype: AccountTokenDto },
      ),
    { status: 400 },
  );
});

test(
  'Account tokens are single use and session revocation survives concurrent requests',
  {
    skip: process.env.RUN_ACCOUNT_LIFECYCLE_INTEGRATION_TESTS !== '1',
    timeout: 45000,
  },
  async () => {
    require('dotenv').config({ quiet: true });
    const { Pool } = require('pg');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { ConfigService } = require('@nestjs/config');
    const { JwtService } = require('@nestjs/jwt');
    const { PrismaClient } = load('generated/prisma/client');
    const { AccountService } = load('modules/account/account.service');
    const { AuthService } = load('modules/auth/auth.service');
    const { JwtStrategy } = load('modules/auth/strategies/jwt.strategy');
    const { AuditService } = load('modules/audit/audit.service');
    const { hashRefreshToken } = load('modules/auth/utils/auth.utils');
    const schema = `willariq_account_test_${randomUUID().replaceAll('-', '')}`;
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
      for (const folder of [
        '20260916021124_init',
        '20261105050000_account_session_version',
      ]) {
        await pool.query(
          await readFile(
            path.join(
              __dirname,
              '../prisma/migrations',
              folder,
              'migration.sql',
            ),
            'utf8',
          ),
        );
      }
      db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
      const config = new ConfigService({
        JWT_SECRET: 'fixture-only',
        JWT_ISSUER: 'fixture',
        JWT_AUDIENCE: 'fixture',
        AUTH_ACCESS_COOKIE_NAME: 'fixture',
        JWT_REFRESH_EXPIRES_IN: '7d',
        EMAIL_TOKEN_TTL_MINUTES: 60,
        PASSWORD_RESET_TOKEN_TTL_MINUTES: 30,
      });
      const jwt = new JwtService({ secret: 'fixture-only' });
      const auth = new AuthService(db, jwt, config);
      const strategy = new JwtStrategy(config, db);
      const { promise: resetMail, resolve: receiveReset } =
        Promise.withResolvers();
      const delivered = [];
      let failVerify = false;
      const mail = {
        assertConfigured() {},
        async sendAccountLink(to, token, kind) {
          if (kind === 'verify' && failVerify)
            throw new Error('SMTP fixture unavailable');
          delivered.push({ to, token, kind });
          if (kind === 'reset') receiveReset({ to, token });
        },
      };
      const account = new AccountService(
        db,
        config,
        mail,
        new AuditService(db),
      );
      const password = 'original-pass';
      const user = await auth.register({
        firstName: 'Fixture',
        dni: '00000001',
        phone: '900000001',
        password,
      });
      const staff = await auth.register({
        firstName: 'Personal',
        dni: '00000003',
        phone: '900000003',
        password,
      });
      await db.user.update({
        where: { id: staff.id },
        data: { role: 'OPERATOR' },
      });
      await assert.rejects(
        () => auth.login({ dni: staff.dni, password }, 'mobile'),
        { status: 403 },
      );
      const staffSession = await auth.login(
        { dni: staff.dni, password },
        'web',
      );
      await assert.rejects(
        () => auth.refresh(staffSession.tokens.refreshToken, 'mobile'),
        { status: 403 },
      );
      const rotated = await auth.refresh(
        staffSession.tokens.refreshToken,
        'web',
      );
      await auth.logout(rotated.refreshToken);
      const countBeforeLogin = await db.refreshToken.count();
      await assert.rejects(
        () => auth.login({ dni: user.dni, password }, 'web'),
        { status: 403 },
      );
      assert.equal(await db.refreshToken.count(), countBeforeLogin);
      const credentials = await auth.login(
        { dni: user.dni, password },
        'mobile',
      );
      await assert.rejects(
        () => auth.refresh(credentials.tokens.refreshToken, 'web'),
        { status: 403 },
      );
      assert.equal(await db.refreshToken.count(), countBeforeLogin + 1);
      const actor = await strategy.validate(
        jwt.decode(credentials.tokens.accessToken),
      );
      const legacy = { sub: actor.id, role: actor.role };
      await strategy.validate(legacy);

      await assert.rejects(
        () => account.setEmail(actor, 'mail@example.com', 'wrong-password'),
        { status: 401 },
      );
      await account.setEmail(actor, 'old@example.com', password);
      failVerify = true;
      await assert.rejects(
        () => account.requestVerification(actor),
        /SMTP fixture unavailable/,
      );
      assert.equal(
        await db.emailVerificationToken.count({
          where: { userId: actor.id, revokedAt: null },
        }),
        0,
      );
      failVerify = false;
      await account.requestVerification(actor);
      await assert.rejects(() => account.requestVerification(actor), {
        status: 429,
      });
      const oldToken = delivered.at(-1).token;

      await account.setEmail(actor, 'mail@example.com', password);
      await assert.rejects(() => account.confirmEmail(oldToken), {
        status: 400,
      });
      await account.requestVerification(actor);
      const expired = delivered.at(-1).token;
      await db.emailVerificationToken.update({
        where: { tokenHash: hashRefreshToken(expired) },
        data: { expiresAt: new Date(0) },
      });
      await assert.rejects(() => account.confirmEmail(expired), {
        status: 400,
      });
      await account.requestVerification(actor);
      const verification = delivered.at(-1).token;
      assert.notEqual(
        (
          await db.emailVerificationToken.findFirstOrThrow({
            where: { revokedAt: null },
          })
        ).tokenHash,
        verification,
      );
      const verifies = await Promise.allSettled([
        account.confirmEmail(verification),
        account.confirmEmail(verification),
      ]);
      assert.equal(
        verifies.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        verifies.find((result) => result.status === 'rejected').reason.status,
        400,
      );

      const other = await auth.register({
        firstName: 'Fixture 2',
        dni: '00000002',
        phone: '900000002',
        password,
      });
      await assert.rejects(
        () =>
          account.setEmail(
            { id: other.id, role: other.role },
            'mail@example.com',
            password,
          ),
        { status: 409 },
      );
      assert.equal(
        account.requestPasswordReset('unknown@example.com'),
        undefined,
      );
      assert.equal(account.requestPasswordReset('mail@example.com'), undefined);
      const { to, token } = await Promise.race([
        resetMail,
        new Promise((_, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Reset email not captured')),
            5000,
          );
          timeout.unref();
        }),
      ]);
      assert.equal(to, 'mail@example.com');
      assert.ok(
        (await auth.login({ dni: user.dni, password }, 'mobile')).tokens,
      );
      const resets = await Promise.allSettled([
        account.resetPassword(token, 'recovered-pass'),
        account.resetPassword(token, 'recovered-pass'),
      ]);
      assert.equal(
        resets.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        resets.find((result) => result.status === 'rejected').reason.status,
        400,
      );
      await assert.rejects(() => strategy.validate(legacy), { status: 401 });
      await assert.rejects(
        () => auth.refresh(credentials.tokens.refreshToken, 'mobile'),
        { status: 401 },
      );
      await assert.rejects(
        () => auth.login({ dni: user.dni, password }, 'mobile'),
        {
          status: 401,
        },
      );

      const afterReset = await auth.login(
        {
          dni: user.dni,
          password: 'recovered-pass',
        },
        'mobile',
      );
      const newActor = await strategy.validate(
        jwt.decode(afterReset.tokens.accessToken),
      );
      await account.changePassword(newActor, 'recovered-pass', 'new-password');
      await assert.rejects(
        () => strategy.validate(jwt.decode(afterReset.tokens.accessToken)),
        { status: 401 },
      );
      const afterChange = await auth.login(
        {
          dni: user.dni,
          password: 'new-password',
        },
        'mobile',
      );
      const finalActor = await strategy.validate(
        jwt.decode(afterChange.tokens.accessToken),
      );

      const [refresh, logout] = await Promise.allSettled([
        auth.refresh(afterChange.tokens.refreshToken, 'mobile'),
        account.logoutAll(finalActor),
      ]);
      assert.equal(logout.status, 'fulfilled');
      if (refresh.status === 'fulfilled') {
        await assert.rejects(
          () => strategy.validate(jwt.decode(refresh.value.accessToken)),
          { status: 401 },
        );
        await assert.rejects(
          () => auth.refresh(refresh.value.refreshToken, 'mobile'),
          {
            status: 401,
          },
        );
      } else {
        assert.equal(refresh.reason.status, 401);
      }
      assert.equal(
        await db.refreshToken.count({ where: { userId: user.id } }),
        0,
      );
      await assert.rejects(
        () => strategy.validate(jwt.decode(afterChange.tokens.accessToken)),
        { status: 401 },
      );
      const logs = await db.auditLog.findMany({ where: { userId: actor.id } });
      assert.ok(logs.some((row) => row.action === 'USER_PASSWORD_RESET'));
      assert.ok(
        logs.every((row) => row.oldValue === null && row.newValue === null),
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
