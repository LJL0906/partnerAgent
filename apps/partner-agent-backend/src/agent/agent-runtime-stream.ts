import type { Model } from '@earendil-works/pi-ai';
import type {
  ChatOutputMode,
  ChatPreviewKind,
  ReasoningLevel,
} from '@partner-agent/contracts';
import type { ModelGatewayService } from '../model-gateway/model-gateway.service.js';
import { EgressDecisionError } from '../model-gateway/egress.types.js';
import type { AgentRuntimePolicy } from './agent-runtime-policy.js';
import type {
  AgentRuntimeTelemetry,
  AgentRunTrace,
} from './agent-runtime-telemetry.js';

export interface PiChatContext {
  taskId?: string;
  operationId?: string;
  source?: string;
  modelConfigId?: string;
  reasoningLevel?: ReasoningLevel;
  outputMode?: ChatOutputMode;
  previewKind?: ChatPreviewKind;
  originalRecordId?: string;
  userMessageId?: string;
}

export function startAgentRunTrace(
  telemetry: AgentRuntimeTelemetry,
  policy: AgentRuntimePolicy,
  ownerId: string,
  sessionId: string,
  context: PiChatContext,
  fallbackSource: string,
): AgentRunTrace {
  return telemetry.start(
    {
      ownerId,
      sessionId,
      taskId: context.taskId,
      operationId: context.operationId,
      source: context.source ?? fallbackSource,
    },
    policy,
  );
}

export function createBudgetedAgentStream(
  gateway: ModelGatewayService,
  ownerId: string,
  sessionId: string,
  context: PiChatContext,
  trace: AgentRunTrace,
  onEgressDecisionError?: (error: EgressDecisionError) => void,
) {
  const stream = gateway.createStreamFunction(
    {
      runId: trace.runId,
      ownerId,
      sessionId,
      taskId: context.taskId,
      operationId: context.operationId,
      source: context.source ?? 'pi_agent',
    },
    { onEgressDecisionError },
  );
  return async (
    model: Model<any>,
    agentContext: Parameters<typeof stream>[1],
    options?: Parameters<typeof stream>[2],
  ) => {
    const requestBudget = trace.budget.startModelRequest(model.maxTokens);
    try {
      return await stream(model, agentContext, {
        ...options,
        ...(context.reasoningLevel && context.reasoningLevel !== 'off'
          ? { reasoning: context.reasoningLevel }
          : {}),
        maxTokens: Math.min(
          options?.maxTokens ?? Number.POSITIVE_INFINITY,
          requestBudget.maxTokens,
        ),
      });
    } catch (error) {
      if (error instanceof EgressDecisionError) onEgressDecisionError?.(error);
      throw error;
    }
  };
}
