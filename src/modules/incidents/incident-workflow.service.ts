import { writeNotification } from '../notifications/write-notification';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import { AssignmentStatus, IncidentStatus } from '@/generated/prisma/enums';
import { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { IncidentAccessService } from './incident-access.service';
import { IncidentAuditContext } from './incidents.service';
import { IncidentPaginationQueryDto } from './dto/incident-pagination-query.dto';
import {
  AssignmentVersionDto,
  CancelAssignmentDto,
  CreateAssignmentDto,
  IncidentVersionDto,
  ReassignIncidentDto,
  RejectIncidentDto,
  ResolveIncidentDto,
  ReviewIncidentDto,
} from './dto/incident-workflow.dto';

const ACTIVE: AssignmentStatus[] = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'];
type Tx = Prisma.TransactionClient;
type Actor = AuthenticatedUser;

@Injectable()
export class IncidentWorkflowService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: IncidentAccessService,
  ) {}

  private async transaction<T>(work: (tx: Tx) => Promise<T>) {
    try {
      return await this.db.$transaction(work, { timeout: 15000 });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException(
          'Conflicto concurrente; recarga las versiones y vuelve a intentar',
        );
      throw error;
    }
  }

  private global(actor: Actor) {
    return actor.role === 'ADMIN' || actor.role === 'SUPERVISOR';
  }

  private async current(tx: Tx, actor: Actor, id: string, version: number) {
    // Same lock order as submit/worker. Authorization is rechecked inside the transaction.
    await tx.$queryRaw`SELECT id FROM incidents WHERE id = ${id}::uuid FOR UPDATE`;
    await this.access.assertReadable(tx, actor, id);
    const incident = await tx.incident.findUniqueOrThrow({ where: { id } });
    if (incident.version !== version)
      throw new ConflictException(
        'La incidencia cambio; recarga su version actual',
      );
    return incident;
  }

  private state(actual: IncidentStatus, allowed: IncidentStatus[]) {
    if (!allowed.includes(actual))
      throw new ConflictException(`Estado ${actual} no admite esta operacion`);
  }

  private async manager(tx: Tx, actor: Actor, areaId: string) {
    if (this.global(actor)) return;
    await tx.$queryRaw`SELECT id FROM municipal_areas WHERE id = ${areaId}::uuid FOR UPDATE`;
    if (actor.role !== 'OPERATOR')
      throw new ForbiddenException('Se requiere personal autorizado');
    const member = await tx.municipalAreaMember.findFirst({
      where: {
        areaId,
        userId: actor.id,
        active: true,
        role: 'MANAGER',
        area: { status: 'ACTIVE' },
      },
    });
    if (!member)
      throw new ForbiddenException('Se requiere MANAGER activo del area');
  }

  private async assignment(
    tx: Tx,
    incidentId: string,
    dto: AssignmentVersionDto,
  ) {
    const assignment = await tx.incidentAssignment.findFirst({
      where: {
        id: dto.assignmentId,
        incidentId,
        status: { in: ACTIVE },
        replacedBy: { is: null },
      },
    });
    if (!assignment || assignment.version !== dto.expectedAssignmentVersion)
      throw new ConflictException('La asignacion cambio o no esta activa');
    return assignment;
  }

  private async eligible(tx: Tx, areaId: string, operatorId?: string | null) {
    // Coordinate eligibility with area/member/user mutations using row locks.
    await tx.$queryRaw`SELECT id FROM municipal_areas WHERE id = ${areaId}::uuid FOR UPDATE`;
    const area = await tx.municipalArea.findUnique({ where: { id: areaId } });
    if (!area || area.status !== 'ACTIVE')
      throw new ConflictException('El area debe estar activa');
    if (!operatorId) return;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${operatorId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM municipal_area_members WHERE "areaId" = ${areaId}::uuid AND "userId" = ${operatorId}::uuid FOR UPDATE`;
    const member = await tx.municipalAreaMember.findFirst({
      where: {
        areaId,
        userId: operatorId,
        active: true,
        user: { status: 'ACTIVE', role: { in: ['OPERATOR', 'SUPERVISOR'] } },
      },
    });
    if (!member)
      throw new ConflictException(
        'El responsable debe ser personal activo y miembro activo del area',
      );
  }

  private async owner(
    tx: Tx,
    actor: Actor,
    assignment: { areaId: string; operatorId: string | null },
  ) {
    if (assignment.operatorId !== actor.id)
      throw new ForbiddenException(
        'Solo el responsable puede aceptar, iniciar o resolver su trabajo',
      );
    await this.eligible(tx, assignment.areaId, assignment.operatorId);
  }

  private async record(
    tx: Tx,
    actor: Actor,
    incident: {
      id: string;
      status: IncidentStatus;
      reporterId: string;
      version: number;
    },
    status: IncidentStatus,
    action: string,
    comment: string,
    context: IncidentAuditContext,
    assignmentId?: string,
  ) {
    const assignment = assignmentId
      ? await tx.incidentAssignment.findUniqueOrThrow({
          where: { id: assignmentId },
          select: {
            id: true,
            areaId: true,
            operatorId: true,
            status: true,
            version: true,
            replacesId: true,
          },
        })
      : null;
    await tx.incidentHistory.create({
      data: {
        incidentId: incident.id,
        userId: actor.id,
        actorType: 'USER',
        previousStatus: incident.status,
        newStatus: status,
        comment,
        metadata: assignment ? { assignment } : {},
      },
    });
    await this.audit.record(
      {
        userId: actor.id,
        entityType: 'Incident',
        entityId: incident.id,
        action,
        oldValue: { status: incident.status, version: incident.version },
        newValue: {
          status,
          version: incident.version + 1,
          assignment,
        },
        ...context,
      },
      tx,
    );
    await writeNotification(tx, {
      eventKey: `incident:${incident.id}:v${incident.version + 1}`,
      userId: incident.reporterId,
      type:
        status === 'RESOLVED'
          ? 'INCIDENT_RESOLVED'
          : status === 'REJECTED'
            ? 'INCIDENT_REJECTED'
            : status === 'ASSIGNED'
              ? 'INCIDENT_ASSIGNED'
              : 'INCIDENT_STATUS_CHANGED',
      title: 'Actualizacion de incidencia',
      body: `Tu incidencia se encuentra en ${status}.`,
      data: { incidentId: incident.id, status },
    });
  }

  private async result(tx: Tx, id: string, assignmentId?: string) {
    const incident = await tx.incident.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        status: true,
        version: true,
        classificationSource: true,
        reviewedAt: true,
        acceptedAt: true,
        assignedAt: true,
        startedAt: true,
        resolvedAt: true,
        closedAt: true,
      },
    });
    const assignment = assignmentId
      ? await tx.incidentAssignment.findUniqueOrThrow({
          where: { id: assignmentId },
        })
      : null;
    return { incident, assignment };
  }

  review(
    actor: Actor,
    id: string,
    dto: ReviewIncidentDto,
    context: IncidentAuditContext,
  ) {
    // Initial unassigned review is exclusively global staff; managers have no global inbox.
    if (!this.global(actor))
      throw new ForbiddenException(
        'Solo ADMIN o SUPERVISOR pueden revisar incidencias',
      );
    return this.transaction(async (tx) => {
      const incident = await this.current(tx, actor, id, dto.expectedVersion);
      this.state(incident.status, ['IN_REVIEW']);
      const { expectedVersion, reason, entities, ...classification } = dto;
      if (dto.urgency === 'CRITICAL' && !dto.requiresSupervision)
        throw new ConflictException(
          'Una incidencia CRITICAL debe conservar supervision',
        );
      await tx.incident.update({
        where: { id, version: expectedVersion },
        data: {
          ...classification,
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
        'IN_REVIEW',
        'INCIDENT_REVIEWED',
        reason,
        context,
      );
      await this.audit.record(
        {
          userId: actor.id,
          action: 'INCIDENT_CLASSIFICATION_CORRECTED',
          entityType: 'Incident',
          entityId: id,
          oldValue: {
            type: incident.type,
            category: incident.category,
            urgency: incident.urgency,
            sentiment: incident.sentiment,
            requiresSupervision: incident.requiresSupervision,
            classificationSource: incident.classificationSource,
          },
          newValue: {
            type: dto.type,
            category: dto.category,
            urgency: dto.urgency,
            sentiment: dto.sentiment,
            requiresSupervision: dto.requiresSupervision,
            classificationSource: 'HUMAN',
            reason,
          },
          ...context,
        },
        tx,
      );
      return this.result(tx, id);
    });
  }

  decide(
    actor: Actor,
    id: string,
    dto: IncidentVersionDto | RejectIncidentDto,
    accept: boolean,
    context: IncidentAuditContext,
  ) {
    if (!this.global(actor))
      throw new ForbiddenException('Solo ADMIN o SUPERVISOR pueden decidir');
    return this.transaction(async (tx) => {
      const incident = await this.current(tx, actor, id, dto.expectedVersion);
      this.state(incident.status, ['IN_REVIEW']);
      if (
        accept &&
        (!incident.type ||
          !incident.category ||
          !incident.urgency ||
          !incident.sentiment ||
          !incident.improvedDescription?.trim() ||
          !incident.recommendedAction?.trim())
      )
        throw new ConflictException(
          'Completa la clasificacion mediante revision antes de aceptar',
        );
      const rejected = dto as RejectIncidentDto;
      const status = accept ? 'ACCEPTED' : 'REJECTED';
      // Acceptance itself confirms a human review of an unchanged AI proposal.
      await tx.incident.update({
        where: { id },
        data: {
          status,
          reviewedById: actor.id,
          reviewedAt: incident.reviewedAt ?? new Date(),
          acceptedAt: accept ? new Date() : null,
          rejectedAt: accept ? null : new Date(),
          rejectionReason: accept ? null : rejected.rejectionReason,
          rejectionComment: accept ? null : rejected.reason,
          version: { increment: 1 },
        },
      });
      await this.record(
        tx,
        actor,
        incident,
        status,
        accept ? 'INCIDENT_ACCEPTED' : 'INCIDENT_REJECTED',
        accept
          ? 'Propuesta revisada y aceptada por personal autorizado'
          : rejected.reason,
        context,
      );
      return this.result(tx, id);
    });
  }

  assign(
    actor: Actor,
    id: string,
    dto: CreateAssignmentDto | ReassignIncidentDto,
    context: IncidentAuditContext,
    reassign = false,
  ) {
    if (actor.role === 'CITIZEN') throw new ForbiddenException();
    return this.transaction(async (tx) => {
      const incident = await this.current(tx, actor, id, dto.expectedVersion);
      this.state(
        incident.status,
        reassign ? ['ASSIGNED', 'IN_PROGRESS'] : ['ACCEPTED'],
      );
      if (!this.global(actor) && incident.requiresSupervision)
        throw new ForbiddenException(
          'La incidencia requiere ADMIN o SUPERVISOR',
        );
      let previousId: string | undefined;
      if (reassign) {
        const replacement = dto as ReassignIncidentDto;
        const old = await this.assignment(tx, id, replacement);
        await this.manager(tx, actor, old.areaId);
        // A manager cannot move a case outside their authorized area.
        if (!this.global(actor) && old.areaId !== dto.areaId)
          throw new ForbiddenException(
            'Solo ADMIN o SUPERVISOR pueden cambiar el area',
          );
        await tx.incidentAssignment.update({
          where: { id: old.id },
          data: {
            status: 'REASSIGNED',
            reassignedAt: new Date(),
            version: { increment: 1 },
          },
        });
        previousId = old.id;
      } else if (!this.global(actor))
        throw new ForbiddenException(
          'La asignacion inicial requiere ADMIN o SUPERVISOR',
        );
      await this.eligible(tx, dto.areaId, dto.operatorId);
      const assignment = await tx.incidentAssignment.create({
        data: {
          incidentId: id,
          areaId: dto.areaId,
          operatorId: dto.operatorId,
          assignedById: actor.id,
          note: dto.note,
          replacesId: previousId,
        },
      });
      await tx.incident.update({
        where: { id },
        data: {
          status: 'ASSIGNED',
          assignedAt: new Date(),
          startedAt: null,
          version: { increment: 1 },
        },
      });
      await this.record(
        tx,
        actor,
        incident,
        'ASSIGNED',
        reassign ? 'INCIDENT_REASSIGNED' : 'INCIDENT_ASSIGNED',
        reassign
          ? (dto as ReassignIncidentDto).reason
          : (dto.note ?? 'Incidencia asignada'),
        context,
        assignment.id,
      );
      if (dto.operatorId)
        await writeNotification(tx, {
          eventKey: `incident:${id}:v${incident.version + 1}`,
          userId: dto.operatorId,
          type: 'INCIDENT_ASSIGNED',
          title: 'Nueva asignacion',
          body: 'Tienes una incidencia asignada.',
          data: { incidentId: id, assignmentId: assignment.id },
        });
      return this.result(tx, id, assignment.id);
    });
  }

  work(
    actor: Actor,
    id: string,
    dto: AssignmentVersionDto | CancelAssignmentDto | ResolveIncidentDto,
    operation: 'accept' | 'start' | 'resolve' | 'cancel',
    context: IncidentAuditContext,
  ) {
    if (actor.role === 'CITIZEN') throw new ForbiddenException();
    return this.transaction(async (tx) => {
      const incident = await this.current(tx, actor, id, dto.expectedVersion);
      const assignment = await this.assignment(tx, id, dto);
      if (operation === 'cancel') {
        await this.manager(tx, actor, assignment.areaId);
        if (incident.requiresSupervision && !this.global(actor))
          throw new ForbiddenException(
            'La incidencia requiere ADMIN o SUPERVISOR',
          );
        this.state(incident.status, ['ASSIGNED', 'IN_PROGRESS']);
      } else {
        await this.owner(tx, actor, assignment);
        const expected =
          operation === 'accept'
            ? 'ASSIGNED'
            : operation === 'start'
              ? 'ACCEPTED'
              : 'IN_PROGRESS';
        if (assignment.status !== expected)
          throw new ConflictException('Estado de asignacion incompatible');
        this.state(
          incident.status,
          operation === 'resolve' ? ['IN_PROGRESS'] : ['ASSIGNED'],
        );
      }
      const now = new Date();
      const status: IncidentStatus =
        operation === 'cancel'
          ? 'ACCEPTED'
          : operation === 'resolve'
            ? 'RESOLVED'
            : operation === 'start'
              ? 'IN_PROGRESS'
              : 'ASSIGNED';
      const assignmentStatus: AssignmentStatus =
        operation === 'cancel'
          ? 'CANCELLED'
          : operation === 'resolve'
            ? 'COMPLETED'
            : operation === 'start'
              ? 'IN_PROGRESS'
              : 'ACCEPTED';
      if (
        operation === 'resolve' &&
        (await tx.evidenceUploadIntent.count({
          where: {
            incidentId: id,
            status: { in: ['PENDING', 'VERIFYING'] },
            expiresAt: { gt: now },
          },
        }))
      )
        throw new ConflictException(
          'Espera a que finalicen las cargas de evidencia',
        );
      const summary =
        operation === 'resolve'
          ? (dto as ResolveIncidentDto).resolutionSummary
          : undefined;
      await tx.incidentAssignment.update({
        where: { id: assignment.id },
        data: {
          status: assignmentStatus,
          version: { increment: 1 },
          ...(operation === 'accept'
            ? { acceptedAt: now }
            : operation === 'start'
              ? { startedAt: now }
              : operation === 'resolve'
                ? { completedAt: now, completionNote: summary }
                : { cancelledAt: now }),
        },
      });
      await tx.incident.update({
        where: { id },
        data: {
          status,
          version: { increment: 1 },
          ...(operation === 'start'
            ? { startedAt: now }
            : operation === 'resolve'
              ? {
                  resolvedAt: now,
                  resolvedById: actor.id,
                  resolutionSummary: summary,
                }
              : operation === 'cancel'
                ? { assignedAt: null, startedAt: null }
                : {}),
        },
      });
      await this.record(
        tx,
        actor,
        incident,
        status,
        `ASSIGNMENT_${operation.toUpperCase()}`,
        operation === 'cancel'
          ? (dto as CancelAssignmentDto).reason
          : (summary ?? `Asignacion: ${operation}`),
        context,
        assignment.id,
      );
      return this.result(tx, id, assignment.id);
    });
  }

  async workByAssignment(
    actor: Actor,
    assignmentId: string,
    dto: AssignmentVersionDto | CancelAssignmentDto,
    operation: 'accept' | 'cancel',
    context: IncidentAuditContext,
  ) {
    if (assignmentId !== dto.assignmentId)
      throw new ConflictException('assignmentId debe coincidir con la ruta');
    const assignment = await this.db.incidentAssignment.findFirst({
      where: { id: assignmentId, incident: this.access.readableWhere(actor) },
      select: { incidentId: true },
    });
    if (!assignment) throw new NotFoundException('Asignacion no encontrada');
    return this.work(actor, assignment.incidentId, dto, operation, context);
  }

  close(
    actor: Actor,
    id: string,
    dto: IncidentVersionDto,
    context: IncidentAuditContext,
  ) {
    if (!this.global(actor))
      throw new ForbiddenException('Solo ADMIN o SUPERVISOR pueden cerrar');
    return this.transaction(async (tx) => {
      const incident = await this.current(tx, actor, id, dto.expectedVersion);
      this.state(incident.status, ['RESOLVED']);
      const completed = await tx.incidentAssignment.findFirst({
        where: {
          incidentId: id,
          status: 'COMPLETED',
          replacedBy: { is: null },
        },
        orderBy: { assignedAt: 'desc' },
      });
      if (!completed || !incident.resolutionSummary?.trim())
        throw new ConflictException(
          'Se requiere asignacion completada y resumen de resolucion',
        );
      await tx.incident.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.record(
        tx,
        actor,
        incident,
        'CLOSED',
        'INCIDENT_CLOSED',
        'Incidencia cerrada',
        context,
        completed.id,
      );
      return this.result(tx, id, completed.id);
    });
  }

  list(actor: Actor, query: IncidentPaginationQueryDto, incidentId?: string) {
    if (!incidentId && actor.role === 'CITIZEN') throw new ForbiddenException();
    return this.transaction(async (tx) => {
      if (incidentId) await this.access.assertReadable(tx, actor, incidentId);
      const where: Prisma.IncidentAssignmentWhereInput = {
        ...(incidentId
          ? { incidentId }
          : {
              operatorId: actor.id,
              status: { notIn: ['CANCELLED', 'REASSIGNED'] },
            }),
        incident: this.access.readableWhere(actor),
      };
      const assignments = await tx.incidentAssignment.findMany({
        where,
        orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      const total = await tx.incidentAssignment.count({ where });
      const areas = await tx.municipalArea.findMany({
        where: { id: { in: assignments.map((row) => row.areaId) } },
        select: { id: true, name: true, code: true },
      });
      const incidents = await tx.incident.findMany({
        where: { id: { in: assignments.map((row) => row.incidentId) } },
        select: { id: true, trackingCode: true },
      });
      const operators =
        actor.role === 'CITIZEN'
          ? []
          : await tx.user.findMany({
              where: {
                id: { in: assignments.flatMap((row) => row.operatorId ?? []) },
              },
              select: { id: true, firstName: true, lastName: true },
            });
      const areaById = new Map(areas.map(({ id, ...area }) => [id, area]));
      const incidentById = new Map(
        incidents.map(({ id, ...incident }) => [id, incident]),
      );
      const operatorById = new Map(
        operators.map(({ id, ...operator }) => [id, operator]),
      );
      const items = assignments.map((row) => ({
        ...row,
        area: areaById.get(row.areaId) ?? null,
        incident: incidentById.get(row.incidentId) ?? null,
        ...(actor.role === 'CITIZEN'
          ? {}
          : { operator: operatorById.get(row.operatorId ?? '') ?? null }),
      }));
      return {
        items,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          pages: Math.ceil(total / query.limit),
        },
      };
    });
  }
}
