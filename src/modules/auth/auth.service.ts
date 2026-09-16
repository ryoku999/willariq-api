import { DatabaseService } from '@/database/database.service';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { RegisterDto } from './dto/register.dto';
import {
  AuthTokens,
  LoginResponseI,
  RegisterResponse,
} from './interfaces/auth.interface';
import bcrypt from 'bcryptjs';
import { Prisma, UserRole, UserStatus } from '@/generated/prisma/client';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from '@/shared/interfaces/jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';
import {
  durationToMilliseconds,
  generateRefreshToken,
  hashRefreshToken,
} from './utils/auth.utils';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  private readonly refreshExpiresInMs: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.refreshExpiresInMs = durationToMilliseconds(
      configService.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    );
  }

  async register(dto: RegisterDto): Promise<RegisterResponse> {
    const uniqueFilters = [{ dni: dto.dni }, { phone: dto.phone }];
    const userFound = await this.db.user.findFirst({
      where: { OR: uniqueFilters },
      select: { id: true },
    });

    if (userFound) {
      throw new ConflictException('Algunos datos ya estan en uso');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    try {
      return await this.db.user.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          dni: dto.dni,
          phone: dto.phone,
          passwordHash,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          dni: true,
          email: true,
          emailVerifiedAt: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Algunos datos ya estan en uso');
      }

      throw error;
    }
  }

  async login(dto: LoginDto): Promise<LoginResponseI> {
    const userFound = await this.db.user.findUnique({
      where: { dni: dto.dni },
    });

    if (!userFound) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const passwordIsValid = await bcrypt.compare(
      dto.password,
      userFound.passwordHash,
    );

    if (!passwordIsValid) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    if (userFound.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('La cuenta no esta activa');
    }

    const tokens = await this.createTokensResponse(
      userFound.id,
      userFound.role,
    );

    const refreshExpiresAt = new Date(Date.now() + this.refreshExpiresInMs);

    await this.db.refreshToken.create({
      data: {
        userId: userFound.id,
        tokenHash: hashRefreshToken(tokens.refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      tokens,
      user: {
        dni: userFound.dni,
        email: userFound.email,
        emailVerifiedAt: userFound.emailVerifiedAt,
        firstName: userFound.firstName,
        id: userFound.id,
        lastName: userFound.lastName,
        phone: userFound.phone,
        role: userFound.role,
        status: userFound.status,
      },
    };
  }

  private async createTokensResponse(
    userId: string,
    role: UserRole,
    refreshToken = generateRefreshToken(),
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, role };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      refreshToken,
    };
  }
}
