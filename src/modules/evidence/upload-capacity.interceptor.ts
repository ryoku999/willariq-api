import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { defer, finalize } from 'rxjs';

@Injectable()
export class UploadCapacityInterceptor implements NestInterceptor {
  private active = 0;
  private readonly max: number;

  constructor(config: ConfigService) {
    this.max = config.getOrThrow<number>('UPLOAD_MAX_CONCURRENT_REQUESTS');
  }

  intercept(_context: ExecutionContext, next: CallHandler) {
    return defer(() => {
      if (this.active >= this.max)
        throw new ServiceUnavailableException(
          'Hay demasiadas cargas simultaneas; vuelve a intentar',
        );
      this.active++;
      return next.handle().pipe(
        finalize(() => {
          this.active--;
        }),
      );
    });
  }
}
