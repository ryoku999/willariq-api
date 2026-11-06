import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import z from 'zod';
import { validVector } from './knowledge-input';

export class EmbeddingFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super(code);
  }
}

const responseSchema = z.object({
  model: z.string(),
  data: z.array(
    z.object({ index: z.number().int().nonnegative(), embedding: z.unknown() }),
  ),
});

@Injectable()
export class EmbeddingProviderService {
  constructor(private readonly config: ConfigService) {}

  async embed(
    input: string[],
    profile: { model: string; dimensions: number; timeoutMs: number },
    inputType: 'search_document' | 'search_query',
  ) {
    const key = this.config.get<string>('OPENROUTER_API_KEY');
    if (!key) throw new EmbeddingFailure('PROVIDER_KEY_MISSING');
    const signal = AbortSignal.timeout(profile.timeoutMs);
    try {
      const response = await fetch(
        `${this.config.getOrThrow<string>('OPENROUTER_BASE_URL')}/embeddings`,
        {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: profile.model,
            input,
            input_type: inputType,
            encoding_format: 'float',
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new EmbeddingFailure(
          response.status === 429 ? 'RATE_LIMITED' : `HTTP_${response.status}`,
          response.status === 429 || response.status >= 500,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new EmbeddingFailure('INVALID_EMBEDDING_RESPONSE');
      const buffers: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new EmbeddingFailure('EMBEDDING_RESPONSE_TOO_LARGE');
        }
        buffers.push(value);
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(buffers).toString('utf8'));
      } catch {
        throw new EmbeddingFailure('INVALID_EMBEDDING_RESPONSE');
      }
      const parsed = responseSchema.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.data.length !== input.length ||
        ![profile.model, profile.model.replace(/:free$/, '')].includes(
          parsed.data.model,
        )
      ) {
        throw new EmbeddingFailure('INVALID_EMBEDDING_RESPONSE');
      }
      const vectors: number[][] = [];
      for (const { index, embedding } of parsed.data.data) {
        if (
          index >= input.length ||
          vectors[index] ||
          !validVector(embedding, profile.dimensions)
        ) {
          throw new EmbeddingFailure('INVALID_EMBEDDING_VECTOR');
        }
        vectors[index] = embedding;
      }
      return vectors;
    } catch (error) {
      if (error instanceof EmbeddingFailure) throw error;
      throw new EmbeddingFailure(
        signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
        true,
      );
    }
  }
}
