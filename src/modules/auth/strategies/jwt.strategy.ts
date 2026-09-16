import { DatabaseService } from '@/database/database.service';
import { UserStatus } from '@/generated/prisma/enums';
import { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { JwtPayload } from '@/shared/interfaces/jwt-payload.interface';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly db: DatabaseService,
  ) {
    const accessCookieName = configService.getOrThrow<string>(
      'AUTH_ACCESS_COOKIE_NAME',
    );

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request): string | null => {
          const cookies: unknown = request.cookies;
          if (!cookies || typeof cookies !== 'object') {
            return null;
          }

          const token: unknown = request.cookies?.[accessCookieName];
          return typeof token === 'string' ? token : null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      issuer: configService.getOrThrow<string>('JWT_ISSUER'),
      audience: configService.getOrThrow<string>('JWT_AUDIENCE'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.db.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('La cuenta no esta activa');
    }

    return {
      id: user.id,
      role: user.role,
    };
  }
}
