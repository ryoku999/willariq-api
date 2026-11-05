import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Auth } from '@/shared/decorators/auth.decorator';
import { UserRole } from '@/generated/prisma/enums';
import { AuditQueryDto } from './audit-query.dto';
import { AuditQueryService } from './audit-query.service';

@Controller('admin/audit-logs')
@Auth(UserRole.ADMIN)
export class AuditQueryController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }

  @Get(':id')
  find(@Param('id', ParseUUIDPipe) id: string) {
    return this.audit.find(id);
  }
}
