import type { ToolRiskLevel } from '@partner-agent/contracts';

export type ConfirmationStatus =
  | 'pending'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'dismissed'
  | 'expired'
  | 'undone';

export interface ToolConfirmationRecord {
  id: string;
  ownerId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  riskLevel: ToolRiskLevel;
  status: ConfirmationStatus;
  arguments: unknown;
  requestSummary: string;
  resultSummary?: string;
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
  abstract saveAudit(record: ToolAuditRecord): Promise<void>;
  abstract listAudits(): Promise<ToolAuditRecord[]>;
  abstract saveReceipt(receipt: ToolExecutionReceipt): Promise<void>;
  abstract findReceipt(id: string): Promise<ToolExecutionReceipt | undefined>;
  abstract claimReceiptForUndo(id: string): Promise<boolean>;
  abstract updateReceipt(
    id: string,
    updates: Partial<ToolExecutionReceipt>,
  ): Promise<void>;
}
