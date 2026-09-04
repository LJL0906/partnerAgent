import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { AcceptedChatTask } from './chat-task.store.js';

export interface PiToolDecision {
  toolCallId: string;
  toolName: string;
  result: AgentToolResult<unknown>;
  isError?: boolean;
}

export interface ToolDecisionClaim {
  confirmationId: string;
  leaseToken: string;
}

export abstract class ChatTaskScheduler {
  abstract schedule(task: AcceptedChatTask): void;
  abstract resumeAfterPrivacyDecision(task: AcceptedChatTask): void;
  abstract claimToolDecision(
    task: AcceptedChatTask,
    confirmationId: string,
    toolCallId: string,
    toolName: string,
  ): Promise<ToolDecisionClaim | undefined>;
  abstract resumeClaimedToolDecision(
    task: AcceptedChatTask,
    claim: ToolDecisionClaim,
    decision: PiToolDecision,
  ): void;
  abstract failClaimedToolDecision(
    task: AcceptedChatTask,
    claim: ToolDecisionClaim,
    error: unknown,
  ): Promise<void>;
  abstract expireToolDecision(
    task: AcceptedChatTask,
    confirmationId: string,
  ): Promise<boolean>;
  abstract failIndeterminateToolDecision(
    task: AcceptedChatTask,
    confirmationId: string,
  ): Promise<boolean>;
  abstract cancel(task: AcceptedChatTask): Promise<void>;
}
