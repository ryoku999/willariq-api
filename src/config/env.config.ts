import z from 'zod';

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
