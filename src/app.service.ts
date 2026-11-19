import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database/database.service';
import { ConfigService } from '@nestjs/config';
import { IncidentQueueService } from './infrastructure/queue/incident-queue.service';

@Injectable()
export class AppService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly queue: IncidentQueueService,
  ) {}

  getHello() {
    return {
      message: 'Willariq API',
    };
  }

  async healthCheck() {
    const enabled =
      this.config.get<boolean>('AI_ENABLED') ||
      this.config.get<boolean>('AI_WORKER_ENABLED');
    const [database, queue] = await Promise.all([
      this.checkDatabase(),
      enabled ? this.queue.health() : Promise.resolve(null),
    ]);
    const result = {
      timestamp: new Date().toISOString(),
      status: !database
        ? 'unavailable'
        : queue?.available === false
          ? 'degraded'
          : 'ok',
      services: {
        database,
        redis: queue?.available ?? null,
        classificationQueue:
          queue === null
            ? 'disabled'
            : queue.available
              ? 'available'
              : 'unavailable',
      },
    };
    if (!database) throw new ServiceUnavailableException(result);
    return result;
  }

  private async checkDatabase() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
