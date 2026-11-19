import { ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';

export async function activeEmbeddingProfile(
  db: Pick<Prisma.TransactionClient, 'embeddingProfile'>,
) {
  const profile = await db.embeddingProfile.findFirst({
    where: { active: true },
  });
  if (!profile) {
    throw new ServiceUnavailableException(
      'Configura un perfil de embeddings activo',
    );
  }
  return profile;
}
