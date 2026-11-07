import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { IncidentAccessService } from './incident-access.service';

@Controller('dashboard')
@Auth('ADMIN', 'SUPERVISOR', 'OPERATOR')
export class DashboardController {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: IncidentAccessService,
  ) {}

  @Get('summary')
  async summary(@CurrentUser() actor: AuthenticatedUser) {
    const where = this.access.readableWhere(actor);
    const since = new Date(Date.now() - 30 * 86400000);
    return this.db.$transaction(
      async (tx) => {
        const status = await tx.incident.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        });
        const urgency = await tx.incident.groupBy({
          by: ['urgency'],
          where,
          _count: { _all: true },
        });
        const memberships = await tx.municipalAreaMember.findMany({
          where: {
            userId: actor.id,
            active: true,
            role: 'MANAGER',
            area: { status: 'ACTIVE' },
          },
          select: { areaId: true },
        });
        // Read bounded batches so the measurement uses the same Prisma access policy as the list.
        let cursor: string | undefined;
        let count = 0;
        let minutes = 0;
        for (;;) {
          const rows = await tx.incident.findMany({
            where: { AND: [where, { resolvedAt: { gte: since } }] },
            select: { id: true, createdAt: true, resolvedAt: true },
            orderBy: { id: 'asc' },
            take: 500,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          for (const row of rows) {
            if (!row.resolvedAt || row.resolvedAt < row.createdAt) continue;
            count++;
            minutes +=
              (row.resolvedAt.getTime() - row.createdAt.getTime()) / 60000;
          }
          if (rows.length < 500) break;
          cursor = rows.at(-1)?.id;
        }
        return {
          total: status.reduce((sum, item) => sum + item._count._all, 0),
          byStatus: status.map((item) => ({
            status: item.status,
            count: item._count._all,
          })),
          byUrgency: urgency.map((item) => ({
            urgency: item.urgency,
            count: item._count._all,
          })),
          resolution: {
            since: since.toISOString(),
            count,
            averageMinutes: count ? Math.round(minutes / count) : null,
          },
          managedAreaIds: memberships.map((item) => item.areaId),
        };
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }
}
