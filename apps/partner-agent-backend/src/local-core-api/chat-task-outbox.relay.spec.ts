import { describe, expect, it, vi } from 'vitest';
import { ChatTaskEventBus } from './chat-task-event.bus.js';
import type { ChatTaskStore } from './chat-task.store.js';
import { ChatTaskOutboxRelay } from './chat-task-outbox.relay.js';

const event = {
  eventId: '00000000-0000-4000-8000-000000000001',
  eventKey: 'chat-task:t1:event-1',
  ownerId: 'owner',
  taskId: '00000000-0000-4000-8000-000000000002',
  operationId: 'operation-1',
  sessionId: 'session-1',
  state: 'completed' as const,
  data: {},
  attemptCount: 1,
  leaseOwner: '00000000-0000-4000-8000-000000000003',
  leaseToken: '1',
};

function fixture() {
  const outbox = {
    claim: vi.fn(async () => [event]),
    acknowledge: vi.fn(async () => true),
    fail: vi.fn(async () => true),
  };
  const tasks = { lifecycleOutbox: outbox } as unknown as ChatTaskStore;
  const events = new ChatTaskEventBus();
  return { outbox, events, relay: new ChatTaskOutboxRelay(tasks, events) };
}

describe('ChatTaskOutboxRelay', () => {
  it('relays a committed lifecycle event before acknowledging it', async () => {
    const { outbox, events, relay } = fixture();
    const order: string[] = [];
    events.subscribe(async (published) => {
      order.push(`publish:${published.eventKey}`);
    });
    outbox.acknowledge.mockImplementationOnce(async () => {
      order.push('ack');
      return true;
    });

    await expect(relay.runOnce()).resolves.toBe(1);
    expect(order).toEqual([`publish:${event.eventKey}`, 'ack']);
  });

  it('reuses the stable event key when publication succeeded but acknowledgement crashed', async () => {
    const { outbox, events, relay } = fixture();
    const keys: string[] = [];
    events.subscribe(async (published) => void keys.push(published.eventKey!));
    outbox.acknowledge
      .mockRejectedValueOnce(new Error('crash before ack'))
      .mockResolvedValueOnce(true);

    await expect(relay.runOnce()).resolves.toBe(0);
    await expect(relay.runOnce()).resolves.toBe(1);
    expect(keys).toEqual([event.eventKey, event.eventKey]);
    expect(outbox.fail).toHaveBeenCalledOnce();
  });

  it('does not overlap two relay loops in one instance', async () => {
    const { outbox, events, relay } = fixture();
    let release!: () => void;
    events.subscribe(() => new Promise<void>((resolve) => (release = resolve)));
    const first = relay.runOnce();
    await vi.waitFor(() => expect(outbox.claim).toHaveBeenCalledOnce());
    await expect(relay.runOnce()).resolves.toBe(0);
    release();
    await expect(first).resolves.toBe(1);
  });

  it('records a poison event failure at its maximum attempt', async () => {
    const { outbox, events, relay } = fixture();
    outbox.claim
      .mockResolvedValueOnce([{ ...event, attemptCount: 8 }])
      .mockResolvedValueOnce([]);
    events.subscribe(async () => { throw new Error('poison'); });

    await expect(relay.runOnce()).resolves.toBe(0);
    await expect(relay.runOnce()).resolves.toBe(0);
    expect(outbox.fail).toHaveBeenCalledOnce();
    expect(outbox.claim).toHaveBeenCalledTimes(2);
  });
});
