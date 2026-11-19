import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { IsInt, Matches, Max, MaxLength, Min } from 'class-validator';
import { DatabaseService } from '@/database/database.service';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { EmbeddingProviderService } from './embedding-provider.service';
import { KnowledgeService } from './knowledge.service';

class CreateEmbeddingProfileDto {
  @Matches(/^[a-z0-9._-]+\/[a-z0-9._-]+(?::[a-z0-9._-]+)?$/)
  @MaxLength(180)
  model!: string;

  @IsInt()
  @Min(1)
  @Max(4096)
  dimensions!: number;

  @IsInt()
  @Min(1000)
  @Max(60000)
  timeoutMs!: number;

  @IsInt()
  @Min(1)
  @Max(16)
  batchSize!: number;
}

@Controller('admin/ai/embedding-profiles')
@Auth('ADMIN')
export class EmbeddingProfilesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly embeddings: EmbeddingProviderService,
    private readonly knowledge: KnowledgeService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.db.embeddingProfile.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  @Post()
  async create(@Body() profile: CreateEmbeddingProfileDto) {
    try {
      await this.embeddings.embed(
        ['Horario de atención municipal.'],
        profile,
        'search_document',
      );
      await this.embeddings.embed(
        ['¿Cuál es el horario?'],
        profile,
        'search_query',
      );
    } catch {
      throw new UnprocessableEntityException(
        'OpenRouter no devolvió vectores válidos para documento y consulta. Revisa el modelo, las dimensiones y la disponibilidad del proveedor.',
      );
    }
    return this.db.embeddingProfile.upsert({
      where: {
        provider_model_dimensions: {
          provider: 'OPENROUTER',
          model: profile.model,
          dimensions: profile.dimensions,
        },
      },
      create: profile,
      update: { timeoutMs: profile.timeoutMs, batchSize: profile.batchSize },
    });
  }

  @Post(':id/reindex')
  async reindex(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const profile = await this.profile(id);
    const documents = await this.publishedMissing(profile);
    const failed: { title: string; reason: string }[] = [];
    for (const document of documents) {
      try {
        await this.knowledge.process(actor.id, document.id, id);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        failed.push({ title: document.title, reason: error.message });
      }
    }
    return { requested: documents.length - failed.length, failed };
  }

  @Post(':id/activate')
  async activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const profile = await this.profile(id);
    if (profile.active) return profile;
    for (const document of await this.publishedMissing(profile)) {
      try {
        await this.knowledge.publish(actor.id, document.id, profile);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        throw new ConflictException(
          `Falta completar la reindexación de «${document.title}».`,
        );
      }
    }

    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE embedding_profiles IN SHARE ROW EXCLUSIVE MODE`;
      // Block concurrent publication changes between the coverage check and switch.
      await tx.$executeRaw`LOCK TABLE knowledge_publications IN SHARE MODE`;
      const missing = await tx.knowledgeDocument.count({
        where: this.missingWhere(profile),
      });
      if (missing) {
        throw new ConflictException(
          'Aún hay documentos publicados sin vectores para este perfil',
        );
      }
      await tx.embeddingProfile.updateMany({
        where: { active: true, id: { not: id } },
        data: { active: false },
      });
      const active = await tx.embeddingProfile.update({
        where: { id },
        data: { active: true },
      });
      await this.audit.record(
        {
          userId: actor.id,
          entityType: 'EmbeddingProfile',
          entityId: id,
          action: 'EMBEDDING_PROFILE_ACTIVATED',
          newValue: { model: active.model, dimensions: active.dimensions },
        },
        tx,
      );
      return active;
    });
  }

  private async profile(id: string) {
    const profile = await this.db.embeddingProfile.findUnique({
      where: { id },
    });
    if (!profile)
      throw new NotFoundException('Perfil de embeddings no encontrado');
    return profile;
  }

  private publishedMissing(profile: { model: string; dimensions: number }) {
    return this.db.knowledgeDocument.findMany({
      where: this.missingWhere(profile),
      select: { id: true, title: true },
      orderBy: { id: 'asc' },
    });
  }

  private missingWhere({
    model,
    dimensions,
  }: {
    model: string;
    dimensions: number;
  }) {
    return {
      status: { not: 'ARCHIVED' as const },
      publications: { some: {}, none: { model, dimensions } },
    };
  }
}
