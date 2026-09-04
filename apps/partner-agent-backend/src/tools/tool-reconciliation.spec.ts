import { describe, expect, it } from 'vitest';
import { MemoryToolOperationStore } from './memory-tool-operation.store.js';
import {
  ToolReconciliationError,
  buildToolReconciliationPhrase,
  type ReconcileIndeterminateToolInput,
  type ToolConfirmationRecord,
} from './tool-operation.store.js';
import { ToolReconciliationService } from './tool-reconciliation.service.js';

function confirmation(
  overrides: Partial<ToolConfirmationRecord> = {},
): ToolConfirmationRecord {
  const now = new Date('2026-09-05T00:00:00.000Z');
  return {
    id: '10000000-0000-4000-8000-000000000001',
    ownerId: 'owner-a',
    sessionId: 'session-a',
    taskId: '20000000-0000-4000-8000-000000000001',
    operationId: 'operation-a',
    toolCallId: 'tool-call-a',
    toolName: 'external_write',
    riskLevel: 'high',
    status: 'executing',
    arguments: { secret: 'must-never-be-listed' },
    requestSummary: '{"secret":"[已脱敏]"}',
    version: 1,
    createdAt: new Date(now.getTime() - 120_000),
    expiresAt: new Date(now.getTime() - 60_000),
    ...overrides,
  };
}

function command(
  overrides: Partial<ReconcileIndeterminateToolInput> = {},
): ReconcileIndeterminateToolInput {
  const input = {
    confirmationId: '10000000-0000-4000-8000-000000000001',
    ownerId: 'owner-a',
    expectedVersion: 1,
    expectedStatus: 'indeterminate' as const,
    outcome: 'verified_not_applied' as const,
    operatorLabel: 'local-operator',
    confirmationPhrase: '',
    ...overrides,
  };
  return {
    ...input,
    confirmationPhrase:
      overrides.confirmationPhrase ?? buildToolReconciliationPhrase(input),
  };
}

async function createPending() {
  const store = new MemoryToolOperationStore();
  await store.saveConfirmation(confirmation());
  await store.reconcileStaleConfirmations(
    new Date('2026-09-05T00:00:00.000Z'),
    10,
  );
  return { store, service: new ToolReconciliationService(store) };
}

describe('tool reconciliation service', () => {
  it('lists only owner-scoped, redacted snapshots', async () => {
    const { service } = await createPending();

    const records = await service.list('owner-a');

    expect(records).toEqual([
      expect.objectContaining({
        confirmationId: '10000000-0000-4000-8000-000000000001',
        ownerId: 'owner-a',
        currentVersion: 1,
        currentStatus: 'indeterminate',
        snapshot: expect.objectContaining({
          requestSummary: '{"secret":"[已脱敏]"}',
        }),
      }),
    ]);
    expect(JSON.stringify(records)).not.toContain('must-never-be-listed');
    await expect(service.list('owner-b')).resolves.toEqual([]);
  });

  it('atomically accepts one fixed conclusion and idempotently replays it', async () => {
    const { store, service } = await createPending();
    const input = command();

    const [first, second] = await Promise.all([
      service.reconcile(input),
      service.reconcile(input),
    ]);

    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.audit.outcome).toBe('verified_not_applied');
    expect(first.audit.confirmationVersionAfter).toBe(2);
    await expect(service.list('owner-a')).resolves.toEqual([]);
    await expect(
      store.findConfirmation(input.confirmationId),
    ).resolves.toMatchObject({
      status: 'indeterminate',
      version: 2,
    });
  });

  it('fails closed for conflicting repeats, stale state/version and cross-owner calls', async () => {
    const { service } = await createPending();
    await service.reconcile(command());

    await expect(
      service.reconcile(command({ outcome: 'abandoned' })),
    ).rejects.toThrow('核对记录已由其他结论处理');
    const second = await createPending();
    await expect(
      second.service.reconcile(command({ expectedVersion: 2 })),
    ).rejects.toThrow('核对记录版本已变化');
    await expect(
      second.service.reconcile(command({ ownerId: 'owner-b' })),
    ).rejects.toThrow('核对记录不存在');

    const pendingStore = new MemoryToolOperationStore();
    await pendingStore.saveConfirmation(confirmation({ status: 'pending' }));
    await expect(
      new ToolReconciliationService(pendingStore).reconcile(command()),
    ).rejects.toThrow('核对记录状态已变化');
  });

  it('requires the exact phrase and a matching persisted safe snapshot', async () => {
    const { service } = await createPending();
    await expect(
      service.reconcile(command({ confirmationPhrase: 'yes' })),
    ).rejects.toThrow('显式确认短语不匹配');

    const store = new MemoryToolOperationStore();
    await store.saveConfirmation(
      confirmation({
        status: 'indeterminate',
        reconciliationSnapshot: undefined,
      }),
    );
    await expect(
      new ToolReconciliationService(store).reconcile(command()),
    ).rejects.toThrow('核对安全快照缺失或不匹配');
  });

  it('does not mutate the operation if the atomic audit write fails', async () => {
    const { store } = await createPending();
    class AuditFailureStore extends MemoryToolOperationStore {
      override async reconcileIndeterminateConfirmation(): Promise<never> {
        throw new ToolReconciliationError('核对审计写入失败');
      }
    }
    const failingStore = new AuditFailureStore();
    const persisted = await store.findConfirmation(
      '10000000-0000-4000-8000-000000000001',
    );
    await failingStore.saveConfirmation(persisted!);
    const service = new ToolReconciliationService(failingStore);

    await expect(service.reconcile(command())).rejects.toThrow(
      '核对审计写入失败',
    );
    await expect(
      failingStore.findConfirmation(command().confirmationId),
    ).resolves.toMatchObject({ status: 'indeterminate', version: 1 });
  });
});
