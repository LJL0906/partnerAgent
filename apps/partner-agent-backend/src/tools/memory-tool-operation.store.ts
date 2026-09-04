import {
  ToolOperationStore,
  type ExpiredToolConfirmationRecord,
  type ReconciledToolConfirmationRecord,
  type RecoverableToolConfirmationRecord,
  type ToolAuditRecord,
  type ToolConfirmationRecord,
  type ToolExecutionReceipt,
} from './tool-operation.store.js';

export class MemoryToolOperationStore extends ToolOperationStore {
  private readonly confirmations = new Map<string, ToolConfirmationRecord>();
  private readonly audits: ToolAuditRecord[] = [];
  private readonly receipts = new Map<string, ToolExecutionReceipt>();
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
    return records.map((record) => {
      if (record.status === 'executing') record.status = 'indeterminate';
      this.listedReconciliations.add(record.id);
      return structuredClone(record) as ReconciledToolConfirmationRecord;
    });
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
