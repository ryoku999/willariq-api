import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { type Request } from 'express';
import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import { type AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { IncidentPaginationQueryDto } from '../incidents/dto/incident-pagination-query.dto';
import { EvidenceService } from './evidence.service';
import { EvidenceUploadGuard } from './evidence-upload.guard';
import { UploadCapacityInterceptor } from './upload-capacity.interceptor';

@Controller('incidents/:id/evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post()
  @UseGuards(EvidenceUploadGuard)
  @Auth(UserRole.CITIZEN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(UploadCapacityInterceptor, FileInterceptor('file'))
  upload(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: Request,
  ) {
    return this.evidence.upload(actor, id, file, this.auditContext(request));
  }

  @Get()
  @Auth()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: IncidentPaginationQueryDto,
  ) {
    return this.evidence.list(actor, id, query);
  }

  @Get(':evidenceId/content')
  @Auth()
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  content(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
  ) {
    return this.evidence.content(actor, id, evidenceId);
  }

  @Delete(':evidenceId')
  @Auth(UserRole.CITIZEN)
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Req() request: Request,
  ) {
    return this.evidence.remove(
      actor,
      id,
      evidenceId,
      this.auditContext(request),
    );
  }

  private auditContext(request: Request) {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
