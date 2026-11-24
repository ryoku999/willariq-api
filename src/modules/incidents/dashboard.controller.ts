import { IncidentStatus } from '@/generated/prisma/enums';
import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { IncidentAccessService } from './incident-access.service';

const openStatuses: IncidentStatus[] = [
  'NEW',
  'ACCEPTED',
  'IN_PROGRESS',
  'RESOLVED',
];
const cancellationReasons = new Set([
  'Duplicado',
  'Spam o reporte falso',
  'Fuera de alcance',
  'Otro',
]);

@Controller('dashboard')
@Auth('ADMIN', 'OPERATOR')
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
        const oldest = await tx.incident.findFirst({
          where: { AND: [where, { status: { in: openStatuses } }] },
          orderBy: { submittedAt: 'asc' },
          select: { submittedAt: true },
        });
        const reasons = new Map<string, number>();
        // Read bounded batches so the measurement uses the same Prisma access policy as the list.
        let cursor: string | undefined;
        let count = 0;
        let cancelled = 0;
        const metrics = {
          acceptance: [] as number[],
          start: [] as number[],
          handling: [] as number[],
          closure: [] as number[],
        };
        for (;;) {
          const rows = await tx.incident.findMany({
            where: { AND: [where, { submittedAt: { gte: since } }] },
            select: {
              id: true,
              submittedAt: true,
              acceptedAt: true,
              startedAt: true,
              closedAt: true,
              status: true,
              cancellationReason: true,
            },
            orderBy: { id: 'asc' },
            take: 500,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          for (const row of rows) {
            count++;
            if (row.status === 'CANCELLED') {
              cancelled++;
              const reason = row.cancellationReason?.split(' · ', 1)[0] ?? '';
              const label = cancellationReasons.has(reason)
                ? reason
                : 'Sin clasificación';
              reasons.set(label, (reasons.get(label) ?? 0) + 1);
            }
            const add = (
              values: number[],
              start: Date | null,
              end: Date | null,
            ) => {
              if (start && end && end >= start)
                values.push((end.getTime() - start.getTime()) / 60000);
            };
            add(metrics.acceptance, row.submittedAt, row.acceptedAt);
            add(metrics.start, row.submittedAt, row.startedAt);
            if (row.status === 'CLOSED') {
              add(metrics.handling, row.startedAt, row.closedAt);
              add(metrics.closure, row.submittedAt, row.closedAt);
            }
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
          since: since.toISOString(),
          submitted: count,
          cancelled,
          cancellationReasons: [...reasons].map(([reason, count]) => ({
            reason,
            count,
          })),
          pending: {
            count: status
              .filter((item) => openStatuses.includes(item.status))
              .reduce((sum, item) => sum + item._count._all, 0),
            oldestSubmittedAt: oldest?.submittedAt ?? null,
          },
          timings: Object.fromEntries(
            Object.entries(metrics).map(([key, values]) => {
              values.sort((a, b) => a - b);
              const size = values.length;
              return [
                key,
                {
                  count: size,
                  averageMinutes: size
                    ? Math.round(
                        values.reduce((sum, value) => sum + value, 0) / size,
                      )
                    : null,
                  medianMinutes: size
                    ? Math.round(
                        (values[Math.floor((size - 1) / 2)] +
                          values[Math.floor(size / 2)]) /
                          2,
                      )
                    : null,
                  p90Minutes: size
                    ? Math.round(values[Math.ceil(size * 0.9) - 1])
                    : null,
                },
              ];
            }),
          ),
        };
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }
}
