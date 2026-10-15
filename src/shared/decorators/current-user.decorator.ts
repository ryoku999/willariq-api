import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    return request.user;
  },
);
