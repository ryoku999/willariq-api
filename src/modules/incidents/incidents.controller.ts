import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type Request } from 'express';
import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import { type AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { IncidentsService } from './incidents.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { ListIncidentsQueryDto } from './dto/list-incidents-query.dto';
import { IncidentPaginationQueryDto } from './dto/incident-pagination-query.dto';
import { CancelIncidentDto } from './dto/cancel-incident.dto';

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Post()
  @Auth(UserRole.CITIZEN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateIncidentDto,
    @Req() request: Request,
  ) {
    return this.incidentsService.create(
      actor,
      body,
      this.auditContext(request),
    );
  }

  @Get()
  @Auth()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListIncidentsQueryDto,
  ) {
    return this.incidentsService.list(actor, query);
  }

  @Get(':id/history')
  @Auth()
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: IncidentPaginationQueryDto,
  ) {
    return this.incidentsService.history(actor, id, query);
  }

  @Get(':id')
  @Auth()
  findById(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.incidentsService.findById(actor, id);
  }

  @Post(':id/cancel')
  @Auth(UserRole.CITIZEN, UserRole.ADMIN, UserRole.SUPERVISOR)
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelIncidentDto,
    @Req() request: Request,
  ) {
    return this.incidentsService.cancel(
      actor,
      id,
      body,
      this.auditContext(request),
    );
  }

  private auditContext(request: Request) {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
