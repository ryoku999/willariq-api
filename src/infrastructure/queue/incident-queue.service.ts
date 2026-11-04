import { Injectable, Logger, BeforeApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

export const INCIDENT_QUEUE = 'incident-classification';

/** Lifecycle managed by Nest; workers use a separate, reconnecting connection. */
@Injectable()
export class IncidentQueueService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(IncidentQueueService.name);
  private producer?: Queue<{ jobId: string }>;
  private producerReady = false;
  private worker?: Worker<{ jobId: string }>;

  constructor(private readonly config: ConfigService) {}

  private connection(worker = false): ConnectionOptions {
    return {
      host: this.config.getOrThrow<string>('REDIS_HOST'),
      port: this.config.getOrThrow<number>('REDIS_PORT'),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      db: this.config.getOrThrow<number>('REDIS_DB'),
      maxRetriesPerRequest: worker ? null : 1,
      enableOfflineQueue: worker,
      connectTimeout: 2000,
      ...(worker ? {} : { commandTimeout: 3000 }),
      retryStrategy: (times: number) => Math.min(times * 500, 5000),
    };
  }

  queue() {
    if (!this.producer) {
      this.producer = new Queue<{ jobId: string }>(INCIDENT_QUEUE, {
        prefix: this.config.getOrThrow<string>('BULLMQ_PREFIX'),
        connection: this.connection(),
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: { age: 86400, count: 1000 },
          removeOnFail: { age: 604800, count: 1000 },
        },
      });
      // Never log connection objects or errors that may contain credentials.
      this.producer.on('error', () => undefined);
    }
    return this.producer;
  }

  start(process: (id: string) => Promise<void>) {
    if (this.worker) return;
    this.worker = new Worker<{ jobId: string }>(
      INCIDENT_QUEUE,
      async (job) => {
        await process(job.data.jobId);
      },
      {
        prefix: this.config.getOrThrow<string>('BULLMQ_PREFIX'),
        connection: this.connection(true),
        concurrency: this.config.getOrThrow<number>('AI_WORKER_CONCURRENCY'),
      },
    );
    this.worker.on('error', () => undefined);
    this.worker.on('failed', (job) =>
      this.logger.warn(
        `Trabajo interrumpido: ${job?.id ?? 'unknown'}; recuperacion por PostgreSQL`,
      ),
    );
  }

  async publish(id: string) {
    const queue = await this.readyQueue();
    const existing = await queue.getJob(id);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') await existing.remove();
      else return;
    }
    await queue.add('classify', { jobId: id }, { jobId: id });
  }

  async health() {
    try {
      const queue = await this.readyQueue();
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'failed',
        'delayed',
      );
      return { available: true, counts };
    } catch {
      return { available: false };
    }
  }

  async beforeApplicationShutdown() {
    await this.worker?.close();
    if (this.producerReady) await this.producer?.disconnect();
    await this.producer?.close();
  }

  private async readyQueue() {
    const queue = this.queue();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        queue.waitUntilReady(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('REDIS_NOT_READY')), 3000);
        }),
      ]);
      this.producerReady = true;
      return queue;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
