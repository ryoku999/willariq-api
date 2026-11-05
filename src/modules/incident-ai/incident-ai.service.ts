import { writeNotification } from '../notifications/write-notification';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import { AiCapability, UserRole } from '@/generated/prisma/enums';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { IncidentAccessService } from '../incidents/incident-access.service';
import type { IncidentAuditContext } from '../incidents/incidents.service';
import type { IncidentPaginationQueryDto } from '../incidents/dto/incident-pagination-query.dto';
import { AiProvidersService } from '../ai-config/ai-providers.service';
import {
  AiSchemaService,
  canonicalJson,
  sha256,
} from '../ai-config/ai-schema.service';
import { lockAiCapability } from '../ai-config/ai-config-lock';
import type { OutboxQueryDto } from './dto/incident-ai.dto';

export const CLASSIFICATION_EVENT = 'INCIDENT_CLASSIFICATION_REQUESTED';
export const ACTIVE_JOB_STATUSES = ['PENDING', 'QUEUED', 'PROCESSING'] as const;
const JOB_SELECT = {
  id: true,
  incidentId: true,
  status: true,
  trigger: true,
  retryOfJobId: true,
  resultApplied: true,
  createdAt: true,
  queuedAt: true,
  startedAt: true,
  completedAt: true,
  failedAt: true,
} satisfies Prisma.AiJobSelect;

