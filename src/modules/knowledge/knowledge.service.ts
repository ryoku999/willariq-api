import { activeEmbeddingProfile } from './embedding-profile';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { addAbortSignal } from 'node:stream';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import { MinioStorageService } from '@/infrastructure/storage/minio-storage.service';
import { AuditService } from '../audit/audit.service';
import { IncidentPaginationQueryDto } from '../incidents/dto/incident-pagination-query.dto';
import { KNOWLEDGE_EVENT } from './knowledge-dispatcher.service';
import {
  checksum,
  decodeMarkdown,
  jobSnapshot,
  markdownChunks,
  MARKDOWN_TYPE,
} from './knowledge-input';
import { UploadKnowledgeDto } from './knowledge.dto';

const active = ['PENDING', 'QUEUED', 'PROCESSING'] as const;
const documentSelect = {
  id: true,
  title: true,
  sourceType: true,
  checksum: true,
  version: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  publications: {
    select: { model: true, dimensions: true, jobId: true, publishedAt: true },
  },
} satisfies Prisma.KnowledgeDocumentSelect;
const jobSelect = {
  id: true,
  status: true,
  inputPayload: true,
  finalOutput: true,
  errorSummary: true,
  currentRound: true,
  createdAt: true,
  completedAt: true,
  failedAt: true,
} satisfies Prisma.AiJobSelect;

