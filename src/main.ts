import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConsoleLogger, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResponseInterceptor } from './shared/interceptors/response.interceptor';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({
      prefix: 'willariq-API',
    }),
  });

  const logger = new Logger('Bootstrap');

  app.set('trust proxy', 1);

  const configService = app.get(ConfigService);

  const apiPrefix = configService.getOrThrow<string>('API_PREFIX');

  app.setGlobalPrefix(apiPrefix);

  const nodeEnv = configService.getOrThrow<string>('NODE_ENV');
  const corsOrigins = configService
    .getOrThrow<string>('CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());

  app.enableShutdownHooks();

  const port = configService.getOrThrow<number>('PORT');

  await app.listen(port, '0.0.0.0');

  logger.log(
    `Aplicación ejecutándose en ${await app.getUrl()} | NODE_ENV=${nodeEnv}`,
  );
}
void bootstrap();
