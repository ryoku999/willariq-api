import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { UserRole } from '@/generated/prisma/enums';
import { IncidentPaginationQueryDto } from '../incidents/dto/incident-pagination-query.dto';
import { IncidentAiService } from './incident-ai.service';
import { SubmitIncidentDto, OutboxQueryDto } from './dto/incident-ai.dto';

@Controller()
export class IncidentAiController {
  constructor(private readonly service: IncidentAiService) {}

  @Post('incidents/:id/submit')
  @Auth(UserRole.CITIZEN)
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitIncidentDto,
    @Req() req: Request,
  ) {
    return this.service.submit(actor, id, body.expectedVersion, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  @Post('incidents/:id/ai/retry')
  @Auth(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.OPERATOR)
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  retry(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitIncidentDto,
    @Req() req: Request,
  ) {
    return this.service.submit(
      actor,
      id,
      body.expectedVersion,
      { ipAddress: req.ip, userAgent: req.get('user-agent') },
      true,
    );
  }

  @Get('incidents/:id/ai-jobs')
  @Auth()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: IncidentPaginationQueryDto,
  ) {
    return this.service.list(actor, id, query);
  }

  @Get('admin/ai/jobs')
  @Auth(UserRole.ADMIN, UserRole.SUPERVISOR)
  listAdminJobs(@Query() query: IncidentPaginationQueryDto) {
    return this.service.listAdminJobs(query);
  }

  @Get('admin/ai/jobs/:id')
  @Auth(UserRole.ADMIN, UserRole.SUPERVISOR)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Get('admin/queues/outbox')
  @Auth(UserRole.ADMIN)
  outbox(@Query() query: OutboxQueryDto) {
    return this.service.outbox(query);
  }

  @Post('admin/queues/outbox/:id/retry')
  @Auth(UserRole.ADMIN)
  @HttpCode(202)
  retryOutbox(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.service.retryOutbox(actor, id, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  }
}
