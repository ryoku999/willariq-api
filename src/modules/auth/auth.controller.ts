import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';
import { RegisterDto } from './dto/register.dto';
import { RegisterResponse } from './interfaces/auth.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() body: RegisterDto): Promise<RegisterResponse> {
    return this.authService.register(body);
  }
}
