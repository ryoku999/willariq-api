import { Module } from '@nestjs/common';
import { QueueModule } from '@/infrastructure/queue/queue.module';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ClassificationProviderService } from '../incident-ai/providers/classification-provider.service';
import { ChatController } from './chat.controller';
import { ChatDispatcherService } from './chat-dispatcher.service';
import { ChatProcessor } from './chat-processor.service';
import { ChatService } from './chat.service';

@Module({
  imports: [QueueModule, AiConfigModule, IncidentsModule, KnowledgeModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatDispatcherService,
    ChatProcessor,
    ClassificationProviderService,
  ],
})
export class ChatModule {}
