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
    const managerQuery = vi.fn().mockResolvedValueOnce([]);
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
    ).resolves.toEqual({ replayable: false, events: [] });
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
    ).resolves.toEqual({ replayable: false, events: [] });
    expect(transaction).not.toHaveBeenCalled();
  });
});
