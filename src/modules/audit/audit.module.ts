import { AuditQueryController } from './audit-query.controller';
import { AuditQueryService } from './audit-query.service';
import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditQueryController],
  providers: [AuditService, AuditQueryService],
  exports: [AuditService],
})
export class AuditModule {}
