import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  SENSITIVE_CATEGORIES,
  WS_SERVER_EVENTS,
  type PrivacyDecisionStatus,
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
import { ChatTaskOutboxRelay } from '../local-core-api/chat-task-outbox.relay.js';
import {
  NoopObservabilitySink,
  ObservabilitySink,
  safelyRecord,
} from '../observability/observability.types.js';
import { RedactionService } from '../tools/redaction.service.js';
import { ToolControlOutboxRelay } from '../tools/tool-control-outbox.relay.js';
import { WsV1ChannelAuthorizer } from './ws-v1-channel-authorizer.js';
import {
  WsV1EventStore,
  type WsV1PublishInput,
  type WsV1StoredEvent,
} from './ws-v1-event.store.js';

export interface WsV1SubscriptionResult {
  ack: SubscriptionAckV1;
  replay: ServerPushEventV1[];
}

interface PendingSubscription {
  streamKey: string;
  buffered: Map<string, WsV1StoredEvent>;
  returnedEventIds: Set<string>;
  replayPosition: number;
}

@Injectable()
export class WsV1Service implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WsV1Service.name);
  private readonly sockets = new Map<string, Socket>();
  private readonly subscriptions = new Map<string, Set<SubscriptionChannel>>();
  private readonly pendingSubscriptions = new Map<
    string,
    Map<SubscriptionChannel, PendingSubscription>
  >();
  private unsubscribeTaskEvents?: () => void;
  private taskPublishQueue = Promise.resolve();

  constructor(
    private readonly authorizer: WsV1ChannelAuthorizer,
    private readonly eventStore: WsV1EventStore,
    private readonly redaction: RedactionService,
    private readonly taskEvents: ChatTaskEventBus,
    @Optional() private readonly outboxRelay?: ChatTaskOutboxRelay,
    @Optional()
    private readonly observability: ObservabilitySink = new NoopObservabilitySink(),
    @Optional() private readonly toolOutboxRelay?: ToolControlOutboxRelay,
  ) {}

  async onModuleInit(): Promise<void> {
    this.eventStore.setObservability(this.observability);
    await this.eventStore.start(
      (record) => this.deliver(record),
      () => this.activeStreams(),
    );
    this.unsubscribeTaskEvents = this.taskEvents.subscribe((event) => {
      const publishing = this.taskPublishQueue.then(() =>
        this.publishTaskEvent(event),
      );
      this.taskPublishQueue = publishing.catch(() => {
        this.logger.warn('WS v1 task event persistence failed');
      });
      return event.eventKey ? publishing : this.taskPublishQueue;
    });
    this.outboxRelay?.start();
    this.toolOutboxRelay?.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.outboxRelay?.stop();
    await this.toolOutboxRelay?.stop();
    this.unsubscribeTaskEvents?.();
    await this.taskPublishQueue.catch(() => undefined);
    await this.eventStore.stop();
  }

  connect(socket: Socket): void {
    this.sockets.set(socket.id, socket);
    this.subscriptions.set(socket.id, new Set());
    this.pendingSubscriptions.set(socket.id, new Map());
  }

  disconnect(socket: Socket): void {
    this.sockets.delete(socket.id);
    this.subscriptions.delete(socket.id);
    this.pendingSubscriptions.delete(socket.id);
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
    const pending = this.pendingSubscriptions.get(socket.id) ?? new Map();
    this.pendingSubscriptions.set(socket.id, pending);

    for (const rawChannel of request.channels ?? []) {
      if (!this.isSubscriptionChannel(rawChannel)) {
        rejected.push({
          channel: String(rawChannel),
          code: 'VALIDATION_001',
          message: '频道格式无效',
        });
        continue;
      }

      if (
        !(await this.authorizer.canSubscribe({ userId, channel: rawChannel }))
      ) {
        rejected.push({
          channel: rawChannel,
          code: 'AUTH_002',
          message: '频道不存在或无权订阅',
        });
        continue;
      }

      subscriptions.delete(rawChannel);
      const pendingChannel: PendingSubscription = {
        streamKey: this.streamKey(rawChannel, userId),
        buffered: new Map(),
        returnedEventIds: new Set(),
        replayPosition: 0,
      };
      pending.set(rawChannel, pendingChannel);
      accepted.push(rawChannel);
      const replayResult = await this.eventStore.replayAfter(
        rawChannel,
        request.after?.[rawChannel],
        pendingChannel.streamKey,
      );
      pendingChannel.replayPosition = replayResult.latestPosition;
      if (replayResult.replayable) {
        const channelReplay = this.mergeReplay(
          replayResult.events,
          pendingChannel.buffered,
        );
        for (const event of channelReplay) {
          pendingChannel.returnedEventIds.add(event.event_id);
        }
        replay.push(...channelReplay);
        safelyRecord(this.observability, {
          kind: 'ws_replay',
          count: channelReplay.length,
        });
      } else {
        replay.push(
          await this.eventStore.createRecoveryRequired(
            rawChannel,
            pendingChannel.streamKey,
          ),
        );
        safelyRecord(this.observability, { kind: 'ws_recovery_required' });
      }
    }

    return {
      ack: { request_id: request.request_id, accepted, rejected },
      replay,
    };
  }

  activateSubscriptions(socket: Socket, channels: SubscriptionChannel[]): void {
    const subscriptions = this.subscriptions.get(socket.id);
    const pending = this.pendingSubscriptions.get(socket.id);
    if (!subscriptions || !pending) return;
    for (const channel of channels) {
      const pendingChannel = pending.get(channel);
      if (!pendingChannel) continue;
      pending.delete(channel);
      subscriptions.add(channel);
      for (const record of [...pendingChannel.buffered.values()].sort(
        (left, right) => left.event.sequence - right.event.sequence,
      )) {
        if (!pendingChannel.returnedEventIds.has(record.event.event_id)) {
          socket.emit(WS_SERVER_EVENTS.AGENT_EVENT, record.event);
        }
      }
      const bufferedPosition = Math.max(
        0,
        ...[...pendingChannel.buffered.values()].map(
          (record) => record.event.sequence,
        ),
      );
      this.eventStore.acknowledgeDelivery(
        pendingChannel.streamKey,
        Math.max(pendingChannel.replayPosition, bufferedPosition),
      );
    }
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
      this.pendingSubscriptions.get(socket.id)?.delete(rawChannel);
      accepted.push(rawChannel);
    }
    return { request_id: request.request_id, accepted, rejected };
  }

  async publish(input: WsV1PublishInput): Promise<ServerPushEventV1> {
    if (input.channel === 'user:self' && !input.recipient_user_id) {
      throw new Error('user:self 推送必须指定 recipient_user_id');
    }
    const record = await this.eventStore.append(
      { ...input, data: this.sanitizePushData(input.data) },
      this.streamKey(input.channel, input.recipient_user_id),
    );
    await this.eventStore.dispatchStored(record);
    return record.event;
  }

  private deliver(record: WsV1StoredEvent): boolean {
    let delivered = false;
    for (const [socketId, channels] of this.subscriptions) {
      const socket = this.sockets.get(socketId);
      if (!socket) continue;
      const expectedStreamKey = this.streamKey(
        record.event.channel,
        socket.data.userId,
      );
      if (
        channels.has(record.event.channel) &&
        record.streamKey === expectedStreamKey
      ) {
        socket.emit(WS_SERVER_EVENTS.AGENT_EVENT, record.event);
        delivered = true;
        continue;
      }
      const pending = this.pendingSubscriptions
        .get(socketId)
        ?.get(record.event.channel);
      if (pending?.streamKey === record.streamKey) {
        pending.buffered.set(record.event.event_id, record);
      }
    }
    return delivered;
  }

  private activeStreams() {
    const streams = new Map<string, SubscriptionChannel>();
    for (const [socketId, channels] of this.subscriptions) {
      const socket = this.sockets.get(socketId);
      if (!socket) continue;
      for (const channel of channels) {
        streams.set(this.streamKey(channel, socket.data.userId), channel);
      }
    }
    return [...streams].map(([streamKey, channel]) => ({ streamKey, channel }));
  }

  private mergeReplay(
    replay: ServerPushEventV1[],
    buffered: Map<string, WsV1StoredEvent>,
  ): ServerPushEventV1[] {
    const merged = new Map(
      replay.map((event) => [event.event_id, event] as const),
    );
    for (const record of buffered.values()) {
      merged.set(record.event.event_id, record.event);
    }
    return [...merged.values()].sort(
      (left, right) => left.sequence - right.sequence,
    );
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

  private streamKey(channel: SubscriptionChannel, userId?: string): string {
    return channel === 'user:self' ? `user:self:${userId ?? ''}` : channel;
  }

  private sanitizePushData(value: unknown): unknown {
    return this.removeInternalDetails(this.redaction.sanitize(value));
  }

  private async publishTaskEvent(event: ChatTaskEvent): Promise<void> {
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
      await this.publish({
        channel,
        ...common,
        ...(event.eventKey
          ? { idempotency_key: `${event.eventKey}:${channel}` }
          : {}),
      });
    }
  }

  private mapTaskEvent(
    event: ChatTaskEvent,
  ): { eventType: ServerPushEventTypeV1; data: unknown } | undefined {
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
        data: {
          state: event.state,
          ...(event.state === 'waiting_privacy_decision'
            ? {
                privacy_decision: this.privacyDecisionStatus(event.data),
              }
            : {}),
        },
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
    if (Array.isArray(value))
      return value.map((entry) => this.toSnakeCase(entry));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        this.toSnakeCase(entry),
      ]),
    );
  }

  private privacyDecisionStatus(
    value: unknown,
  ): PrivacyDecisionStatus | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const data = value as Record<string, unknown>;
    const nested = data.privacy_decision ?? data.privacyDecision ?? data;
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
      return undefined;
    }
    const decision = nested as Record<string, unknown>;
    const egressId = decision.egress_id ?? decision.egressId;
    const modelId = decision.model_id ?? decision.modelId;
    const expiresAt = decision.expires_at ?? decision.expiresAt;
    if (
      !this.isNonEmptyString(egressId) ||
      !this.isNonEmptyString(decision.provider) ||
      !this.isNonEmptyString(modelId) ||
      !this.isNonEmptyString(expiresAt) ||
      !Array.isArray(decision.categories) ||
      !decision.categories.every(
        (category) =>
          typeof category === 'string' &&
          SENSITIVE_CATEGORIES.includes(
            category as (typeof SENSITIVE_CATEGORIES)[number],
          ),
      )
    ) {
      return undefined;
    }
    return {
      egress_id: egressId,
      categories: decision.categories as PrivacyDecisionStatus['categories'],
      provider: decision.provider,
      model_id: modelId,
      expires_at: expiresAt,
    };
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
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
