import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import { IncidentStatus } from '@/generated/prisma/enums';
import { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { writeNotification } from '../notifications/write-notification';
import { IncidentAccessService } from './incident-access.service';
import { IncidentEventsGateway } from './incident-events.gateway';
import { IncidentAuditContext } from './incidents.service';
import {
  CloseIncidentDto,
  IncidentVersionDto,
  ReviewIncidentDto,
  TransferIncidentDto,
} from './dto/incident-workflow.dto';

type Tx = Prisma.TransactionClient;
type Actor = AuthenticatedUser;
type Incident = Awaited<ReturnType<IncidentAccessService['assertReadable']>>;

@Injectable()
export class IncidentWorkflowService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: IncidentAccessService,
    private readonly events: IncidentEventsGateway,
  ) {}

  private async change(
    actor: Actor,
    id: string,
    dto: IncidentVersionDto,
    states: IncidentStatus[],
    action: (tx: Tx, incident: Incident) => Promise<void>,
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'OPERATOR')
      throw new ForbiddenException();
    const result = await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM incidents WHERE id = ${id}::uuid FOR UPDATE`;
        const incident = await this.access.assertReadable(tx, actor, id);
        if (incident.version !== dto.expectedVersion)
          throw new ConflictException(
            'La incidencia cambió; recarga antes de continuar',
          );
        if (!states.includes(incident.status))
          throw new ConflictException(
            'El estado actual no admite esta operación',
          );
        if (
          actor.role !== 'ADMIN' &&
          incident.responsibleId &&
          incident.responsibleId !== actor.id
        )
          throw new ForbiddenException(
            'La incidencia está a cargo de otro operador',
          );
        await action(tx, incident);
        return tx.incident.findUniqueOrThrow({
          where: { id },
          select: {
            id: true,
            status: true,
            version: true,
            responsibleId: true,
          },
        });
      },
      { timeout: 15000 },
    );
    this.events.publish(id, result.version);
    return { incident: result };
  }

  private async record(
    tx: Tx,
    actor: Actor,
    incident: Incident,
    context: IncidentAuditContext,
    status: IncidentStatus,
    action: string,
    comment: string,
    details?: Prisma.InputJsonObject,
  ) {
    await tx.incidentHistory.create({
      data: {
        incidentId: incident.id,
        userId: actor.id,
        previousStatus: incident.status,
        newStatus: status,
        comment,
        metadata: details ?? {},
      },
    });
    await this.audit.record(
      {
        userId: actor.id,
        entityType: 'Incident',
        entityId: incident.id,
        action,
        oldValue: {
          status: incident.status,
          responsibleId: incident.responsibleId,
          version: incident.version,
        },
        newValue: { status, version: incident.version + 1, ...details },
        ...context,
      },
      tx,
    );
    if (status !== incident.status)
      await writeNotification(tx, {
        eventKey: 'incident:' + incident.id + ':v' + (incident.version + 1),
        userId: incident.reporterId,
        type:
          status === 'CLOSED' ? 'INCIDENT_RESOLVED' : 'INCIDENT_STATUS_CHANGED',
        title: 'Actualización de incidencia',
        body: comment,
        data: { incidentId: incident.id, status },
      });
  }

  review(
    actor: Actor,
    id: string,
    dto: ReviewIncidentDto,
    context: IncidentAuditContext,
  ) {
    return this.change(
      actor,
      id,
      dto,
      ['NEW', 'ACCEPTED', 'IN_PROGRESS'],
      async (tx, incident) => {
        const { reason, entities, ...classification } = dto;
        const { expectedVersion, ...fields } = classification;
        if (dto.urgency === 'CRITICAL' && !dto.requiresSupervision)
          throw new ConflictException(
            'Una incidencia crítica debe marcarse para supervisión',
          );
        await tx.incident.update({
          where: { id, version: expectedVersion },
          data: {
            ...fields,
            classificationSource: 'HUMAN',
            reviewedById: actor.id,
            reviewedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await tx.incidentEntity.deleteMany({ where: { incidentId: id } });
        if (entities.length)
          await tx.incidentEntity.createMany({
            data: entities.map((entity) => ({
              ...entity,
              incidentId: id,
              normalizedValue: entity.value.toLocaleLowerCase('es'),
            })),
          });
        await this.record(
          tx,
          actor,
          incident,
          context,
          incident.status,
          'INCIDENT_REVIEWED',
          reason,
          fields,
        );
      },
    );
  }

  accept(
    actor: Actor,
    id: string,
    dto: IncidentVersionDto,
    context: IncidentAuditContext,
  ) {
    return this.change(actor, id, dto, ['NEW'], async (tx, incident) => {
      await this.assertActiveStaff(tx, actor.id);
      await tx.incident.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          responsibleId: actor.id,
          acceptedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.record(
        tx,
        actor,
        incident,
        context,
        'ACCEPTED',
        'INCIDENT_ACCEPTED',
        'El equipo de Serenazgo tomó tu reporte.',
        { responsibleId: actor.id },
      );
    });
  }

  start(
    actor: Actor,
    id: string,
    dto: IncidentVersionDto,
    context: IncidentAuditContext,
  ) {
    return this.change(actor, id, dto, ['ACCEPTED'], async (tx, incident) => {
      await tx.incident.update({
        where: { id },
        data: {
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.record(
        tx,
        actor,
        incident,
        context,
        'IN_PROGRESS',
        'INCIDENT_STARTED',
        'Comenzó la atención de tu incidencia.',
      );
    });
  }

  close(
    actor: Actor,
    id: string,
    dto: CloseIncidentDto,
    context: IncidentAuditContext,
  ) {
    return this.change(
      actor,
      id,
      dto,
      ['IN_PROGRESS', 'RESOLVED'],
      async (tx, incident) => {
        if (
          await tx.evidenceUploadIntent.count({
            where: {
              incidentId: id,
              status: { in: ['PENDING', 'VERIFYING'] },
              expiresAt: { gt: new Date() },
            },
          })
        )
          throw new ConflictException(
            'Espera a que finalicen las cargas de evidencia',
          );
        const now = new Date();
        await tx.incident.update({
          where: { id },
          data: {
            status: 'CLOSED',
            closedAt: now,
            ...(incident.status !== 'RESOLVED' && {
              resolvedAt: now,
              resolvedById: actor.id,
            }),
            resolutionSummary: dto.resolutionSummary,
            version: { increment: 1 },
          },
        });
        await this.record(
          tx,
          actor,
          incident,
          context,
          'CLOSED',
          'INCIDENT_CLOSED',
          'Tu incidencia se cerró con un resultado registrado.',
          { resolutionSummary: dto.resolutionSummary },
        );
      },
    );
  }

  transfer(
    actor: Actor,
    id: string,
    dto: TransferIncidentDto,
    context: IncidentAuditContext,
  ) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException();
    return this.change(
      actor,
      id,
      dto,
      ['ACCEPTED', 'IN_PROGRESS'],
      async (tx, incident) => {
        await this.assertActiveStaff(tx, dto.responsibleId);
        await tx.incident.update({
          where: { id },
          data: {
            responsibleId: dto.responsibleId,
            version: { increment: 1 },
          },
        });
        await this.record(
          tx,
          actor,
          incident,
          context,
          incident.status,
          'INCIDENT_RESPONSIBLE_CHANGED',
          dto.reason,
          {
            previousResponsibleId: incident.responsibleId,
            responsibleId: dto.responsibleId,
          },
        );
      },
    );
  }

  private async assertActiveStaff(tx: Tx, userId: string) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true, role: true },
    });
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      (user.role !== 'OPERATOR' && user.role !== 'ADMIN')
    )
      throw new ConflictException('El responsable debe ser personal activo');
  }
}
