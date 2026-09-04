import type {
  AgentRuntimeBudgetCode,
  AgentRuntimeBudgetReason,
  AgentRuntimePolicy,
} from '../agent/agent-runtime-policy.js';
import type {
  ModelProviderFailureCategory,
  ModelProviderFailureCode,
} from '../model-gateway/model-gateway-reliability.js';

export type AgentRunFinishReason =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting_tool_approval'
  | 'waiting_privacy_decision';

export interface AgentTraceContext {
  runId: string;
  ownerId: string;
  sessionId: string;
  taskId?: string;
  operationId?: string;
  source: string;
  at: number;
  elapsedMs: number;
}

export type AgentObservabilityEvent =
  | (AgentTraceContext & {
      kind: 'agent_run_started';
      policy: Readonly<AgentRuntimePolicy>;
    })
  | (AgentTraceContext & {
      kind: 'agent_turn_started';
      turn: number;
      outputTokensUsed: number;
      outputTokensRemaining: number;
      deadlineRemainingMs: number;
    })
  | (AgentTraceContext & {
      kind: 'agent_budget_observed';
      observation:
        'model_output_recorded' | 'tool_call_started' | 'budget_stopped';
      modelTurnsStarted: number;
      toolCallsStarted: number;
      outputTokensUsed: number;
      outputTokensRemaining: number;
      deadlineRemainingMs: number;
      errorCode?: AgentRuntimeBudgetCode;
      budgetReason?: AgentRuntimeBudgetReason;
    })
  | (AgentTraceContext & { kind: 'agent_first_token' })
  | (AgentTraceContext & {
      kind: 'agent_tool_started';
      toolCallId: string;
      toolName: string;
    })
  | (AgentTraceContext & {
      kind: 'agent_tool_finished';
      toolCallId: string;
      toolName: string;
      status: 'succeeded' | 'failed';
      durationMs?: number;
    })
  | (AgentTraceContext & {
      kind: 'agent_run_finished';
      reason: AgentRunFinishReason;
      errorCode?: AgentRuntimeBudgetCode;
      budgetReason?: AgentRuntimeBudgetReason;
      modelTurnsStarted: number;
      toolCallsStarted: number;
      outputTokensUsed: number;
    });

export interface ModelTraceContext {
  runId: string;
  requestId: string;
  ownerId: string;
  sessionId: string;
  taskId?: string;
  operationId?: string;
  source: string;
  provider: string;
  modelId: string;
}

export type ModelObservabilityEvent =
  | (ModelTraceContext & {
      kind: 'model_request_started';
      timeoutMs: number;
    })
  | (ModelTraceContext & {
      kind: 'model_egress_decided';
      decision: 'allowed' | 'redacted' | 'pending_user_decision' | 'blocked';
    })
  | (ModelTraceContext & {
      kind: 'model_first_response';
      durationMs: number;
      status: 'success' | 'error';
    })
  | (ModelTraceContext & {
      kind: 'model_request_finished';
      durationMs: number;
      status: 'success' | 'error';
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      failureCategory?: ModelProviderFailureCategory;
      errorCode?: ModelProviderFailureCode;
    });

export type SchedulerObservabilityEvent =
  | {
      kind: 'chat_task_queue_depth';
      depth: number;
    }
  | {
      kind: 'chat_task_claim';
      result: 'claimed' | 'empty' | 'error';
    }
  | {
      kind: 'chat_task_lease_expired';
      count: number;
    }
  | {
      kind: 'chat_task_fence_rejected';
      operation: 'renew' | 'finish' | 'wait';
    };

export type TransportObservabilityEvent =
  | { kind: 'listen_reconnect' }
  | { kind: 'ws_replay'; count: number }
  | {
      kind: 'ws_catch_up';
      result: 'completed' | 'partial' | 'failed';
      count: number;
    }
  | { kind: 'ws_recovery_required' };

export type ObservabilityEvent =
  | AgentObservabilityEvent
  | ModelObservabilityEvent
  | SchedulerObservabilityEvent
  | TransportObservabilityEvent;

/** Sink implementations must be metadata-only and failure-isolated by callers. */
export abstract class ObservabilitySink {
  abstract record(event: Readonly<ObservabilityEvent>): void | Promise<void>;
}

export class NoopObservabilitySink extends ObservabilitySink {
  record(): void {}
}

export class InMemoryObservabilitySink extends ObservabilitySink {
  readonly events: ObservabilityEvent[] = [];

  record(event: Readonly<ObservabilityEvent>): void {
    this.events.push(structuredClone(event));
  }
}

export class CompositeObservabilitySink extends ObservabilitySink {
  constructor(private readonly sinks: readonly ObservabilitySink[]) {
    super();
  }

  record(event: Readonly<ObservabilityEvent>): void {
    for (const sink of this.sinks) safelyRecord(sink, event);
  }
}

export function safelyRecord(
  sink: ObservabilitySink,
  event: Readonly<ObservabilityEvent>,
  onFailure?: () => void,
): void {
  try {
    const pending = sink.record(event);
    if (pending !== undefined) {
      void Promise.resolve(pending).catch(() => onFailure?.());
    }
  } catch {
    onFailure?.();
  }
}
