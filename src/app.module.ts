import { ChatModule } from './modules/chat/chat.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { AccountModule } from './modules/account/account.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { envSchema } from './config/env.config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from './modules/users/users.module';
import { AuditModule } from './modules/audit/audit.module';
import { MunicipalAreasModule } from './modules/municipal-areas/municipal-areas.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AiConfigModule } from './modules/ai-config/ai-config.module';
import { IncidentAiModule } from './modules/incident-ai/incident-ai.module';
import { QueueModule } from './infrastructure/queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validationSchema: envSchema,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.getOrThrow<number>('RATE_LIMIT_TTL'),
          limit: configService.getOrThrow<number>('RATE_LIMIT_LIMIT'),
        },
      ],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    AccountModule,
    UsersModule,
    AuditModule,
    NotificationsModule,
    MunicipalAreasModule,
    IncidentsModule,
    AssignmentsModule,
    EvidenceModule,
    AiConfigModule,
    QueueModule,
    IncidentAiModule,
    KnowledgeModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
