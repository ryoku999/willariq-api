import { KnowledgeQueueService } from './knowledge-queue.service';
import { Module } from '@nestjs/common';
import { IncidentQueueService } from './incident-queue.service';

@Module({
  providers: [IncidentQueueService, KnowledgeQueueService],
  exports: [IncidentQueueService, KnowledgeQueueService],
})
export class QueueModule {}
