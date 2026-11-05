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
    return {
      items,
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
    return {
      ...metadata,
      oldValue: auditValue(oldValue),
      newValue: auditValue(newValue),
    };
  }
}
