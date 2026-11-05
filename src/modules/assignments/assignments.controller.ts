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
import { IncidentWorkflowService } from '../incidents/incident-workflow.service';
import {
  AssignmentVersionDto,
  CancelAssignmentDto,
} from '../incidents/dto/incident-workflow.dto';
import { IncidentPaginationQueryDto } from '../incidents/dto/incident-pagination-query.dto';

const STAFF = [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.OPERATOR];

const context = (req: Request) => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
});

@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly workflow: IncidentWorkflowService) {}

  @Get('me')
  @Auth(...STAFF)
  mine(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: IncidentPaginationQueryDto,
  ) {
    return this.workflow.list(actor, query);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @Auth(...STAFF)
  accept(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignmentVersionDto,
    @Req() req: Request,
  ) {
    return this.workflow.workByAssignment(
      actor,
      id,
      dto,
      'accept',
      context(req),
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Auth(...STAFF)
  cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAssignmentDto,
    @Req() req: Request,
  ) {
    return this.workflow.workByAssignment(
      actor,
      id,
      dto,
      'cancel',
      context(req),
    );
  }
}
