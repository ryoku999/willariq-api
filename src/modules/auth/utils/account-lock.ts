import type { Prisma } from '@/generated/prisma/client';

export async function lockAccount(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  return tx.user.findUnique({ where: { id: userId } });
}
