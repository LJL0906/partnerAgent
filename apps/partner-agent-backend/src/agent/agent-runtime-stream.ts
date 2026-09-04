import type { Model } from '@earendil-works/pi-ai';
import type { ModelGatewayService } from '../model-gateway/model-gateway.service.js';
import type { AgentRuntimePolicy } from './agent-runtime-policy.js';
import type {
  AgentRuntimeTelemetry,
  AgentRunTrace,
} from './agent-runtime-telemetry.js';

export interface PiChatContext {
  taskId?: string;
  operationId?: string;
  source?: string;
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
) {
  const stream = gateway.createStreamFunction({
    runId: trace.runId,
    ownerId,
    sessionId,
    taskId: context.taskId,
    operationId: context.operationId,
    source: context.source ?? 'pi_agent',
  });
  return (
    model: Model<any>,
    agentContext: Parameters<typeof stream>[1],
    options?: Parameters<typeof stream>[2],
  ) => {
    const requestBudget = trace.budget.startModelRequest(model.maxTokens);
    return stream(model, agentContext, {
      ...options,
      maxTokens: Math.min(
        options?.maxTokens ?? Number.POSITIVE_INFINITY,
        requestBudget.maxTokens,
      ),
    });
  };
}
