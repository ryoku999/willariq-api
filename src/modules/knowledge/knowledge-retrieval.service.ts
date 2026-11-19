import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { validVector } from './knowledge-input';

@Injectable()
export class KnowledgeRetrievalService {
  constructor(private readonly db: DatabaseService) {}

  async findPublished(
    query: number[],
    profile: { model: string; dimensions: number },
    limit: number,
  ) {
    if (
      !validVector(query, profile.dimensions) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    ) {
      throw new BadRequestException('Vector o limite de busqueda invalido');
    }
    // Filter before computing distances. PostgreSQL must never compare vectors from different profiles.
    return this.db.$queryRaw<
      {
        chunkId: string;
        documentId: string;
        title: string;
        chunkIndex: number;
        content: string;
        section: string[];
        score: number;
      }[]
    >`
      WITH eligible AS MATERIALIZED (
        SELECT c.id AS "chunkId", c."documentId", d.title, c."chunkIndex", c.content,
               c.metadata->'section' AS section, c.embedding
        FROM knowledge_publications p
        JOIN knowledge_documents d ON d.id = p."documentId"
        JOIN knowledge_chunks c ON c."embeddingJobId" = p."jobId" AND c."documentId" = d.id
        WHERE d.status <> 'ARCHIVED' AND p.model = ${profile.model} AND p.dimensions = ${profile.dimensions}
          AND c."embeddingProvider" = 'OPENROUTER' AND c."embeddingModel" = p.model
          AND c."embeddingDimensions" = p.dimensions AND c.embedding IS NOT NULL
      )
      SELECT "chunkId", "documentId", title, "chunkIndex", content, section,
             1 - (embedding <=> ${JSON.stringify(query)}::vector) AS score
      FROM eligible
      ORDER BY score DESC, "chunkId"
      LIMIT ${limit}
    `;
  }
}
