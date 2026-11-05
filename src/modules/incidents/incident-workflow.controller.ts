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
import type { Request } from 'express';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { UserRole } from '@/generated/prisma/enums';
import { IncidentWorkflowService } from './incident-workflow.service';
import {
  AssignmentVersionDto,
  CreateAssignmentDto,
  IncidentVersionDto,
  ReassignIncidentDto,
  RejectIncidentDto,
  ResolveIncidentDto,
  ReviewIncidentDto,
} from './dto/incident-workflow.dto';
import { IncidentPaginationQueryDto } from './dto/incident-pagination-query.dto';
const STAFF = [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.OPERATOR];
const context = (req: Request) => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
});

@Controller('incidents')
export class IncidentWorkflowController {
  constructor(private readonly workflow: IncidentWorkflowService) {}
  @Post(':id/review')
  @HttpCode(200)
  @Auth(UserRole.ADMIN, UserRole.SUPERVISOR)
  review(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewIncidentDto,
    @Req() req: Request,
  ) {
    return this.workflow.review(actor, id, dto, context(req));
  }
  @Post(':id/accept')
  @HttpCode(200)
  @Auth(UserRole.ADMIN, UserRole.SUPERVISOR)
  accept(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IncidentVersionDto,
    @Req() req: Request,
  ) {
    return this.workflow.decide(actor, id, dto, true, context(req));
  }
  @Post(':id/reject')
  @HttpCode(200)
  @Auth(UserRole.ADMIN, UserRole.SUPERVISOR)
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectIncidentDto,
    @Req() req: Request,
  ) {
    return this.workflow.decide(actor, id, dto, false, context(req));
  }
  @Post(':id/assignments')
  @Auth(...STAFF)
  assign(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAssignmentDto,
    @Req() req: Request,
  ) {
    return this.workflow.assign(actor, id, dto, context(req));
  }
  @Get(':id/assignments')
  @Auth()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: IncidentPaginationQueryDto,
  ) {
    return this.workflow.list(actor, query, id);
  }
  @Post(':id/reassignments')
  @Auth(...STAFF)
  reassign(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignIncidentDto,
    @Req() req: Request,
  ) {
    return this.workflow.assign(actor, id, dto, context(req), true);
  }
  @Post(':id/start')
  @HttpCode(200)
  @Auth(...STAFF)
  start(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignmentVersionDto,
    @Req() req: Request,
  ) {
    return this.workflow.work(actor, id, dto, 'start', context(req));
  }
  @Post(':id/resolve')
  @HttpCode(200)
  @Auth(...STAFF)
  resolve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveIncidentDto,
    @Req() req: Request,
  ) {
    return this.workflow.work(actor, id, dto, 'resolve', context(req));
  }
  @Post(':id/close')
  @HttpCode(200)
  @Auth(UserRole.ADMIN, UserRole.SUPERVISOR)
  close(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IncidentVersionDto,
    @Req() req: Request,
  ) {
    return this.workflow.close(actor, id, dto, context(req));
  }
}
