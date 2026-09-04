import type { Notification } from 'pg';
import type { DataSource, EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import {
  TypeOrmWsV1EventStore,
  WS_V1_NOTIFICATION_CHANNEL,
  type WsV1ListenerClient,
} from './typeorm-ws-v1-event.store.js';

class FakeListenerClient implements WsV1ListenerClient {
  readonly connect = vi.fn(async () => undefined);
  readonly query = vi.fn(async () => undefined);
  readonly end = vi.fn(async () => undefined);
  private readonly handlers = new Map<string, Array<(value: never) => void>>();

  on(event: string, listener: (value: never) => void): this {
    const listeners = this.handlers.get(event) ?? [];
    listeners.push(listener);
    this.handlers.set(event, listeners);
    return this;
  }

  removeAllListeners(): this {
    this.handlers.clear();
    return this;
  }

  notify(eventId: string): void {
    const message = {
      channel: WS_V1_NOTIFICATION_CHANNEL,
      payload: eventId,
    } as Notification;
    for (const handler of this.handlers.get('notification') ?? []) {
      handler(message as never);
    }
  }

  disconnect(): void {
    for (const handler of this.handlers.get('end') ?? []) handler(undefined as never);
  }
}

function storedEvent(id: string, sequence: number) {
  return {
    schema_version: 1 as const,
    event_id: id,
    channel: 'session:s1' as const,
    sequence,
    event_type: 'task_state' as const,
    timestamp: sequence,
    data: { state: 'running' },
  };
}

describe('TypeOrmWsV1EventStore', () => {
  it('allocates a stream position transactionally and notifies with only event id', async () => {
    const managerQuery = vi.fn(async (sql: string) =>
      sql.includes('returning last_position') ? [{ last_position: '7' }] : [],
    );
    const transaction = vi.fn(
      async (work: (manager: EntityManager) => unknown) =>
        work({ query: managerQuery } as unknown as EntityManager),
    );
    const dataSource = { transaction } as unknown as DataSource;
    const store = new TypeOrmWsV1EventStore(dataSource, 'postgres://unused');

    const stored = await store.append({
      channel: 'session:s1',
      session_id: 's1',
      event_type: 'done',
      data: { safe: true },
    });

    expect(stored.event.sequence).toBe(7);
    const notify = managerQuery.mock.calls.find(([sql]) =>
      String(sql).includes('pg_notify'),
    );
    expect(notify?.[1]).toEqual([
      WS_V1_NOTIFICATION_CHANNEL,
      stored.event.event_id,
    ]);
    expect(JSON.stringify(notify?.[1])).not.toContain('safe');
    expect(
      managerQuery.mock.calls.some(([sql]) =>
        String(sql).includes('on conflict (stream_key) do update'),
      ),
    ).toBe(true);
  });

  it('returns an idempotent relay event without consuming another stream position', async () => {
    const existing = storedEvent('00000000-0000-4000-8000-000000000007', 7);
    const managerQuery = vi.fn(async (sql: string) =>
      sql.includes('where stream_key = $1 and idempotency_key = $2')
        ? [{ event_id: existing.event_id, wire_payload: existing }]
        : [],
    );
    const transaction = vi.fn(
      async (work: (manager: EntityManager) => unknown) =>
        work({ query: managerQuery } as unknown as EntityManager),
    );
    const store = new TypeOrmWsV1EventStore(
      { transaction } as unknown as DataSource,
      'postgres://unused',
    );

    await expect(
      store.append({
        channel: 'session:s1',
        event_type: 'done',
        data: {},
        idempotency_key: 'chat-task:t1:event-1:session:s1',
      }),
    ).resolves.toEqual({ streamKey: 'session:s1', event: existing });
    expect(
      managerQuery.mock.calls.some(([sql]) =>
        String(sql).includes('returning last_position'),
      ),
    ).toBe(false);
  });

  it('loads a remote notification by id and exposes its stream key to routing', async () => {
    const client = new FakeListenerClient();
    const event = {
      schema_version: 1 as const,
      event_id: '00000000-0000-4000-8000-000000000007',
      channel: 'user:self' as const,
      sequence: 3,
      event_type: 'summary' as const,
      timestamp: 1,
      data: { summary_id: 'summary-1' },
    };
    const query = vi.fn(async () => [
      {
        stream_key: 'user:self:owner-a',
        publisher_instance_id: '00000000-0000-4000-8000-000000000099',
        wire_payload: event,
      },
    ]);
    const dataSource = { query } as unknown as DataSource;
    const received = vi.fn();
    const store = new TypeOrmWsV1EventStore(
      dataSource,
      'postgres://unused',
      1_000,
      () => client,
    );
    await store.start(received);

    client.notify(event.event_id);
    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where event_id = $1'),
      [event.event_id],
    );
    expect(received).toHaveBeenCalledWith({
      streamKey: 'user:self:owner-a',
      event,
    });
    expect(client.query).toHaveBeenCalledWith(
      `LISTEN ${WS_V1_NOTIFICATION_CHANNEL}`,
    );
    await store.stop();
  });

  it('binds replay cursors to the requested stream and flags missing cursors', async () => {
    const missingId = '00000000-0000-4000-8000-000000000008';
    const managerQuery = vi
      .fn()
      .mockResolvedValueOnce([{ last_position: '5' }])
      .mockResolvedValueOnce([]);
    const transaction = vi.fn(
      async (_isolation: string, work: (manager: EntityManager) => unknown) =>
        work({ query: managerQuery } as unknown as EntityManager),
    );
    const store = new TypeOrmWsV1EventStore(
      { transaction } as unknown as DataSource,
      'postgres://unused',
    );

    await expect(
      store.replayAfter('session:s1', missingId, 'session:s1'),
    ).resolves.toEqual({ replayable: false, events: [], latestPosition: 5 });
    expect(managerQuery).toHaveBeenCalledWith(
      expect.stringContaining('event_id = $1 and stream_key = $2'),
      [missingId, 'session:s1'],
    );
    expect(transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function),
    );
  });

  it('treats a malformed cursor as unavailable without querying PostgreSQL', async () => {
    const transaction = vi.fn();
    const store = new TypeOrmWsV1EventStore(
      { transaction } as unknown as DataSource,
      'postgres://unused',
    );

    await expect(
      store.replayAfter('task:t1', 'not-a-uuid', 'task:t1'),
    ).resolves.toEqual({ replayable: false, events: [], latestPosition: 0 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('catches up multiple events written while LISTEN is disconnected', async () => {
    const clients = [new FakeListenerClient(), new FakeListenerClient()];
    const query = vi.fn(async (sql: string) => {
      if (!sql.includes('retained.first_position')) return [];
      return [2, 3].map((sequence) => ({
        last_position: '3',
        first_position: '1',
        wire_payload: storedEvent(`00000000-0000-4000-8000-00000000000${sequence}`, sequence),
      }));
    });
    const received = vi.fn(async () => true);
    const store = new TypeOrmWsV1EventStore(
      { query } as unknown as DataSource,
      'postgres://unused',
      1,
      () => clients.shift()!,
    );
    await store.start(received, () => [
      { streamKey: 'session:s1', channel: 'session:s1' },
    ]);
    store.acknowledgeDelivery('session:s1', 1);
    const first = (store as unknown as { client: FakeListenerClient }).client;
    first.disconnect();
    await (store as unknown as { openListener(): Promise<void> }).openListener();
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2));
    expect(received.mock.calls.map(([record]) => record.event.sequence)).toEqual([2, 3]);
    await store.stop();
  });

  it('orders catch-up before a realtime notification arriving during reconnect', async () => {
    const first = new FakeListenerClient();
    const second = new FakeListenerClient();
    let resolveCatchUp!: (rows: unknown[]) => void;
    let catchups = 0;
    const query = vi.fn((sql: string, values?: unknown[]) => {
      if (sql.includes('retained.first_position')) {
        catchups += 1;
        return new Promise<unknown[]>((resolve) => (resolveCatchUp = resolve));
      }
      if (sql.includes('where event_id = $1')) {
        return Promise.resolve([{
          stream_key: 'session:s1',
          publisher_instance_id: '00000000-0000-4000-8000-000000000099',
          wire_payload: storedEvent(String(values?.[0]), 4),
        }]);
      }
      return Promise.resolve([]);
    });
    const received = vi.fn(async () => true);
    const clients = [first, second];
    const store = new TypeOrmWsV1EventStore(
      { query } as unknown as DataSource,
      'postgres://unused',
      1,
      () => clients.shift()!,
    );
    await store.start(received, () => [
      { streamKey: 'session:s1', channel: 'session:s1' },
    ]);
    store.acknowledgeDelivery('session:s1', 1);
    first.disconnect();
    const reconnecting = (store as unknown as { openListener(): Promise<void> }).openListener();
    await vi.waitFor(() => expect(catchups).toBe(1));
    second.notify('00000000-0000-4000-8000-000000000004');
    resolveCatchUp([2, 3].map((sequence) => ({
      last_position: '3',
      first_position: '1',
      wire_payload: storedEvent(`00000000-0000-4000-8000-00000000000${sequence}`, sequence),
    })));
    await reconnecting;
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(3));
    expect(received.mock.calls.map(([record]) => record.event.sequence)).toEqual([2, 3, 4]);
    await store.stop();
  });

  it('deduplicates repeated notifications by stream position', async () => {
    const client = new FakeListenerClient();
    const event = storedEvent('00000000-0000-4000-8000-000000000002', 2);
    const query = vi.fn(async (sql: string) =>
      sql.includes('where event_id = $1')
        ? [{ stream_key: 'session:s1', publisher_instance_id: randomPublisher, wire_payload: event }]
        : [],
    );
    const received = vi.fn(async () => true);
    const store = new TypeOrmWsV1EventStore(
      { query } as unknown as DataSource,
      'postgres://unused',
      1,
      () => client,
    );
    await store.start(received);
    store.acknowledgeDelivery('session:s1', 1);
    client.notify(event.event_id);
    client.notify(event.event_id);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
    await store.stop();
  });

  it('emits one recovery_required when the watermark predates retention', async () => {
    const clients = [new FakeListenerClient(), new FakeListenerClient()];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('retained.first_position')) {
        return [{ last_position: '5', first_position: '4', wire_payload: storedEvent('00000000-0000-4000-8000-000000000004', 4) }];
      }
      if (sql.includes('select last_position::text')) return [{ last_position: '5' }];
      return [];
    });
    const received = vi.fn(async () => true);
    const store = new TypeOrmWsV1EventStore(
      { query } as unknown as DataSource,
      'postgres://unused',
      1,
      () => clients.shift()!,
    );
    await store.start(received, () => [
      { streamKey: 'session:s1', channel: 'session:s1' },
    ]);
    store.acknowledgeDelivery('session:s1', 1);
    const active = (store as unknown as { client: FakeListenerClient }).client;
    active.disconnect();
    await (store as unknown as { openListener(): Promise<void> }).openListener();
    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
    expect(received.mock.calls[0]?.[0].event).toMatchObject({
      sequence: 5,
      event_type: 'recovery_required',
    });
    await store.stop();
  });
});

const randomPublisher = '00000000-0000-4000-8000-000000000099';
