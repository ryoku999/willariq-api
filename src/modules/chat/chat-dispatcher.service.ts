import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@/database/database.service';
import { ChatQueueService } from '@/infrastructure/queue/chat-queue.service';
import { OutboxDispatcherService } from '../incident-ai/outbox-dispatcher.service';
import { CHAT_EVENT, chatEnabled } from './chat.types';

@Injectable()
export class ChatDispatcherService extends OutboxDispatcherService {
  constructor(
    db: DatabaseService,
    config: ConfigService,
    queue: ChatQueueService,
  ) {
    super(db, config, queue);
  }
  protected override get eventType() {
    return CHAT_EVENT;
  }
  protected override get jobType() {
    return 'CHAT_RESPONSE' as const;
  }
  protected override get enabled() {
    return chatEnabled(this.config);
  }
}
