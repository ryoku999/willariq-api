import { Prisma } from '@/generated/prisma/client';
import { AiCapability } from '@/generated/prisma/enums';

export async function lockAiCapability(
  tx: Prisma.TransactionClient,
  capability: AiCapability,
) {
  // Mismo lock en activacion, desactivacion y rutas: evita estados intermedios y carreras.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('willariq-ai-config'), hashtext(${capability}::text))::text`;
}
