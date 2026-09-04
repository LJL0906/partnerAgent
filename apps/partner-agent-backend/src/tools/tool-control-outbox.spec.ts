import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { ToolControlOutboxWriter } from './tool-control-outbox.js';

describe('ToolControlOutboxWriter', () => {
  it('writes only safe event metadata with stable event keys', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('max(sequence_no)') ? [{ next_sequence: 7 }] : [],
    );
    await ToolControlOutboxWriter.append(
      { query } as unknown as EntityManager,
      {
        id: '10000000-0000-4000-8000-000000000001',
        ownerId: 'owner',
        sessionId: 'session',
        taskId: '20000000-0000-4000-8000-000000000001',
        operationId: 'operation',
      },
      [
        {
          key: 'confirmation-dismissed',
          type: 'tool_confirmation_dismissed',
          data: { confirmation_id: 'safe-id', reason: 'user_dismissed' },
        },
      ],
    );

    expect(query).toHaveBeenCalledTimes(3);
    const parameters = query.mock.calls[2]?.[1] as unknown[];
    expect(parameters).toContain(
      'tool-control:10000000-0000-4000-8000-000000000001:confirmation-dismissed',
    );
    expect(JSON.stringify(parameters)).not.toContain('arguments');
    expect(parameters).toContain(7);
  });

  it('does not create durable events for legacy confirmations without a task', async () => {
    const query = vi.fn();
    await ToolControlOutboxWriter.append(
      { query } as unknown as EntityManager,
      { id: 'id', ownerId: 'owner', sessionId: 'session' },
      [
        {
          key: 'confirmation-dismissed',
          type: 'tool_confirmation_dismissed',
          data: {},
        },
      ],
    );
    expect(query).not.toHaveBeenCalled();
  });
});
