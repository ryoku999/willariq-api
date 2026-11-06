import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, {
  type SMTPSentMessageInfo,
  type Transporter,
} from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport?: Transporter<SMTPSentMessageInfo>;

  constructor(private readonly config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    if (!host) return;
    const secure = config.getOrThrow<boolean>('SMTP_SECURE');
    this.transport = nodemailer.createTransport({
      host,
      port: config.getOrThrow<number>('SMTP_PORT'),
      secure,
      requireTLS: !secure,
      auth: {
        user: config.getOrThrow<string>('SMTP_USER'),
        pass: config.getOrThrow<string>('SMTP_PASS'),
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  assertConfigured() {
    if (!this.transport)
      throw new ServiceUnavailableException('Correo no configurado');
    return this.transport;
  }

  async sendAccountLink(to: string, token: string, kind: 'verify' | 'reset') {
    const transport = this.assertConfigured();
    const verify = kind === 'verify';
    const url = new URL(
      this.config.getOrThrow<string>(
        verify ? 'EMAIL_VERIFICATION_URL' : 'PASSWORD_RESET_URL',
      ),
    );
    url.searchParams.set('token', token);
    const subject = verify
      ? 'Verifica tu correo en Willariq'
      : 'Restablece tu contraseña en Willariq';
    try {
      const info = await transport.sendMail({
        from: this.config.getOrThrow<string>('MAIL_FROM'),
        to: { name: '', address: to },
        subject,
        text: `${subject}\n\n${url.href}\n\nSi no solicitaste esta acción, puedes ignorar este correo.`,
      });
      if (!info.accepted.length) throw new Error('No recipients accepted');
    } catch {
      this.logger.warn(
        'El servidor SMTP no acepto el envio de correo de cuenta',
      );
      throw new ServiceUnavailableException('No se pudo enviar el correo');
    }
  }
}
