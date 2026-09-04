import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  CallbackAgentRuntimeObserver,
  createAgentRunBudget,
  type AgentRunBudget,
  type AgentRuntimeBudgetStop,
  type AgentRuntimeObservation,
  type AgentRuntimePolicy,
} from './agent-runtime-policy.js';
import {
  NoopObservabilitySink,
  ObservabilitySink,
  safelyRecord,
  type AgentRunFinishReason,
} from '../observability/observability.types.js';

export interface AgentRunMetadata {
  ownerId: string;
  sessionId: string;
  taskId?: string;
  operationId?: string;
  source: string;
}

/**
 * Runtime telemetry is deliberately metadata-only. Never pass prompts, model
 * text, tool arguments, tool results, or raw provider errors into this class.
 */
@Injectable()
export class AgentRuntimeTelemetry {
  private readonly logger = new Logger(AgentRuntimeTelemetry.name);

  constructor(
    @Optional()
    private readonly sink: ObservabilitySink = new NoopObservabilitySink(),
  ) {}

  start(metadata: AgentRunMetadata, policy: AgentRuntimePolicy): AgentRunTrace {
    const trace = new AgentRunTrace(
      metadata,
      (event) => this.logger.log(JSON.stringify(event)),
      this.sink,
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
  private policy?: Readonly<AgentRuntimePolicy>;
  private lastObservation?: AgentRuntimeObservation;

  constructor(
    private readonly metadata: AgentRunMetadata,
    private readonly write: (event: Record<string, unknown>) => void,
    private readonly sink: ObservabilitySink = new NoopObservabilitySink(),
  ) {}

  get budget(): AgentRunBudget {
    if (!this._budget) throw new Error('Agent runtime budget 尚未初始化');
    return this._budget;
  }

  attachBudget(policy: AgentRuntimePolicy): void {
    this.policy = Object.freeze({ ...policy });
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
    this.observe({
      kind: 'agent_first_token',
      ...this.traceContext(),
    });
  }

  toolStarted(toolCallId: string, toolName: string): void {
    this.toolStartedAt.set(toolCallId, Date.now());
    this.emit('tool_started', {
      tool_call_id: safeLabel(toolCallId),
      tool_name: safeLabel(toolName),
    });
    this.observe({
      kind: 'agent_tool_started',
      ...this.traceContext(),
      toolCallId: safeLabel(toolCallId),
      toolName: safeLabel(toolName),
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
    this.observe({
      kind: 'agent_tool_finished',
      ...this.traceContext(),
      toolCallId: safeLabel(toolCallId),
      toolName: safeLabel(toolName),
      status: success ? 'succeeded' : 'failed',
      ...(startedAt === undefined
        ? {}
        : { durationMs: Math.max(0, Date.now() - startedAt) }),
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
    this.observe({
      kind: 'agent_run_finished',
      ...this.traceContext(),
      reason,
      ...(budgetStop
        ? { errorCode: budgetStop.code, budgetReason: budgetStop.reason }
        : {}),
      modelTurnsStarted: this.lastObservation?.modelTurnsStarted ?? 0,
      toolCallsStarted: this.lastObservation?.toolCallsStarted ?? 0,
      outputTokensUsed: this.lastObservation?.outputTokensUsed ?? 0,
    });
  }

  private runtimeObservation(observation: AgentRuntimeObservation): void {
    this.lastObservation = observation;
    this.emit(`budget_${observation.kind}`, {
      model_turns_started: observation.modelTurnsStarted,
      tool_calls_started: observation.toolCallsStarted,
      output_tokens_used: observation.outputTokensUsed,
      output_tokens_remaining: observation.outputTokensRemaining,
      deadline_remaining_ms: observation.deadlineRemainingMs,
      ...(observation.code ? { failure_code: observation.code } : {}),
      ...(observation.reason ? { failure_reason: observation.reason } : {}),
    });
    if (observation.kind === 'run_started' && this.policy) {
      this.observe({
        kind: 'agent_run_started',
        ...this.traceContext(observation.at, observation.elapsedMs),
        policy: this.policy,
      });
      return;
    }
    if (observation.kind === 'model_request_started') {
      this.observe({
        kind: 'agent_turn_started',
        ...this.traceContext(observation.at, observation.elapsedMs),
        turn: observation.modelTurnsStarted,
        outputTokensUsed: observation.outputTokensUsed,
        outputTokensRemaining: observation.outputTokensRemaining,
        deadlineRemainingMs: observation.deadlineRemainingMs,
      });
      return;
    }
    if (observation.kind !== 'run_started') {
      this.observe({
        kind: 'agent_budget_observed',
        ...this.traceContext(observation.at, observation.elapsedMs),
        observation: observation.kind,
        modelTurnsStarted: observation.modelTurnsStarted,
        toolCallsStarted: observation.toolCallsStarted,
        outputTokensUsed: observation.outputTokensUsed,
        outputTokensRemaining: observation.outputTokensRemaining,
        deadlineRemainingMs: observation.deadlineRemainingMs,
        ...(observation.code ? { errorCode: observation.code } : {}),
        ...(observation.reason ? { budgetReason: observation.reason } : {}),
      });
    }
  }

  private observe(event: Parameters<ObservabilitySink['record']>[0]): void {
    safelyRecord(this.sink, event);
  }

  private traceContext(at = Date.now(), elapsedMs = this.elapsedMs()) {
    return {
      runId: this.runId,
      ownerId: safeLabel(this.metadata.ownerId),
      sessionId: safeLabel(this.metadata.sessionId),
      taskId: this.metadata.taskId
        ? safeLabel(this.metadata.taskId)
        : undefined,
      operationId: this.metadata.operationId
        ? safeLabel(this.metadata.operationId)
        : undefined,
      source: safeLabel(this.metadata.source),
      at,
      elapsedMs,
    };
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
