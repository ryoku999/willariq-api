import crypto from 'node:crypto';

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d|w)$/;

const DURATION_MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export function durationToMilliseconds(duration: string): number {
  const match = DURATION_PATTERN.exec(duration);

  if (!match) {
    throw new Error(`Duracion invalida: ${duration}`);
  }

  return Number(match[1]) * DURATION_MULTIPLIERS[match[2]];
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
