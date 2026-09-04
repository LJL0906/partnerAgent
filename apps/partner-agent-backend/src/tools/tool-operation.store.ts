import type { ToolRiskLevel } from '@partner-agent/contracts';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';

export type ConfirmationStatus =
  | 'pending'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'dismissed'
  | 'expired'
  | 'indeterminate'
  | 'undone';

export const TOOL_RECONCILIATION_OUTCOMES = [
  'verified_applied',
  'verified_not_applied',
  'abandoned',
] as const;

export type ToolReconciliationOutcome =
  (typeof TOOL_RECONCILIATION_OUTCOMES)[number];

export interface ToolReconciliationSnapshot {
  confirmationId: string;
  ownerId: string;
  sessionId: string;
  taskId: string;
  operationId: string;
  toolCallId: string;
  toolName: string;
  requestSummary: string;
  resultSummary?: string;
  capturedAt: Date;
}

export interface ToolConfirmationRecord {
  id: string;
  ownerId: string;
  sessionId: string;
  /** 旧 Gateway 产生的确认记录可能没有正式任务关联。 */
  taskId?: string;
  operationId?: string;
  toolCallId: string;
  toolName: string;
  riskLevel: ToolRiskLevel;
  status: ConfirmationStatus;
  arguments: unknown;
  requestSummary: string;
  resultSummary?: string;
  /** 已脱敏且可安全回灌 Agent 的完整结果；用于成功后的崩溃恢复。 */
  result?: AgentToolResult<unknown>;
  /** 人工核对只可读取此脱敏快照，不能读取或提交原始参数/任意结果。 */
  reconciliationSnapshot?: ToolReconciliationSnapshot;
  /** 仅供人工核对的乐观并发版本；不会驱动 ChatTask 恢复。 */
  version?: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface ToolAuditRecord {
  id: string;
  ownerId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  riskLevel: ToolRiskLevel;
  action:
    | 'executed'
    | 'staged'
    | 'confirmed'
    | 'dismissed'
    | 'expired'
    | 'indeterminate'
    | 'failed'
    | 'undone'
    | 'undo_failed'
    | 'denied'
    | 'candidate_staged';
  confirmationId?: string;
  executionId?: string;
  requestSummary?: string;
  resultSummary?: string;
  createdAt: Date;
}

export interface ToolExecutionReceipt {
  id: string;
  confirmationId: string;
  ownerId: string;
  sessionId: string;
  toolName: string;
  undoPayload: unknown;
  status: 'applied' | 'undoing' | 'undone' | 'undo_failed';
  appliedAt: Date;
  /** 仅适用于外部系统副作用回执，不代表正式业务对象的撤销资格。 */
  undoExpiresAt: Date;
}

export interface RecoverableToolConfirmationRecord extends ToolConfirmationRecord {
  taskId: string;
  operationId: string;
  status: 'succeeded' | 'dismissed';
  result: AgentToolResult<unknown>;
}

export interface ExpiredToolConfirmationRecord extends ToolConfirmationRecord {
  taskId: string;
  operationId: string;
  status: 'expired';
}

export interface ReconciledToolConfirmationRecord extends ToolConfirmationRecord {
  taskId: string;
  operationId: string;
  status: 'failed' | 'expired' | 'indeterminate';
}

export interface PendingToolReconciliation {
  confirmationId: string;
  ownerId: string;
  currentVersion: number;
  currentStatus: 'indeterminate';
  snapshot: ToolReconciliationSnapshot;
}

export interface ToolReconciliationAuditRecord {
  id: string;
  confirmationId: string;
  ownerId: string;
  expectedVersion: number;
  confirmationVersionAfter: number;
  expectedStatus: 'indeterminate';
  outcome: ToolReconciliationOutcome;
  operatorLabel: string;
  confirmationPhrase: string;
  snapshot: ToolReconciliationSnapshot;
  createdAt: Date;
}

export interface ReconcileIndeterminateToolInput {
  confirmationId: string;
  ownerId: string;
  expectedVersion: number;
  expectedStatus: 'indeterminate';
  outcome: ToolReconciliationOutcome;
  operatorLabel: string;
  confirmationPhrase: string;
}

export interface ToolReconciliationResult {
  audit: ToolReconciliationAuditRecord;
  replayed: boolean;
}

export class ToolReconciliationError extends Error {}

export function buildToolReconciliationPhrase(
  input: Pick<
    ReconcileIndeterminateToolInput,
    | 'confirmationId'
    | 'ownerId'
    | 'expectedVersion'
    | 'expectedStatus'
    | 'outcome'
  >,
): string {
  return [
    'CONFIRM TOOL RECONCILIATION',
    input.confirmationId,
    'OWNER',
    input.ownerId,
    'VERSION',
    String(input.expectedVersion),
    'STATE',
    input.expectedStatus,
    'OUTCOME',
    input.outcome,
  ].join(' ');
}

export function assertToolReconciliationInput(
  input: ReconcileIndeterminateToolInput,
): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.confirmationId,
    )
  ) {
    throw new ToolReconciliationError('confirmation id 必须是有效 UUID');
  }
  if (!input.ownerId.trim()) {
    throw new ToolReconciliationError('核对记录不存在');
  }
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    input.expectedVersion >= 2_147_483_647
  ) {
    throw new ToolReconciliationError('当前版本必须是正整数');
  }
  if (input.expectedStatus !== 'indeterminate') {
    throw new ToolReconciliationError('当前状态必须显式为 indeterminate');
  }
  if (
    !(TOOL_RECONCILIATION_OUTCOMES as readonly string[]).includes(input.outcome)
  ) {
    throw new ToolReconciliationError('核对结论不受支持');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(input.operatorLabel)) {
    throw new ToolReconciliationError(
      '操作人标识只能包含安全的 ASCII 标识字符且最长 128 字符',
    );
  }
  if (input.confirmationPhrase !== buildToolReconciliationPhrase(input)) {
    throw new ToolReconciliationError('显式确认短语不匹配');
  }
}

