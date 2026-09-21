import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import { type AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { RequestAuditContext, UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { UserRole } from '@/generated/prisma/enums';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import type { Request } from 'express';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @Auth()
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findMe(user.id);
  }

  @Patch('me')
  @Auth()
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateMeDto) {
    return this.usersService.updateMe(user.id, body);
  }

  @Get()
  @Auth(UserRole.ADMIN)
  list(@Query() query: ListUsersQueryDto) {
    return this.usersService.list(query);
  }

  @Get(':id')
  @Auth(UserRole.ADMIN)
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id/status')
  @Auth(UserRole.ADMIN)
  updateStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserStatusDto,
    @Req() request: Request,
  ) {
    return this.usersService.updateStatus(
      actor.id,
      id,
      body,
      this.auditContext(request),
    );
  }

  @Patch(':id/role')
  @Auth(UserRole.ADMIN)
  updateRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserRoleDto,
    @Req() request: Request,
  ) {
    return this.usersService.updateRole(
      actor.id,
      id,
      body,
      this.auditContext(request),
    );
  }

  private auditContext(request: Request): RequestAuditContext {
    return {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
  }
}
