import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { memoryStorage } from 'multer';
import { StorageModule } from '@/infrastructure/storage/storage.module';
import { AuditModule } from '../audit/audit.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';
import { EvidenceCleanupService } from './evidence-cleanup.service';
import { EvidenceUploadGuard } from './evidence-upload.guard';
import { UploadCapacityInterceptor } from './upload-capacity.interceptor';

@Module({
  imports: [
    StorageModule,
    AuditModule,
    IncidentsModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: memoryStorage(),
        limits: {
          fileSize: config.getOrThrow<number>('EVIDENCE_MAX_IMAGE_BYTES'),
          files: 1,
          fields: 0,
          parts: 2,
        },
      }),
    }),
  ],
  controllers: [EvidenceController],
  providers: [
    EvidenceService,
    EvidenceCleanupService,
    EvidenceUploadGuard,
    UploadCapacityInterceptor,
  ],
})
export class EvidenceModule {}
