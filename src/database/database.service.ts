import { PrismaClient } from '@/generated/prisma/client';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);

  constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('DATABASE_URL');
    const pool = new Pool({ connectionString: connectionString });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  onModuleInit() {
    this.logger.log('Conectando Prisma...');
  }

  onModuleDestroy() {
    this.logger.warn('Desconectando Prisma...');
  }
}
