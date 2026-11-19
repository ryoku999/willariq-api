import { Injectable } from '@nestjs/common';
import { IncidentQueueService } from './incident-queue.service';

@Injectable()
export class ChatQueueService extends IncidentQueueService {
  protected override get queueName() {
    return 'municipal-chat';
  }
  protected override get concurrency() {
    return 2;
  }
  protected override get attempts() {
    return 3;
  }
}
