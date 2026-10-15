import { Prisma } from '@/generated/prisma/client';
import {
  AreaMemberRole,
  AssignmentStatus,
  MunicipalAreaStatus,
  UserRole,
  UserStatus,
} from '@/generated/prisma/enums';
import { AuditService } from '@/modules/audit/audit.service';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AddMunicipalAreaMemberDto } from './dto/add-municipal-area-member.dto';
import { ListMunicipalAreaMembersQueryDto } from './dto/list-municipal-area-members-query.dto';
import { DatabaseService } from '@/database/database.service';
import { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';

const MEMBER_SELECT = {
  id: true,
  areaId: true,
  userId: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
    },
  },
} as const;

type MunicipalAreaMemberResponse = Prisma.MunicipalAreaMemberGetPayload<{
  select: typeof MEMBER_SELECT;
}>;

export interface MemberAuditContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class MunicipalAreaMembersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  async addMember(
    actor: AuthenticatedUser,
    areaId: string,
    dto: AddMunicipalAreaMemberDto,
    context: MemberAuditContext,
  ) {
    try {
      return await this.db.$transaction(async (transaction) => {
        const area = await transaction.municipalArea.findUnique({
          where: { id: areaId },
          select: { status: true },
        });
        if (!area) {
          throw new NotFoundException('Area municipal no encontrada');
        }
        if (area.status !== MunicipalAreaStatus.ACTIVE) {
          throw new ConflictException('El area municipal no esta activa');
        }

        await this.assertCanManage(transaction, actor, areaId);

        const user = await transaction.user.findUnique({
          where: { id: dto.userId },
          select: { id: true, role: true, status: true },
        });
        if (!user) {
          throw new NotFoundException('Usuario no encontrado');
        }
        if (user.status !== UserStatus.ACTIVE) {
          throw new ConflictException('El usuario no esta activo');
        }
        if (
          user.role !== UserRole.OPERATOR &&
          user.role !== UserRole.SUPERVISOR
        ) {
          throw new ConflictException(
            'El usuario no tiene un rol elegible para pertenecer al area',
          );
        }

        const membership = await transaction.municipalAreaMember.findUnique({
          where: { areaId_userId: { areaId, userId: dto.userId } },
          select: MEMBER_SELECT,
        });
        if (membership?.active) {
          throw new ConflictException(
            'El usuario ya es miembro activo del area',
          );
        }

        let result: MunicipalAreaMemberResponse;
        let action: 'AREA_MEMBER_ADDED' | 'AREA_MEMBER_REACTIVATED';
        if (membership) {
          const reactivated = await transaction.municipalAreaMember.updateMany({
            where: { id: membership.id, active: false },
            data: { active: true, role: dto.role },
          });
          if (reactivated.count !== 1) {
            throw new ConflictException(
              'El usuario ya es miembro activo del area',
            );
          }
          result = await transaction.municipalAreaMember.findUniqueOrThrow({
            where: { id: membership.id },
            select: MEMBER_SELECT,
          });
          action = 'AREA_MEMBER_REACTIVATED';
        } else {
          result = await transaction.municipalAreaMember.create({
            data: { areaId, userId: dto.userId, role: dto.role },
            select: MEMBER_SELECT,
          });
          action = 'AREA_MEMBER_ADDED';
        }

        await this.auditService.record(
          {
            userId: actor.id,
            action,
            entityType: 'MunicipalAreaMember',
            entityId: result.id,
            ...(membership
              ? {
                  oldValue: {
                    areaId,
                    memberUserId: dto.userId,
                    role: membership.role,
                    active: false,
                  },
                }
              : {}),
            newValue: {
              areaId,
              memberUserId: dto.userId,
              role: dto.role,
              active: true,
            },
            ...context,
          },
          transaction,
        );

        return result;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('El usuario ya es miembro activo del area');
      }
      throw error;
    }
  }

  async listMembers(
    actor: AuthenticatedUser,
    areaId: string,
    query: ListMunicipalAreaMembersQueryDto,
  ) {
    const area = await this.db.municipalArea.findUnique({
      where: { id: areaId },
      select: { status: true },
    });
    if (!area) {
      throw new NotFoundException('Area municipal no encontrada');
    }

    if (actor.role === UserRole.OPERATOR) {
      if (area.status !== MunicipalAreaStatus.ACTIVE) {
        throw new ForbiddenException('No tienes permisos para esta accion');
      }
      const membership = await this.db.municipalAreaMember.findUnique({
        where: { areaId_userId: { areaId, userId: actor.id } },
        select: { active: true },
      });
      if (!membership?.active) {
        throw new ForbiddenException('No tienes permisos para esta accion');
      }
    } else if (
      actor.role !== UserRole.ADMIN &&
      actor.role !== UserRole.SUPERVISOR
    ) {
      throw new ForbiddenException('No tienes permisos para esta accion');
    }

    const search = query.search?.trim();
    const userWhere: Prisma.UserWhereInput = {
      ...(query.userRole ? { role: query.userRole } : {}),
      ...(query.userStatus ? { status: query.userStatus } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const where: Prisma.MunicipalAreaMemberWhereInput = {
      areaId,
      active: query.active,
      ...(query.role ? { role: query.role } : {}),
      user: { is: userWhere },
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await this.db.$transaction([
      this.db.municipalAreaMember.findMany({
        where,
        select: MEMBER_SELECT,
        orderBy: [
          { role: 'asc' },
          { user: { firstName: 'asc' } },
          { id: 'asc' },
        ],
        skip,
        take: query.limit,
      }),
      this.db.municipalAreaMember.count({ where }),
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

  async removeMember(
    actor: AuthenticatedUser,
    areaId: string,
    userId: string,
    context: MemberAuditContext,
  ) {
    return this.db.$transaction(async (transaction) => {
      const area = await transaction.municipalArea.findUnique({
        where: { id: areaId },
        select: { status: true },
      });
      if (!area) {
        throw new NotFoundException('Area municipal no encontrada');
      }

      if (actor.role !== UserRole.ADMIN) {
        if (area.status !== MunicipalAreaStatus.ACTIVE) {
          throw new ForbiddenException('No tienes permisos para esta accion');
        }
        await this.assertCanManage(transaction, actor, areaId);
        if (actor.id === userId) {
          throw new ForbiddenException(
            'Un manager no puede retirarse a si mismo',
          );
        }
      }

      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      const membership = await transaction.municipalAreaMember.findUnique({
        where: { areaId_userId: { areaId, userId } },
        select: MEMBER_SELECT,
      });
      if (!membership) {
        throw new NotFoundException('El usuario no pertenece al area');
      }
      if (!membership.active) {
        throw new ConflictException('La membresia ya esta inactiva');
      }

      const activeAssignments = await transaction.incidentAssignment.count({
        where: {
          areaId,
          operatorId: userId,
          status: {
            in: [
              AssignmentStatus.ASSIGNED,
              AssignmentStatus.ACCEPTED,
              AssignmentStatus.IN_PROGRESS,
            ],
          },
        },
      });
      if (activeAssignments > 0) {
        throw new ConflictException(
          'El miembro tiene asignaciones activas pendientes en el area',
        );
      }

      const removed = await transaction.municipalAreaMember.updateMany({
        where: { id: membership.id, active: true },
        data: { active: false },
      });
      if (removed.count !== 1) {
        throw new ConflictException('La membresia ya esta inactiva');
      }
      const result = await transaction.municipalAreaMember.findUniqueOrThrow({
        where: { id: membership.id },
        select: MEMBER_SELECT,
      });

      await this.auditService.record(
        {
          userId: actor.id,
          action: 'AREA_MEMBER_REMOVED',
          entityType: 'MunicipalAreaMember',
          entityId: membership.id,
          oldValue: {
            areaId,
            memberUserId: userId,
            role: membership.role,
            active: true,
          },
          newValue: {
            areaId,
            memberUserId: userId,
            role: membership.role,
            active: false,
          },
          ...context,
        },
        transaction,
      );

      return result;
    });
  }

  private async assertCanManage(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    areaId: string,
  ): Promise<void> {
    if (actor.role === UserRole.ADMIN) {
      return;
    }
    if (
      actor.role !== UserRole.SUPERVISOR &&
      actor.role !== UserRole.OPERATOR
    ) {
      throw new ForbiddenException('No tienes permisos para esta accion');
    }

    const membership = await transaction.municipalAreaMember.findUnique({
      where: { areaId_userId: { areaId, userId: actor.id } },
      select: { active: true, role: true },
    });
    if (!membership?.active || membership.role !== AreaMemberRole.MANAGER) {
      throw new ForbiddenException('No tienes permisos para esta accion');
    }
  }
}
