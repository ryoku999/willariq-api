import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { MunicipalAreasService } from './municipal-areas.service';
import { Auth } from '@/shared/decorators/auth.decorator';
import { UserRole } from '@/generated/prisma/enums';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import { type AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { CreateMunicipalAreaDto } from './dto/create-municipal-area.dto';
import { type Request } from 'express';
import { ListMunicipalAreasQueryDto } from './dto/list-municipal-areas-query.dto';
import { UpdateMunicipalAreaDto } from './dto/update-municipal-area.dto';
import { UpdateMunicipalAreaStatusDto } from './dto/update-municipal-area-status.dto';
import { AreaAuditContext } from '@/shared/interfaces/audit-context.interface';

@Controller('municipal-areas')
export class MunicipalAreasController {
  constructor(private readonly municipalAreasService: MunicipalAreasService) {}

  @Post()
  @Auth(UserRole.ADMIN)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateMunicipalAreaDto,
    @Req() request: Request,
  ) {
    return this.municipalAreasService.create(
      user.id,
      body,
      this.auditContext(request),
    );
  }

  @Get()
  @Auth(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.OPERATOR)
  list(@Query() query: ListMunicipalAreasQueryDto) {
    return this.municipalAreasService.list(query);
  }

  @Get(':id')
  @Auth(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.OPERATOR)
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.municipalAreasService.findById(id);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMunicipalAreaDto,
    @Req() request: Request,
  ) {
    return this.municipalAreasService.update(
      actor.id,
      id,
      body,
      this.auditContext(request),
    );
  }

  @Patch(':id/status')
  @Auth(UserRole.ADMIN)
  updateStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMunicipalAreaStatusDto,
    @Req() request: Request,
  ) {
    return this.municipalAreasService.updateStatus(
      actor.id,
      id,
      body,
      this.auditContext(request),
    );
  }

  private auditContext(request: Request): AreaAuditContext {
    return {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
  }
}
