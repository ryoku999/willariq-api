import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

@Injectable()
export class AppService {
  constructor(private readonly db: DatabaseService) {}

  getHello() {
    return {
      message: 'Willariq API',
    };
  }

  async healthCheck() {
    const [database] = await Promise.all([this.checkDatabase()]);
    return {
      timestamp: new Date().toISOString(),
      services: {
        database,
      },
    };
  }

  private async checkDatabase() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
