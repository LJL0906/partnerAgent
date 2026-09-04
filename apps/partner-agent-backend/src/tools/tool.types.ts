import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ToolRiskLevel } from '@partner-agent/contracts';

export type ToolEffect =
  'read_only' | 'external_side_effect' | 'formal_business_data';

export type ToolCapability =
  | 'read_runtime'
  | 'read_user_data'
  | 'external_api'
  | 'generate_candidate_batch';

export interface CandidateBatchToolResultDetails {
  status: 'candidate_staged';
  batch_id: string;
  candidate_ids: string[];
  [key: string]: unknown;
}

export interface RegisteredTool {
  tool: AgentTool;
  riskLevel: ToolRiskLevel;
  effect: ToolEffect;
  capabilities: readonly ToolCapability[];
  requiredPermissions: readonly string[];
  /** 仅用于外部系统副作用审批，不是正式业务 Confirmation。 */
  requiresToolApproval: boolean;
  /** 正式业务数据工具只能通过该适配器生成 Candidate/Batch。 */
  createCandidateBatch?: (
    args: unknown,
    context: ToolExecutionContext,
    toolCallId: string,
  ) => Promise<AgentToolResult<CandidateBatchToolResultDetails>>;
  /** 以下撤销仅适用于外部系统副作用。 */
  undo?: (payload: unknown) => Promise<void>;
  createUndoPayload?: (
    args: unknown,
    result: AgentToolResult<unknown>,
  ) => unknown;
}

export interface ToolExecutionContext {
  ownerId: string;
  sessionId: string;
  permissions?: readonly string[];
}

export interface ToolExecutionOutcome {
  result: AgentToolResult<unknown>;
  executionId?: string;
  /** 外部系统副作用的审批回执撤销期限。 */
  externalUndoExpiresAt?: Date;
}
