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
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { IncidentPaginationQueryDto } from '../incidents/dto/incident-pagination-query.dto';
import { CreateChatMessageDto, CreateChatSessionDto } from './chat.dto';
import { ChatService } from './chat.service';

@Controller('chat')
@Auth()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('sessions')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateChatSessionDto,
    @Req() request: Request,
  ) {
    this.requireJson(request);
    return this.chat.create(actor.id, dto);
  }

  @Get('sessions')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: IncidentPaginationQueryDto,
  ) {
    return this.chat.list(actor.id, query);
  }

  @Get('sessions/:id')
  detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.detail(actor.id, id);
  }

  @Get('sessions/:id/messages')
  messages(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: IncidentPaginationQueryDto,
  ) {
    return this.chat.messages(actor, id, query);
  }

  @Post('sessions/:id/messages')
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateChatMessageDto,
    @Req() request: Request,
  ) {
    this.requireJson(request);
    return this.chat.submit(actor.id, id, dto);
  }

  @Post('sessions/:id/close')
  @HttpCode(200)
  close(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    this.requireJson(request);
    return this.chat.close(actor.id, id);
  }

  @Get('jobs/:id')
  job(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.job(actor.id, id);
  }
  private requireJson(request: Request) {
    if (!request.is('application/json'))
      throw new UnsupportedMediaTypeException('Envia un cuerpo JSON');
  }
}
