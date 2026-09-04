import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  ServerPushEventTypeV1,
  ServerPushEventV1,
  SubscriptionChannel,
} from '@partner-agent/contracts';
import type { ObservabilitySink } from '../observability/observability.types.js';

export interface WsV1PublishInput {
  channel: SubscriptionChannel;
  event_type: ServerPushEventTypeV1;
  data: unknown;
  session_id?: string;
  operation_id?: string;
  task_id?: string;
  /** Internal routing key for user:self; never copied into the wire event. */
  recipient_user_id?: string;
  /** Internal stable relay key; never copied into the wire event. */
  idempotency_key?: string;
}

export type WsV1ReplayResult =
  | { replayable: true; events: ServerPushEventV1[]; latestPosition: number }
  | { replayable: false; events: []; latestPosition: number };

export interface WsV1StoredEvent {
  streamKey: string;
  event: ServerPushEventV1;
}

export type WsV1StoredEventListener = (
  record: WsV1StoredEvent,
) => boolean | Promise<boolean>;

export interface WsV1ActiveStream {
  streamKey: string;
  channel: SubscriptionChannel;
}

export type WsV1ActiveStreamProvider = () => WsV1ActiveStream[];

const DEFAULT_CHANNEL_RETENTION = 100;

@Injectable()
export abstract class WsV1EventStore {
  setObservability(_sink: ObservabilitySink): void {}
  abstract start(
    listener: WsV1StoredEventListener,
    activeStreams?: WsV1ActiveStreamProvider,
  ): Promise<void>;
  abstract stop(): Promise<void>;
  abstract append(
    input: WsV1PublishInput,
    streamKey?: string,
  ): Promise<WsV1StoredEvent>;
  abstract replayAfter(
    channel: SubscriptionChannel,
    after?: string,
    streamKey?: string,
  ): Promise<WsV1ReplayResult>;
  abstract createRecoveryRequired(
    channel: SubscriptionChannel,
    streamKey?: string,
  ): Promise<ServerPushEventV1>;
  abstract dispatchStored(record: WsV1StoredEvent): Promise<void>;
  abstract acknowledgeDelivery(streamKey: string, position: number): void;
}

@Injectable()
export class MemoryWsV1EventStore extends WsV1EventStore {
  private readonly records = new Map<string, ServerPushEventV1[]>();
  private readonly nextSequence = new Map<string, number>();

  private listener?: WsV1StoredEventListener;
  private readonly deliveredPositions = new Map<string, number>();

  constructor(private readonly retentionCount = DEFAULT_CHANNEL_RETENTION) {
    super();
  }

  async start(listener: WsV1StoredEventListener): Promise<void> {
    this.listener = listener;
  }

  async stop(): Promise<void> {}

  async append(
    input: WsV1PublishInput,
    streamKey: string = input.channel,
  ): Promise<WsV1StoredEvent> {
    const sequence = (this.nextSequence.get(streamKey) ?? 0) + 1;
    this.nextSequence.set(streamKey, sequence);
    const event = {
      schema_version: 1,
      event_id: randomUUID(),
      channel: input.channel,
      sequence,
      event_type: input.event_type,
      timestamp: Date.now(),
      data: input.data,
      ...(input.session_id ? { session_id: input.session_id } : {}),
      ...(input.operation_id ? { operation_id: input.operation_id } : {}),
      ...(input.task_id ? { task_id: input.task_id } : {}),
    } as ServerPushEventV1;

    const channelRecords = this.records.get(streamKey) ?? [];
    channelRecords.push(event);
    if (channelRecords.length > this.retentionCount) {
      channelRecords.splice(
        0,
        channelRecords.length - this.retentionCount,
      );
    }
    this.records.set(streamKey, channelRecords);
    return { streamKey, event };
  }

  async replayAfter(
    channel: SubscriptionChannel,
    after?: string,
    streamKey: string = channel,
  ): Promise<WsV1ReplayResult> {
    const latestPosition = this.nextSequence.get(streamKey) ?? 0;
    if (after === undefined)
      return { replayable: true, events: [], latestPosition };
    const channelRecords = this.records.get(streamKey) ?? [];
    const position = channelRecords.findIndex(
      (event) => event.event_id === after,
    );
    if (position < 0)
      return { replayable: false, events: [], latestPosition };
    return {
      replayable: true,
      events: channelRecords.slice(position + 1),
      latestPosition,
    };
  }

  async createRecoveryRequired(
    channel: SubscriptionChannel,
    streamKey: string = channel,
  ): Promise<ServerPushEventV1> {
    return {
      schema_version: 1,
      event_id: randomUUID(),
      channel,
      sequence: this.nextSequence.get(streamKey) ?? 0,
      event_type: 'recovery_required',
      timestamp: Date.now(),
      data: { reason: 'event_expired' },
    };
  }

  async dispatchStored(record: WsV1StoredEvent): Promise<void> {
    if (record.event.sequence <= (this.deliveredPositions.get(record.streamKey) ?? 0))
      return;
    if (await this.listener?.(record)) {
      this.acknowledgeDelivery(record.streamKey, record.event.sequence);
    }
  }

  acknowledgeDelivery(streamKey: string, position: number): void {
    const current = this.deliveredPositions.get(streamKey) ?? 0;
    if (position > current) this.deliveredPositions.set(streamKey, position);
  }
}
