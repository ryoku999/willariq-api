import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import { AuditQueryDto } from './audit-query.dto';

const summary = {
  id: true,
  userId: true,
  user: { select: { firstName: true, lastName: true } },
  action: true,
  entityType: true,
  entityId: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

// Only fields produced by known audit writers are returned. Free text, network
// metadata and arbitrary JSON are not part of the administrative projection.
const scalarFields = [
  'id',
  'status',
  'version',
  'role',
  'active',
  'enabled',
  'type',
  'category',
  'urgency',
  'sentiment',
  'requiresSupervision',
  'classificationSource',
  'areaId',
  'memberUserId',
  'incidentId',
  'incidentVersion',
  'operatorId',
  'replacesId',
  'jobId',
  'resultApplied',
  'errorCode',
  'trackingCode',
  'promptId',
  'promptHash',
  'schemaHash',
  'capability',
  'provider',
  'model',
  'priority',
  'timeoutMs',
  'code',
] as const;
const identifierLists = ['activePromptIds', 'routeIds'] as const;

function auditValue(value: Prisma.JsonValue): Prisma.JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: Prisma.JsonObject = {};
  for (const key of scalarFields) {
    const field = value[key];
    if (
      field === null ||
      typeof field === 'number' ||
      typeof field === 'boolean' ||
      typeof field === 'string'
    ) {
      result[key] = field;
    }
  }
  for (const key of identifierLists) {
    const field = value[key];
    if (Array.isArray(field))
      result[key] = field.filter((item) => typeof item === 'string');
  }
  if (value.assignment !== undefined) {
    result.assignment = projectFields(value.assignment, [
      'id',
      'areaId',
      'operatorId',
      'status',
      'version',
      'replacesId',
    ]);
  }
  if (Array.isArray(value.order)) {
    result.order = value.order
      .map((item) => projectFields(item, ['id', 'priority']))
      .filter((item) => item !== null);
  }
  return result;
}

function projectFields(
  value: Prisma.JsonValue,
  fields: string[],
): Prisma.JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: Prisma.JsonObject = {};
  for (const key of fields) {
    const field = value[key];
    if (
      field === null ||
      typeof field === 'string' ||
      typeof field === 'number'
    )
      result[key] = field;
  }
  return result;
}

@Injectable()
export class AuditQueryService {
  constructor(private readonly db: DatabaseService) {}

  async list({
    page,
    limit,
    actorId,
    action,
    entityType,
    entityId,
    from,
    to,
  }: AuditQueryDto) {
    const gte = from ? new Date(from) : undefined;
    const lte = to ? new Date(to) : undefined;
    if (
      (gte && !Number.isFinite(gte.getTime())) ||
      (lte && !Number.isFinite(lte.getTime())) ||
      (gte && lte && gte > lte)
    ) {
      throw new BadRequestException('Rango de fechas invalido');
    }
    const where: Prisma.AuditLogWhereInput = {
      userId: actorId,
      action,
      entityType,
      entityId,
      createdAt: gte || lte ? { gte, lte } : undefined,
    };
    const [items, total] = await this.db.$transaction(
      [
        this.db.auditLog.findMany({
          where,
          select: summary,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.auditLog.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    const labels = await this.entityLabels(items);
    return {
      items: items.map((item) => ({
        ...item,
        entityLabel: labels.get(this.labelKey(item)) ?? null,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async find(id: string) {
    const entry = await this.db.auditLog.findUnique({
      where: { id },
      select: { ...summary, oldValue: true, newValue: true },
    });
    if (!entry)
      throw new NotFoundException('Registro de auditoria no encontrado');
    const { oldValue, newValue, ...metadata } = entry;
    const labels = await this.entityLabels([entry]);
    return {
      ...metadata,
      entityLabel: labels.get(this.labelKey(entry)) ?? null,
      oldValue: auditValue(oldValue),
      newValue: auditValue(newValue),
    };
  }

  private labelKey(entry: { entityType: string; entityId: string | null }) {
    return `${entry.entityType}:${entry.entityId ?? ''}`;
  }

  private async entityLabels(
    entries: { entityType: string; entityId: string | null }[],
  ) {
    const groups = new Map<string, Set<string>>();
    const labels = new Map<string, string>();
    for (const { entityType, entityId } of entries) {
      if (!entityId) continue;
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entityId)) {
        labels.set(this.labelKey({ entityType, entityId }), entityId);
        continue;
      }
      const group = groups.get(entityType) ?? new Set<string>();
      group.add(entityId);
      groups.set(entityType, group);
    }
    const name = (user: { firstName: string; lastName: string | null }) =>
      [user.firstName, user.lastName].filter(Boolean).join(' ');
    await Promise.all(
      [...groups].map(async ([type, ids]) => {
        const where = { id: { in: [...ids] } };
        const set = (id: string, label: string) =>
          labels.set(this.labelKey({ entityType: type, entityId: id }), label);
        switch (type) {
          case 'Incident':
            for (const row of await this.db.incident.findMany({
              where,
              select: { id: true, trackingCode: true },
            }))
              set(row.id, row.trackingCode);
            break;
          case 'User':
            for (const row of await this.db.user.findMany({
              where,
              select: { id: true, firstName: true, lastName: true },
            }))
              set(row.id, name(row));
            break;
          case 'MunicipalArea':
            for (const row of await this.db.municipalArea.findMany({
              where,
              select: { id: true, name: true },
            }))
              set(row.id, row.name);
            break;
          case 'MunicipalAreaMember':
            for (const row of await this.db.municipalAreaMember.findMany({
              where,
              select: {
                id: true,
                area: { select: { name: true } },
                user: { select: { firstName: true, lastName: true } },
              },
            })) {
              set(row.id, `${name(row.user)} · ${row.area.name}`);
            }
            break;
          case 'IncidentEvidence':
            for (const row of await this.db.incidentEvidence.findMany({
              where,
              select: {
                id: true,
                fileName: true,
                incident: { select: { trackingCode: true } },
              },
            })) {
              set(
                row.id,
                [row.incident.trackingCode, row.fileName]
                  .filter(Boolean)
                  .join(' · '),
              );
            }
            break;
          case 'PromptVersion':
            for (const row of await this.db.promptVersion.findMany({
              where,
              select: { id: true, name: true, version: true },
            }))
              set(row.id, `${row.name} · v${row.version}`);
            break;
          case 'AiRoute':
            for (const row of await this.db.aiRoute.findMany({
              where,
              select: { id: true, model: true },
            }))
              set(row.id, row.model);
            break;
          case 'KnowledgeDocument':
            for (const row of await this.db.knowledgeDocument.findMany({
              where,
              select: { id: true, title: true },
            }))
              set(row.id, row.title);
            break;
          case 'QueueOutbox': {
            const rows = await this.db.queueOutbox.findMany({
              where: {
                ...where,
                eventType: 'INCIDENT_CLASSIFICATION_REQUESTED',
              },
              select: { id: true, aggregateId: true },
            });
            const jobs = await this.db.aiJob.findMany({
              where: {
                id: { in: rows.map((row) => row.aggregateId) },
                type: 'INCIDENT_ANALYSIS',
              },
              select: {
                id: true,
                incident: { select: { trackingCode: true } },
              },
            });
            const codes = new Map(
              jobs.map((job) => [job.id, job.incident?.trackingCode]),
            );
            for (const row of rows) {
              const code = codes.get(row.aggregateId);
              if (code) set(row.id, code);
            }
            break;
          }
        }
      }),
    );
    return labels;
  }
}
