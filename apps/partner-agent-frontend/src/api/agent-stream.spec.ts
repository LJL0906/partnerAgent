import type { ServerPushEventV1, SubscriptionAckV1 } from '@partner-agent/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  subscribeAgentStream,
  SubscriptionRejectedError,
  type AgentStreamConnection,
} from './agent-stream';

const mocks = vi.hoisted(() => ({
  socket: undefined as FakeSocket | undefined,
  uuid: 0,
}));

vi.mock('expo-crypto', () => ({
  randomUUID: () => `request-${++mocks.uuid}`,
}));
vi.mock('./access-token', () => ({ requireAccessToken: vi.fn(async () => 'token') }));
vi.mock('./config', () => ({
  apiConfig: { serverUrl: 'http://example.test', streamNamespace: '/ws/v1' },
}));
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mocks.socket),
}));

type Handler = (value?: unknown) => void;

class FakeSocket {
  connected = false;
  readonly sent: { event: string; payload: Record<string, unknown> }[] = [];
  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): this {
    const handlers = this.handlers.get(event) ?? new Set<Handler>();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  emit(event: string, payload: Record<string, unknown>): this {
    this.sent.push({ event, payload });
    return this;
  }

  connect(): this {
    this.connected = true;
    this.serverEmit('connect');
    return this;
  }

  disconnect(): this {
    this.connected = false;
    return this;
  }

  removeAllListeners(): this {
    this.handlers.clear();
    return this;
  }

  serverEmit(event: string, value?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(value);
  }

  simulateDisconnect(): void {
    this.connected = false;
    this.serverEmit('disconnect');
  }

  simulateReconnect(): void {
    this.connected = true;
    this.serverEmit('connect');
  }

  lastRequest(event = 'subscribe'): Record<string, unknown> {
    const request = [...this.sent].reverse().find((entry) => entry.event === event);
    if (!request) throw new Error(`missing ${event} request`);
    return request.payload;
  }
}

