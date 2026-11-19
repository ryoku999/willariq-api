import { Injectable } from '@nestjs/common';
import { IncidentQueueService } from './incident-queue.service';

@Injectable()
export class KnowledgeQueueService extends IncidentQueueService {
  protected override get queueName() {
    return 'knowledge-embeddings';
  }
  protected override get concurrency() {
    return this.config.getOrThrow<number>('KNOWLEDGE_WORKER_CONCURRENCY');
  }
  protected override get attempts() {
    return 3;
  }
}
