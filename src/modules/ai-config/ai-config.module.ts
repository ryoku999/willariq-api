import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AiConfigController } from './ai-config.controller';
import { AiPromptsService } from './ai-prompts.service';
import { AiRoutesService } from './ai-routes.service';
import { AiProvidersService } from './ai-providers.service';
import { AiSchemaService } from './ai-schema.service';

@Module({
  imports: [AuditModule],
  controllers: [AiConfigController],
  providers: [
    AiPromptsService,
    AiRoutesService,
    AiProvidersService,
    AiSchemaService,
  ],
  exports: [
    AiPromptsService,
    AiRoutesService,
    AiProvidersService,
    AiSchemaService,
  ],
})
export class AiConfigModule {}
