import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { isUUID } from 'class-validator';
import { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { EvidenceService } from './evidence.service';

@Injectable()
export class EvidenceUploadGuard implements CanActivate {
  constructor(private readonly evidence: EvidenceService) {}

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    const id = request.params.id;
    if (typeof id !== 'string' || !isUUID(id))
      throw new BadRequestException('ID de incidencia invalido');
    // Guards se ejecutan antes de que Multer reciba el binario en memoria.
    await this.evidence.assertCanUpload(request.user, id);
    return true;
  }
}
