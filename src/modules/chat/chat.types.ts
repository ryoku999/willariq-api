import type { ConfigService } from '@nestjs/config';
import z from 'zod';

export const CHAT_EVENT = 'MUNICIPAL_CHAT_REQUESTED';
export const ACTIVE_CHAT_JOBS = ['PENDING', 'QUEUED', 'PROCESSING'] as const;
export const TRACKING_PATTERN = /^[A-Z0-9]{1,10}-\d{4}-\d{6,10}$/;
export const UNAVAILABLE_TRACKING =
  'No encontré una incidencia disponible para consultar con ese código.';

export function chatEnabled(config: ConfigService) {
  return (
    config.get<boolean>('CHAT_ENABLED') ??
    Boolean(config.get<string>('MINIO_KNOWLEDGE_BUCKET'))
  );
}

export const chatProfile = z.object({
  model: z.string().min(1),
  dimensions: z.number().int().min(1).max(4096),
  timeoutMs: z.number().int().min(1000).max(60000),
  topK: z.number().int().min(1).max(20),
  similarity: z.number().min(0).max(1),
  contextBudget: z.number().int().min(256).max(16000),
  historyLimit: z.number().int().min(0).max(50),
});

export const chatSnapshot = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('TRACKING'),
    trackingCode: z.string().regex(TRACKING_PATTERN),
  }),
  z.object({ kind: z.literal('MUNICIPAL'), profile: chatProfile }),
]);

export const chatRoutes = z
  .array(
    z.object({
      id: z.uuid(),
      provider: z.enum(['OPENROUTER', 'CEREBRAS', 'GROQ']),
      model: z.string().min(1),
      priority: z.number().int(),
      timeoutMs: z.number().int().min(1000).max(120000),
    }),
  )
  .min(1)
  .max(3);

export const generatedAnswer = z
  .object({
    answer: z.string().trim().min(1).max(4000),
    citations: z.array(z.number().int().positive()).max(20),
  })
  .strict();

export const trackingMetadata = z.object({
  kind: z.literal('TRACKING'),
  incidentId: z.uuid().optional(),
});
