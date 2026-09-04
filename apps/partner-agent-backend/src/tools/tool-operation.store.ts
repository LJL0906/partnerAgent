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
