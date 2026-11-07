import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import {
  AiSchemaService,
  canonicalJson,
  sha256,
} from '../ai-config/ai-schema.service';
import { IncidentAccessService } from '../incidents/incident-access.service';
import { IncidentPaginationQueryDto } from '../incidents/dto/incident-pagination-query.dto';
import { CreateChatMessageDto, CreateChatSessionDto } from './chat.dto';
import {
  ACTIVE_CHAT_JOBS,
  CHAT_EVENT,
  TRACKING_PATTERN,
  UNAVAILABLE_TRACKING,
  chatEnabled,
  trackingMetadata,
} from './chat.types';

const sessionSelect = {
  id: true,
  title: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
} satisfies Prisma.ChatSessionSelect;
const messageSelect = {
  id: true,
  role: true,
  content: true,
  clientRequestId: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.ChatMessageSelect;
const jobSelect = {
  id: true,
  chatMessageId: true,
  status: true,
  currentRound: true,
  finalOutput: true,
  errorSummary: true,
  createdAt: true,
  completedAt: true,
  failedAt: true,
} satisfies Prisma.AiJobSelect;

export async function lockChatSession(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
) {
  const rows = await tx.$queryRaw<{ status: 'ACTIVE' | 'CLOSED' }[]>`
    SELECT status FROM chat_sessions WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid FOR UPDATE
  `;
  if (!rows[0]) throw new NotFoundException('Conversacion no encontrada');
  return rows[0];
}

function trackingCode(dto: CreateChatMessageDto) {
  const found = new Set(
    dto.content.toUpperCase().match(/\b[A-Z0-9]{1,10}-\d{4}-\d{6,10}\b/g),
  );
  if (dto.trackingCode) found.add(dto.trackingCode);
  if (found.size > 1)
    throw new BadRequestException('Consulta un codigo de incidencia a la vez');
  const code = [...found][0];
  if (code && !TRACKING_PATTERN.test(code))
    throw new BadRequestException('Codigo de incidencia invalido');
  return code;
}

function pagination(query: IncidentPaginationQueryDto, total: number) {
  return {
    page: query.page,
    limit: query.limit,
    total,
    pages: Math.ceil(total / query.limit),
  };
}

@Injectable()
export class ChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly access: IncidentAccessService,
    private readonly schemas: AiSchemaService,
  ) {}

  create(userId: string, dto: CreateChatSessionDto) {
    this.requireEnabled();
    return this.db.chatSession.create({
      data: { userId, title: dto.title },
      select: sessionSelect,
    });
  }

  async list(userId: string, query: IncidentPaginationQueryDto) {
    const where = { userId };
    const [items, total] = await this.db.$transaction(
      [
        this.db.chatSession.findMany({
          where,
          select: sessionSelect,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.db.chatSession.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, pagination: pagination(query, total) };
  }

  async detail(userId: string, id: string) {
    const session = await this.db.chatSession.findFirst({
      where: { id, userId },
      select: sessionSelect,
    });
    if (!session) throw new NotFoundException('Conversacion no encontrada');
    return session;
  }

  async messages(
    actor: AuthenticatedUser,
    id: string,
    query: IncidentPaginationQueryDto,
  ) {
    await this.detail(actor.id, id);
    const where = {
      sessionId: id,
      session: { userId: actor.id },
      role: { in: ['USER', 'ASSISTANT'] as ('USER' | 'ASSISTANT')[] },
    };
    const [items, total] = await this.db.$transaction(
      [
        this.db.chatMessage.findMany({
          where,
          select: messageSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.db.chatMessage.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    const metadata = items.map((item) =>
      item.role === 'ASSISTANT'
        ? trackingMetadata.safeParse(item.metadata)
        : null,
    );
    const trackedIds = metadata.flatMap((item) =>
      item?.success && item.data.incidentId ? [item.data.incidentId] : [],
    );
    const readable = trackedIds.length
      ? await this.db.incident.findMany({
          where: {
            AND: [{ id: { in: trackedIds } }, this.access.readableWhere(actor)],
          },
          select: { id: true },
        })
      : [];
    const allowed = new Set(readable.map((incident) => incident.id));
    return {
      items: items.map((message, index) => {
        const info = metadata[index];
        if (!info?.success) return message;
        return {
          ...message,
          content:
            info.data.incidentId && !allowed.has(info.data.incidentId)
              ? UNAVAILABLE_TRACKING
              : message.content,
          metadata: { kind: 'TRACKING' },
        };
      }),
      pagination: pagination(query, total),
    };
  }

  async submit(userId: string, id: string, dto: CreateChatMessageDto) {
    this.requireEnabled();
    if (
      Array.from(dto.content).length >
      this.config.getOrThrow<number>('CHAT_MAX_MESSAGE_CHARS')
    ) {
      throw new BadRequestException(
        'El mensaje supera el limite de caracteres',
      );
    }
    const code = trackingCode(dto);
    return this.db.$transaction(async (tx) => {
      const session = await lockChatSession(tx, id, userId);
      const existing = await tx.chatMessage.findUnique({
        where: {
          sessionId_clientRequestId: {
            sessionId: id,
            clientRequestId: dto.clientRequestId,
          },
        },
        select: messageSelect,
      });
      if (existing) {
        const job = await tx.aiJob.findFirstOrThrow({
          where: { chatMessageId: existing.id, type: 'CHAT_RESPONSE' },
          select: { ...jobSelect, inputPayload: true },
        });
        const input = job.inputPayload as { trackingCode?: string } | null;
        if (existing.content !== dto.content || input?.trackingCode !== code) {
          throw new ConflictException(
            'clientRequestId ya fue usado con otro mensaje',
          );
        }
        if (
          session.status === 'ACTIVE' &&
          (job.status === 'PENDING' || job.status === 'QUEUED')
        ) {
          await tx.queueOutbox.updateMany({
            where: {
              eventType: CHAT_EVENT,
              aggregateId: job.id,
              status: 'DEAD',
            },
            data: {
              status: 'PENDING',
              attempts: 0,
              availableAt: new Date(),
              lastError: null,
            },
          });
        }
        const { inputPayload, ...response } = job;
        void inputPayload;
        return { message: existing, job: response };
      }
      if (session.status !== 'ACTIVE')
        throw new ConflictException('La conversacion esta cerrada');
      const running = await tx.aiJob.findFirst({
        where: {
          type: 'CHAT_RESPONSE',
          status: { in: [...ACTIVE_CHAT_JOBS] },
          chatMessage: { sessionId: id },
        },
        select: { id: true },
      });
      if (running) throw new ConflictException('Ya hay una respuesta en curso');

      const setup = code
        ? { inputPayload: { kind: 'TRACKING', trackingCode: code } }
        : await this.municipalSetup(tx);
      const message = await tx.chatMessage.create({
        data: {
          sessionId: id,
          clientRequestId: dto.clientRequestId,
          role: 'USER',
          content: dto.content,
          metadata: { kind: code ? 'TRACKING' : 'MUNICIPAL' },
        },
        select: messageSelect,
      });
      const job = await tx.aiJob.create({
        data: {
          type: 'CHAT_RESPONSE',
          chatMessageId: message.id,
          requestedById: userId,
          maxRounds: 3,
          ...setup,
        },
        select: jobSelect,
      });
      await tx.queueOutbox.create({
        data: {
          eventType: CHAT_EVENT,
          aggregateType: 'AiJob',
          aggregateId: job.id,
          payload: { jobId: job.id },
        },
      });
      await tx.chatSession.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
      return { message, job };
    });
  }

  async job(userId: string, id: string) {
    const job = await this.db.aiJob.findFirst({
      where: {
        id,
        type: 'CHAT_RESPONSE',
        chatMessage: { session: { userId } },
      },
      select: jobSelect,
    });
    if (!job)
      throw new NotFoundException('Trabajo de conversacion no encontrado');
    const dispatch = await this.db.queueOutbox.findUnique({
      where: {
        eventType_aggregateId: { eventType: CHAT_EVENT, aggregateId: id },
      },
      select: { status: true, lastError: true },
    });
    return {
      ...job,
      dispatchStatus: dispatch?.status,
      dispatchError: dispatch?.lastError,
    };
  }

  async close(userId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      const session = await lockChatSession(tx, id, userId);
      if (session.status === 'CLOSED')
        return tx.chatSession.findUniqueOrThrow({
          where: { id },
          select: sessionSelect,
        });
      await tx.aiJob.updateMany({
        where: {
          type: 'CHAT_RESPONSE',
          chatMessage: { sessionId: id },
          status: { in: [...ACTIVE_CHAT_JOBS] },
        },
        data: {
          status: 'CANCELLED',
          processingToken: null,
          processingLeaseUntil: null,
        },
      });
      return tx.chatSession.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date() },
        select: sessionSelect,
      });
    });
  }

  private async municipalSetup(tx: Prisma.TransactionClient) {
    if (!this.config.get<string>('OPENROUTER_API_KEY'))
      throw new ServiceUnavailableException(
        'Falta configurar el proveedor de embeddings',
      );
    const prompt = await tx.promptVersion.findFirst({
      where: { capability: 'CHATBOT', active: true },
    });
    const routes = (
      await tx.aiRoute.findMany({
        where: { capability: 'CHATBOT', enabled: true },
        select: {
          id: true,
          provider: true,
          model: true,
          priority: true,
          timeoutMs: true,
        },
        orderBy: { priority: 'asc' },
      })
    )
      .filter((route) => this.config.get<string>(`${route.provider}_API_KEY`))
      .slice(0, 3);
    if (!prompt || !routes.length)
      throw new ServiceUnavailableException(
        'Configura el prompt activo y una ruta habilitada para CHATBOT',
      );
    const responseSchema = this.schemas.prepare(
      'CHATBOT',
      prompt.responseSchema,
    );
    return {
      promptVersionId: prompt.id,
      promptHash: sha256(prompt.systemPrompt),
      responseSchemaHash: sha256(canonicalJson(responseSchema)),
      routeSnapshot: routes,
      inputPayload: {
        kind: 'MUNICIPAL',
        profile: {
          model: this.config.getOrThrow<string>('OPENROUTER_EMBEDDING_MODEL'),
          dimensions: this.config.getOrThrow<number>(
            'OPENROUTER_EMBEDDING_DIMENSIONS',
          ),
          timeoutMs: this.config.getOrThrow<number>(
            'OPENROUTER_EMBEDDING_TIMEOUT_MS',
          ),
          topK: this.config.getOrThrow<number>('RAG_TOP_K'),
          similarity: this.config.getOrThrow<number>('RAG_MIN_SIMILARITY'),
          contextBudget: this.config.getOrThrow<number>(
            'RAG_MAX_CONTEXT_TOKENS',
          ),
          historyLimit: this.config.getOrThrow<number>(
            'CHAT_MAX_HISTORY_MESSAGES',
          ),
        },
      },
    };
  }

  private requireEnabled() {
    if (!chatEnabled(this.config))
      throw new ServiceUnavailableException('Chat municipal deshabilitado');
  }
}
