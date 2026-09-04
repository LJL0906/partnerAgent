import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  WS_EVENTS,
  type ServerPushEventTypeV1,
  type ServerPushEventV1,
  type SubscribeRequestV1,
  type SubscriptionAckV1,
  type SubscriptionChannel,
  type UnsubscribeRequestV1,
} from '@partner-agent/contracts';
import type { Socket } from 'socket.io';
import {
  ChatTaskEventBus,
  type ChatTaskEvent,
} from '../local-core-api/chat-task-event.bus.js';
import { RedactionService } from '../tools/redaction.service.js';
import { WsV1ChannelAuthorizer } from './ws-v1-channel-authorizer.js';
import {
  WsV1EventStore,
  type WsV1PublishInput,
} from './ws-v1-event.store.js';

export interface WsV1SubscriptionResult {
  ack: SubscriptionAckV1;
  replay: ServerPushEventV1[];
}

@Injectable()
export class WsV1Service implements OnModuleInit, OnModuleDestroy {
  private readonly sockets = new Map<string, Socket>();
  private readonly subscriptions = new Map<
    string,
    Set<SubscriptionChannel>
  >();
  private unsubscribeTaskEvents?: () => void;

  constructor(
    private readonly authorizer: WsV1ChannelAuthorizer,
    private readonly eventStore: WsV1EventStore,
    private readonly redaction: RedactionService,
    private readonly taskEvents: ChatTaskEventBus,
  ) {}

  onModuleInit(): void {
    this.unsubscribeTaskEvents = this.taskEvents.subscribe((event) =>
      this.publishTaskEvent(event),
    );
  }

  onModuleDestroy(): void {
    this.unsubscribeTaskEvents?.();
  }

  connect(socket: Socket): void {
    this.sockets.set(socket.id, socket);
    this.subscriptions.set(socket.id, new Set());
  }

  disconnect(socket: Socket): void {
    this.sockets.delete(socket.id);
    this.subscriptions.delete(socket.id);
  }

  async subscribe(
    socket: Socket,
    request: SubscribeRequestV1,
  ): Promise<WsV1SubscriptionResult> {
    const userId = this.requireAuthenticated(socket);
    const accepted: SubscriptionChannel[] = [];
    const rejected: SubscriptionAckV1['rejected'] = [];
    const replay: ServerPushEventV1[] = [];
    const subscriptions = this.subscriptions.get(socket.id) ?? new Set();
    this.subscriptions.set(socket.id, subscriptions);

    for (const rawChannel of request.channels ?? []) {
      if (!this.isSubscriptionChannel(rawChannel)) {
        rejected.push({
          channel: String(rawChannel),
          code: 'VALIDATION_001',
          message: '频道格式无效',
        });
        continue;
      }

      if (!(await this.authorizer.canSubscribe({ userId, channel: rawChannel }))) {
        rejected.push({
          channel: rawChannel,
          code: 'AUTH_002',
          message: '频道不存在或无权订阅',
        });
        continue;
      }

      subscriptions.add(rawChannel);
      accepted.push(rawChannel);
      const replayResult = this.eventStore.replayAfter(
        rawChannel,
        request.after?.[rawChannel],
        this.streamKey(rawChannel, userId),
      );
      if (replayResult.replayable) {
        replay.push(...replayResult.events);
      } else {
        replay.push(
          this.eventStore.createRecoveryRequired(
            rawChannel,
            this.streamKey(rawChannel, userId),
          ),
        );
      }
    }

    return {
      ack: { request_id: request.request_id, accepted, rejected },
      replay,
    };
  }

  unsubscribe(
    socket: Socket,
    request: UnsubscribeRequestV1,
  ): SubscriptionAckV1 {
    this.requireAuthenticated(socket);
    const subscriptions = this.subscriptions.get(socket.id) ?? new Set();
    const accepted: SubscriptionChannel[] = [];
    const rejected: SubscriptionAckV1['rejected'] = [];

    for (const rawChannel of request.channels ?? []) {
      if (!this.isSubscriptionChannel(rawChannel)) {
        rejected.push({
          channel: String(rawChannel),
          code: 'VALIDATION_001',
          message: '频道格式无效',
        });
        continue;
      }
      subscriptions.delete(rawChannel);
      accepted.push(rawChannel);
    }
    return { request_id: request.request_id, accepted, rejected };
  }

