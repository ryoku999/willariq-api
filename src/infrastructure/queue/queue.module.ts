import { Module } from '@nestjs/common';
import { IncidentQueueService } from './incident-queue.service';

@Module({ providers: [IncidentQueueService], exports: [IncidentQueueService] })
export class QueueModule {}
