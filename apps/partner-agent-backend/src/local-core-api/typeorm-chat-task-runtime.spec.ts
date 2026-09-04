import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { TypeOrmChatTaskRuntime } from './typeorm-chat-task-runtime.js';

describe('TypeOrmChatTaskRuntime runnable depth', () => {
  it('uses the authoritative runnable predicate with a bounded query', async () => {
    const query = vi.fn(async () => [{ count: '7' }]);
    const runtime = new TypeOrmChatTaskRuntime(
      { query } as unknown as DataSource,
      vi.fn(),
    );

    await expect(runtime.countRunnable(250)).resolves.toBe(7);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("active.state in"),
      [250],
    );
    expect(query.mock.calls[0]?.[0]).toContain('limit $1');
  });
});
