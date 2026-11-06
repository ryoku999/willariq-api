import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { UserRole } from '@/generated/prisma/enums';
import { IncidentPaginationQueryDto } from '../incidents/dto/incident-pagination-query.dto';
import { MARKDOWN_TYPE } from './knowledge-input';
import { UploadKnowledgeDto } from './knowledge.dto';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge/documents')
@Auth(UserRole.ADMIN)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadKnowledgeDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.knowledge.upload(user.id, dto, file);
  }

  @Get()
  list(@Query() query: IncidentPaginationQueryDto) {
    return this.knowledge.list(query);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.detail(id);
  }

  @Get(':id/content')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async content(@Param('id', ParseUUIDPipe) id: string) {
    return new StreamableFile(await this.knowledge.content(id), {
      type: MARKDOWN_TYPE,
      disposition: `attachment; filename="${id}.md"`,
    });
  }

  @Post(':id/process')
  @HttpCode(202)
  process(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledge.process(user.id, id);
  }

  @Get(':id/jobs')
  jobs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: IncidentPaginationQueryDto,
  ) {
    return this.knowledge.jobs(id, query);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledge.publish(user.id, id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledge.archive(user.id, id);
  }
}
