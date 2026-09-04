import { randomUUID } from 'node:crypto';
import {
  ToolOperationStore,
  ToolReconciliationError,
  assertToolReconciliationInput,
  type ExpiredToolConfirmationRecord,
  type ReconciledToolConfirmationRecord,
  type RecoverableToolConfirmationRecord,
  type ToolAuditRecord,
  type ToolConfirmationRecord,
  type ToolExecutionReceipt,
  type PendingToolReconciliation,
  type ReconcileIndeterminateToolInput,
  type ToolReconciliationAuditRecord,
  type ToolReconciliationResult,
} from './tool-operation.store.js';
import {
  createToolReconciliationSnapshot,
  pendingToolReconciliationFrom,
  requireToolReconciliationSnapshot,
} from './tool-reconciliation-snapshot.js';

export class MemoryToolOperationStore extends ToolOperationStore {
  private readonly confirmations = new Map<string, ToolConfirmationRecord>();
  private readonly audits: ToolAuditRecord[] = [];
  private readonly receipts = new Map<string, ToolExecutionReceipt>();
  private readonly reconciliationAudits = new Map<
    string,
    ToolReconciliationAuditRecord
  >();
  private readonly listedRecoveries = new Set<string>();
  private readonly listedReconciliations = new Set<string>();

  async saveConfirmation(record: ToolConfirmationRecord): Promise<void> {
    this.confirmations.set(record.id, structuredClone(record));
  }

  async findConfirmation(
    id: string,
  ): Promise<ToolConfirmationRecord | undefined> {
    const record = this.confirmations.get(id);
    return record ? structuredClone(record) : undefined;
  }

  async claimConfirmation(id: string): Promise<boolean> {
    const record = this.confirmations.get(id);
    if (!record || record.status !== 'pending') return false;
    record.status = 'executing';
    return true;
  }

  async updateConfirmation(
    id: string,
    updates: Partial<ToolConfirmationRecord>,
  ): Promise<void> {
    const record = this.confirmations.get(id);
    if (!record) throw new Error('确认请求不存在');
    Object.assign(record, structuredClone(updates));
  }

  async listRecoverableConfirmations(
    limit: number,
  ): Promise<RecoverableToolConfirmationRecord[]> {
    return [...this.confirmations.values()]
      .filter(
        (record): record is RecoverableToolConfirmationRecord =>
          (record.status === 'succeeded' || record.status === 'dismissed') &&
          Boolean(record.taskId && record.operationId && record.result) &&
          !this.listedRecoveries.has(record.id),
      )
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .slice(0, this.safeLimit(limit))
      .map((record) => {
        this.listedRecoveries.add(record.id);
        return structuredClone(record);
      });
  }

  async expirePendingConfirmations(
    now: Date,
    limit: number,
  ): Promise<ExpiredToolConfirmationRecord[]> {
    const expired = [...this.confirmations.values()]
      .filter(
        (record) =>
          record.status === 'pending' &&
          record.expiresAt.getTime() <= now.getTime() &&
          Boolean(record.taskId && record.operationId),
      )
      .sort(
        (left, right) => left.expiresAt.getTime() - right.expiresAt.getTime(),
      )
      .slice(0, this.safeLimit(limit));
    for (const record of expired) record.status = 'expired';
    return expired.map(
      (record) => structuredClone(record) as ExpiredToolConfirmationRecord,
    );
  }

  async reconcileStaleConfirmations(
    now: Date,
    limit: number,
  ): Promise<ReconciledToolConfirmationRecord[]> {
    const records = [...this.confirmations.values()]
      .filter(
        (record) =>
          Boolean(record.taskId && record.operationId) &&
          !this.listedReconciliations.has(record.id) &&
          (record.status === 'failed' ||
            record.status === 'expired' ||
            (record.status === 'executing' &&
              record.expiresAt.getTime() <= now.getTime())),
      )
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .slice(0, this.safeLimit(limit));
    const transitions = records
      .filter((record) => record.status === 'executing')
      .map((record) => ({
        record,
        snapshot: createToolReconciliationSnapshot(record, now),
        audit: {
          id: randomUUID(),
          ownerId: record.ownerId,
          sessionId: record.sessionId,
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          riskLevel: record.riskLevel,
          action: 'indeterminate',
          confirmationId: record.id,
          requestSummary: record.requestSummary,
          resultSummary: record.resultSummary,
          createdAt: now,
        } satisfies ToolAuditRecord,
      }));
    for (const { record, snapshot, audit } of transitions) {
      this.audits.push(audit);
      record.status = 'indeterminate';
      record.reconciliationSnapshot = snapshot;
    }
    return records.map((record) => {
      this.listedReconciliations.add(record.id);
      return structuredClone(record) as ReconciledToolConfirmationRecord;
    });
  }

