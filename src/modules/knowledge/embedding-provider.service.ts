import { Injectable, Logger } from '@nestjs/common';
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

const errorEnvelope = z.object({
  error: z.object({
    code: z.union([z.number(), z.string()]).optional(),
    message: z.string().optional(),
    metadata: z.object({ provider_name: z.string().optional() }).optional(),
  }),
});

function safeToken(value: string | number | null | undefined) {
  const text = String(value ?? '');
  return /^[a-z0-9_.:-]{1,100}$/i.test(text) ? text : undefined;
}

async function failureMetadata(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return {};
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        return { body: 'too_large' };
      }
      chunks.push(value);
    }
    const parsed = errorEnvelope.safeParse(
      JSON.parse(Buffer.concat(chunks).toString('utf8')),
    );
    if (!parsed.success) return { body: 'unknown_format' };
    const { code, message, metadata } = parsed.data.error;
    const hint = /rate.limit|too many requests/i.test(message ?? '')
      ? 'rate_limit'
      : /timeout|timed out/i.test(message ?? '')
        ? 'timeout'
        : /provider returned error|upstream/i.test(message ?? '')
          ? 'upstream_error'
          : undefined;
    return {
      providerCode: safeToken(code),
      providerName: safeToken(metadata?.provider_name),
      hint,
    };
  } catch {
    return { body: 'unreadable_or_not_json' };
  } finally {
    reader.releaseLock();
  }
}

@Injectable()
export class EmbeddingProviderService {
  private readonly logger = new Logger(EmbeddingProviderService.name);
  constructor(private readonly config: ConfigService) {}

  async embed(
    input: string[],
    profile: { model: string; dimensions: number; timeoutMs: number },
    inputType: 'search_document' | 'search_query',
    jobId?: string,
  ) {
    const key = this.config.get<string>('OPENROUTER_API_KEY');
    if (!key) throw new EmbeddingFailure('PROVIDER_KEY_MISSING');
    const signal = AbortSignal.timeout(profile.timeoutMs);
    const started = Date.now();
    const context = {
      jobId,
      model: profile.model,
      inputType,
      batch: input.length,
      dimensions: profile.dimensions,
    };
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
        const metadata = await failureMetadata(response);
        this.logger.warn(
          JSON.stringify({
            event: 'embedding_http_error',
            ...context,
            status: response.status,
            requestId: safeToken(
              response.headers.get('x-request-id') ??
                response.headers.get('x-openrouter-request-id'),
            ),
            elapsedMs: Date.now() - started,
            ...metadata,
          }),
        );
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
      if (!parsed.success) {
        throw new EmbeddingFailure('INVALID_EMBEDDING_RESPONSE');
      }
      const returned = parsed.data;
      // OpenRouter may prefix the requested model with its private routing namespace.
      const returnedModel = returned.model.replace(
        /^private\/openrouter\//,
        '',
      );
      if (
        returned.data.length !== input.length ||
        ![profile.model, profile.model.replace(/:free$/, '')].includes(
          returnedModel,
        )
      ) {
        this.logger.warn(
          JSON.stringify({
            event: 'embedding_response_mismatch',
            ...context,
            returnedModel: safeToken(returned.model.replaceAll('/', ':')),
            vectors: returned.data.length,
          }),
        );
        throw new EmbeddingFailure('INVALID_EMBEDDING_RESPONSE');
      }
      const vectors: number[][] = [];
      for (const { index, embedding } of parsed.data.data) {
        if (
          index >= input.length ||
          vectors[index] ||
          !validVector(embedding, profile.dimensions)
        ) {
          this.logger.warn(
            JSON.stringify({
              event: 'embedding_invalid_vector',
              ...context,
              index,
              receivedDimensions: Array.isArray(embedding)
                ? embedding.length
                : null,
            }),
          );
          throw new EmbeddingFailure('INVALID_EMBEDDING_VECTOR');
        }
        vectors[index] = embedding;
      }
      return vectors;
    } catch (error) {
      if (error instanceof EmbeddingFailure) {
        if (!/^HTTP_|^RATE_LIMITED$/.test(error.code)) {
          this.logger.warn(
            JSON.stringify({
              event: 'embedding_response_error',
              ...context,
              code: error.code,
            }),
          );
        }
        throw error;
      }
      const code = signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE';
      this.logger.warn(
        JSON.stringify({
          event: 'embedding_transport_error',
          ...context,
          code,
          elapsedMs: Date.now() - started,
        }),
      );
      throw new EmbeddingFailure(code, true);
    }
  }
}
