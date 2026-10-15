import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AddMunicipalAreaMemberDto } from './dto/add-municipal-area-member.dto';
import { ListMunicipalAreaMembersQueryDto } from './dto/list-municipal-area-members-query.dto';
import {
  MemberAuditContext,
  MunicipalAreaMembersService,
} from './municipal-area-members.service';
import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import { type AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';

@Controller('municipal-areas')
export class MunicipalAreaMembersController {
  constructor(
    private readonly municipalAreaMembersService: MunicipalAreaMembersService,
  ) {}

  @Post(':id/members')
  @Auth(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.OPERATOR)
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) areaId: string,
    @Body() body: AddMunicipalAreaMemberDto,
    @Req() request: Request,
  ) {
    return this.municipalAreaMembersService.addMember(
      user,
      areaId,
      body,
      this.auditContext(request),
    );
  }

  @Get(':id/members')
  @Auth(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.OPERATOR)
  listMembers(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) areaId: string,
    @Query() query: ListMunicipalAreaMembersQueryDto,
  ) {
    return this.municipalAreaMembersService.listMembers(actor, areaId, query);
  }

  @Delete(':id/members/:userId')
  @Auth(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.OPERATOR)
  removeMember(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) areaId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: Request,
  ) {
    return this.municipalAreaMembersService.removeMember(
      actor,
      areaId,
      userId,
      this.auditContext(request),
    );
  }

  private auditContext(request: Request): MemberAuditContext {
    return {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
  }
}
