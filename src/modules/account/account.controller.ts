import {
  Body,
  Controller,
  HttpCode,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { AuthCookieService } from '../auth/services/auth-cookie.service';
import { AccountService } from './account.service';
import {
  AccountEmailDto,
  AccountTokenDto,
  ChangeAccountPasswordDto,
  ResetAccountPasswordDto,
  SetAccountEmailDto,
} from './account.dto';

@Controller()
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly cookies: AuthCookieService,
  ) {}

  @Put('users/me/email')
  @Auth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  setEmail(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: SetAccountEmailDto,
  ) {
    return this.account.setEmail(actor, dto.email, dto.currentPassword);
  }

  @Post('users/me/email/verification-requests')
  @Auth()
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async requestVerification(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    this.requireJson(request);
    await this.account.requestVerification(actor);
    return { message: 'Correo de verificacion enviado' };
  }

  @Post('users/email-verifications/confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async confirm(@Body() dto: AccountTokenDto) {
    await this.account.confirmEmail(dto.token);
    return { message: 'Correo verificado' };
  }

  @Post('auth/password/forgot')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgot(@Body() dto: AccountEmailDto) {
    this.account.requestPasswordReset(dto.email);
    return {
      message: 'Si la cuenta puede recuperar su acceso, recibiras un correo',
    };
  }

  @Post('auth/password/reset')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async reset(@Body() dto: ResetAccountPasswordDto) {
    await this.account.resetPassword(dto.token, dto.newPassword);
    return { message: 'Contrasena restablecida' };
  }

  @Patch('users/me/password')
  @Auth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async change(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ChangeAccountPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.account.changePassword(
      actor,
      dto.currentPassword,
      dto.newPassword,
    );
    this.cookies.clearCookies(response);
    return { message: 'Contrasena cambiada' };
  }

  @Post('auth/logout-all')
  @Auth()
  @HttpCode(200)
  async logoutAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.requireJson(request);
    await this.account.logoutAll(actor);
    this.cookies.clearCookies(response);
    return { message: 'Sesiones cerradas' };
  }
  // Require a preflight for cross-origin browser requests with cookies.
  private requireJson(request: Request) {
    if (!request.is('application/json')) {
      throw new UnsupportedMediaTypeException('Envia un cuerpo JSON');
    }
  }
}
