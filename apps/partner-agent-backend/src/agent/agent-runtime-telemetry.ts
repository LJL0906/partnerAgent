import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  CallbackAgentRuntimeObserver,
  createAgentRunBudget,
  type AgentRunBudget,
  type AgentRuntimeBudgetStop,
  type AgentRuntimeObservation,
  type AgentRuntimePolicy,
} from './agent-runtime-policy.js';

export interface AgentRunMetadata {
  sessionId: string;
  taskId?: string;
  operationId?: string;
  source: string;
}

type AgentRunFinishReason =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting_tool_approval'
  | 'waiting_privacy_decision';

/**
 * Runtime telemetry is deliberately metadata-only. Never pass prompts, model
 * text, tool arguments, tool results, or raw provider errors into this class.
 */
@Injectable()
export class AgentRuntimeTelemetry {
  private readonly logger = new Logger(AgentRuntimeTelemetry.name);

  start(metadata: AgentRunMetadata, policy: AgentRuntimePolicy): AgentRunTrace {
    const trace = new AgentRunTrace(metadata, (event) =>
      this.logger.log(JSON.stringify(event)),
    );
    trace.attachBudget(policy);
    return trace;
  }
}

export class AgentRunTrace {
  readonly runId = randomUUID();
  private readonly startedAt = Date.now();
  private readonly toolStartedAt = new Map<string, number>();
  private firstTokenRecorded = false;
  private _budget?: AgentRunBudget;

  constructor(
    private readonly metadata: AgentRunMetadata,
    private readonly write: (event: Record<string, unknown>) => void,
  ) {}

  get budget(): AgentRunBudget {
    if (!this._budget) throw new Error('Agent runtime budget 尚未初始化');
    return this._budget;
  }

  attachBudget(policy: AgentRuntimePolicy): void {
    this._budget = createAgentRunBudget(policy, {
      observer: new CallbackAgentRuntimeObserver((observation) =>
        this.runtimeObservation(observation),
      ),
    });
  }

  firstToken(): void {
    if (this.firstTokenRecorded) return;
    this.firstTokenRecorded = true;
    this.emit('first_token', { first_token_ms: this.elapsedMs() });
  }

  toolStarted(toolCallId: string, toolName: string): void {
    this.toolStartedAt.set(toolCallId, Date.now());
    this.emit('tool_started', {
      tool_call_id: safeLabel(toolCallId),
      tool_name: safeLabel(toolName),
    });
  }

  toolFinished(toolCallId: string, toolName: string, success: boolean): void {
    const startedAt = this.toolStartedAt.get(toolCallId);
    this.toolStartedAt.delete(toolCallId);
    this.emit('tool_finished', {
      tool_call_id: safeLabel(toolCallId),
      tool_name: safeLabel(toolName),
      success,
      ...(startedAt === undefined
        ? {}
        : { elapsed_ms: Math.max(0, Date.now() - startedAt) }),
    });
  }

  finish(
    reason: AgentRunFinishReason,
    budgetStop?: Readonly<AgentRuntimeBudgetStop>,
  ): void {
    this.emit('run_finished', {
      reason,
      ...(budgetStop
        ? { failure_code: budgetStop.code, failure_reason: budgetStop.reason }
        : {}),
    });
  }

  private runtimeObservation(observation: AgentRuntimeObservation): void {
    this.emit(`budget_${observation.kind}`, {
      model_turns_started: observation.modelTurnsStarted,
      tool_calls_started: observation.toolCallsStarted,
      output_tokens_used: observation.outputTokensUsed,
      output_tokens_remaining: observation.outputTokensRemaining,
      deadline_remaining_ms: observation.deadlineRemainingMs,
      ...(observation.code ? { failure_code: observation.code } : {}),
      ...(observation.reason ? { failure_reason: observation.reason } : {}),
    });
  }

  private emit(event: string, details: Record<string, unknown>): void {
    try {
      this.write({
        event: `agent_runtime.${event}`,
        run_id: this.runId,
        session_id: safeLabel(this.metadata.sessionId),
        source: safeLabel(this.metadata.source),
        ...(this.metadata.taskId
          ? { task_id: safeLabel(this.metadata.taskId) }
          : {}),
        ...(this.metadata.operationId
          ? { operation_id: safeLabel(this.metadata.operationId) }
          : {}),
        elapsed_ms: this.elapsedMs(),
        ...details,
      });
    } catch {
      // Telemetry failure must never alter Agent execution semantics.
    }
  }

  private elapsedMs(): number {
    return Math.max(0, Date.now() - this.startedAt);
  }
}

function safeLabel(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 ? '_' : character;
    })
    .join('')
    .slice(0, 128);
}
