import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { QueueModule } from '@/infrastructure/queue/queue.module';
import { StorageModule } from '@/infrastructure/storage/storage.module';
import { AuditModule } from '../audit/audit.module';
import { EmbeddingProviderService } from './embedding-provider.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeDispatcherService } from './knowledge-dispatcher.service';
import { KnowledgeProcessor } from './knowledge-processor.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [
    QueueModule,
    StorageModule,
    AuditModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: memoryStorage(),
        limits: {
          fileSize: config.getOrThrow<number>('KNOWLEDGE_MAX_DOCUMENT_BYTES'),
          files: 1,
          fields: 2,
          fieldSize: 4096,
          parts: 4,
        },
      }),
    }),
  ],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    KnowledgeDispatcherService,
    KnowledgeProcessor,
    KnowledgeRetrievalService,
    EmbeddingProviderService,
  ],
  exports: [KnowledgeRetrievalService, EmbeddingProviderService],
})
export class KnowledgeModule {}
