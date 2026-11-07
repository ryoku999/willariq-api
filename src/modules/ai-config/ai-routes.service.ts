import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import { AiCapability, AiProvider } from '@/generated/prisma/enums';
import { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { IncidentAuditContext } from '../incidents/incidents.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateAiRouteDto,
  ListAiRoutesQueryDto,
  ReorderAiRoutesDto,
  UpdateAiRouteDto,
} from './dto/ai-config.dto';
import { lockAiCapability } from './ai-config-lock';
import { AiProvidersService } from './ai-providers.service';
import { AiSchemaService } from './ai-schema.service';

@Injectable()
export class AiRoutesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly providers: AiProvidersService,
    private readonly schemas: AiSchemaService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateAiRouteDto,
    context: IncidentAuditContext,
  ) {
    try {
      return await this.db.$transaction(async (tx) => {
        await lockAiCapability(tx, dto.capability);
        if (
          (await tx.aiRoute.count({ where: { capability: dto.capability } })) >=
          100
        )
          throw new ConflictException('Limite de 100 rutas por capacidad');
        if (dto.enabled)
          await this.assertCanEnable(tx, dto.capability, dto.provider);
        const route = await tx.aiRoute.create({ data: { ...dto } });
        await this.audit.record(
          {
            userId: actor.id,
            action: 'AI_ROUTE_CREATED',
            entityType: 'AiRoute',
            entityId: route.id,
            newValue: {
              capability: route.capability,
              provider: route.provider,
              model: route.model,
              priority: route.priority,
              enabled: route.enabled,
              timeoutMs: route.timeoutMs,
            },
            ...context,
          },
          tx,
        );
        return route;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'La prioridad ya esta en uso en esa capacidad',
        );
      throw error;
    }
  }

  async list(query: ListAiRoutesQueryDto) {
    const where: Prisma.AiRouteWhereInput = {
      capability: query.capability,
      provider: query.provider,
      enabled: query.enabled,
    };
    const [items, total] = await this.db.$transaction(
      [
        this.db.aiRoute.findMany({
          where,
          orderBy: [{ capability: 'asc' }, { priority: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.db.aiRoute.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateAiRouteDto,
    context: IncidentAuditContext,
  ) {
    if (
      [dto.model, dto.enabled, dto.timeoutMs].every(
        (value) => value === undefined,
      )
    )
      throw new BadRequestException('Debes enviar al menos un campo');
    const target = await this.db.aiRoute.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Ruta IA no encontrada');
    return this.db.$transaction(async (tx) => {
      await lockAiCapability(tx, target.capability);
      const route = await tx.aiRoute.findUniqueOrThrow({ where: { id } });
      if (dto.enabled === true || (route.enabled && dto.enabled !== false))
        await this.assertCanEnable(tx, route.capability, route.provider);
      const data = {
        model: dto.model ?? route.model,
        enabled: dto.enabled ?? route.enabled,
        timeoutMs: dto.timeoutMs ?? route.timeoutMs,
      };
      if (
        data.model === route.model &&
        data.enabled === route.enabled &&
        data.timeoutMs === route.timeoutMs
      )
        return route;
      const updated = await tx.aiRoute.update({ where: { id }, data });
      await this.audit.record(
        {
          userId: actor.id,
          action: 'AI_ROUTE_UPDATED',
          entityType: 'AiRoute',
          entityId: id,
          oldValue: {
            model: route.model,
            enabled: route.enabled,
            timeoutMs: route.timeoutMs,
          },
          newValue: data,
          ...context,
        },
        tx,
      );
      return updated;
    });
  }

  async reorder(
    actor: AuthenticatedUser,
    dto: ReorderAiRoutesDto,
    context: IncidentAuditContext,
  ) {
    return this.db.$transaction(async (tx) => {
      await lockAiCapability(tx, dto.capability);
      const routes = await tx.aiRoute.findMany({
        where: { capability: dto.capability },
        orderBy: { priority: 'asc' },
        select: { id: true, priority: true },
      });
      if (
        routes.length !== dto.routeIds.length ||
        !routes.every((route) => dto.routeIds.includes(route.id))
      )
        throw new ConflictException(
          'Incluye todas las rutas de la capacidad, incluidas las deshabilitadas, exactamente una vez',
        );
      if (
        routes.every(
          (route, index) =>
            route.id === dto.routeIds[index] && route.priority === index + 1,
        )
      )
        return {
          capability: dto.capability,
          items: await tx.aiRoute.findMany({
            where: { capability: dto.capability },
            orderBy: { priority: 'asc' },
          }),
        };
      const used = new Set(routes.map((route) => route.priority));
      const temporary: number[] = [];
      let candidate = -1;
      for (let index = 0; index < dto.routeIds.length; index++) {
        while (used.has(candidate)) candidate--;
        temporary.push(candidate--);
      }
      for (const priorities of [
        temporary,
        dto.routeIds.map((_id, index) => index + 1),
      ]) {
        const values = dto.routeIds.map(
          (id, index) =>
            Prisma.sql`(${id}::uuid, ${priorities[index]}::integer)`,
        );
        await tx.$executeRaw`UPDATE ai_routes AS route SET priority = ranks.priority, "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' FROM (VALUES ${Prisma.join(values)}) AS ranks(id, priority) WHERE route.id = ranks.id`;
      }
      await this.audit.record(
        {
          userId: actor.id,
          action: 'AI_ROUTES_REORDERED',
          entityType: 'AiRoute',
          entityId: dto.capability,
          oldValue: { order: routes },
          newValue: { routeIds: dto.routeIds },
          ...context,
        },
        tx,
      );
      return {
        capability: dto.capability,
        items: await tx.aiRoute.findMany({
          where: { capability: dto.capability },
          orderBy: { priority: 'asc' },
        }),
      };
    });
  }

  async check(capability?: AiCapability) {
    const [prompts, routes] = await this.db.$transaction(
      [
        this.db.promptVersion.findMany({
          where: { active: true, ...(capability ? { capability } : {}) },
        }),
        this.db.aiRoute.findMany({
          where: { ...(capability ? { capability } : {}) },
          orderBy: { priority: 'asc' },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const items = (capability ? [capability] : Object.values(AiCapability)).map(
      (item) => {
        const active = prompts.filter((prompt) => prompt.capability === item);
        const enabled = routes.filter(
          (route) => route.capability === item && route.enabled,
        );
        const issues: string[] = [];
        if (item !== AiCapability.EMBEDDING && active.length !== 1)
          issues.push('ACTIVE_PROMPT_REQUIRED');
        for (const prompt of active) {
          try {
            this.schemas.prepare(item, prompt.responseSchema);
          } catch {
            issues.push('ACTIVE_PROMPT_SCHEMA_INVALID');
          }
        }
        if (!enabled.length) issues.push('ENABLED_ROUTE_REQUIRED');
        for (const route of enabled)
          if (!this.providers.isConfigured(route.provider))
            issues.push(`PROVIDER_KEY_MISSING:${route.provider}`);
        return {
          capability: item,
          activePromptId: active.length === 1 ? active[0].id : null,
          enabledRouteIds: enabled.map((route) => route.id),
          configurationReady: issues.length === 0,
          executionImplemented:
            item === AiCapability.INCIDENT_CLASSIFICATION ||
            item === AiCapability.CHATBOT,
          issues: [...new Set(issues)],
          providerVerification: 'NOT_CHECKED',
        };
      },
    );
    return { items, externalRequestsMade: false };
  }

  private async assertCanEnable(
    tx: Prisma.TransactionClient,
    capability: AiCapability,
    provider: AiProvider,
  ) {
    if (!this.providers.isConfigured(provider))
      throw new ConflictException(
        'Falta configurar la credencial del proveedor en el entorno del backend',
      );
    if (capability === AiCapability.EMBEDDING) return;
    const prompts = await tx.promptVersion.findMany({
      where: { capability, active: true },
    });
    if (prompts.length !== 1)
      throw new ConflictException(
        'Activa exactamente un prompt para esta capacidad antes de habilitar rutas',
      );
    this.schemas.prepare(capability, prompts[0].responseSchema);
  }
}
