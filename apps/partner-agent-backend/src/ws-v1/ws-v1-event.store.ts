import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  ServerPushEventTypeV1,
  ServerPushEventV1,
  SubscriptionChannel,
} from '@partner-agent/contracts';

export interface WsV1PublishInput {
  channel: SubscriptionChannel;
  event_type: ServerPushEventTypeV1;
  data: unknown;
  session_id?: string;
  operation_id?: string;
  task_id?: string;
  /** Internal routing key for user:self; never copied into the wire event. */
  recipient_user_id?: string;
}

export type WsV1ReplayResult =
  | { replayable: true; events: ServerPushEventV1[] }
  | { replayable: false; events: [] };

const DEFAULT_CHANNEL_RETENTION = 100;

@Injectable()
export class WsV1EventStore {
  private readonly records = new Map<string, ServerPushEventV1[]>();
  private readonly nextSequence = new Map<string, number>();

  append(
    input: WsV1PublishInput,
    streamKey: string = input.channel,
  ): ServerPushEventV1 {
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
    if (channelRecords.length > DEFAULT_CHANNEL_RETENTION) {
      channelRecords.splice(
        0,
        channelRecords.length - DEFAULT_CHANNEL_RETENTION,
      );
    }
    this.records.set(streamKey, channelRecords);
    return event;
  }

  replayAfter(
    channel: SubscriptionChannel,
    after?: string,
    streamKey: string = channel,
  ): WsV1ReplayResult {
    if (after === undefined) return { replayable: true, events: [] };
    const channelRecords = this.records.get(streamKey) ?? [];
    const position = channelRecords.findIndex(
      (event) => event.event_id === after,
    );
    if (position < 0) return { replayable: false, events: [] };
    return {
      replayable: true,
      events: channelRecords.slice(position + 1),
    };
  }

  createRecoveryRequired(
    channel: SubscriptionChannel,
    streamKey: string = channel,
  ): ServerPushEventV1 {
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
}
