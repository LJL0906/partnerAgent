import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { WsV1EventRetentionWorker } from './ws-v1-event-retention.worker.js';

describe('WsV1EventRetentionWorker', () => {
  it('deletes one bounded SKIP LOCKED batch without deleting stream watermarks', async () => {
    const query = vi.fn(async () => [{ event_id: 'event-1' }, { event_id: 'event-2' }]);
    const worker = new WsV1EventRetentionWorker(
      { query } as unknown as DataSource,
      { count: 25, ageMs: 60_000, batchSize: 2, intervalMs: 1_000 },
    );

    await expect(worker.runOnce(new Date('2026-09-05T00:00:00Z'))).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('for update of event skip locked'),
      [new Date('2026-09-04T23:59:00Z'), 25, 2],
    );
    expect(query.mock.calls[0]?.[0]).not.toContain('delete from ws_v1_event_streams');
  });

  it('isolates cleanup failures from the runtime', async () => {
    const worker = new WsV1EventRetentionWorker(
      { query: vi.fn(async () => { throw new Error('database unavailable'); }) } as unknown as DataSource,
      { count: 100, ageMs: 60_000, batchSize: 10, intervalMs: 1_000 },
    );
    await expect(worker.runOnce()).resolves.toBe(0);
  });
});
