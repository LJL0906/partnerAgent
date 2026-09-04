import {
  ToolOperationStore,
  assertToolReconciliationInput,
  type PendingToolReconciliation,
  type ReconcileIndeterminateToolInput,
  type ToolReconciliationResult,
} from './tool-operation.store.js';

/**
 * 仅供具备数据库访问权限的本机 CLI 使用；不得注册为 HTTP/WS handler。
 * 核对只落脱敏审计，不恢复 failed ChatTask，也不执行或重放工具。
 */
export class ToolReconciliationService {
  constructor(private readonly store: ToolOperationStore) {}

  async list(
    ownerId: string,
    limit = 50,
  ): Promise<PendingToolReconciliation[]> {
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) throw new Error('必须提供非空 owner id');
    return this.store.listIndeterminateConfirmations(normalizedOwnerId, limit);
  }

  async reconcile(
    input: ReconcileIndeterminateToolInput,
  ): Promise<ToolReconciliationResult> {
    assertToolReconciliationInput(input);
    return this.store.reconcileIndeterminateConfirmation({
      ...input,
      ownerId: input.ownerId.trim(),
      operatorLabel: input.operatorLabel.trim(),
    });
  }
}