@Injectable()
export class IncidentAiService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly access: IncidentAccessService,
    private readonly audit: AuditService,
    private readonly providers: AiProvidersService,
    private readonly schemas: AiSchemaService,
  ) {}

  async submit(
    actor: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    context: IncidentAuditContext,
    retry = false,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM incidents WHERE id = ${id}::uuid FOR UPDATE`;
        await this.access.assertReadable(tx, actor, id);
        const incident = await tx.incident.findUniqueOrThrow({ where: { id } });
        if (
          !retry &&
          (actor.role !== UserRole.CITIZEN || incident.reporterId !== actor.id)
        )
          throw new ForbiddenException(
            'Solo el ciudadano propietario puede enviar',
          );
        if (retry && actor.role === UserRole.OPERATOR) {
          const allowed = await tx.incident.count({
            where: {
              id,
              assignments: {
                some: {
                  replacedBy: { is: null },
                  status: { notIn: ['CANCELLED', 'REASSIGNED'] },
                  area: {
                    status: 'ACTIVE',
                    members: {
                      some: { userId: actor.id, role: 'MANAGER', active: true },
                    },
                  },
                },
              },
            },
          });
          if (!allowed)
            throw new ForbiddenException(
              'Se requiere un encargado del area asignada',
            );
        }
        if (incident.version !== expectedVersion)
          throw new ConflictException(
            'Version desactualizada; consulta nuevamente la incidencia',
          );
        if (
          incident.status !== (retry ? 'IN_REVIEW' : 'RECEIVED') ||
          incident.classificationSource === 'HUMAN' ||
          incident.reviewedAt
        )
          throw new ConflictException('La incidencia no admite este envio');
        if (
          await tx.aiJob.count({
            where: {
              incidentId: id,
              type: 'INCIDENT_ANALYSIS',
              status: { in: [...ACTIVE_JOB_STATUSES] },
            },
          })
        )
          throw new ConflictException('Ya existe un trabajo activo');
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
            'Espera a que terminen las cargas de evidencia',
          );
        const previous = retry
          ? await tx.aiJob.findFirst({
              where: { incidentId: id, type: 'INCIDENT_ANALYSIS' },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            })
          : null;
        if (retry && !this.config.get<boolean>('AI_ENABLED'))
          throw new ConflictException('IA deshabilitada');
        if (retry && previous?.status !== 'FAILED')
          throw new ConflictException(
            'Solo se reintenta la ultima clasificacion fallida; no se reemplazan decisiones validas',
          );
        const enabled = this.config.get<boolean>('AI_ENABLED') === true;
        const status = enabled ? 'AI_ANALYSIS' : 'IN_REVIEW';
        let jobId: string | null = null;
        if (enabled) {
          await lockAiCapability(tx, AiCapability.INCIDENT_CLASSIFICATION);
          const prompts = await tx.promptVersion.findMany({
            where: { capability: 'INCIDENT_CLASSIFICATION', active: true },
          });
          const routes = await tx.aiRoute.findMany({
            where: { capability: 'INCIDENT_CLASSIFICATION', enabled: true },
            orderBy: [{ priority: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              provider: true,
              model: true,
              priority: true,
              timeoutMs: true,
            },
          });
          if (
            prompts.length !== 1 ||
            !routes.length ||
            routes.some((route) => !this.providers.isConfigured(route.provider))
          )
            throw new ConflictException(
              'Configura un prompt activo, rutas habilitadas y credenciales antes de enviar',
            );
          const prompt = prompts[0];
          const responseSchema = this.schemas.prepare(
            AiCapability.INCIDENT_CLASSIFICATION,
            prompt.responseSchema,
          );
          const input = {
            systemPrompt: prompt.systemPrompt,
            responseSchema,
            incident: {
              originalMessage: incident.originalMessage,
              address: incident.address,
              addressReference: incident.addressReference,
            },
          };
          jobId = randomUUID();
          await tx.aiJob.create({
            data: {
              id: jobId,
              type: 'INCIDENT_ANALYSIS',
              trigger: retry ? 'RETRY' : 'AUTOMATIC',
              incidentId: id,
              requestedById: actor.id,
              retryOfJobId: previous?.id,
              bullJobId: jobId,
              promptVersionId: prompt.id,
              promptHash: sha256(prompt.systemPrompt),
              responseSchemaHash: sha256(canonicalJson(responseSchema)),
              inputFingerprint: sha256(canonicalJson(input.incident)),
              inputPayload: input,
              routeSnapshot: routes,
              incidentVersion: incident.version + 1,
              maxRounds: this.config.getOrThrow<number>('AI_JOB_MAX_ROUNDS'),
            },
          });
          await tx.queueOutbox.create({
            data: {
              eventType: CLASSIFICATION_EVENT,
              aggregateType: 'AiJob',
              aggregateId: jobId,
              payload: { jobId },
            },
          });
        }
        await tx.incident.update({
          where: { id },
          data: {
            status,
            version: { increment: 1 },
            submittedAt: incident.submittedAt ?? new Date(),
            ...(enabled
              ? {}
              : {
                  classificationSource: 'MANUAL_WITHOUT_AI',
                  requiresSupervision: true,
                }),
          },
        });
        await tx.incidentHistory.create({
          data: {
            incidentId: id,
            userId: actor.id,
            previousStatus: incident.status,
            newStatus: status,
            comment: enabled
              ? 'Enviada a clasificacion IA'
              : 'IA deshabilitada: revision manual',
            metadata: { jobId, retry },
          },
        });
        await this.audit.record(
          {
            userId: actor.id,
            action: retry ? 'INCIDENT_AI_RETRIED' : 'INCIDENT_SUBMITTED',
            entityType: 'Incident',
            entityId: id,
            newValue: { status, jobId, version: incident.version + 1 },
            ...context,
          },
          tx,
        );
        if (!enabled)
          await writeNotification(tx, {
            eventKey: `incident:${id}:v${incident.version + 1}`,
            userId: incident.reporterId,
            type: 'INCIDENT_STATUS_CHANGED',
            title: 'Incidencia en revision',
            body: 'Tu incidencia fue enviada a revision manual.',
            data: { incidentId: id, version: incident.version + 1 },
          });
        return {
          incidentId: id,
          trackingCode: incident.trackingCode,
          status,
          version: incident.version + 1,
          jobId,
          analysisMode: enabled ? 'AI' : 'MANUAL_WITHOUT_AI',
        };
      },
      { timeout: 10000 },
    );
  }

  async list(
    actor: AuthenticatedUser,
    id: string,
    query: IncidentPaginationQueryDto,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.access.assertReadable(tx, actor, id);
        const where = { incidentId: id, type: 'INCIDENT_ANALYSIS' as const };
        const items = await tx.aiJob.findMany({
          where,
          select: JOB_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        });
        return this.page(items, await tx.aiJob.count({ where }), query);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async detail(id: string) {
    const job = await this.db.aiJob.findFirst({
      where: { id, type: 'INCIDENT_ANALYSIS' },
      select: {
        ...JOB_SELECT,
        promptVersionId: true,
        promptHash: true,
        responseSchemaHash: true,
        inputFingerprint: true,
        finalProvider: true,
        finalModel: true,
        errorSummary: true,
        maxRounds: true,
        currentRound: true,
        bullAttempts: true,
        heartbeatAt: true,
        processingLeaseUntil: true,
        incidentVersion: true,
        attempts: {
          orderBy: [{ round: 'asc' }, { sequence: 'asc' }],
          select: {
            id: true,
            round: true,
            sequence: true,
            provider: true,
            model: true,
            status: true,
            errorCode: true,
            latencyMs: true,
            promptTokens: true,
            completionTokens: true,
            totalTokens: true,
            startedAt: true,
            completedAt: true,
          },
        },
      },
    });
    if (!job) throw new NotFoundException('Trabajo IA no encontrado');
    return job;
  }

  async outbox(query: OutboxQueryDto) {
    const where: Prisma.QueueOutboxWhereInput = {
      eventType: CLASSIFICATION_EVENT,
      status: query.status,
    };
    const [items, total] = await this.db.$transaction(
      [
        this.db.queueOutbox.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
          select: {
            id: true,
            aggregateId: true,
            status: true,
            attempts: true,
            availableAt: true,
            publishedAt: true,
            createdAt: true,
            lastError: true,
          },
        }),
        this.db.queueOutbox.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return this.page(items, total, query);
  }

  async retryOutbox(
    actor: AuthenticatedUser,
    id: string,
    context: IncidentAuditContext,
  ) {
    return this.db.$transaction(async (tx) => {
      const entry = await tx.queueOutbox.findFirst({
        where: { id, eventType: CLASSIFICATION_EVENT },
      });
      if (!entry) throw new NotFoundException('Outbox no encontrada');
      const job = await tx.aiJob.findUnique({
        where: { id: entry.aggregateId },
      });
      if (!job || !(['PENDING', 'QUEUED'] as string[]).includes(job.status))
        throw new ConflictException(
          'El trabajo no esta pendiente de publicacion',
        );
      const changed = await tx.queueOutbox.updateMany({
        where: { id, status: 'DEAD' },
        data: {
          status: 'PENDING',
          attempts: 0,
          availableAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
      if (!changed.count)
        throw new ConflictException('Solo se reintentan entradas DEAD');
      await this.audit.record(
        {
          userId: actor.id,
          action: 'OUTBOX_RETRIED',
          entityType: 'QueueOutbox',
          entityId: id,
          newValue: { jobId: job.id },
          ...context,
        },
        tx,
      );
      return { id, status: 'PENDING', jobId: job.id };
    });
  }

  private page<T>(
    items: T[],
    total: number,
    query: IncidentPaginationQueryDto,
  ) {
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
}
