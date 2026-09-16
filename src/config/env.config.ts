import z from 'zod';

export const envSchema = z.object({
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
});
