import {
  chatItemIds,
  isServerPushEventV1,
  type ServerPushEventV1,
} from '@partner-agent/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ChatTaskEventBus } from '../local-core-api/chat-task-event.bus.js';
import { ChatTaskOutboxRelay } from '../local-core-api/chat-task-outbox.relay.js';
import type { ChatTaskStore } from '../local-core-api/chat-task.store.js';
import { RedactionService } from '../tools/redaction.service.js';
import type { WsV1ChannelAuthorizer } from './ws-v1-channel-authorizer.js';
import { MemoryWsV1EventStore } from './ws-v1-event.store.js';
import { WsV1Service } from './ws-v1.service.js';

const operationId = '00000000-0000-4000-8000-000000000010';

async function relayLifecycle(
  state: 'running' | 'failed',
  revision: number,
): Promise<ServerPushEventV1> {
  const lifecycleEvent = {
    eventId: `00000000-0000-4000-8000-${String(revision).padStart(12, '0')}`,
    eventKey: `chat-task:task-1:revision:${revision}`,
    ownerId: 'owner', taskId: 'task-1', operationId, sessionId: 'session-1',
    state,
    revision,
    data: state === 'failed'
      ? { revision, code: 'INTERNAL_000', message: 'failed safely' }
      : { revision },
    attemptCount: 1, leaseOwner: 'relay-1', leaseToken: '1',
  };
  const outbox = {
    claim: vi.fn(async () => [lifecycleEvent]),
    acknowledge: vi.fn(async () => true),
    fail: vi.fn(async () => true),
  };
  const events = new ChatTaskEventBus();
  const relay = new ChatTaskOutboxRelay(
    { lifecycleOutbox: outbox } as unknown as ChatTaskStore,
    events,
  );
  const store = new MemoryWsV1EventStore();
  const append = vi.spyOn(store, 'append');
  const service = new WsV1Service(
    { canSubscribe: vi.fn(async () => true) } as unknown as WsV1ChannelAuthorizer,
    store,
    new RedactionService(),
    events,
  );
  await service.onModuleInit();
  try {
    await expect(relay.runOnce()).resolves.toBe(1);
    const sessionCallIndex = append.mock.calls.findIndex(
      ([input]) => input.channel === 'session:session-1',
    );
    expect(sessionCallIndex).toBeGreaterThanOrEqual(0);
    return (await append.mock.results[sessionCallIndex]!.value).event;
  } finally {
    await service.onModuleDestroy();
  }
}

async function relayAgentEvent(input: {
  eventType: 'thinking_delta' | 'text_delta';
  itemId: string;
  itemRevision: number;
  textOffset: number;
  messageId?: string;
}): Promise<ServerPushEventV1> {
  const events = new ChatTaskEventBus();
  const store = new MemoryWsV1EventStore();
  const append = vi.spyOn(store, 'append');
  const service = new WsV1Service(
    { canSubscribe: vi.fn(async () => true) } as unknown as WsV1ChannelAuthorizer,
    store,
    new RedactionService(),
    events,
  );
  await service.onModuleInit();
  events.publish({
    ownerId: 'owner', taskId: 'task-1', operationId, sessionId: 'session-1',
    state: 'running', type: 'agent_event', data: '增量', ...input,
  });
  await service.onModuleDestroy();
  const callIndex = append.mock.calls.findIndex(
    ([event]) => event.channel === 'session:session-1',
  );
  expect(callIndex).toBeGreaterThanOrEqual(0);
  return (await append.mock.results[callIndex]!.value).event;
}

describe('ChatTask lifecycle WS revision', () => {
  it('publishes a valid task_state event with the runtime item revision', async () => {
    const event = await relayLifecycle('running', 4);

    expect(event).toMatchObject({
      event_type: 'task_state',
      item_id: chatItemIds.taskRuntime('task-1'),
      item_revision: 4,
    });
    expect(isServerPushEventV1(event)).toBe(true);
  });

  it('publishes a valid failure event with the stable error item revision', async () => {
    const event = await relayLifecycle('failed', 5);

    expect(event).toMatchObject({
      event_type: 'error',
      item_id: 'task:task-1:error',
      item_revision: 5,
    });
    expect(isServerPushEventV1(event)).toBe(true);
  });

  it('publishes a valid thinking delta with its stable item and text offset', async () => {
    const event = await relayAgentEvent({
      eventType: 'thinking_delta',
      itemId: chatItemIds.taskThinking('task-1'),
      itemRevision: 2,
      textOffset: 3,
    });

    expect(event).toMatchObject({
      event_type: 'thinking_delta',
      item_id: chatItemIds.taskThinking('task-1'),
      item_revision: 2,
      text_offset: 3,
    });
    expect(isServerPushEventV1(event)).toBe(true);
  });

  it('publishes a valid text delta with its stable message identity and offset', async () => {
    const event = await relayAgentEvent({
      eventType: 'text_delta',
      itemId: chatItemIds.taskAssistant('task-1'),
      itemRevision: 2,
      messageId: 'message-1',
      textOffset: 3,
    });

    expect(event).toMatchObject({
      event_type: 'text_delta',
      item_id: chatItemIds.taskAssistant('task-1'),
      item_revision: 2,
      message_id: 'message-1',
      text_offset: 3,
    });
    expect(isServerPushEventV1(event)).toBe(true);
  });
});
