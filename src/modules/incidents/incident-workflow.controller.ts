import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { IncidentWorkflowService } from './incident-workflow.service';
import {
  CloseIncidentDto,
  IncidentVersionDto,
  ReviewIncidentDto,
  TransferIncidentDto,
} from './dto/incident-workflow.dto';
@Controller('incidents')
export class IncidentWorkflowController {
  constructor(private readonly workflow: IncidentWorkflowService) {}
  @Post(':id/review')
  @HttpCode(200)
  @Auth('ADMIN', 'OPERATOR')
  review(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewIncidentDto,
    @Req() request: Request,
  ) {
    return this.workflow.review(actor, id, dto, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Post(':id/accept')
  @HttpCode(200)
  @Auth('ADMIN', 'OPERATOR')
  accept(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IncidentVersionDto,
    @Req() request: Request,
  ) {
    return this.workflow.accept(actor, id, dto, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Post(':id/start')
  @HttpCode(200)
  @Auth('ADMIN', 'OPERATOR')
  start(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IncidentVersionDto,
    @Req() request: Request,
  ) {
    return this.workflow.start(actor, id, dto, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Post(':id/close')
  @HttpCode(200)
  @Auth('ADMIN', 'OPERATOR')
  close(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseIncidentDto,
    @Req() request: Request,
  ) {
    return this.workflow.close(actor, id, dto, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Post(':id/transfer')
  @HttpCode(200)
  @Auth('ADMIN')
  transfer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferIncidentDto,
    @Req() request: Request,
  ) {
    return this.workflow.transfer(actor, id, dto, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }
}
