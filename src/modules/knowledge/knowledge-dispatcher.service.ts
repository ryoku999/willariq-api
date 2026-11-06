import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@/database/database.service';
import { KnowledgeQueueService } from '@/infrastructure/queue/knowledge-queue.service';
import { OutboxDispatcherService } from '../incident-ai/outbox-dispatcher.service';

export const KNOWLEDGE_EVENT = 'KNOWLEDGE_EMBEDDING_REQUESTED';

@Injectable()
export class KnowledgeDispatcherService extends OutboxDispatcherService {
  constructor(
    db: DatabaseService,
    config: ConfigService,
    queue: KnowledgeQueueService,
  ) {
    super(db, config, queue);
  }

  protected override get eventType() {
    return KNOWLEDGE_EVENT;
  }
  protected override get jobType() {
    return 'EMBEDDING_DOCUMENT' as const;
  }
  protected override get enabled() {
    return Boolean(this.config.get<string>('MINIO_KNOWLEDGE_BUCKET'));
  }
}
