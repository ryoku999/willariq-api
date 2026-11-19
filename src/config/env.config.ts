import z from 'zod';

const mailLink = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}, 'Usa una URL HTTPS o HTTP local sin credenciales ni fragmento');

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().default(8000),
    DATABASE_URL: z.string(),
    API_PREFIX: z.string(),
    CORS_ORIGINS: z.string(),
    RATE_LIMIT_LIMIT: z.coerce.number().positive(),
    RATE_LIMIT_TTL: z.coerce.number().positive(),
    AUTH_ACCESS_COOKIE_NAME: z.string(),
    AUTH_REFRESH_COOKIE_NAME: z.string(),
    AUTH_COOKIE_SECURE: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true'),
    AUTH_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    JWT_EXPIRES_IN: z.string(),
    JWT_REFRESH_EXPIRES_IN: z.string(),
    JWT_SECRET: z.string(),
    JWT_ISSUER: z.string(),
    JWT_AUDIENCE: z.string(),
    SMTP_HOST: z.string().trim().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    SMTP_USER: z.email().optional(),
    SMTP_PASS: z.string().min(1).optional(),
    MAIL_FROM: z
      .string()
      .trim()
      .min(1)
      .regex(/^[^\r\n]+$/)
      .optional(),
    EMAIL_VERIFICATION_URL: mailLink.optional(),
    PASSWORD_RESET_URL: mailLink.optional(),
    EMAIL_TOKEN_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(60),
    PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(30),
    INCIDENT_TRACKING_PREFIX: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{1,10}$/),
    INCIDENT_TRACKING_TIME_ZONE: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    }, 'Zona horaria de incidencias invalida'),
    MINIO_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    MINIO_ENDPOINT: z
      .string()
      .trim()
      .regex(/^[^/\\\s]+$/)
      .optional(),
    MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
    MINIO_USE_SSL: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    MINIO_ACCESS_KEY: z.string().min(1).optional(),
    MINIO_SECRET_KEY: z.string().min(1).optional(),
    MINIO_REGION: z.string().min(1).default('us-east-1'),
    MINIO_EVIDENCE_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .optional(),
    EVIDENCE_MAX_IMAGE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024)
      .default(5242880),
    EVIDENCE_MAX_FILES_PER_INCIDENT: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(5),
    EVIDENCE_MAX_TOTAL_BYTES_PER_INCIDENT: z.coerce
      .number()
      .int()
      .positive()
      .max(1024 * 1024 * 1024)
      .default(26214400),
    UPLOAD_MAX_CONCURRENT_REQUESTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(16)
      .default(4),
    CEREBRAS_API_KEY: z.preprocess(
      (value) =>
        typeof value === 'string' && !value.trim() ? undefined : value,
      z.string().trim().min(1).optional(),
    ),
    REDIS_HOST: z.string().trim().min(1).default('localhost'),
    REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
    BULLMQ_PREFIX: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,60}$/)
      .default('willariq-dev'),
    AI_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    AI_WORKER_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    AI_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    AI_JOB_MAX_ROUNDS: z.coerce.number().int().min(1).max(5).default(2),
    AI_JOB_LEASE_SECONDS: z.coerce.number().int().min(10).max(600).default(120),
    AI_JOB_HEARTBEAT_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(120)
      .default(30),
    AI_JOB_MAX_TOTAL_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(600000)
      .default(180000),
    OUTBOX_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(250)
      .max(60000)
      .default(2000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
    MINIO_KNOWLEDGE_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .optional(),
    KNOWLEDGE_MAX_DOCUMENT_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1048576)
      .default(1048576),
    KNOWLEDGE_CHUNK_TARGET_CHARS: z.coerce
      .number()
      .int()
      .min(200)
      .max(4000)
      .default(800),
    KNOWLEDGE_CHUNK_OVERLAP_CHARS: z.coerce
      .number()
      .int()
      .min(0)
      .max(500)
      .default(100),
    KNOWLEDGE_WORKER_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(4)
      .default(1),
    CHAT_ENABLED: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    CHAT_MUNICIPAL_CONTACT: z.string().trim().min(1).max(300).optional(),
    RAG_TOP_K: z.coerce.number().int().min(1).max(20).default(5),
    RAG_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.7),
    RAG_MAX_CONTEXT_TOKENS: z.coerce
      .number()
      .int()
      .min(256)
      .max(16000)
      .default(4000),
    CHAT_MAX_MESSAGE_CHARS: z.coerce
      .number()
      .int()
      .min(1)
      .max(12000)
      .default(4000),
    CHAT_MAX_HISTORY_MESSAGES: z.coerce
      .number()
      .int()
      .min(0)
      .max(50)
      .default(20),
    OPENROUTER_BASE_URL: z
      .literal('https://openrouter.ai/api/v1')
      .default('https://openrouter.ai/api/v1'),
    GROQ_API_KEY: z.preprocess(
      (value) =>
        typeof value === 'string' && !value.trim() ? undefined : value,
      z.string().trim().min(1).optional(),
    ),
    OPENROUTER_API_KEY: z.preprocess(
      (value) =>
        typeof value === 'string' && !value.trim() ? undefined : value,
      z.string().trim().min(1).optional(),
    ),
  })
  .superRefine((env, context) => {
    if (env.AI_JOB_HEARTBEAT_SECONDS * 2 >= env.AI_JOB_LEASE_SECONDS)
      context.addIssue({
        code: 'custom',
        path: ['AI_JOB_HEARTBEAT_SECONDS'],
        message: 'El heartbeat debe ser menor a la mitad del lease',
      });
    const mailKeys = [
      'SMTP_HOST',
      'SMTP_USER',
      'SMTP_PASS',
      'MAIL_FROM',
      'EMAIL_VERIFICATION_URL',
      'PASSWORD_RESET_URL',
    ] as const;
    if (mailKeys.some((key) => env[key] !== undefined)) {
      for (const key of mailKeys) {
        if (!env[key])
          context.addIssue({
            code: 'custom',
            path: [key],
            message: 'Completa la configuracion de correo SMTP',
          });
      }
    }
    if (env.KNOWLEDGE_CHUNK_OVERLAP_CHARS >= env.KNOWLEDGE_CHUNK_TARGET_CHARS) {
      context.addIssue({
        code: 'custom',
        path: ['KNOWLEDGE_CHUNK_OVERLAP_CHARS'],
        message: 'El solapamiento debe ser menor al tamano del fragmento',
      });
    }
    if (
      env.MINIO_KNOWLEDGE_BUCKET &&
      (!env.MINIO_ENABLED ||
        !env.OPENROUTER_API_KEY ||
        env.MINIO_KNOWLEDGE_BUCKET === env.MINIO_EVIDENCE_BUCKET)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['MINIO_KNOWLEDGE_BUCKET'],
        message:
          'Conocimiento requiere almacenamiento habilitado, bucket distinto al de evidencias y OPENROUTER_API_KEY',
      });
    }
    if (!env.MINIO_ENABLED) return;
    for (const key of [
      'MINIO_ENDPOINT',
      'MINIO_ACCESS_KEY',
      'MINIO_SECRET_KEY',
      'MINIO_EVIDENCE_BUCKET',
    ] as const) {
      if (!env[key])
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Variable obligatoria cuando MINIO_ENABLED=true',
        });
    }
  });
