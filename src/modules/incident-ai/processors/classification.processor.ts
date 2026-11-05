import { writeNotification } from '../../notifications/write-notification';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import {
  AiCapability,
  type AiAttemptStatus,
  type AiJob,
} from '@/generated/prisma/client';
import { IncidentQueueService } from '@/infrastructure/queue/incident-queue.service';
import {
  AiSchemaService,
  canonicalJson,
  sha256,
} from '../../ai-config/ai-schema.service';
import { AuditService } from '../../audit/audit.service';
import {
  ClassificationProviderService,
  ProviderFailure,
} from '../providers/classification-provider.service';
import type {
  ClassificationResult,
  ClassificationRoute,
  ClassificationSnapshot,
} from '../incident-ai.types';

@Injectable()
export class ClassificationProcessor implements OnModuleInit {
  private readonly logger = new Logger(ClassificationProcessor.name);
  private readonly workerId = randomUUID();

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly queue: IncidentQueueService,
    private readonly provider: ClassificationProviderService,
    private readonly schemas: AiSchemaService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (this.config.get<boolean>('AI_WORKER_ENABLED'))
      this.queue.start((id) => this.process(id));
  }

  async process(id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) return;
    const token = randomUUID();
    const now = new Date();
    const claimed = await this.db.aiJob.updateMany({
      where: {
        id,
        type: 'INCIDENT_ANALYSIS',
        OR: [
          { status: { in: ['PENDING', 'QUEUED'] } },
          { status: 'PROCESSING', processingLeaseUntil: { lt: now } },
        ],
      },
      data: {
        status: 'PROCESSING',
        processingToken: token,
        processingLeaseUntil: this.lease(),
        heartbeatAt: now,
        workerId: this.workerId,
        bullAttempts: { increment: 1 },
      },
    });
    if (!claimed.count) return;
    // startedAt is retained over crashes, so recovery cannot reset the time budget.
    await this.db.aiJob.updateMany({
      where: { id, processingToken: token, startedAt: null },
      data: { startedAt: now },
    });
    const job = await this.db.aiJob.findUniqueOrThrow({ where: { id } });
    let lost = false;
    let beating = false;
    const heartbeat = setInterval(
      () => {
        if (beating) return;
        beating = true;
        void this.db.aiJob
          .updateMany({
            where: {
              id,
              status: 'PROCESSING',
              processingToken: token,
              processingLeaseUntil: { gt: new Date() },
            },
            data: {
              processingLeaseUntil: this.lease(),
              heartbeatAt: new Date(),
            },
          })
          .then((result) => {
            if (!result.count) lost = true;
          })
          .catch(() => {
            lost = true;
          })
          .finally(() => {
            beating = false;
          });
      },
      this.config.getOrThrow<number>('AI_JOB_HEARTBEAT_SECONDS') * 1000,
    );
    heartbeat.unref();
    try {
      if (job.bullAttempts > 3) {
        await this.finish(
          job,
          token,
          undefined,
          undefined,
          'WORKER_RECOVERY_EXHAUSTED',
        );
        return;
      }
      const snapshot = job.inputPayload as unknown as ClassificationSnapshot;
      const routes = job.routeSnapshot as unknown as ClassificationRoute[];
      if (
        !snapshot?.systemPrompt ||
        !Array.isArray(routes) ||
        !routes.length ||
        sha256(snapshot.systemPrompt) !== job.promptHash ||
        sha256(canonicalJson(snapshot.responseSchema)) !==
          job.responseSchemaHash ||
        sha256(canonicalJson(snapshot.incident)) !== job.inputFingerprint
      ) {
        await this.finish(job, token, undefined, undefined, 'SNAPSHOT_INVALID');
        return;
      }
      this.schemas.prepare(
        AiCapability.INCIDENT_CLASSIFICATION,
        snapshot.responseSchema,
      );
      const deadline =
        job.startedAt!.getTime() +
        this.config.getOrThrow<number>('AI_JOB_MAX_TOTAL_MS');
      await this.db.aiAttempt.updateMany({
        where: { jobId: id, status: { in: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'FAILED',
          errorCode: 'WORKER_INTERRUPTED',
          completedAt: new Date(),
        },
      });
      const existing = await this.db.aiAttempt.findMany({
        where: { jobId: id },
        orderBy: [{ round: 'asc' }, { sequence: 'asc' }],
      });
      // A crash after saving a valid response but before applying it must not waste a new call.
      const success = existing.find((attempt) => attempt.status === 'SUCCESS');
      if (success?.parsedResponse) {
        const output = success.parsedResponse as Record<string, unknown>;
        if (
          this.schemas.validateOutput(
            AiCapability.INCIDENT_CLASSIFICATION,
            snapshot.responseSchema,
            output,
          ).valid
        ) {
          await this.finish(
            job,
            token,
            output as unknown as ClassificationResult,
            routes.find(
              (route) =>
                route.provider === success.provider &&
                route.model === success.model,
            ),
          );
          return;
        }
      }
      const completedSlots = new Set(
        existing.map((attempt) => `${attempt.round}-${attempt.sequence}`),
      );
      let lastError = 'PROVIDERS_EXHAUSTED';
      for (let round = 1; round <= job.maxRounds; round++) {
        for (const [index, route] of routes.entries()) {
          if (lost) return;
          if (completedSlots.has(`${round}-${index + 1}`)) continue;
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            await this.finish(
              job,
              token,
              undefined,
              undefined,
              'TIME_BUDGET_EXCEEDED',
            );
            return;
          }
          const attempt = await this.db.$transaction(async (tx) => {
            const fence = await tx.aiJob.updateMany({
              where: {
                id,
                status: 'PROCESSING',
                processingToken: token,
                processingLeaseUntil: { gt: new Date() },
              },
              data: { currentRound: round },
            });
            if (!fence.count) return null;
            return tx.aiAttempt.create({
              data: {
                jobId: id,
                round,
                sequence: index + 1,
                provider: route.provider,
                model: route.model,
                status: 'PROCESSING',
                startedAt: new Date(),
              },
            });
          });
          if (!attempt) return;
          const began = Date.now();
          let delay = 0;
          let result:
            | Awaited<ReturnType<ClassificationProviderService['classify']>>
            | undefined;
          let errorCode: string | undefined;
          try {
            result = await this.provider.classify(
              route,
              snapshot,
              Math.min(route.timeoutMs, remaining),
            );
            if (
              !this.schemas.validateOutput(
                AiCapability.INCIDENT_CLASSIFICATION,
                snapshot.responseSchema,
                result.output,
              ).valid
            ) {
              result = undefined;
              throw new ProviderFailure('INVALID_RESPONSE');
            }
          } catch (error) {
            const failure =
              error instanceof ProviderFailure
                ? error
                : new ProviderFailure('INVALID_RESPONSE');
            errorCode = failure.code;
            lastError = errorCode;
            delay = failure.code === 'RATE_LIMITED' ? failure.retryAfterMs : 0;
          }
          if (lost) return;
          const status: AiAttemptStatus = result
            ? 'SUCCESS'
            : errorCode === 'TIMEOUT'
              ? 'TIMEOUT'
              : errorCode === 'RATE_LIMITED'
                ? 'RATE_LIMITED'
                : errorCode === 'INVALID_RESPONSE' ||
                    errorCode === 'RESPONSE_TOO_LARGE'
                  ? 'INVALID_RESPONSE'
                  : 'FAILED';
          const persisted = await this.db.$transaction(async (tx) => {
            const fence = await tx.aiJob.updateMany({
              where: {
                id,
                status: 'PROCESSING',
                processingToken: token,
                processingLeaseUntil: { gt: new Date() },
              },
              data: { heartbeatAt: new Date() },
            });
            if (!fence.count) return false;
            await tx.aiAttempt.update({
              where: { id: attempt.id },
              data: {
                status,
                errorCode,
                completedAt: new Date(),
                latencyMs: Date.now() - began,
                ...(result
                  ? {
                      parsedResponse: result.output as Prisma.InputJsonObject,
                      promptTokens: result.promptTokens,
                      completionTokens: result.completionTokens,
                      totalTokens: result.totalTokens,
                    }
                  : {}),
              },
            });
            return true;
          });
          if (!persisted) return;
          if (result) {
            await this.finish(
              job,
              token,
              result.output as unknown as ClassificationResult,
              route,
            );
            return;
          }
          if (delay > 0)
            await new Promise<void>((resolve) =>
              setTimeout(
                resolve,
                Math.min(delay, Math.max(0, deadline - Date.now())),
              ),
            );
        }
      }
      await this.finish(job, token, undefined, undefined, lastError);
    } catch {
      // Leave recoverable state if PostgreSQL is down; no raw payload in logs.
      this.logger.warn(
        `Trabajo ${id} interrumpido; se recuperara al vencer su lease`,
      );
      throw new Error('CLASSIFICATION_INTERRUPTED');
    } finally {
      clearInterval(heartbeat);
    }
  }

  private lease() {
    return new Date(
      Date.now() +
        this.config.getOrThrow<number>('AI_JOB_LEASE_SECONDS') * 1000,
    );
  }

  private async finish(
    job: AiJob,
    token: string,
    output?: ClassificationResult,
    route?: ClassificationRoute,
    errorCode?: string,
  ) {
    if (!job.incidentId) return;
    const id = job.incidentId;
    await this.db.$transaction(
      async (tx) => {
        // Always lock incident before job, matching submission's lock order.
        await tx.$queryRaw`SELECT id FROM incidents WHERE id = ${id}::uuid FOR UPDATE`;
        const fenced = await tx.aiJob.updateMany({
          where: {
            id: job.id,
            status: 'PROCESSING',
            processingToken: token,
            processingLeaseUntil: { gt: new Date() },
          },
          data: {
            status: output ? 'COMPLETED' : 'FAILED',
            completedAt: output ? new Date() : null,
            failedAt: output ? null : new Date(),
            errorSummary: output ? null : (errorCode ?? 'PROVIDERS_EXHAUSTED'),
            processingToken: null,
            processingLeaseUntil: null,
            resultApplied: false,
          },
        });
        if (!fenced.count) return;
        const incident = await tx.incident.findUnique({ where: { id } });
        if (
          !incident ||
          incident.status !== 'AI_ANALYSIS' ||
          incident.version !== job.incidentVersion ||
          incident.classificationSource === 'HUMAN' ||
          incident.reviewedAt
        ) {
          await tx.aiJob.update({
            where: { id: job.id },
            data: {
              status: 'CANCELLED',
              errorSummary: 'STALE_INCIDENT',
              resultApplied: false,
            },
          });
          return;
        }
        if (output) {
          const { entities, ...classification } = output;
          await tx.incident.update({
            where: { id },
            data: {
              ...classification,
              classificationSource: 'AI',
              status: 'IN_REVIEW',
              version: { increment: 1 },
            },
          });
          await tx.incidentEntity.deleteMany({ where: { incidentId: id } });
          if (entities.length)
            await tx.incidentEntity.createMany({
              data: entities.map((entity) => ({
                incidentId: id,
                ...entity,
                normalizedValue: entity.value.trim().toLocaleLowerCase('es'),
              })),
            });
          await tx.aiJob.update({
            where: { id: job.id },
            data: {
              resultApplied: true,
              finalOutput: output as unknown as Prisma.InputJsonObject,
              finalProvider: route?.provider,
              finalModel: route?.model,
            },
          });
        } else {
          await tx.incident.update({
            where: { id },
            data: {
              status: 'IN_REVIEW',
              classificationSource: 'MANUAL_WITHOUT_AI',
              requiresSupervision: true,
              version: { increment: 1 },
            },
          });
        }
        await tx.incidentHistory.create({
          data: {
            incidentId: id,
            actorType: output ? 'AI' : 'SYSTEM',
            previousStatus: 'AI_ANALYSIS',
            newStatus: 'IN_REVIEW',
            comment: output
              ? 'Clasificacion IA completada; requiere revision humana'
              : 'No se completo la clasificacion IA; requiere revision manual',
            metadata: { jobId: job.id, resultApplied: Boolean(output) },
          },
        });
        await this.audit.record(
          {
            action: output ? 'INCIDENT_AI_CLASSIFIED' : 'INCIDENT_AI_FAILED',
            entityType: 'Incident',
            entityId: id,
            newValue: {
              jobId: job.id,
              version: incident.version + 1,
              resultApplied: Boolean(output),
              errorCode: errorCode ?? null,
            },
          },
          tx,
        );
        await writeNotification(tx, {
          eventKey: `incident:${id}:v${incident.version + 1}`,
          userId: incident.reporterId,
          type: output ? 'INCIDENT_STATUS_CHANGED' : 'AI_REVIEW_REQUIRED',
          title: 'Incidencia en revision',
          body: output
            ? 'Tu incidencia fue analizada y esta pendiente de revision humana.'
            : 'Tu incidencia fue recibida y sera revisada manualmente.',
          data: { incidentId: id, jobId: job.id },
        });
      },
      { timeout: 10000 },
    );
  }
}
