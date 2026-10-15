import { DatabaseService } from '@/database/database.service';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UpdateMeDto } from './dto/update-me.dto';
import { Prisma, UserRole, UserStatus } from '@/generated/prisma/client';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { AuditService } from '../audit/audit.service';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

export interface RequestAuditContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  async findMe(userId: string) {
    return this.findById(userId);
  }

  async findById(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dni: true,
        phone: true,
        email: true,
        emailVerifiedAt: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    try {
      return await this.db.user.update({
        where: { id: userId },
        data: {
          ...(dto.firstName === undefined
            ? {}
            : { firstName: dto.firstName.trim() }),
          ...(dto.lastName === undefined
            ? {}
            : { lastName: dto.lastName.trim() }),
          ...(dto.phone === undefined ? {} : { phone: dto.phone }),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          dni: true,
          phone: true,
          email: true,
          emailVerifiedAt: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('Algunos datos ya estan en uso');
      }

      throw error;
    }
  }

  async list(query: ListUsersQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { dni: { contains: search } },
              { phone: { contains: search } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          dni: true,
          phone: true,
          email: true,
          emailVerifiedAt: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.db.user.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async updateStatus(
    actorId: string,
    userId: string,
    dto: UpdateUserStatusDto,
    context: RequestAuditContext,
  ) {
    if (actorId === userId) {
      throw new ForbiddenException('No puedes cambiar tu propio estado');
    }

    const user = await this.findById(userId);
    if (user.status === dto.status) {
      return user;
    }

    if (
      user.role === UserRole.ADMIN &&
      user.status === UserStatus.ACTIVE &&
      dto.status !== UserStatus.ACTIVE
    ) {
      const activeAdmins = await this.db.user.count({
        where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      });
      if (activeAdmins <= 1) {
        throw new ConflictException('Debe existir al menos un administrador');
      }
    }

    return this.db.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        where: { id: userId },
        data: { status: dto.status },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          dni: true,
          phone: true,
          email: true,
          emailVerifiedAt: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (dto.status !== UserStatus.ACTIVE) {
        await transaction.refreshToken.deleteMany({ where: { userId } });
        await transaction.emailVerificationToken.updateMany({
          where: { userId, usedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await this.auditService.record(
        {
          userId: actorId,
          action: this.statusAuditAction(dto.status),
          entityType: 'User',
          entityId: userId,
          oldValue: { status: user.status },
          newValue: { status: dto.status },
          ...context,
        },
        transaction,
      );

      return updated;
    });
  }

  async updateRole(
    actorId: string,
    userId: string,
    dto: UpdateUserRoleDto,
    context: RequestAuditContext,
  ) {
    if (actorId === userId) {
      throw new ForbiddenException('No puedes cambiar tu propio rol');
    }

    const user = await this.findById(userId);
    if (user.role === dto.role) {
      return user;
    }

    if (user.role === UserRole.ADMIN && user.status === UserStatus.ACTIVE) {
      const activeAdmins = await this.db.user.count({
        where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      });
      if (activeAdmins <= 1) {
        throw new ConflictException('Debe existir al menos un administrador');
      }
    }

    return this.db.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        where: { id: userId },
        data: { role: dto.role },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          dni: true,
          phone: true,
          email: true,
          emailVerifiedAt: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      await transaction.refreshToken.deleteMany({ where: { userId } });
      await this.auditService.record(
        {
          userId: actorId,
          action: 'USER_ROLE_CHANGED',
          entityType: 'User',
          entityId: userId,
          oldValue: { role: user.role },
          newValue: { role: dto.role },
          ...context,
        },
        transaction,
      );

      return updated;
    });
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private statusAuditAction(status: UserStatus): string {
    if (status === UserStatus.BLOCKED) {
      return 'USER_BLOCKED';
    }
    if (status === UserStatus.INACTIVE) {
      return 'USER_INACTIVATED';
    }
    return 'USER_ACTIVATED';
  }
}
