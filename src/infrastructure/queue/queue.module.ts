import { ChatQueueService } from './chat-queue.service';
import { KnowledgeQueueService } from './knowledge-queue.service';
import { Module } from '@nestjs/common';
import { IncidentQueueService } from './incident-queue.service';

@Module({
  providers: [IncidentQueueService, KnowledgeQueueService, ChatQueueService],
  exports: [IncidentQueueService, KnowledgeQueueService, ChatQueueService],
})
export class QueueModule {}
