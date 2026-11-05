import type { Prisma } from '@/generated/prisma/client';

/** Persist inside the business transaction. A replay never resets readAt. */
export function writeNotification(
  tx: Prisma.TransactionClient,
  data: Omit<
    Prisma.NotificationCreateManyInput,
    'eventKey' | 'status' | 'sentAt' | 'readAt'
  > & { eventKey: string },
) {
  return tx.notification.createMany({
    data: { ...data, status: 'SENT', sentAt: new Date() },
    skipDuplicates: true,
  });
}
