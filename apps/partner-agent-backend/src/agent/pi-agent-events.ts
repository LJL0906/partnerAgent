import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { ToolRiskLevel } from '@partner-agent/contracts';

export type BackendAgentEvent = {
  type: string;
  data?: unknown;
  timestamp: number;
};

interface BudgetStopView {
  code: string;
  message: string;
}

interface AgentEventMapperOptions {
  isApprovalRequired: (toolName: string) => boolean;
  riskLevelFor: (toolName: string) => ToolRiskLevel;
  markFailed: () => void;
  budgetStop?: BudgetStopView;
}

export function mapPiAgentEvent(
  event: AgentEvent,
  options: AgentEventMapperOptions,
): BackendAgentEvent | undefined {
  const timestamp = Date.now();

  if (event.type === 'message_update') {
    const assistantEvent = event.assistantMessageEvent;
    if (assistantEvent.type === 'text_delta') {
      return { type: 'text_delta', data: assistantEvent.delta, timestamp };
    }
    if (assistantEvent.type === 'thinking_delta') {
      return {
        type: 'thinking_delta',
        data: assistantEvent.delta,
        timestamp,
      };
    }
  }

  if (event.type === 'tool_execution_start') {
    if (options.isApprovalRequired(event.toolName)) return undefined;
    return {
      type: 'tool_execution_start',
      data: { tool: event.toolName, tool_call_id: event.toolCallId },
      timestamp,
    };
  }

  if (event.type === 'tool_execution_end') {
    const details = event.result?.details as
      | {
          status?: string;
          confirmationId?: string;
          requestSummary?: string;
          expiresAt?: string;
        }
      | undefined;
    if (
      details?.status === 'pending_tool_approval' &&
      details.confirmationId &&
      details.expiresAt
    ) {
      return {
        type: 'tool_confirmation_pending',
        data: {
          confirmationId: details.confirmationId,
          tool: event.toolName,
          tool_call_id: event.toolCallId,
          riskLevel: options.riskLevelFor(event.toolName),
          requestSummary: details.requestSummary ?? '',
          expiresAt: new Date(details.expiresAt).getTime(),
        },
        timestamp,
      };
    }
    return {
      type: 'tool_execution_end',
      data: {
        tool: event.toolName,
        tool_call_id: event.toolCallId,
        success: !event.isError,
      },
      timestamp,
    };
  }

  if (
    event.type === 'message_end' &&
    event.message.role === 'assistant' &&
    event.message.errorMessage
  ) {
    options.markFailed();
    return {
      type: 'error',
      data: options.budgetStop
        ? {
            code: options.budgetStop.code,
            message: options.budgetStop.message,
          }
        : { message: event.message.errorMessage },
      timestamp,
    };
  }

  if (event.type === 'agent_end') {
    if (options.budgetStop) {
      options.markFailed();
      return {
        type: 'error',
        data: {
          code: options.budgetStop.code,
          message: options.budgetStop.message,
        },
        timestamp,
      };
    }
    return { type: 'done', timestamp };
  }

  return undefined;
}
