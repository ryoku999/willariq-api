import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { lockAccount } from '../auth/utils/account-lock';
import {
  generateRefreshToken,
  hashRefreshToken,
} from '../auth/utils/auth.utils';
import { MailService } from '../mail/mail.service';

const COOLDOWN_MS = 60_000;
const invalidToken = () =>
  new BadRequestException('El enlace no es valido o ha expirado');

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async setEmail(
    actor: AuthenticatedUser,
    email: string,
    currentPassword: string,
  ) {
    const passwordHash = await this.verifyPassword(actor, currentPassword);
    try {
      return await this.db.$transaction(async (tx) => {
        const user = await this.activeActor(tx, actor, passwordHash);
        if (user.email?.toLowerCase() === email) {
          return { email: user.email, emailVerifiedAt: user.emailVerifiedAt };
        }
        const duplicate = await tx.user.findFirst({
          where: {
            id: { not: actor.id },
            email: { equals: email, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (duplicate)
          throw new ConflictException('El correo no esta disponible');

        const result = await tx.user.update({
          where: { id: actor.id },
          data: { email, emailVerifiedAt: null },
          select: { email: true, emailVerifiedAt: true },
        });
        await tx.emailVerificationToken.updateMany({
          where: { userId: actor.id, usedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.passwordResetToken.deleteMany({
          where: { userId: actor.id, usedAt: null },
        });
        await this.record(tx, actor.id, 'USER_EMAIL_CHANGED');
        return result;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('El correo no esta disponible');
      }
      throw error;
    }
  }

  async requestVerification(actor: AuthenticatedUser) {
    this.mail.assertConfigured();
    const raw = generateRefreshToken();
    const entry = await this.db.$transaction(async (tx) => {
      const user = await this.activeActor(tx, actor);
      if (!user.email || user.emailVerifiedAt) {
        throw new ConflictException(
          'Se requiere un correo pendiente de verificar',
        );
      }
      const now = new Date();
      const pending = { userId: user.id, usedAt: null, revokedAt: null };
      const recent = await tx.emailVerificationToken.findFirst({
        where: {
          ...pending,
          createdAt: { gt: new Date(now.getTime() - COOLDOWN_MS) },
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (recent)
        throw new HttpException(
          'Espera antes de solicitar otro correo',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      await tx.emailVerificationToken.updateMany({
        where: pending,
        data: { revokedAt: now },
      });
      return tx.emailVerificationToken.create({
        data: {
          userId: user.id,
          email: user.email,
          tokenHash: hashRefreshToken(raw),
          expiresAt: this.expires('EMAIL_TOKEN_TTL_MINUTES', now),
        },
        select: { id: true, email: true },
      });
    });
    try {
      await this.mail.sendAccountLink(entry.email, raw, 'verify');
    } catch (error) {
      await this.db.emailVerificationToken.updateMany({
        where: { id: entry.id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw error;
    }
  }

  async confirmEmail(raw: string) {
    const entry = await this.db.emailVerificationToken.findUnique({
      where: { tokenHash: hashRefreshToken(raw) },
    });
    if (!entry) throw invalidToken();
    await this.db.$transaction(async (tx) => {
      const user = await lockAccount(tx, entry.userId);
      if (
        !user ||
        user.status !== 'ACTIVE' ||
        user.email !== entry.email ||
        user.emailVerifiedAt
      )
        throw invalidToken();
      const now = new Date();
      const consumed = await tx.emailVerificationToken.updateMany({
        where: {
          id: entry.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw invalidToken();
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: now },
      });
      await this.record(tx, user.id, 'USER_EMAIL_VERIFIED');
    });
  }

  requestPasswordReset(email: string) {
    this.mail.assertConfigured();
    // Keep the SMTP outcome and its latency out of the public response.
    void this.deliverPasswordReset(email).catch(() => {
      this.logger.warn('No se pudo completar una solicitud de recuperacion');
    });
  }

  private async deliverPasswordReset(email: string) {
    const users = await this.db.user.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
      take: 2,
    });
    if (users.length !== 1) return;

    const raw = generateRefreshToken();
    const entry = await this.db.$transaction(async (tx) => {
      const user = await lockAccount(tx, users[0].id);
      if (
        !user?.email ||
        user.email.toLowerCase() !== email ||
        !user.emailVerifiedAt ||
        user.status !== 'ACTIVE'
      )
        return;
      const now = new Date();
      const pending = { userId: user.id, usedAt: null };
      const recent = await tx.passwordResetToken.findFirst({
        where: {
          ...pending,
          createdAt: { gt: new Date(now.getTime() - COOLDOWN_MS) },
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (recent) return;
      await tx.passwordResetToken.deleteMany({ where: pending });
      const token = await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashRefreshToken(raw),
          expiresAt: this.expires('PASSWORD_RESET_TOKEN_TTL_MINUTES', now),
        },
        select: { id: true },
      });
      return { id: token.id, email: user.email };
    });
    if (!entry) return;
    try {
      await this.mail.sendAccountLink(entry.email, raw, 'reset');
    } catch (error) {
      await this.db.passwordResetToken.deleteMany({
        where: { id: entry.id, usedAt: null },
      });
      throw error;
    }
  }

  async resetPassword(raw: string, password: string) {
    const entry = await this.db.passwordResetToken.findUnique({
      where: { tokenHash: hashRefreshToken(raw) },
    });
    if (!entry || entry.usedAt || entry.expiresAt <= new Date())
      throw invalidToken();
    const passwordHash = await this.hashPassword(password);
    await this.db.$transaction(async (tx) => {
      const user = await lockAccount(tx, entry.userId);
      if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt)
        throw invalidToken();
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: entry.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) throw invalidToken();
      await this.replacePassword(
        tx,
        user.id,
        passwordHash,
        'USER_PASSWORD_RESET',
      );
    });
  }

  async changePassword(
    actor: AuthenticatedUser,
    current: string,
    next: string,
  ) {
    const previousHash = await this.verifyPassword(actor, current);
    const passwordHash = await this.hashPassword(next);
    await this.db.$transaction(async (tx) => {
      await this.activeActor(tx, actor, previousHash);
      await this.replacePassword(
        tx,
        actor.id,
        passwordHash,
        'USER_PASSWORD_CHANGED',
      );
    });
  }

  async logoutAll(actor: AuthenticatedUser) {
    await this.db.$transaction(async (tx) => {
      await this.activeActor(tx, actor);
      await tx.user.update({
        where: { id: actor.id },
        data: { sessionVersion: { increment: 1 } },
      });
      await tx.refreshToken.deleteMany({ where: { userId: actor.id } });
      await this.record(tx, actor.id, 'USER_SESSIONS_REVOKED');
    });
  }

  private async replacePassword(
    tx: Prisma.TransactionClient,
    userId: string,
    passwordHash: string,
    action: string,
  ) {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
    await this.record(tx, userId, action);
  }

  private async activeActor(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    passwordHash?: string,
  ) {
    const user = await lockAccount(tx, actor.id);
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.sessionVersion !== (actor.sessionVersion ?? 0) ||
      (passwordHash !== undefined && user.passwordHash !== passwordHash)
    ) {
      throw new UnauthorizedException('La sesion fue revocada');
    }
    return user;
  }

  private async verifyPassword(actor: AuthenticatedUser, password: string) {
    const user = await this.db.user.findUnique({
      where: { id: actor.id },
      select: { passwordHash: true },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Contrasena actual incorrecta');
    }
    return user.passwordHash;
  }

  private hashPassword(password: string) {
    if (Buffer.byteLength(password, 'utf8') > 72)
      throw new BadRequestException('La contrasena nueva supera 72 bytes');
    return bcrypt.hash(password, 12);
  }

  private expires(key: string, now: Date) {
    return new Date(
      now.getTime() + this.config.getOrThrow<number>(key) * 60_000,
    );
  }

  private record(tx: Prisma.TransactionClient, userId: string, action: string) {
    return this.audit.record(
      { userId, action, entityType: 'User', entityId: userId },
      tx,
    );
  }
}
