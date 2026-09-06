import { DataType, newDb } from 'pg-mem';
import type { DataSource, QueryRunner } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isServerPushEventV1,
  type ServerPushEventV1,
} from '@partner-agent/contracts';
import { ChatTaskEventBus } from '../local-core-api/chat-task-event.bus.js';
import type { ClaimedChatTaskLifecycleEvent } from '../local-core-api/chat-task-lifecycle-outbox.js';
import { ChatTaskOutboxRelay } from '../local-core-api/chat-task-outbox.relay.js';
import type { ChatTaskStore } from '../local-core-api/chat-task.store.js';
import { RedactionService } from '../tools/redaction.service.js';
import type { WsV1ChannelAuthorizer } from '../ws-v1/ws-v1-channel-authorizer.js';
import { MemoryWsV1EventStore } from '../ws-v1/ws-v1-event.store.js';
import { WsV1Service } from '../ws-v1/ws-v1.service.js';
import { AddChatTaskRevision1788521000000 } from './migrations/1788521000000-add-chat-task-revision.js';

const taskId = '10000000-0000-4000-8000-000000000001';
const deliveredOnlyTaskId = '10000000-0000-4000-8000-000000000002';
const operationId = '00000000-0000-4000-8000-000000000010';

describe('AddChatTaskRevision1788521000000 legacy outbox upgrade', () => {
  let dataSource: DataSource | undefined;

  afterEach(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('migrates pending legacy lifecycle rows into valid ordered WS events and reverses the payload backfill', async () => {
    const database = newDb();
    database.public.registerFunction({
      name: 'version',
      returns: DataType.text,
      implementation: () => 'PostgreSQL 16.0',
    });
    database.public.registerFunction({
      name: 'current_database',
      returns: DataType.text,
      implementation: () => 'partner_agent_test',
    });
    dataSource = database.adapters.createTypeormDataSource({
      type: 'postgres',
    });
    await dataSource.initialize();
    await createLegacySchema(dataSource);
    await seedLegacyRows(dataSource);

    const migration = new AddChatTaskRevision1788521000000();
    await migration.up({
      query: (...args) => dataSource!.query(...args),
    } as QueryRunner);

    const tasks = (await dataSource.query(
      'select id, revision from chat_tasks order by id',
    )) as Array<{ id: string; revision: number }>;
    expect(tasks).toEqual([
      { id: taskId, revision: 3 },
      { id: deliveredOnlyTaskId, revision: 1 },
    ]);

    const rows = (await dataSource.query(
      `select * from chat_task_lifecycle_outbox
       where task_id = $1 order by created_at, event_id`,
      [taskId],
    )) as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.event_data)).toEqual([
      { legacy: 'delivered' },
      { legacy: 'running', revision: 2 },
      { code: 'INTERNAL_000', message: 'failed safely', revision: 3 },
    ]);
    await expect(
      dataSource.query(
        `select event_data from chat_task_lifecycle_outbox
       where task_id = $1`,
        [deliveredOnlyTaskId],
      ),
    ).resolves.toEqual([{ event_data: { legacy: 'delivered-only' } }]);

    const events = await relayRows(rows.slice(1).map(toClaimedEvent));
    expect(
      events.map((event) => ({
        event_type: event.event_type,
        item_revision: event.item_revision,
        valid: isServerPushEventV1(event),
      })),
    ).toEqual([
      { event_type: 'task_state', item_revision: 2, valid: true },
      { event_type: 'error', item_revision: 3, valid: true },
    ]);

    await dataSource.query(
      'update chat_task_lifecycle_outbox set delivered_at = now() where event_id = $1',
      [rows[1]!.event_id],
    );
    await migration.down({
      query: (...args) => dataSource!.query(...args),
    } as QueryRunner);

    const restored = (await dataSource.query(
      `select event_data from chat_task_lifecycle_outbox
       where task_id = $1 order by created_at, event_id`,
      [taskId],
    )) as Array<{ event_data: Record<string, unknown> }>;
    expect(restored.map((row) => row.event_data)).toEqual([
      { legacy: 'delivered' },
      { legacy: 'running' },
      { code: 'INTERNAL_000', message: 'failed safely' },
    ]);
  });
});

