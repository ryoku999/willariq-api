import { UnauthorizedException } from '@nestjs/common';

export const AUTH_ERROR = {
  ACCESS_TOKEN_EXPIRED: 'ACCESS_TOKEN_EXPIRED',
  ACCESS_TOKEN_INVALID: 'ACCESS_TOKEN_INVALID',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR)[keyof typeof AUTH_ERROR];

export function authUnauthorized(
  code: AuthErrorCode,
  message: string,
): UnauthorizedException {
  return new UnauthorizedException({ code, message });
}
