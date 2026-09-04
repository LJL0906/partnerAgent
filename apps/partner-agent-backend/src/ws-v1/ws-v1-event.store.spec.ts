import { describe, expect, it } from 'vitest';
import { MemoryWsV1EventStore } from './ws-v1-event.store.js';

describe('MemoryWsV1EventStore', () => {
  it('keeps independent ordered streams and replays after a known event id', async () => {
    const store = new MemoryWsV1EventStore();
    const first = await store.append(
      { channel: 'user:self', event_type: 'summary', data: { index: 1 } },
      'user:self:owner-a',
    );
    const second = await store.append(
      { channel: 'user:self', event_type: 'summary', data: { index: 2 } },
      'user:self:owner-a',
    );
    const other = await store.append(
      { channel: 'user:self', event_type: 'summary', data: { index: 1 } },
      'user:self:owner-b',
    );

    await expect(
      store.replayAfter(
        'user:self',
        first.event.event_id,
        'user:self:owner-a',
      ),
    ).resolves.toEqual({
      replayable: true,
      events: [second.event],
      latestPosition: 2,
    });
    expect(first.event.sequence).toBe(1);
    expect(second.event.sequence).toBe(2);
    expect(other.event.sequence).toBe(1);
  });

  it('requires REST recovery after the cursor leaves the retention window', async () => {
    const store = new MemoryWsV1EventStore();
    const expired = await store.append({
      channel: 'session:s1',
      event_type: 'text_delta',
      data: 'expired',
    });
    for (let index = 0; index < 100; index += 1) {
      await store.append({
        channel: 'session:s1',
        event_type: 'text_delta',
        data: index,
      });
    }

    await expect(
      store.replayAfter('session:s1', expired.event.event_id),
    ).resolves.toEqual({ replayable: false, events: [], latestPosition: 101 });
    await expect(
      store.createRecoveryRequired('session:s1'),
    ).resolves.toMatchObject({
      channel: 'session:s1',
      sequence: 101,
      event_type: 'recovery_required',
      data: { reason: 'event_expired' },
    });
  });
});
