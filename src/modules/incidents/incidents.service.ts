import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import {
  HistoryActorType,
  IncidentSource,
  IncidentStatus,
  UserRole,
} from '@/generated/prisma/enums';
import { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { IncidentAccessService } from './incident-access.service';
import { IncidentTrackingService } from './incident-tracking.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { CancelIncidentDto } from './dto/cancel-incident.dto';
import { ListIncidentsQueryDto } from './dto/list-incidents-query.dto';
import { IncidentPaginationQueryDto } from './dto/incident-pagination-query.dto';
import {
  INCIDENT_DETAIL_SELECT,
  INCIDENT_LIST_SELECT,
  type IncidentDetail,
} from './incident.select';

export interface IncidentAuditContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class IncidentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: IncidentAccessService,
    private readonly tracking: IncidentTrackingService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateIncidentDto,
    context: IncidentAuditContext,
  ) {
    if (actor.role !== UserRole.CITIZEN) {
      throw new ForbiddenException(
        'Solo un ciudadano puede registrar incidencias',
      );
    }
    const input = {
      originalMessage: dto.originalMessage.trim(),
      latitude: dto.latitude,
      longitude: dto.longitude,
      address: dto.address?.trim() || null,
      addressReference: dto.addressReference?.trim() || null,
      source: IncidentSource.MOBILE_APP,
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    const key = {
      reporterId: actor.id,
      clientRequestId: dto.clientRequestId.trim(),
    };
    const existing = await this.db.incident.findUnique({
      where: { reporterId_clientRequestId: key },
      select: { ...INCIDENT_DETAIL_SELECT, requestFingerprint: true },
    });
    if (existing) return this.replay(existing, fingerprint);

    try {
      const incident = await this.db.$transaction(async (tx) => {
        const trackingCode = await this.tracking.next(tx);
        const created = await tx.incident.create({
          data: {
            ...key,
            ...input,
            trackingCode,
            requestFingerprint: fingerprint,
            status: IncidentStatus.RECEIVED,
            histories: {
              create: {
                userId: actor.id,
                actorType: HistoryActorType.USER,
                newStatus: IncidentStatus.RECEIVED,
                comment: 'Incidencia registrada',
              },
            },
          },
          select: INCIDENT_DETAIL_SELECT,
        });
        await this.audit.record(
          {
            userId: actor.id,
            action: 'INCIDENT_CREATED',
            entityType: 'Incident',
            entityId: created.id,
            newValue: {
              trackingCode,
              status: created.status,
              version: created.version,
            },
            ...context,
          },
          tx,
        );
        return created;
      });
      return this.toDetail(incident);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // La peticion ganadora ya hizo commit; consultar fuera de la transaccion fallida.
        const winner = await this.db.incident.findUnique({
          where: { reporterId_clientRequestId: key },
          select: { ...INCIDENT_DETAIL_SELECT, requestFingerprint: true },
        });
        if (winner) return this.replay(winner, fingerprint);
        throw new ConflictException(
          'Conflicto al generar el codigo de incidencia; vuelve a intentar',
        );
      }
      throw error;
    }
  }

  async list(actor: AuthenticatedUser, query: ListIncidentsQueryDto) {
    const from = query.createdFrom ? new Date(query.createdFrom) : undefined;
    const to = query.createdTo ? new Date(query.createdTo) : undefined;
    if (
      (from && !Number.isFinite(from.getTime())) ||
      (to && !Number.isFinite(to.getTime()))
    ) {
      throw new BadRequestException('Las fechas deben ser fechas ISO validas');
    }
    if (from && to && from > to) {
      throw new BadRequestException(
        'createdFrom no puede ser posterior a createdTo',
      );
    }
    const where: Prisma.IncidentWhereInput = {
      AND: [
        this.access.readableWhere(actor),
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.type ? { type: query.type } : {}),
          ...(query.category ? { category: query.category } : {}),
          ...(query.urgency ? { urgency: query.urgency } : {}),
          ...(query.trackingCode?.trim()
            ? {
                trackingCode: {
                  contains: query.trackingCode.trim(),
                  mode: 'insensitive',
                },
              }
            : {}),
          ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
          ...(query.areaId || query.operatorId
            ? {
                assignments: {
                  some: {
                    replacedBy: { is: null },
                    ...(query.areaId ? { areaId: query.areaId } : {}),
                    ...(query.operatorId
                      ? { operatorId: query.operatorId }
                      : {}),
                  },
                },
              }
            : {}),
        },
      ],
    };
    const [items, total] = await this.db.$transaction(
      [
        this.db.incident.findMany({
          where,
          select: INCIDENT_LIST_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.db.incident.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: items.map((item) => ({
        ...item,
        latitude: item.latitude.toNumber(),
        longitude: item.longitude.toNumber(),
      })),
      pagination: this.pagination(query, total),
    };
  }

  async findById(actor: AuthenticatedUser, id: string) {
    const incident = await this.db.incident.findFirst({
      where: { AND: [{ id }, this.access.readableWhere(actor)] },
      select: INCIDENT_DETAIL_SELECT,
    });
    if (!incident) throw new NotFoundException('Incidencia no encontrada');
    return this.toDetail(incident);
  }

  async history(
    actor: AuthenticatedUser,
    id: string,
    query: IncidentPaginationQueryDto,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.access.assertReadable(tx, actor, id);
        const where = { incidentId: id };
        const items = await tx.incidentHistory.findMany({
          where,
          select: {
            id: true,
            incidentId: true,
            actorType: true,
            previousStatus: true,
            newStatus: true,
            comment: true,
            createdAt: true,
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        });
        const total = await tx.incidentHistory.count({ where });
        return { items, pagination: this.pagination(query, total) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async cancel(
    actor: AuthenticatedUser,
    id: string,
    dto: CancelIncidentDto,
    context: IncidentAuditContext,
  ) {
    if (
      ![UserRole.CITIZEN, UserRole.ADMIN, UserRole.SUPERVISOR].some(
        (role) => role === actor.role,
      )
    ) {
      throw new ForbiddenException(
        'No tienes permisos para cancelar incidencias',
      );
    }
    return this.db.$transaction(async (tx) => {
      const current = await this.access.assertReadable(tx, actor, id);
      if (current.version !== dto.expectedVersion) {
        throw new ConflictException(
          'La incidencia cambio; recarga su version actual',
        );
      }
      if (current.status !== IncidentStatus.RECEIVED) {
        throw new ConflictException(
          'Solo se pueden cancelar incidencias en RECEIVED en esta fase',
        );
      }
      const changed = await tx.incident.updateMany({
        where: {
          id,
          version: dto.expectedVersion,
          status: IncidentStatus.RECEIVED,
        },
        data: {
          status: IncidentStatus.CANCELLED,
          cancelledAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'La incidencia cambio; recarga su version actual',
        );
      }
      const reason = dto.reason.trim();
      await tx.incidentHistory.create({
        data: {
          incidentId: id,
          userId: actor.id,
          actorType: HistoryActorType.USER,
          previousStatus: current.status,
          newStatus: IncidentStatus.CANCELLED,
          comment: reason,
        },
      });
      await this.audit.record(
        {
          userId: actor.id,
          action: 'INCIDENT_CANCELLED',
          entityType: 'Incident',
          entityId: id,
          oldValue: { status: current.status, version: current.version },
          newValue: {
            status: IncidentStatus.CANCELLED,
            version: current.version + 1,
            reason,
          },
          ...context,
        },
        tx,
      );
      const updated = await tx.incident.findUniqueOrThrow({
        where: { id },
        select: INCIDENT_DETAIL_SELECT,
      });
      return this.toDetail(updated);
    });
  }

  private replay(
    incident: IncidentDetail & { requestFingerprint: string | null },
    fingerprint: string,
  ) {
    const { requestFingerprint, ...detail } = incident;
    if (requestFingerprint !== fingerprint) {
      throw new ConflictException(
        'clientRequestId ya fue utilizado con otro contenido',
      );
    }
    return this.toDetail(detail);
  }

  private toDetail(incident: IncidentDetail) {
    return {
      ...incident,
      latitude: incident.latitude.toNumber(),
      longitude: incident.longitude.toNumber(),
      aiConfidence: incident.aiConfidence?.toNumber() ?? null,
    };
  }

  private pagination(query: IncidentPaginationQueryDto, total: number) {
    return {
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit),
    };
  }
}