export abstract class ToolOperationStore {
  abstract saveConfirmation(record: ToolConfirmationRecord): Promise<void>;
  abstract findConfirmation(
    id: string,
  ): Promise<ToolConfirmationRecord | undefined>;
  abstract claimConfirmation(id: string): Promise<boolean>;
  abstract updateConfirmation(
    id: string,
    updates: Partial<ToolConfirmationRecord>,
  ): Promise<void>;
  abstract listRecoverableConfirmations(
    limit: number,
  ): Promise<RecoverableToolConfirmationRecord[]>;
  abstract expirePendingConfirmations(
    now: Date,
    limit: number,
  ): Promise<ExpiredToolConfirmationRecord[]>;
  abstract reconcileStaleConfirmations(
    now: Date,
    limit: number,
  ): Promise<ReconciledToolConfirmationRecord[]>;
  abstract listIndeterminateConfirmations(
    ownerId: string,
    limit: number,
  ): Promise<PendingToolReconciliation[]>;
  abstract reconcileIndeterminateConfirmation(
    input: ReconcileIndeterminateToolInput,
  ): Promise<ToolReconciliationResult>;
  abstract saveAudit(record: ToolAuditRecord): Promise<void>;
  abstract listAudits(): Promise<ToolAuditRecord[]>;
  abstract saveReceipt(receipt: ToolExecutionReceipt): Promise<void>;
  abstract findReceipt(id: string): Promise<ToolExecutionReceipt | undefined>;
  abstract findReceiptByConfirmationId(
    confirmationId: string,
  ): Promise<ToolExecutionReceipt | undefined>;
  abstract claimReceiptForUndo(id: string): Promise<boolean>;
  abstract updateReceipt(
    id: string,
    updates: Partial<ToolExecutionReceipt>,
  ): Promise<void>;
}
