import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';
import { RegisterDto } from './dto/register.dto';
import { RegisterResponse, WebLoginRes } from './interfaces/auth.interface';
import { LoginDto } from './dto/login.dto';
import { AuthCookieService } from './services/auth-cookie.service';
import { type Request, type Response } from 'express';

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
    const result = await this.authService.login(body);
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
}
