import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import { AiCapability } from '@/generated/prisma/enums';
import { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { IncidentAuditContext } from '../incidents/incidents.service';
import { AuditService } from '../audit/audit.service';
import { AiSchemaService, sha256, canonicalJson } from './ai-schema.service';
import { CreatePromptDto, ListPromptsQueryDto } from './dto/ai-config.dto';
import { lockAiCapability } from './ai-config-lock';

const PROMPT_LIST_SELECT = {
  id: true,
  name: true,
  version: true,
  capability: true,
  active: true,
  promptHash: true,
  schemaHash: true,
  createdAt: true,
} as const satisfies Prisma.PromptVersionSelect;

@Injectable()
export class AiPromptsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly schemas: AiSchemaService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreatePromptDto,
    context: IncidentAuditContext,
  ) {
    const schema = this.schemas.prepare(dto.capability, dto.responseSchema);
    try {
      return await this.db.$transaction(async (tx) => {
        const prompt = await tx.promptVersion.create({
          data: {
            name: dto.name,
            version: dto.version,
            capability: dto.capability,
            systemPrompt: dto.systemPrompt,
            responseSchema: schema,
            active: false,
            promptHash: sha256(dto.systemPrompt),
            schemaHash: sha256(canonicalJson(schema)),
          },
        });
        await this.audit.record(
          {
            userId: actor.id,
            action: 'AI_PROMPT_CREATED',
            entityType: 'PromptVersion',
            entityId: prompt.id,
            newValue: {
              name: prompt.name,
              version: prompt.version,
              capability: prompt.capability,
              active: false,
              promptHash: prompt.promptHash,
              schemaHash: prompt.schemaHash,
            },
            ...context,
          },
          tx,
        );
        return prompt;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Ya existe ese nombre y version de prompt');
      throw error;
    }
  }

  async list(query: ListPromptsQueryDto) {
    const where: Prisma.PromptVersionWhereInput = {
      capability: query.capability,
      name: query.name,
      version: query.version,
      active: query.active,
    };
    const [items, total] = await this.db.$transaction(
      [
        this.db.promptVersion.findMany({
          where,
          select: PROMPT_LIST_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.db.promptVersion.count({ where }),
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

  async findById(id: string) {
    const prompt = await this.db.promptVersion.findUnique({ where: { id } });
    if (!prompt) throw new NotFoundException('Version de prompt no encontrada');
    return prompt;
  }

  async setActive(
    actor: AuthenticatedUser,
    id: string,
    active: boolean,
    context: IncidentAuditContext,
  ) {
    const target = await this.findById(id);
    return this.db.$transaction(async (tx) => {
      await lockAiCapability(tx, target.capability);
      const prompt = await tx.promptVersion.findUniqueOrThrow({
        where: { id },
      });
      if (active)
        this.schemas.prepare(prompt.capability, prompt.responseSchema);
      const previous = await tx.promptVersion.findMany({
        where: { capability: prompt.capability, active: true },
        select: { id: true },
      });
      if (active && prompt.active && previous.length === 1) return prompt;
      if (!active && !prompt.active) return prompt;
      if (
        !active &&
        prompt.capability !== AiCapability.EMBEDDING &&
        (await tx.aiRoute.count({
          where: { capability: prompt.capability, enabled: true },
        }))
      )
        throw new ConflictException(
          'Deshabilita primero las rutas de esta capacidad antes de desactivar su prompt',
        );
      if (active)
        await tx.promptVersion.updateMany({
          where: { capability: prompt.capability, active: true },
          data: { active: false },
        });
      const updated = await tx.promptVersion.update({
        where: { id },
        data: { active },
      });
      await this.audit.record(
        {
          userId: actor.id,
          action: active ? 'AI_PROMPT_ACTIVATED' : 'AI_PROMPT_DEACTIVATED',
          entityType: 'PromptVersion',
          entityId: id,
          oldValue: { activePromptIds: previous.map((item) => item.id) },
          newValue: { active, promptId: id, capability: prompt.capability },
          ...context,
        },
        tx,
      );
      return updated;
    });
  }

  async validateOutput(id: string, output: Record<string, unknown>) {
    const prompt = await this.findById(id);
    return {
      promptId: id,
      ...this.schemas.validateOutput(
        prompt.capability,
        prompt.responseSchema,
        output,
      ),
      externalRequestsMade: false,
    };
  }
}