async function createLegacySchema(dataSource: DataSource): Promise<void> {
  await dataSource.query(`
    create table chat_tasks (
      owner_id text not null,
      id uuid not null,
      primary key (owner_id, id)
    )
  `);
  await dataSource.query(`
    create table chat_task_lifecycle_outbox (
      event_id uuid primary key,
      event_key text not null unique,
      owner_id text not null,
      task_id uuid not null,
      operation_id text not null,
      session_id text not null,
      state text not null,
      event_data jsonb not null default '{}'::jsonb,
      attempt_count integer not null default 0,
      available_at timestamptz not null,
      lease_owner uuid null,
      lease_token bigint not null default 0,
      lease_expires_at timestamptz null,
      delivered_at timestamptz null,
      last_error_code text null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `);
}

async function seedLegacyRows(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'insert into chat_tasks (owner_id, id) values ($1, $2), ($1, $3)',
    ['owner', taskId, deliveredOnlyTaskId],
  );
  const insert = `insert into chat_task_lifecycle_outbox
    (event_id, event_key, owner_id, task_id, operation_id, session_id, state,
     event_data, available_at, delivered_at, created_at, updated_at)
    values ($1, $2, 'owner', $3, $4, 'session-1', $5, $6::jsonb,
            '2026-09-06T00:00:00Z', $7, $8, $8)`;
  await dataSource.query(insert, [
    '20000000-0000-4000-8000-000000000001',
    `chat-task:${taskId}:20000000-0000-4000-8000-000000000001`,
    taskId,
    operationId,
    'queued',
    JSON.stringify({ legacy: 'delivered' }),
    '2026-09-06T00:00:01Z',
    '2026-09-06T00:00:01Z',
  ]);
  await dataSource.query(insert, [
    '20000000-0000-4000-8000-000000000002',
    `chat-task:${taskId}:20000000-0000-4000-8000-000000000002`,
    taskId,
    operationId,
    'running',
    JSON.stringify({ legacy: 'running' }),
    null,
    '2026-09-06T00:00:02Z',
  ]);
  await dataSource.query(insert, [
    '20000000-0000-4000-8000-000000000003',
    `chat-task:${taskId}:20000000-0000-4000-8000-000000000003`,
    taskId,
    operationId,
    'failed',
    JSON.stringify({ code: 'INTERNAL_000', message: 'failed safely' }),
    null,
    '2026-09-06T00:00:03Z',
  ]);
  await dataSource.query(insert, [
    '20000000-0000-4000-8000-000000000004',
    `chat-task:${deliveredOnlyTaskId}:20000000-0000-4000-8000-000000000004`,
    deliveredOnlyTaskId,
    operationId,
    'completed',
    JSON.stringify({ legacy: 'delivered-only' }),
    '2026-09-06T00:00:04Z',
    '2026-09-06T00:00:04Z',
  ]);
}

function toClaimedEvent(
  row: Record<string, unknown>,
): ClaimedChatTaskLifecycleEvent {
  const data = row.event_data as Record<string, unknown>;
  return {
    eventId: String(row.event_id),
    eventKey: String(row.event_key),
    ownerId: String(row.owner_id),
    taskId: String(row.task_id),
    operationId: String(row.operation_id),
    sessionId: String(row.session_id),
    state: String(row.state) as ClaimedChatTaskLifecycleEvent['state'],
    revision: Number(data.revision),
    data,
    attemptCount: 1,
    leaseOwner: 'relay-1',
    leaseToken: '1',
  };
}

async function relayRows(
  rows: ClaimedChatTaskLifecycleEvent[],
): Promise<ServerPushEventV1[]> {
  const outbox = {
    claim: vi.fn(async () => rows),
    acknowledge: vi.fn(async () => true),
    fail: vi.fn(async () => true),
  };
  const bus = new ChatTaskEventBus();
  const store = new MemoryWsV1EventStore();
  const append = vi.spyOn(store, 'append');
  const service = new WsV1Service(
    {
      canSubscribe: vi.fn(async () => true),
    } as unknown as WsV1ChannelAuthorizer,
    store,
    new RedactionService(),
    bus,
  );
  const relay = new ChatTaskOutboxRelay(
    { lifecycleOutbox: outbox } as unknown as ChatTaskStore,
    bus,
  );
  await service.onModuleInit();
  try {
    await expect(relay.runOnce()).resolves.toBe(rows.length);
    const indexes = append.mock.calls
      .map(([input], index) => ({ input, index }))
      .filter(({ input }) => input.channel === 'session:session-1')
      .map(({ index }) => index);
    return Promise.all(
      indexes.map(
        async (index) => (await append.mock.results[index]!.value).event,
      ),
    );
  } finally {
    await service.onModuleDestroy();
  }
}