describe('agent stream', () => {
  beforeEach(() => {
    mocks.socket = new FakeSocket();
    mocks.uuid = 0;
  });

  it('becomes ready only after the stable channel request is acknowledged', async () => {
    const statuses: string[] = [];
    let ready = false;
    const opening = subscribeAgentStream({
      channels: ['user:self', 'session:session-1'],
      onEvent: vi.fn(),
      onStatusChange: (status) => statuses.push(status),
    }).then((connection) => {
      ready = true;
      return connection;
    });
    await nextMicrotask();

    expect(ready).toBe(false);
    expect(statuses).toEqual(['connecting']);
    acknowledge(mocks.socket!, mocks.socket!.lastRequest(), [
      'user:self',
      'session:session-1',
    ]);

    const connection = await opening;
    expect(ready).toBe(true);
    expect(statuses).toEqual(['connecting', 'connected']);
    connection.close();
  });

  it('uses one socket and correlates incremental acknowledgements by request id', async () => {
    const connection = await openConnection();
    const taskPromise = connection.subscribe(['task:task-1']);
    const taskRequest = mocks.socket!.lastRequest();
    const operationPromise = connection.subscribe(['operation:operation-1']);
    const operationRequest = mocks.socket!.lastRequest();
    let taskSettled = false;
    void taskPromise.finally(() => {
      taskSettled = true;
    });

    acknowledge(mocks.socket!, operationRequest, ['operation:operation-1']);
    await expect(operationPromise).resolves.toMatchObject({
      request_id: operationRequest.request_id,
    });
    expect(taskSettled).toBe(false);
    acknowledge(mocks.socket!, taskRequest, ['task:task-1']);
    await expect(taskPromise).resolves.toMatchObject({ request_id: taskRequest.request_id });
    expect(mocks.socket!.sent.filter((entry) => entry.event === 'subscribe')).toHaveLength(3);
    connection.close();
  });

  it('setChannels emits only incremental subscribe and unsubscribe requests', async () => {
    const connection = await openConnection();
    const updating = connection.setChannels(['user:self', 'task:task-1']);
    const subscribeRequest = mocks.socket!.lastRequest('subscribe');
    const unsubscribeRequest = mocks.socket!.lastRequest('unsubscribe');
    expect(subscribeRequest.channels).toEqual(['task:task-1']);
    expect(unsubscribeRequest.channels).toEqual(['session:session-1']);

    acknowledge(mocks.socket!, unsubscribeRequest, ['session:session-1']);
    acknowledge(mocks.socket!, subscribeRequest, ['task:task-1']);
    await expect(updating).resolves.toMatchObject({
      subscribed: { accepted: ['task:task-1'] },
      unsubscribed: { accepted: ['session:session-1'] },
    });
    expect(connection.getChannels()).toEqual(['user:self', 'task:task-1']);
    connection.close();
  });

  it('reconnects the same socket with current channels and retained watermarks', async () => {
    const onEvent = vi.fn();
    const connection = await openConnection(onEvent);
    mocks.socket!.serverEmit('agent_event', event('event-1', 'session:session-1', 1));
    mocks.socket!.serverEmit('agent_event', {
      ...event('recovery-1', 'session:session-1', 2),
      event_type: 'recovery_required',
      data: { reason: 'event_expired' },
    } satisfies ServerPushEventV1);

    mocks.socket!.simulateDisconnect();
    mocks.socket!.simulateReconnect();
    const reconnectRequest = mocks.socket!.lastRequest();
    expect(reconnectRequest.channels).toEqual(['user:self', 'session:session-1']);
    expect(reconnectRequest.after).toEqual({ 'session:session-1': 'event-1' });
    acknowledge(mocks.socket!, reconnectRequest, ['user:self', 'session:session-1']);
    expect(onEvent).toHaveBeenCalledTimes(2);
    connection.close();
  });

  it('deduplicates event ids and delivers only the most specific acknowledged channel', async () => {
    const onEvent = vi.fn();
    const connection = await openConnection(onEvent);
    const taskSubscription = connection.subscribe(['task:task-1']);
    const taskRequest = mocks.socket!.lastRequest();

    // Before task ACK, the already-ACKed session remains canonical.
    mocks.socket!.serverEmit('agent_event', event('pre-task', 'task:task-1', 1));
    const preAckSession = event('pre-session', 'session:session-1', 1);
    mocks.socket!.serverEmit('agent_event', preAckSession);
    mocks.socket!.serverEmit('agent_event', preAckSession);
    acknowledge(mocks.socket!, taskRequest, ['task:task-1']);
    await taskSubscription;

    // After task ACK, copies on lower-priority session are ignored even though
    // the backend assigns a different event_id to every channel copy.
    mocks.socket!.serverEmit('agent_event', event('post-session', 'session:session-1', 2));
    mocks.socket!.serverEmit('agent_event', event('post-task', 'task:task-1', 2));

    expect(onEvent.mock.calls.map(([value]) => value.event_id)).toEqual([
      'pre-session',
      'post-task',
    ]);
    connection.close();
  });

  it('rejects a failed subscription explicitly and reports its correlated ACK', async () => {
    const onSubscriptionError = vi.fn();
    const connection = await openConnection(vi.fn(), onSubscriptionError);
    const subscribing = connection.subscribe(['task:forbidden']);
    const request = mocks.socket!.lastRequest();
    acknowledge(mocks.socket!, request, [], [
      { channel: 'task:forbidden', code: 'AUTH_002', message: '无权订阅' },
    ]);

    await expect(subscribing).rejects.toBeInstanceOf(SubscriptionRejectedError);
    expect(onSubscriptionError).toHaveBeenCalledOnce();
    expect(connection.getChannels()).not.toContain('task:forbidden');
    connection.close();
  });
});

async function openConnection(
  onEvent = vi.fn(),
  onSubscriptionError = vi.fn(),
): Promise<AgentStreamConnection> {
  const opening = subscribeAgentStream({
    channels: ['user:self', 'session:session-1'],
    onEvent,
    onSubscriptionError,
  });
  await nextMicrotask();
  acknowledge(mocks.socket!, mocks.socket!.lastRequest(), ['user:self', 'session:session-1']);
  return opening;
}

function acknowledge(
  socket: FakeSocket,
  request: Record<string, unknown>,
  accepted: SubscriptionAckV1['accepted'],
  rejected: SubscriptionAckV1['rejected'] = [],
): void {
  socket.serverEmit('subscription_ack', {
    request_id: String(request.request_id),
    accepted,
    rejected,
  } satisfies SubscriptionAckV1);
}

function event(
  eventId: string,
  channel: ServerPushEventV1['channel'],
  sequence: number,
): ServerPushEventV1 {
  return {
    schema_version: 1,
    event_id: eventId,
    channel,
    sequence,
    session_id: 'session-1',
    operation_id: 'operation-1',
    task_id: 'task-1',
    event_type: 'done',
    timestamp: sequence,
    data: {},
  };
}

async function nextMicrotask(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
