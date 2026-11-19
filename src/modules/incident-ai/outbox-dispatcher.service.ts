import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '@/database/database.service';
import { IncidentQueueService } from '@/infrastructure/queue/incident-queue.service';
import { CLASSIFICATION_EVENT } from './incident-ai.service';

@Injectable()
export class OutboxDispatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private busy = false;
  private stopping = false;
  private nextPoll = 0;
  private readonly owner = randomUUID();

  constructor(
    private readonly db: DatabaseService,
    protected readonly config: ConfigService,
    private readonly queue: IncidentQueueService,
  ) {}

  protected get eventType(): string {
    return CLASSIFICATION_EVENT;
  }
  protected get jobType():
    'INCIDENT_ANALYSIS' | 'EMBEDDING_DOCUMENT' | 'CHAT_RESPONSE' {
    return 'INCIDENT_ANALYSIS';
  }
  protected get enabled() {
    return Boolean(
      this.config.get<boolean>('AI_ENABLED') ||
      this.config.get<boolean>('AI_WORKER_ENABLED'),
    );
  }

  @Interval(250)
  async tick() {
    if (
      this.stopping ||
      this.busy ||
      Date.now() < this.nextPoll ||
      !this.enabled
    )
      return;
    this.busy = true;
    this.nextPoll =
      Date.now() + this.config.getOrThrow<number>('OUTBOX_POLL_INTERVAL_MS');
    try {
      await this.recover();
      // Claim one at a time: a slow Redis connection cannot exhaust a batch's lease.
      for (
        let index = 0;
        index < this.config.getOrThrow<number>('OUTBOX_BATCH_SIZE');
        index++
      ) {
        if (this.stopping) break;
        const claim = randomUUID();
        const entry = await this.db.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM queue_outbox WHERE "eventType" = ${this.eventType} AND status = 'PENDING' AND "availableAt" <= CURRENT_TIMESTAMP AT TIME ZONE 'UTC' ORDER BY "createdAt", id LIMIT 1 FOR UPDATE SKIP LOCKED`;
          if (!rows.length) return null;
          return tx.queueOutbox.update({
            where: { id: rows[0].id },
            data: {
              status: 'PROCESSING',
              lockedAt: new Date(),
              lockedBy: claim,
              attempts: { increment: 1 },
            },
          });
        });
        if (!entry) break;
        try {
          const job = await this.db.aiJob.findUnique({
            where: { id: entry.aggregateId },
          });
          if (job && ['PENDING', 'QUEUED'].includes(job.status)) {
            await this.db.aiJob.updateMany({
              where: { id: job.id, status: 'PENDING' },
              data: { status: 'QUEUED', queuedAt: new Date() },
            });
            await this.queue.publish(job.id);
          }
          await this.db.queueOutbox.updateMany({
            where: { id: entry.id, status: 'PROCESSING', lockedBy: claim },
            data: {
              status: 'PUBLISHED',
              publishedAt: new Date(),
              lockedAt: null,
              lockedBy: null,
              lastError: null,
            },
          });
        } catch {
          const dead =
            entry.attempts >=
            this.config.getOrThrow<number>('OUTBOX_MAX_ATTEMPTS');
          await this.db.queueOutbox.updateMany({
            where: { id: entry.id, status: 'PROCESSING', lockedBy: claim },
            data: {
              status: dead ? 'DEAD' : 'PENDING',
              availableAt: new Date(
                Date.now() +
                  Math.min(1000 * 2 ** Math.min(entry.attempts, 6), 60000),
              ),
              lockedAt: null,
              lockedBy: null,
              lastError: 'QUEUE_PUBLISH_UNAVAILABLE',
            },
          });
          break;
        }
      }
    } catch {
      this.logger.warn(
        'Dispatcher temporalmente no disponible; outbox conservada en PostgreSQL',
      );
    } finally {
      this.busy = false;
    }
  }

  private async recover() {
    const expired = new Date(Date.now() - 30000);
    await this.db.queueOutbox.updateMany({
      where: {
        eventType: this.eventType,
        status: 'PROCESSING',
        lockedAt: { lt: expired },
      },
      data: {
        status: 'PENDING',
        lockedAt: null,
        lockedBy: null,
        availableAt: new Date(),
      },
    });
    // Multi-instance reconciliation uses a short PostgreSQL lease, not an in-process lock alone.
    const candidates = await this.db.aiJob.findMany({
      where: {
        type: this.jobType,
        OR: [
          { status: 'PROCESSING', processingLeaseUntil: { lt: new Date() } },
          { status: { in: ['PENDING', 'QUEUED'] }, updatedAt: { lt: expired } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: this.config.getOrThrow<number>('OUTBOX_BATCH_SIZE'),
    });
    for (const job of candidates) {
      await this.db.$transaction(async (tx) => {
        const changed = await tx.aiJob.updateMany({
          where: {
            id: job.id,
            status: job.status,
            updatedAt: job.updatedAt,
            ...(job.status === 'PROCESSING'
              ? { processingLeaseUntil: { lt: new Date() } }
              : {}),
          },
          data: {
            status: 'QUEUED',
            processingToken: null,
            processingLeaseUntil: null,
            workerId: this.owner,
          },
        });
        if (!changed.count) return;
        // Even after Redis data loss, PUBLISHED entries are republished. DEAD requires admin action.
        await tx.queueOutbox.updateMany({
          where: {
            eventType: this.eventType,
            aggregateId: job.id,
            status: 'PUBLISHED',
          },
          data: {
            status: 'PENDING',
            availableAt: new Date(),
            publishedAt: null,
            lockedAt: null,
            lockedBy: null,
          },
        });
      });
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    while (this.busy)
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}