  publish(input: WsV1PublishInput): ServerPushEventV1 {
    if (input.channel === 'user:self' && !input.recipient_user_id) {
      throw new Error('user:self 推送必须指定 recipient_user_id');
    }
    const event = this.eventStore.append(
      { ...input, data: this.sanitizePushData(input.data) },
      this.streamKey(input.channel, input.recipient_user_id),
    );
    for (const [socketId, channels] of this.subscriptions) {
      const socket = this.sockets.get(socketId);
      if (
        channels.has(input.channel) &&
        socket &&
        (input.channel !== 'user:self' ||
          socket.data.userId === input.recipient_user_id)
      ) {
        socket.emit(WS_EVENTS.AGENT_EVENT, event);
      }
    }
    return event;
  }

  private requireAuthenticated(socket: Socket): string {
    const userId = socket.data.userId;
    if (typeof userId !== 'string' || !userId) throw new Error('未认证');
    return userId;
  }

  private isSubscriptionChannel(value: unknown): value is SubscriptionChannel {
    if (value === 'user:self') return true;
    if (typeof value !== 'string') return false;
    return ['session:', 'task:', 'operation:'].some(
      (prefix) => value.startsWith(prefix) && value.length > prefix.length,
    );
  }

  private streamKey(
    channel: SubscriptionChannel,
    userId?: string,
  ): string {
    return channel === 'user:self' ? `user:self:${userId ?? ''}` : channel;
  }

  private sanitizePushData(value: unknown): unknown {
    return this.removeInternalDetails(this.redaction.sanitize(value));
  }

  private publishTaskEvent(event: ChatTaskEvent): void {
    const mapped = this.mapTaskEvent(event);
    if (!mapped) return;
    const common = {
      session_id: event.sessionId,
      operation_id: event.operationId,
      task_id: event.taskId,
      event_type: mapped.eventType,
      data: mapped.data,
    } as const;
    for (const channel of [
      `task:${event.taskId}`,
      `operation:${event.operationId}`,
      `session:${event.sessionId}`,
    ] as const) {
      this.publish({ channel, ...common });
    }
  }

  private mapTaskEvent(event: ChatTaskEvent):
    | { eventType: ServerPushEventTypeV1; data: unknown }
    | undefined {
    if (event.type === 'state_changed') {
      if (event.state === 'completed') return { eventType: 'done', data: {} };
      if (event.state === 'cancelled') {
        return { eventType: 'cancelled', data: {} };
      }
      if (event.state === 'failed') {
        const details = this.toSnakeCase(event.data);
        return {
          eventType: 'error',
          data:
            details && typeof details === 'object'
              ? details
              : { code: 'INTERNAL_000', message: '聊天任务失败' },
        };
      }
      return {
        eventType: 'task_state',
        data: { state: event.state },
      };
    }

    if (!event.eventType || !this.isPushEventType(event.eventType)) {
      return undefined;
    }
    return { eventType: event.eventType, data: this.toSnakeCase(event.data) };
  }

  private isPushEventType(value: string): value is ServerPushEventTypeV1 {
    return [
      'text_delta',
      'thinking_delta',
      'history',
      'tool_execution_start',
      'tool_execution_end',
      'tool_confirmation_pending',
      'tool_confirmation_confirmed',
      'tool_confirmation_dismissed',
      'tool_undo_available',
      'tool_undo_completed',
      'candidate',
      'reminder',
      'summary',
      'task_state',
      'cancelled',
      'done',
      'error',
    ].includes(value);
  }

  private toSnakeCase(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => this.toSnakeCase(entry));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        this.toSnakeCase(entry),
      ]),
    );
  }

  private removeInternalDetails(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.removeInternalDetails(entry));
    }
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /^(stack|error_stack|raw|raw_data)$/i.test(key)
          ? '[已移除]'
          : this.removeInternalDetails(entry),
      ]),
    );
  }
}
