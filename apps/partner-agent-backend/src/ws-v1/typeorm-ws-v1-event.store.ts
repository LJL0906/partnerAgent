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
  WsV1EventStore,
  type WsV1PublishInput,
  type WsV1ReplayResult,
  type WsV1StoredEvent,
  type WsV1StoredEventListener,
} from './ws-v1-event.store.js';

export const WS_V1_NOTIFICATION_CHANNEL = 'partner_agent_ws_v1_event';
const DEFAULT_CHANNEL_RETENTION = 100;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

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
  private stopping = false;

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
  ) {
    super();
  }

  async start(listener: WsV1StoredEventListener): Promise<void> {
    this.listener = listener;
    this.stopping = false;
    await this.ensureConnected();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.listener = undefined;
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
    const eventId = randomUUID();
    const timestamp = Date.now();
    let event: ServerPushEventV1 | undefined;
    await this.dataSource.transaction(async (manager) => {
      const sequence = await this.nextPosition(manager, streamKey);
      event = this.toWireEvent(input, eventId, sequence, timestamp);
      await manager.query(
        `insert into ws_v1_events
          (event_id, stream_key, stream_position, publisher_instance_id, wire_payload, created_at)
         values ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          eventId,
          streamKey,
          sequence,
          this.instanceId,
          JSON.stringify(event),
          new Date(timestamp),
        ],
      );
      await manager.query(
        `delete from ws_v1_events
         where stream_key = $1
           and stream_position <= $2::bigint - $3::bigint`,
        [streamKey, sequence, DEFAULT_CHANNEL_RETENTION],
      );
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
    if (after === undefined) return { replayable: true, events: [] };
    if (!isUuid(after)) return { replayable: false, events: [] };
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const cursors = (await manager.query(
        `select stream_position::text as stream_position
         from ws_v1_events where event_id = $1 and stream_key = $2`,
        [after, streamKey],
      )) as Array<{ stream_position: string }>;
      if (!cursors[0]) return { replayable: false, events: [] };
      const rows = (await manager.query(
        `select wire_payload from ws_v1_events
         where stream_key = $1 and stream_position > $2
         order by stream_position asc`,
        [streamKey, cursors[0].stream_position],
      )) as Array<{ wire_payload: ServerPushEventV1 }>;
      return {
        replayable: true,
        events: rows.map((row) => row.wire_payload),
      };
    });
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
    if (!row || row.publisher_instance_id === this.instanceId) return;
    await this.listener?.({
      streamKey: row.stream_key,
      event: row.wire_payload,
    });
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
    } catch (error) {
      if (this.client === client) this.client = undefined;
      client.removeAllListeners();
      await client.end().catch(() => undefined);
      throw error;
    }
  }

  private handleDisconnect(client: WsV1ListenerClient): void {
    if (this.client !== client) return;
    this.client = undefined;
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
