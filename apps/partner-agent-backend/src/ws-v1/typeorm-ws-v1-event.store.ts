import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type {
  ServerPushEventV1,
  SubscriptionChannel,
} from '@partner-agent/contracts';
import { Client, type Notification } from 'pg';
import type { DataSource, EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';
import {
  NoopObservabilitySink,
  ObservabilitySink,
  safelyRecord,
} from '../observability/observability.types.js';
import {
  WsV1EventStore,
  type WsV1PublishInput,
  type WsV1ActiveStreamProvider,
  type WsV1ReplayResult,
  type WsV1StoredEvent,
  type WsV1StoredEventListener,
} from './ws-v1-event.store.js';
import {
  DEFAULT_WS_V1_RETENTION,
  WsV1EventRetentionWorker,
  type WsV1RetentionOptions,
} from './ws-v1-event-retention.worker.js';

export const WS_V1_NOTIFICATION_CHANNEL = 'partner_agent_ws_v1_event';
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const CATCH_UP_BATCH_SIZE = 100;
const CATCH_UP_CONCURRENCY = 4;

export interface WsV1ListenerClient {
  connect(): Promise<unknown>;
  query(query: string): Promise<unknown>;
  end(): Promise<void>;
  on(event: 'notification', listener: (message: Notification) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'end', listener: () => void): this;
  removeAllListeners(): this;
}

export class TypeOrmWsV1EventStore extends WsV1EventStore {
  private readonly logger = new Logger(TypeOrmWsV1EventStore.name);
  private readonly instanceId = randomUUID();
  private client?: WsV1ListenerClient;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connecting?: Promise<void>;
  private listener?: WsV1StoredEventListener;
  private activeStreams?: WsV1ActiveStreamProvider;
  private readonly deliveredPositions = new Map<string, number>();
  private readonly deliveryQueues = new Map<string, Promise<void>>();
  private readonly pendingNotifications: string[] = [];
  private catchingUp = false;
  private reconnectPending = false;
  private stopping = false;
  private readonly retentionWorker: WsV1EventRetentionWorker;

  constructor(
    private readonly dataSource: DataSource,
    databaseUrl: string,
    private readonly reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
    private readonly createClient: () => WsV1ListenerClient = () =>
      new Client({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 5_000,
        application_name: 'partner-agent-ws-v1-listener',
      }),
    retentionOptions: WsV1RetentionOptions = DEFAULT_WS_V1_RETENTION,
    private observability: ObservabilitySink = new NoopObservabilitySink(),
  ) {
    super();
    this.retentionWorker = new WsV1EventRetentionWorker(
      dataSource,
      retentionOptions,
    );
  }

  override setObservability(sink: ObservabilitySink): void {
    this.observability = sink;
  }

  async start(
    listener: WsV1StoredEventListener,
    activeStreams?: WsV1ActiveStreamProvider,
  ): Promise<void> {
    this.listener = listener;
    this.activeStreams = activeStreams;
    this.stopping = false;
    await this.ensureConnected();
    this.retentionWorker.start();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.listener = undefined;
    this.activeStreams = undefined;
    this.retentionWorker.stop();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const client = this.client;
    this.client = undefined;
    client?.removeAllListeners();
    if (client) await client.end().catch(() => undefined);
    await this.connecting?.catch(() => undefined);
  }

  async append(
    input: WsV1PublishInput,
    streamKey: string = input.channel,
  ): Promise<WsV1StoredEvent> {
    let eventId: string = randomUUID();
    const timestamp = Date.now();
    let event: ServerPushEventV1 | undefined;
    await this.dataSource.transaction(async (manager) => {
      await manager.query('select pg_advisory_xact_lock(hashtext($1))', [
        `ws-v1-stream:${streamKey}`,
      ]);
      if (input.idempotency_key) {
        const existing = (await manager.query(
          `select event_id, wire_payload from ws_v1_events
           where stream_key = $1 and idempotency_key = $2`,
          [streamKey, input.idempotency_key],
        )) as Array<{ event_id: string; wire_payload: ServerPushEventV1 }>;
        if (existing[0]) {
          eventId = existing[0].event_id;
          event = existing[0].wire_payload;
          return;
        }
      }
      const sequence = await this.nextPosition(manager, streamKey);
      event = this.toWireEvent(input, eventId, sequence, timestamp);
      const inserted = (await manager.query(
        `insert into ws_v1_events
          (event_id, stream_key, stream_position, publisher_instance_id,
           wire_payload, created_at, idempotency_key)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7)
         on conflict (stream_key, idempotency_key) do nothing
         returning event_id, wire_payload`,
        [
          eventId,
          streamKey,
          sequence,
          this.instanceId,
          JSON.stringify(event),
          new Date(timestamp),
          input.idempotency_key ?? null,
        ],
      )) as Array<{ event_id: string; wire_payload: ServerPushEventV1 }>;
      if (!inserted[0] && input.idempotency_key) {
        const existing = (await manager.query(
          `select event_id, wire_payload from ws_v1_events
           where stream_key = $1 and idempotency_key = $2`,
          [streamKey, input.idempotency_key],
        )) as Array<{ event_id: string; wire_payload: ServerPushEventV1 }>;
        if (!existing[0]) throw new Error('WS_V1_IDEMPOTENCY_LOOKUP_FAILED');
        eventId = existing[0].event_id;
        event = existing[0].wire_payload;
      }
      await manager.query('select pg_notify($1, $2)', [
        WS_V1_NOTIFICATION_CHANNEL,
        eventId,
      ]);
    });
    if (!event) throw new Error('WS_V1_EVENT_PERSIST_FAILED');
    return { streamKey, event };
  }

  async replayAfter(
    _channel: SubscriptionChannel,
    after?: string,
    streamKey: string = _channel,
  ): Promise<WsV1ReplayResult> {
    if (after !== undefined && !isUuid(after))
      return { replayable: false, events: [], latestPosition: 0 };
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const streams = (await manager.query(
        `select last_position::text as last_position
         from ws_v1_event_streams where stream_key = $1`,
        [streamKey],
      )) as Array<{ last_position: string }>;
      const latestPosition = this.safePosition(streams[0]?.last_position ?? '0');
      if (after === undefined)
        return { replayable: true as const, events: [], latestPosition };
      const cursors = (await manager.query(
        `select stream_position::text as stream_position
         from ws_v1_events where event_id = $1 and stream_key = $2`,
        [after, streamKey],
      )) as Array<{ stream_position: string }>;
      if (!cursors[0])
        return { replayable: false as const, events: [], latestPosition };
      const rows = (await manager.query(
        `select wire_payload from ws_v1_events
         where stream_key = $1 and stream_position > $2
         order by stream_position asc`,
        [streamKey, cursors[0].stream_position],
      )) as Array<{ wire_payload: ServerPushEventV1 }>;
      return {
        replayable: true,
        events: rows.map((row) => row.wire_payload),
        latestPosition,
      };
    });
  }

  async dispatchStored(record: WsV1StoredEvent): Promise<void> {
    return this.enqueue(record.streamKey, () => this.deliverIfNeeded(record));
  }

  acknowledgeDelivery(streamKey: string, position: number): void {
    const current = this.deliveredPositions.get(streamKey) ?? 0;
    if (position > current) this.deliveredPositions.set(streamKey, position);
  }

  async createRecoveryRequired(
    channel: SubscriptionChannel,
    streamKey: string = channel,
  ): Promise<ServerPushEventV1> {
    const rows = (await this.dataSource.query(
      `select last_position::text as last_position
       from ws_v1_event_streams where stream_key = $1`,
      [streamKey],
    )) as Array<{ last_position: string }>;
    return {
      schema_version: 1,
      event_id: randomUUID(),
      channel,
      sequence: this.safePosition(rows[0]?.last_position ?? '0'),
      event_type: 'recovery_required',
      timestamp: Date.now(),
      data: { reason: 'event_expired' },
    };
  }

  private async nextPosition(
    manager: EntityManager,
    streamKey: string,
  ): Promise<number> {
    const rows = (await manager.query(
      `insert into ws_v1_event_streams (stream_key, last_position)
       values ($1, 1)
       on conflict (stream_key) do update
       set last_position = ws_v1_event_streams.last_position + 1
       returning last_position::text as last_position`,
      [streamKey],
    )) as Array<{ last_position: string }>;
    return this.safePosition(rows[0]?.last_position);
  }

  private safePosition(value?: string): number {
    const position = Number(value);
    if (!Number.isSafeInteger(position) || position < 0) {
      throw new Error('WS_V1_STREAM_POSITION_EXHAUSTED');
    }
    return position;
  }

  private toWireEvent(
    input: WsV1PublishInput,
    eventId: string,
    sequence: number,
    timestamp: number,
  ): ServerPushEventV1 {
    return {
      schema_version: 1,
      event_id: eventId,
      channel: input.channel,
      sequence,
      event_type: input.event_type,
      timestamp,
      data: input.data,
      ...(input.session_id ? { session_id: input.session_id } : {}),
      ...(input.operation_id ? { operation_id: input.operation_id } : {}),
      ...(input.task_id ? { task_id: input.task_id } : {}),
    } as ServerPushEventV1;
  }

  private async dispatch(eventId: string): Promise<void> {
    const rows = (await this.dataSource.query(
      `select stream_key, publisher_instance_id, wire_payload
       from ws_v1_events where event_id = $1`,
      [eventId],
    )) as Array<{
      stream_key: string;
      publisher_instance_id: string;
      wire_payload: ServerPushEventV1;
    }>;
    const row = rows[0];
    if (!row) return;
    await this.dispatchStored({
      streamKey: row.stream_key,
      event: row.wire_payload,
    });
  }

  private async deliverIfNeeded(record: WsV1StoredEvent): Promise<void> {
    if (record.event.sequence <= (this.deliveredPositions.get(record.streamKey) ?? 0))
      return;
    if (await this.listener?.(record)) {
      this.acknowledgeDelivery(record.streamKey, record.event.sequence);
    }
  }

  private enqueue(streamKey: string, work: () => Promise<void>): Promise<void> {
    const prior = this.deliveryQueues.get(streamKey) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(work);
    this.deliveryQueues.set(streamKey, next);
    void next.then(
      () => this.clearDeliveryQueue(streamKey, next),
      () => this.clearDeliveryQueue(streamKey, next),
    );
    return next;
  }

  private clearDeliveryQueue(streamKey: string, queued: Promise<void>): void {
    if (this.deliveryQueues.get(streamKey) === queued)
      this.deliveryQueues.delete(streamKey);
  }

  private async ensureConnected(): Promise<void> {
    if (this.stopping || this.client || this.connecting) {
      await this.connecting;
      return;
    }
    const attempt = this.openListener()
      .catch(() => {
        this.logger.warn('WS v1 LISTEN unavailable; reconnect scheduled');
        this.scheduleReconnect();
      })
      .finally(() => {
        if (this.connecting === attempt) this.connecting = undefined;
      });
    this.connecting = attempt;
    await attempt;
  }

  private async openListener(): Promise<void> {
    const client = this.createClient();
    this.client = client;
    client.on('notification', (message) => {
      if (message.channel !== WS_V1_NOTIFICATION_CHANNEL || !message.payload)
        return;
      if (this.catchingUp) {
        this.pendingNotifications.push(message.payload);
        return;
      }
      void this.dispatch(message.payload).catch(() => {
        this.logger.warn(
          'WS v1 event dispatch failed; client replay is required',
        );
      });
    });
    client.on('error', () => this.handleDisconnect(client));
    client.on('end', () => this.handleDisconnect(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${WS_V1_NOTIFICATION_CHANNEL}`);
      this.catchingUp = true;
      try {
        const caughtUp = await this.catchUpActiveStreams();
        if (this.reconnectPending) {
          safelyRecord(this.observability, { kind: 'listen_reconnect' });
          safelyRecord(this.observability, {
            kind: 'ws_catch_up',
            result: 'completed',
            count: caughtUp,
          });
          this.reconnectPending = false;
        }
      } finally {
        this.catchingUp = false;
      }
      for (const eventId of this.pendingNotifications.splice(0)) {
        await this.dispatch(eventId);
      }
    } catch (error) {
      if (this.reconnectPending) {
        safelyRecord(this.observability, {
          kind: 'ws_catch_up',
          result: 'failed',
          count: 0,
        });
      }
      if (this.client === client) this.client = undefined;
      client.removeAllListeners();
      await client.end().catch(() => undefined);
      throw error;
    }
  }

  private async catchUpActiveStreams(): Promise<number> {
    const streams = this.activeStreams?.() ?? [];
    let count = 0;
    for (let offset = 0; offset < streams.length; offset += CATCH_UP_CONCURRENCY) {
      const results = await Promise.all(
        streams
          .slice(offset, offset + CATCH_UP_CONCURRENCY)
          .map(async (stream) => this.catchUpStream(stream.streamKey, stream.channel)),
      );
      count += results.reduce((total, value) => total + value, 0);
    }
    return count;
  }

  private async catchUpStream(
    streamKey: string,
    channel: SubscriptionChannel,
  ): Promise<number> {
    let position = this.deliveredPositions.get(streamKey);
    if (position === undefined) return 0;
    let count = 0;
    for (;;) {
      const rows = (await this.dataSource.query(
        `select stream.last_position::text as last_position,
                retained.first_position::text as first_position,
                event.wire_payload
         from ws_v1_event_streams stream
         left join lateral (
           select min(stream_position) as first_position
           from ws_v1_events where stream_key = stream.stream_key
         ) retained on true
         left join lateral (
           select wire_payload
           from ws_v1_events
           where stream_key = stream.stream_key and stream_position > $2
           order by stream_position asc limit $3
         ) event on true
         where stream.stream_key = $1`,
        [streamKey, position, CATCH_UP_BATCH_SIZE],
      )) as Array<{
        last_position: string;
        first_position: string | null;
        wire_payload: ServerPushEventV1 | null;
      }>;
      const state = rows[0];
      if (!state) return count;
      const lastPosition = this.safePosition(state.last_position);
      const firstPosition = state.first_position
        ? this.safePosition(state.first_position)
        : undefined;
      if (position < lastPosition && (firstPosition === undefined || position + 1 < firstPosition)) {
        const recovery = await this.createRecoveryRequired(channel, streamKey);
        if (await this.listener?.({ streamKey, event: recovery })) {
          this.acknowledgeDelivery(streamKey, lastPosition);
        }
        safelyRecord(this.observability, { kind: 'ws_recovery_required' });
        return count;
      }
      const events = rows
        .map((row) => row.wire_payload)
        .filter((event): event is ServerPushEventV1 => Boolean(event));
      if (events.length === 0) return count;
      for (const event of events) {
        const before: number = position;
        await this.dispatchStored({ streamKey, event });
        position = this.deliveredPositions.get(streamKey) ?? position;
        if (position === before) return count;
        count += 1;
      }
      if (position >= lastPosition || events.length < CATCH_UP_BATCH_SIZE)
        return count;
    }
  }

  private handleDisconnect(client: WsV1ListenerClient): void {
    if (this.client !== client) return;
    this.client = undefined;
    this.connecting = undefined;
    this.reconnectPending = true;
    client.removeAllListeners();
    void client.end().catch(() => undefined);
    this.logger.warn('WS v1 LISTEN disconnected; reconnect scheduled');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.ensureConnected();
    }, this.reconnectDelayMs);
    this.reconnectTimer.unref?.();
  }
}
