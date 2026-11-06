import { HttpException, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import { KnowledgeQueueService } from '@/infrastructure/queue/knowledge-queue.service';
import {
  EmbeddingFailure,
  EmbeddingProviderService,
} from './embedding-provider.service';
import { decodeMarkdown, jobSnapshot, markdownChunks } from './knowledge-input';
import { KnowledgeService, lockKnowledgeDocument } from './knowledge.service';

const leaseUntil = () => new Date(Date.now() + 120_000);

@Injectable()
export class KnowledgeProcessor implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly queue: KnowledgeQueueService,
    private readonly knowledge: KnowledgeService,
    private readonly provider: EmbeddingProviderService,
  ) {}

  onModuleInit() {
    if (this.knowledge.bucket) this.queue.start((id) => this.run(id));
  }

  async run(id: string) {
    const token = randomUUID();
    const job = await this.db.$transaction(async (tx) => {
      const claimed = await tx.aiJob.updateMany({
        where: { id, type: 'EMBEDDING_DOCUMENT', status: 'QUEUED' },
        data: {
          status: 'PROCESSING',
          processingToken: token,
          processingLeaseUntil: leaseUntil(),
          currentRound: { increment: 1 },
          startedAt: new Date(),
          errorSummary: null,
          finalOutput: Prisma.DbNull,
        },
      });
      return claimed.count
        ? tx.aiJob.findUniqueOrThrow({ where: { id } })
        : null;
    });
    if (!job?.knowledgeDocumentId) return;
    const documentId = job.knowledgeDocumentId;
    const claim = { id, status: 'PROCESSING' as const, processingToken: token };
    const snapshot = jobSnapshot.safeParse(job.inputPayload);

    try {
      if (job.currentRound > job.maxRounds)
        throw new EmbeddingFailure('RETRIES_EXHAUSTED');
      if (!snapshot.success) throw new EmbeddingFailure('INVALID_JOB_SNAPSHOT');
      const profile = snapshot.data;
      const doc = await this.db.knowledgeDocument.findUniqueOrThrow({
        where: { id: documentId },
      });
      if (
        doc.version !== profile.version ||
        doc.checksum !== profile.checksum ||
        doc.status === 'ARCHIVED'
      ) {
        throw new EmbeddingFailure('DOCUMENT_VERSION_CHANGED');
      }
      const raw = await this.knowledge.readObject(doc);
      const fragments = markdownChunks(
        decodeMarkdown(raw),
        profile.target,
        profile.overlap,
      );
      if (!fragments.length) throw new EmbeddingFailure('EMPTY_MARKDOWN');
      const vectors: number[][] = [];
      for (
        let start = 0;
        start < fragments.length;
        start += profile.batchSize
      ) {
        const progress = await this.db.aiJob.updateMany({
          where: claim,
          data: {
            processingLeaseUntil: leaseUntil(),
            finalOutput: { embedded: vectors.length, total: fragments.length },
          },
        });
        if (!progress.count) return;
        const inputs = fragments
          .slice(start, start + profile.batchSize)
          .map(({ content, section }) =>
            [doc.title, section.join(' > '), content]
              .filter(Boolean)
              .join('\n\n'),
          );
        vectors.push(
          ...(await this.provider.embed(inputs, profile, 'search_document')),
        );
      }

      await this.db.$transaction(
        async (tx) => {
          const current = await lockKnowledgeDocument(tx, documentId);
          if (current.status === 'ARCHIVED') return;
          if (
            current.version !== profile.version ||
            current.checksum !== profile.checksum
          ) {
            throw new EmbeddingFailure('DOCUMENT_VERSION_CHANGED');
          }
          const finished = await tx.aiJob.updateMany({
            where: claim,
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
              processingToken: null,
              processingLeaseUntil: null,
              finalProvider: 'OPENROUTER',
              finalModel: profile.model,
              resultApplied: true,
              finalOutput: {
                embedded: vectors.length,
                total: fragments.length,
              },
            },
          });
          if (!finished.count) return;
          for (let start = 0; start < fragments.length; start += 16) {
            const rows = fragments
              .slice(start, start + 16)
              .map(({ content, section }, offset) => {
                const index = start + offset;
                return Prisma.sql`(${randomUUID()}::uuid, ${documentId}::uuid, ${id}::uuid, ${index},
              ${content}, ${JSON.stringify({ section })}::jsonb, 'OPENROUTER'::"AiProvider", ${profile.model},
              ${profile.dimensions}, ${JSON.stringify(vectors[index])}::vector, now(), now())`;
              });
            await tx.$executeRaw`INSERT INTO knowledge_chunks
            (id, "documentId", "embeddingJobId", "chunkIndex", content, metadata, "embeddingProvider",
             "embeddingModel", "embeddingDimensions", embedding, "embeddedAt", "updatedAt")
            VALUES ${Prisma.join(rows)}`;
          }
          await tx.knowledgeDocument.update({
            where: { id: documentId },
            data: { status: 'READY' },
          });
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      const failure =
        error instanceof EmbeddingFailure
          ? error
          : error instanceof HttpException && error.getStatus() < 500
            ? new EmbeddingFailure('MARKDOWN_OR_STORAGE_INVALID')
            : new EmbeddingFailure('KNOWLEDGE_PROCESSING_UNAVAILABLE', true);
      const retry = failure.retryable && job.currentRound < job.maxRounds;
      const changed = await this.db.$transaction(async (tx) => {
        const current = await lockKnowledgeDocument(tx, documentId);
        if (current.status === 'ARCHIVED') return false;
        const updated = await tx.aiJob.updateMany({
          where: claim,
          data: {
            status: retry ? 'QUEUED' : 'FAILED',
            errorSummary: failure.code,
            failedAt: retry ? null : new Date(),
            processingToken: null,
            processingLeaseUntil: null,
          },
        });
        if (!updated.count) return false;
        if (!retry)
          await tx.knowledgeDocument.update({
            where: { id: documentId },
            data: { status: 'ERROR' },
          });
        return true;
      });
      if (changed && retry) throw failure;
    }
  }
}
