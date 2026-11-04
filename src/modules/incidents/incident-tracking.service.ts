import { Prisma } from '@/generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class IncidentTrackingService {
  private readonly prefix: string;
  private readonly yearFormatter: Intl.DateTimeFormat;

  constructor(configService: ConfigService) {
    this.prefix = configService.getOrThrow<string>('INCIDENT_TRACKING_PREFIX');
    this.yearFormatter = new Intl.DateTimeFormat('en', {
      timeZone: configService.getOrThrow<string>('INCIDENT_TRACKING_TIME_ZONE'),
      year: 'numeric',
    });
  }

  async next(
    client: Prisma.TransactionClient,
    now = new Date(),
  ): Promise<string> {
    const year = Number(this.yearFormatter.format(now));
    const counter = await client.incidentTrackingCounter.upsert({
      where: { prefix_year: { prefix: this.prefix, year } },
      create: { prefix: this.prefix, year, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
      select: { lastValue: true },
    });
    return `${this.prefix}-${year}-${String(counter.lastValue).padStart(6, '0')}`;
  }
}
