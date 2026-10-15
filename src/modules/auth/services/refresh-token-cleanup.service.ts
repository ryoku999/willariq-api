import { DatabaseService } from '@/database/database.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class RefreshTokenCleanupService {
  private readonly logger = new Logger(RefreshTokenCleanupService.name);

  constructor(private readonly db: DatabaseService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'America/Lima' })
  async removeExpiredTokens(): Promise<void> {
    const result = await this.db.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    if (result.count > 0) {
      this.logger.log(`Refresh tokens eliminados: ${result.count}`);
    }
  }
}
