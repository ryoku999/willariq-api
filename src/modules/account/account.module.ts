import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [AuditModule, AuthModule, MailModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
