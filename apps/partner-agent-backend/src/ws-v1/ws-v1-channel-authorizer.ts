import { Injectable } from '@nestjs/common';
import type { SubscriptionChannel } from '@partner-agent/contracts';
import { SessionStore } from '../database/session-store.js';
import { ChatTaskOwnershipService } from '../local-core-api/chat-task-ownership.service.js';

export interface WsV1AuthorizationRequest {
  userId: string;
  channel: SubscriptionChannel;
}

/** Ownership boundary for WS v1 subscriptions. */
export abstract class WsV1ChannelAuthorizer {
  abstract canSubscribe(request: WsV1AuthorizationRequest): Promise<boolean>;
}

@Injectable()
export class DefaultWsV1ChannelAuthorizer extends WsV1ChannelAuthorizer {
  constructor(
    private readonly sessionStore: SessionStore,
    private readonly taskOwnership: ChatTaskOwnershipService,
  ) {
    super();
  }

  async canSubscribe({
    userId,
    channel,
  }: WsV1AuthorizationRequest): Promise<boolean> {
    if (channel === 'user:self') return true;

    if (channel.startsWith('session:')) {
      const sessionId = channel.slice('session:'.length);
      if (!sessionId) return false;
      return Boolean(await this.sessionStore.find(sessionId, userId));
    }

    if (channel.startsWith('task:')) {
      const taskId = channel.slice('task:'.length);
      return Boolean(
        taskId && (await this.taskOwnership.ownsTask(userId, taskId)),
      );
    }

    if (channel.startsWith('operation:')) {
      const operationId = channel.slice('operation:'.length);
      return Boolean(
        operationId &&
          (await this.taskOwnership.ownsOperation(userId, operationId)),
      );
    }

    return false;
  }
}
