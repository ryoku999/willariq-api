import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { durationToMilliseconds } from '../utils/auth.utils';
import { AuthTokens } from '../interfaces/auth.interface';

@Injectable()
export class AuthCookieService {
  private readonly accessCookieName: string;
  private readonly refreshCookieName: string;
  private readonly accessMaxAge: number;
  private readonly refreshMaxAge: number;
  private readonly secure: boolean;
  private readonly sameSite: 'lax' | 'strict' | 'none';

  constructor(configService: ConfigService) {
    this.accessCookieName = configService.getOrThrow<string>(
      'AUTH_ACCESS_COOKIE_NAME',
    );
    this.refreshCookieName = configService.getOrThrow<string>(
      'AUTH_REFRESH_COOKIE_NAME',
    );
    this.accessMaxAge = durationToMilliseconds(
      configService.getOrThrow<string>('JWT_EXPIRES_IN'),
    );

    this.refreshMaxAge = durationToMilliseconds(
      configService.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    );

    this.secure = configService.getOrThrow<boolean>('AUTH_COOKIE_SECURE');
    this.sameSite = configService.getOrThrow<'lax' | 'strict' | 'none'>(
      'AUTH_COOKIE_SAME_SITE',
    );

    const isProduction =
      configService.getOrThrow<string>('NODE_ENV') === 'production';
    if ((isProduction || this.sameSite === 'none') && !this.secure) {
      throw new Error(
        'AUTH_COOKIE_SECURE debe ser true en produccion o con SameSite=None',
      );
    }
  }

  setCookies(response: Response, tokens: AuthTokens): void {
    response.cookie(
      this.accessCookieName,
      tokens.accessToken,
      this.options(this.accessMaxAge),
    );
    response.cookie(
      this.refreshCookieName,
      tokens.refreshToken,
      this.options(this.refreshMaxAge),
    );
  }

  clearCookies(response: Response): void {
    const options = this.options();
    response.clearCookie(this.accessCookieName, options);
    response.clearCookie(this.refreshCookieName, options);
  }

  getRefreshToken(req: Request) {
    const cookies: unknown = req.cookies;
    if (!cookies || typeof cookies !== 'object') {
      return null;
    }

    const refreshToken: unknown = req.cookies?.[this.refreshCookieName];
    return typeof refreshToken === 'string' ? refreshToken : null;
  }

  private options(maxAge?: number): CookieOptions {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: this.sameSite,
      path: '/',
      ...(maxAge === undefined ? {} : { maxAge }),
    };
  }
}
