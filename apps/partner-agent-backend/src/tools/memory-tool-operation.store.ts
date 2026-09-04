import {
  ToolOperationStore,
  type ToolAuditRecord,
  type ToolConfirmationRecord,
  type ToolExecutionReceipt,
} from './tool-operation.store.js';

export class MemoryToolOperationStore extends ToolOperationStore {
  private readonly confirmations = new Map<string, ToolConfirmationRecord>();
  private readonly audits: ToolAuditRecord[] = [];
  private readonly receipts = new Map<string, ToolExecutionReceipt>();

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
}
