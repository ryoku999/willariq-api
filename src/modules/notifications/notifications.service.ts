import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import { NotificationsQueryDto } from './notifications-query.dto';

const inboxSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  data: true,
  createdAt: true,
  readAt: true,
} satisfies Prisma.NotificationSelect;

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    userId: string,
    { page, limit, unreadOnly }: NotificationsQueryDto,
  ) {
    const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };
    const [items, total] = await this.db.$transaction(
      [
        this.db.notification.findMany({
          where,
          select: inboxSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.notification.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async unreadCount(userId: string) {
    const count = await this.db.notification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  markRead(userId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      await tx.notification.updateMany({
        where: { id, userId, readAt: null },
        data: { readAt: new Date(), status: 'READ' },
      });
      const notification = await tx.notification.findFirst({
        where: { id, userId },
        select: inboxSelect,
      });
      if (!notification)
        throw new NotFoundException('Notificacion no encontrada');
      return notification;
    });
  }

  async markAllRead(userId: string) {
    const { count } = await this.db.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date(), status: 'READ' },
    });
    return { updated: count };
  }
}
