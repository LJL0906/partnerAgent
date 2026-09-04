import { describe, expect, it, vi } from 'vitest';
import type { ToolOperationStore } from './tool-operation.store.js';
import type { WsV1EventStore } from '../ws-v1/ws-v1-event.store.js';
import type { RedactionService } from './redaction.service.js';
import { ToolControlOutboxRelay } from './tool-control-outbox.relay.js';

describe('ToolControlOutboxRelay', () => {
  it('publishes each channel idempotently before acknowledging', async () => {
    const event = {
      eventId: '10000000-0000-4000-8000-000000000001',
      eventKey: 'tool-control:confirmation:dismissed',
      ownerId: 'owner',
      sessionId: 'session',
      taskId: '20000000-0000-4000-8000-000000000001',
      operationId: 'operation',
      eventType: 'tool_confirmation_dismissed' as const,
      data: { reason: 'user_dismissed' },
      attemptCount: 1,
      leaseOwner: '30000000-0000-4000-8000-000000000001',
      leaseToken: '1',
    };
    const outbox = {
      claim: vi.fn(async () => [event]),
      acknowledge: vi.fn(async () => true),
      fail: vi.fn(async () => true),
    };
    const append = vi.fn(async (input, streamKey) => ({
      event: {
        event_id: input.idempotency_key,
        sequence: 1,
        occurred_at: Date.now(),
        ...input,
      },
      streamKey,
      streamPosition: 1,
    }));
    const dispatchStored = vi.fn(async () => undefined);
    const relay = new ToolControlOutboxRelay(
      { controlOutbox: outbox } as unknown as ToolOperationStore,
      { append, dispatchStored } as unknown as WsV1EventStore,
      { sanitize: (value: unknown) => value } as RedactionService,
    );

    await expect(relay.runOnce()).resolves.toBe(1);
    expect(append).toHaveBeenCalledTimes(3);
    expect(append.mock.calls.map((call) => call[0].idempotency_key)).toEqual([
      `${event.eventKey}:session:${event.sessionId}`,
      `${event.eventKey}:task:${event.taskId}`,
      `${event.eventKey}:operation:${event.operationId}`,
    ]);
    expect(outbox.acknowledge).toHaveBeenCalledWith(event);
    expect(outbox.fail).not.toHaveBeenCalled();
  });
});
