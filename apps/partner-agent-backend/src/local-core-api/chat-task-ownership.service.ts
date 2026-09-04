import { Injectable } from '@nestjs/common';
import { ChatTaskStore } from './chat-task.store.js';

@Injectable()
export class ChatTaskOwnershipService {
  constructor(private readonly store: ChatTaskStore) {}

  ownsTask(ownerId: string, taskId: string): Promise<boolean> {
    return this.store.ownsTask(ownerId, taskId);
  }

  ownsOperation(ownerId: string, operationId: string): Promise<boolean> {
    return this.store.ownsOperation(ownerId, operationId);
  }
}
