import { randomUUID } from 'node:crypto';
import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  AGENT_TRACE_MAX_EVENTS_PER_RUN,
  AGENT_TRACE_MAX_QUERY_DAYS,
  AgentRunTraceStore,
  type AgentRunTracePage,
  type AgentRunTraceQuery,
  type AgentRunTraceRecord,
} from './agent-run-trace.store.js';
import {
  ObservabilitySink,
  type AgentObservabilityEvent,
  type ModelObservabilityEvent,
  type ObservabilityEvent,
} from './observability.types.js';

type TraceEvent = AgentObservabilityEvent | ModelObservabilityEvent;

@Injectable()
export class AgentRunTraceSink extends ObservabilitySink {
  private readonly sequences = new Map<string, number>();
  private readonly cleanupTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(private readonly store: AgentRunTraceStore) {
    super();
  }

  record(event: Readonly<ObservabilityEvent>): void {
    if (!isTraceEvent(event)) return;
    const sequence = (this.sequences.get(event.runId) ?? 0) + 1;
    if (sequence > AGENT_TRACE_MAX_EVENTS_PER_RUN) return;
    this.sequences.set(event.runId, sequence);
    const appended = this.store
      .append(toRecord(event, sequence))
      .catch(() => undefined);
    if (
      event.kind === 'agent_run_started' ||
      event.kind === 'agent_run_finished'
    ) {
      void appended.then(() =>
        this.store
          .prune(event.ownerId, new Date(event.at))
          .catch(() => undefined),
      );
    }
    if (event.kind === 'agent_run_finished') this.scheduleCleanup(event.runId);
  }

  private scheduleCleanup(runId: string): void {
    const prior = this.cleanupTimers.get(runId);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => {
      this.sequences.delete(runId);
      this.cleanupTimers.delete(runId);
    }, 5 * 60_000);
    timer.unref?.();
    this.cleanupTimers.set(runId, timer);
  }
}

@Injectable()
export class AgentRunTraceRetentionWorker
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly store: AgentRunTraceStore) {}

  onModuleInit(): void {
    void this.store.pruneExpired().catch(() => undefined);
    this.timer = setInterval(
      () => void this.store.pruneExpired().catch(() => undefined),
      60 * 60_000,
    );
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

/** Internal-only owner-scoped query API. No HTTP or WS controller is registered. */
@Injectable()
export class AgentRunTraceQueryService {
  constructor(private readonly store: AgentRunTraceStore) {}

  async query(
    query: AgentRunTraceQuery,
    now = new Date(),
  ): Promise<AgentRunTracePage> {
    const ownerId = safeText(query.ownerId);
    if (!ownerId) throw new Error('trace 查询必须提供 ownerId');
    if (
      !Number.isFinite(query.from.getTime()) ||
      !Number.isFinite(query.to.getTime()) ||
      query.from >= query.to
    ) {
      throw new RangeError('trace 查询时间范围无效');
    }
    const maxRangeMs = AGENT_TRACE_MAX_QUERY_DAYS * 24 * 60 * 60 * 1_000;
    if (query.to.getTime() - query.from.getTime() > maxRangeMs) {
      throw new RangeError(
        `trace 查询时间范围不能超过 ${AGENT_TRACE_MAX_QUERY_DAYS} 天`,
      );
    }
    if (query.to.getTime() > now.getTime() + 5 * 60_000) {
      throw new RangeError('trace 查询结束时间不能明显晚于当前时间');
    }
    return this.store.query({ ...query, ownerId });
  }
}

function isTraceEvent(event: ObservabilityEvent): event is TraceEvent {
  return event.kind.startsWith('agent_') || event.kind.startsWith('model_');
}

function toRecord(event: TraceEvent, sequence: number): AgentRunTraceRecord {
  const common: AgentRunTraceRecord = {
    id: randomUUID(),
    runId: event.runId,
    sequence,
    ownerId: safeText(event.ownerId),
    sessionId: safeText(event.sessionId),
    taskId: optionalSafeText(event.taskId),
    operationId: optionalSafeText(event.operationId),
    source: safeText(event.source),
    eventType: event.kind,
    createdAt: new Date('at' in event ? event.at : Date.now()),
  };
  switch (event.kind) {
    case 'agent_run_started':
      return {
        ...common,
        modelTurns: event.policy.maxModelTurns,
        toolCalls: event.policy.maxToolCalls,
        outputTokenBudget: event.policy.totalOutputTokens,
        deadlineMs: event.policy.runTimeoutMs,
      };
    case 'agent_turn_started':
      return {
        ...common,
        modelTurns: event.turn,
        outputTokens: event.outputTokensUsed,
        outputTokenBudget: event.outputTokensRemaining,
        deadlineMs: event.deadlineRemainingMs,
      };
    case 'agent_budget_observed':
      return {
        ...common,
        status: event.observation,
        modelTurns: event.modelTurnsStarted,
        toolCalls: event.toolCallsStarted,
        outputTokens: event.outputTokensUsed,
        outputTokenBudget: event.outputTokensRemaining,
        deadlineMs: event.deadlineRemainingMs,
        errorCode: event.errorCode,
      };
    case 'agent_first_token':
      return { ...common, durationMs: event.elapsedMs };
    case 'agent_tool_started':
      return {
        ...common,
        toolCallId: safeText(event.toolCallId),
        toolName: safeText(event.toolName),
      };
    case 'agent_tool_finished':
      return {
        ...common,
        toolCallId: safeText(event.toolCallId),
        toolName: safeText(event.toolName),
        status: event.status,
        durationMs: event.durationMs,
      };
    case 'agent_run_finished':
      return {
        ...common,
        status: event.reason,
        modelTurns: event.modelTurnsStarted,
        toolCalls: event.toolCallsStarted,
        outputTokens: event.outputTokensUsed,
        errorCode: event.errorCode,
      };
    case 'model_request_started':
      return modelRecord(common, event, { deadlineMs: event.timeoutMs });
    case 'model_egress_decided':
      return modelRecord(common, event, { status: event.decision });
    case 'model_first_response':
      return modelRecord(common, event, {
        status: event.status,
        durationMs: event.durationMs,
      });
    case 'model_request_finished':
      return modelRecord(common, event, {
        status: event.status,
        durationMs: event.durationMs,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        totalTokens: event.totalTokens,
        errorCode: event.errorCode,
      });
  }
}

function modelRecord(
  common: AgentRunTraceRecord,
  event: ModelObservabilityEvent,
  details: Partial<AgentRunTraceRecord>,
): AgentRunTraceRecord {
  return {
    ...common,
    requestId: event.requestId,
    provider: safeText(event.provider),
    modelId: safeText(event.modelId),
    ...details,
  };
}

function optionalSafeText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : safeText(value);
}

function safeText(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 ? '_' : character;
    })
    .join('')
    .slice(0, 128);
}