export async function lockKnowledgeDocument(
  tx: Prisma.TransactionClient,
  id: string,
) {
  await tx.$queryRaw`SELECT id FROM knowledge_documents WHERE id = ${id}::uuid FOR UPDATE`;
  const doc = await tx.knowledgeDocument.findUnique({ where: { id } });
  if (!doc) throw new NotFoundException('Documento no encontrado');
  return doc;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly storage: MinioStorageService,
    private readonly audit: AuditService,
  ) {}

  get bucket() {
    return this.config.get<string>('MINIO_KNOWLEDGE_BUCKET');
  }
  async upload(
    userId: string,
    dto: UploadKnowledgeDto,
    file?: Express.Multer.File,
  ) {
    const bucket = this.requireBucket();
    if (
      !file?.buffer ||
      !/\.md$/i.test(file.originalname) ||
      ![
        'text/markdown',
        'text/x-markdown',
        'text/plain',
        'application/octet-stream',
      ].includes(file.mimetype)
    ) {
      throw new BadRequestException('Sube un archivo .md en el campo file');
    }
    if (file.buffer.length > this.maxBytes())
      throw new BadRequestException('El Markdown excede el limite de bytes');
    const text = decodeMarkdown(file.buffer);
    markdownChunks(
      text,
      this.config.getOrThrow<number>('KNOWLEDGE_CHUNK_TARGET_CHARS'),
      this.config.getOrThrow<number>('KNOWLEDGE_CHUNK_OVERLAP_CHARS'),
    );
    const key = `knowledge/${randomUUID()}.md`;
    await this.storage.put(bucket, key, file.buffer, MARKDOWN_TYPE);
    try {
      const uploaded = await this.db.$transaction(async (tx) => {
        const doc = await tx.knowledgeDocument.create({
          data: {
            title: dto.title,
            sourceType: dto.sourceType,
            storageBucket: bucket,
            storageKey: key,
            checksum: checksum(file.buffer),
            createdById: userId,
          },
          select: documentSelect,
        });
        await this.audit.record(
          {
            userId,
            entityType: 'KnowledgeDocument',
            entityId: doc.id,
            action: 'KNOWLEDGE_DOCUMENT_UPLOADED',
          },
          tx,
        );
        return doc;
      });
      this.logger.log(
        `Markdown registrado documento=${uploaded.id} bytes=${file.buffer.length}`,
      );
      return uploaded;
    } catch (error) {
      // Check ownership before compensation in case the commit response was lost.
      const committed = await this.db.knowledgeDocument
        .findFirst({
          where: { storageBucket: bucket, storageKey: key },
          select: { id: true },
        })
        .catch(() => undefined);
      if (committed === null)
        await this.storage.remove(bucket, key).catch(() => undefined);
      throw error;
    }
  }

  async list({ page, limit }: IncidentPaginationQueryDto) {
    const [items, total] = await this.db.$transaction(
      [
        this.db.knowledgeDocument.findMany({
          select: documentSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.knowledgeDocument.count(),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async detail(id: string) {
    const doc = await this.db.knowledgeDocument.findUnique({
      where: { id },
      select: documentSelect,
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    return doc;
  }

  async content(id: string) {
    const doc = await this.db.knowledgeDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    return this.readObject(doc);
  }

  async readObject(doc: {
    storageBucket: string | null;
    storageKey: string | null;
    checksum: string | null;
  }) {
    if (
      !doc.storageKey ||
      !doc.checksum ||
      doc.storageBucket !== this.requireBucket() ||
      !/^knowledge\/[0-9a-f-]{36}\.md$/.test(doc.storageKey)
    ) {
      throw new ConflictException(
        'El documento no tiene un Markdown administrado por esta API',
      );
    }
    const stream = await this.storage.get(doc.storageBucket, doc.storageKey);
    addAbortSignal(AbortSignal.timeout(40_000), stream);
    const buffers: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      size += chunk.byteLength;
      if (size > this.maxBytes())
        throw new ConflictException('El objeto excede el limite de bytes');
      buffers.push(chunk);
    }
    const bytes = Buffer.concat(buffers);
    if (checksum(bytes) !== doc.checksum)
      throw new ConflictException('La huella del Markdown no coincide');
    return bytes;
  }

  async process(userId: string, id: string, profileId?: string) {
    this.requireBucket();
    const result = await this.db.$transaction(async (tx) => {
      const doc = await lockKnowledgeDocument(tx, id);
      if (
        doc.status === 'ARCHIVED' ||
        !doc.checksum ||
        !doc.storageKey ||
        doc.storageBucket !== this.bucket
      ) {
        throw new ConflictException('El documento no se puede procesar');
      }
      const profile = profileId
        ? await tx.embeddingProfile.findUniqueOrThrow({
            where: { id: profileId },
          })
        : await activeEmbeddingProfile(tx);
      const pending = await tx.aiJob.findFirst({
        where: {
          type: 'EMBEDDING_DOCUMENT',
          knowledgeDocumentId: id,
          status: { in: [...active] },
        },
        select: jobSelect,
      });
      if (pending) {
        const snapshot = jobSnapshot.safeParse(pending.inputPayload);
        if (
          !snapshot.success ||
          snapshot.data.model !== profile.model ||
          snapshot.data.dimensions !== profile.dimensions
        ) {
          throw new ConflictException(
            'El documento ya se está procesando con otro perfil',
          );
        }
        await tx.queueOutbox.updateMany({
          where: {
            eventType: KNOWLEDGE_EVENT,
            aggregateId: pending.id,
            status: 'DEAD',
          },
          data: {
            status: 'PENDING',
            attempts: 0,
            availableAt: new Date(),
            lastError: null,
          },
        });
        return pending;
      }
      const snapshot = {
        version: doc.version,
        checksum: doc.checksum,
        model: profile.model,
        dimensions: profile.dimensions,
        target: this.config.getOrThrow<number>('KNOWLEDGE_CHUNK_TARGET_CHARS'),
        overlap: this.config.getOrThrow<number>(
          'KNOWLEDGE_CHUNK_OVERLAP_CHARS',
        ),
        batchSize: profile.batchSize,
        timeoutMs: profile.timeoutMs,
      };
      const latest = await tx.aiJob.findFirst({
        where: { type: 'EMBEDDING_DOCUMENT', knowledgeDocumentId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: jobSelect,
      });
      const prior = jobSnapshot.safeParse(latest?.inputPayload);
      if (
        latest?.status === 'COMPLETED' &&
        prior.success &&
        (
          [
            'version',
            'checksum',
            'model',
            'dimensions',
            'target',
            'overlap',
          ] as const
        ).every((key) => prior.data[key] === snapshot[key])
      ) {
        return latest;
      }
      const job = await tx.aiJob.create({
        data: {
          type: 'EMBEDDING_DOCUMENT',
          trigger: 'MANUAL',
          knowledgeDocumentId: id,
          requestedById: userId,
          inputPayload: snapshot,
          maxRounds: 3,
        },
        select: jobSelect,
      });
      await tx.queueOutbox.create({
        data: {
          eventType: KNOWLEDGE_EVENT,
          aggregateType: 'AiJob',
          aggregateId: job.id,
          payload: { jobId: job.id },
        },
      });
      await tx.knowledgeDocument.update({
        where: { id },
        data: { status: 'PROCESSING' },
      });
      return job;
    });
    this.logger.log(
      `Procesamiento solicitado documento=${id} job=${result.id} estado=${result.status}`,
    );
    return result;
  }

  async jobs(id: string, { page, limit }: IncidentPaginationQueryDto) {
    await this.detail(id);
    const where = {
      knowledgeDocumentId: id,
      type: 'EMBEDDING_DOCUMENT' as const,
    };
    const [items, total] = await this.db.$transaction(
      [
        this.db.aiJob.findMany({
          where,
          select: jobSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.aiJob.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    const dispatches = await this.db.queueOutbox.findMany({
      where: {
        eventType: KNOWLEDGE_EVENT,
        aggregateId: { in: items.map((job) => job.id) },
      },
      select: { aggregateId: true, status: true, lastError: true },
    });
    const byId = new Map(dispatches.map((entry) => [entry.aggregateId, entry]));
    return {
      items: items.map((job) => ({
        ...job,
        dispatchStatus: byId.get(job.id)?.status,
        dispatchError: byId.get(job.id)?.lastError,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async publish(
    userId: string,
    id: string,
    profile?: { model: string; dimensions: number },
  ) {
    return this.db.$transaction(async (tx) => {
      const doc = await lockKnowledgeDocument(tx, id);
      if (doc.status !== 'READY')
        throw new ConflictException('El documento debe estar READY');
      const job = await tx.aiJob.findFirst({
        where: {
          knowledgeDocumentId: id,
          type: 'EMBEDDING_DOCUMENT',
          ...(profile
            ? {
                AND: [
                  { inputPayload: { path: ['model'], equals: profile.model } },
                  {
                    inputPayload: {
                      path: ['dimensions'],
                      equals: profile.dimensions,
                    },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const snapshot = jobSnapshot.safeParse(job?.inputPayload);
      const progress = job?.finalOutput as { total?: number } | null;
      if (
        !job ||
        job.status !== 'COMPLETED' ||
        !snapshot.success ||
        snapshot.data.version !== doc.version ||
        snapshot.data.checksum !== doc.checksum ||
        !progress?.total
      )
        throw new ConflictException(
          'Falta un procesamiento completo para esta version',
        );
      const { model, dimensions } = snapshot.data;
      const chunkCount = await tx.knowledgeChunk.count({
        where: {
          documentId: id,
          embeddingJobId: job.id,
          embeddingModel: model,
          embeddingDimensions: dimensions,
        },
      });
      if (chunkCount !== progress.total)
        throw new ConflictException('El conjunto de vectores esta incompleto');
      const key = { documentId: id, model, dimensions };
      const prior = await tx.knowledgePublication.findUnique({
        where: { documentId_model_dimensions: key },
      });
      if (prior?.jobId === job.id)
        return tx.knowledgeDocument.findUniqueOrThrow({
          where: { id },
          select: documentSelect,
        });
      const now = new Date();
      await tx.knowledgePublication.upsert({
        where: { documentId_model_dimensions: key },
        create: { ...key, jobId: job.id, publishedAt: now },
        update: { jobId: job.id, publishedAt: now },
      });
      await this.audit.record(
        {
          userId,
          entityType: 'KnowledgeDocument',
          entityId: id,
          action: 'KNOWLEDGE_DOCUMENT_PUBLISHED',
          newValue: { jobId: job.id, model, dimensions, version: doc.version },
        },
        tx,
      );
      return tx.knowledgeDocument.update({
        where: { id },
        data: { publishedAt: now, publishedById: userId },
        select: documentSelect,
      });
    });
  }

  async archive(userId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      const doc = await lockKnowledgeDocument(tx, id);
      if (doc.status !== 'ARCHIVED') {
        await tx.aiJob.updateMany({
          where: {
            knowledgeDocumentId: id,
            type: 'EMBEDDING_DOCUMENT',
            status: { in: [...active] },
          },
          data: {
            status: 'CANCELLED',
            processingToken: null,
            processingLeaseUntil: null,
          },
        });
        await this.audit.record(
          {
            userId,
            entityType: 'KnowledgeDocument',
            entityId: id,
            action: 'KNOWLEDGE_DOCUMENT_ARCHIVED',
          },
          tx,
        );
      }
      return tx.knowledgeDocument.update({
        where: { id },
        data: { status: 'ARCHIVED' },
        select: documentSelect,
      });
    });
  }

  private maxBytes() {
    return this.config.getOrThrow<number>('KNOWLEDGE_MAX_DOCUMENT_BYTES');
  }
  private requireBucket() {
    if (!this.bucket || !this.storage.enabled)
      throw new ServiceUnavailableException(
        'Almacenamiento de conocimiento no configurado',
      );
    return this.bucket;
  }
}
