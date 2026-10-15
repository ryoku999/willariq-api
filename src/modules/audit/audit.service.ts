import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import { Injectable } from '@nestjs/common';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  record(
    entry: AuditEntry,
    client: Prisma.TransactionClient | DatabaseService = this.db,
  ) {
    return client.auditLog.create({ data: entry });
  }
}
