import { Module } from '@nestjs/common';
import { QueueModule } from '@/infrastructure/queue/queue.module';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { AuditModule } from '../audit/audit.module';
import { IncidentAiController } from './incident-ai.controller';
import { IncidentAiService } from './incident-ai.service';
import { ClassificationProviderService } from './providers/classification-provider.service';
import { ClassificationProcessor } from './processors/classification.processor';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

@Module({
  imports: [QueueModule, AiConfigModule, IncidentsModule, AuditModule],
  controllers: [IncidentAiController],
  providers: [
    IncidentAiService,
    ClassificationProviderService,
    ClassificationProcessor,
    OutboxDispatcherService,
  ],
})
export class IncidentAiModule {}
