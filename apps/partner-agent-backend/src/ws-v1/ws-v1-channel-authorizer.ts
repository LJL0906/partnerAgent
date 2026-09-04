import { Injectable } from '@nestjs/common';
import type { SubscriptionChannel } from '@partner-agent/contracts';
import { SessionStore } from '../database/session-store.js';

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
  constructor(private readonly sessionStore: SessionStore) {
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

    // Task/operation ownership has no authoritative data source yet.
    // Keep these channels fail-closed until a concrete authorizer is provided.
    return false;
  }
}