  async listIndeterminateConfirmations(
    ownerId: string,
    limit: number,
  ): Promise<PendingToolReconciliation[]> {
    return [...this.confirmations.values()]
      .filter(
        (record) =>
          record.ownerId === ownerId &&
          record.status === 'indeterminate' &&
          !this.reconciliationAudits.has(record.id),
      )
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .slice(0, this.safeLimit(limit))
      .map((record) => pendingToolReconciliationFrom(record));
  }

  async reconcileIndeterminateConfirmation(
    input: ReconcileIndeterminateToolInput,
  ): Promise<ToolReconciliationResult> {
    assertToolReconciliationInput(input);
    const record = this.confirmations.get(input.confirmationId);
    if (!record || record.ownerId !== input.ownerId) {
      throw new ToolReconciliationError('核对记录不存在');
    }
    const existing = this.reconciliationAudits.get(record.id);
    if (existing) {
      if (
        existing.expectedVersion === input.expectedVersion &&
        existing.expectedStatus === input.expectedStatus &&
        existing.outcome === input.outcome &&
        existing.operatorLabel === input.operatorLabel.trim() &&
        existing.confirmationPhrase === input.confirmationPhrase
      ) {
        return { audit: structuredClone(existing), replayed: true };
      }
      throw new ToolReconciliationError('核对记录已由其他结论处理');
    }
    if (record.status !== input.expectedStatus) {
      throw new ToolReconciliationError('核对记录状态已变化');
    }
    const currentVersion = record.version ?? 1;
    if (currentVersion !== input.expectedVersion) {
      throw new ToolReconciliationError('核对记录版本已变化');
    }
    const snapshot = requireToolReconciliationSnapshot(record);
    const audit: ToolReconciliationAuditRecord = {
      id: randomUUID(),
      confirmationId: record.id,
      ownerId: record.ownerId,
      expectedVersion: input.expectedVersion,
      confirmationVersionAfter: input.expectedVersion + 1,
      expectedStatus: input.expectedStatus,
      outcome: input.outcome,
      operatorLabel: input.operatorLabel.trim(),
      confirmationPhrase: input.confirmationPhrase,
      snapshot,
      createdAt: new Date(),
    };
    this.reconciliationAudits.set(record.id, structuredClone(audit));
    record.version = audit.confirmationVersionAfter;
    return { audit: structuredClone(audit), replayed: false };
  }

  async saveAudit(record: ToolAuditRecord): Promise<void> {
    this.audits.push(structuredClone(record));
  }

  async listAudits(): Promise<ToolAuditRecord[]> {
    return structuredClone(this.audits);
  }

  async saveReceipt(receipt: ToolExecutionReceipt): Promise<void> {
    this.receipts.set(receipt.id, structuredClone(receipt));
  }

  async findReceipt(id: string): Promise<ToolExecutionReceipt | undefined> {
    const receipt = this.receipts.get(id);
    return receipt ? structuredClone(receipt) : undefined;
  }

  async findReceiptByConfirmationId(
    confirmationId: string,
  ): Promise<ToolExecutionReceipt | undefined> {
    const receipt = [...this.receipts.values()].find(
      (entry) => entry.confirmationId === confirmationId,
    );
    return receipt ? structuredClone(receipt) : undefined;
  }

  async claimReceiptForUndo(id: string): Promise<boolean> {
    const receipt = this.receipts.get(id);
    if (!receipt || receipt.status !== 'applied') return false;
    receipt.status = 'undoing';
    return true;
  }

  async updateReceipt(
    id: string,
    updates: Partial<ToolExecutionReceipt>,
  ): Promise<void> {
    const receipt = this.receipts.get(id);
    if (!receipt) throw new Error('执行记录不存在');
    Object.assign(receipt, structuredClone(updates));
  }

  private safeLimit(limit: number): number {
    return Math.max(1, Math.min(Math.trunc(limit) || 1, 100));
  }
}
