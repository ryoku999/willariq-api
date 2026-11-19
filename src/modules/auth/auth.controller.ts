import {
  Body,
  ForbiddenException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';
import { RegisterDto } from './dto/register.dto';
import { RegisterResponse, WebLoginRes } from './interfaces/auth.interface';
import { LoginDto } from './dto/login.dto';
import { AuthCookieService } from './services/auth-cookie.service';
import { type Request, type Response } from 'express';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() body: RegisterDto): Promise<RegisterResponse> {
    return this.authService.register(body);
  }

  @Post('web/login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async webLogin(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebLoginRes> {
    const result = await this.authService.login(body, 'web');
    this.authCookieService.setCookies(response, result.tokens);
    return result.user;
  }

  @Post('web/logout')
  @HttpCode(HttpStatus.OK)
  async webLogout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.authCookieService.getRefreshToken(request);
    await this.authService.logout(refreshToken);
    this.authCookieService.clearCookies(response);
    return { message: 'Sesion cerrada correctamente' };
  }

  @Post('web/refresh')
  @HttpCode(HttpStatus.OK)
  async webRefresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.authCookieService.getRefreshToken(request);

    if (!refreshToken) {
      throw new UnauthorizedException('No se encontro el refresh token');
    }

    try {
      const tokens = await this.authService.refresh(refreshToken, 'web');
      this.authCookieService.setCookies(response, tokens);
    } catch (error) {
      if (error instanceof ForbiddenException)
        this.authCookieService.clearCookies(response);
      throw error;
    }

    return {
      message: 'Token refrescado',
    };
  }

  @Post('mobile/login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  mobileLogin(@Body() body: LoginDto) {
    return this.authService.login(body, 'mobile');
  }

  @Post('mobile/refresh')
  @HttpCode(HttpStatus.OK)
  mobileRefresh(@Body() body: RefreshTokenDto) {
    return this.authService.refresh(body.refreshToken, 'mobile');
  }

  @Post('mobile/logout')
  @HttpCode(HttpStatus.OK)
  async mobileLogout(@Body() body: RefreshTokenDto) {
    await this.authService.logout(body.refreshToken);
    return { message: 'Sesion cerrada correctamente' };
  }
}
