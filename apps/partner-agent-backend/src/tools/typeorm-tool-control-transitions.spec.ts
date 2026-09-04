import { describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';
import { claimConfirmationWithOutbox } from './typeorm-tool-control-transitions.js';

const confirmation = {
  id: '10000000-0000-4000-8000-000000000001',
  ownerId: 'owner',
  sessionId: 'session',
  taskId: '20000000-0000-4000-8000-000000000001',
  operationId: 'operation',
  toolName: 'external-tool',
  toolCallId: 'call-1',
  status: 'pending',
};

function harness() {
  const record = { ...confirmation };
  const getOne = vi.fn(async () => record);
  const queryBuilder = {
    setLock: vi.fn(() => queryBuilder),
    where: vi.fn(() => queryBuilder),
    getOne,
  };
  const repository = {
    createQueryBuilder: vi.fn(() => queryBuilder),
    save: vi.fn(async () => record),
  };
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) =>
    sql.includes('max(sequence_no)') ? [{ next_sequence: 0 }] : [],
  );
  const manager = {
    getRepository: vi.fn(() => repository),
    query,
  } as unknown as EntityManager;
  const dataSource = {
    transaction: (run: (value: EntityManager) => Promise<unknown>) =>
      run(manager),
  } as DataSource;
  return { dataSource, query, record };
}

describe('claimConfirmationWithOutbox', () => {
  it('does not emit confirmed or execution-start events for a dismissal', async () => {
    const fixture = harness();

    await expect(
      claimConfirmationWithOutbox(
        fixture.dataSource,
        confirmation.id,
        'dismiss',
      ),
    ).resolves.toBe(true);

    expect(fixture.record.status).toBe('executing');
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it('emits confirmed and execution-start events for a confirmation', async () => {
    const fixture = harness();

    await expect(
      claimConfirmationWithOutbox(
        fixture.dataSource,
        confirmation.id,
        'confirm',
      ),
    ).resolves.toBe(true);

    expect(fixture.query).toHaveBeenCalledTimes(4);
    expect(
      fixture.query.mock.calls
        .map((call) => call[1]?.[6])
        .filter(Boolean),
    ).toEqual(['tool_confirmation_confirmed', 'tool_execution_start']);
  });
});
