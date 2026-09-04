import type {
  AgentEvent,
  BeforeToolCallContext,
  BeforeToolCallResult,
  ShouldStopAfterTurnContext,
} from '@earendil-works/pi-agent-core';

export const AGENT_RUNTIME_CONFIG_KEYS = {
  runTimeoutMs: 'AGENT_RUN_TIMEOUT_MS',
  maxModelTurns: 'AGENT_RUN_MAX_MODEL_TURNS',
  maxToolCalls: 'AGENT_RUN_MAX_TOOL_CALLS',
  totalOutputTokens: 'AGENT_RUN_MAX_OUTPUT_TOKENS',
  requestMaxTokens: 'AGENT_RUN_MAX_REQUEST_TOKENS',
} as const;

export const DEFAULT_AGENT_RUNTIME_POLICY = Object.freeze({
  runTimeoutMs: 3 * 60_000,
  maxModelTurns: 8,
  maxToolCalls: 12,
  totalOutputTokens: 16_384,
  requestMaxTokens: 4_096,
});

export const MAX_AGENT_RUNTIME_POLICY = Object.freeze({
  runTimeoutMs: 30 * 60_000,
  maxModelTurns: 64,
  maxToolCalls: 128,
  totalOutputTokens: 131_072,
  requestMaxTokens: 32_768,
});

export interface AgentRuntimePolicy {
  runTimeoutMs: number;
  maxModelTurns: number;
  maxToolCalls: number;
  totalOutputTokens: number;
  requestMaxTokens: number;
}

export type AgentRuntimeConfigReader = (key: string) => unknown;

export type AgentRuntimeBudgetReason =
  | 'deadline_exceeded'
  | 'model_turn_limit_reached'
  | 'tool_call_limit_reached'
  | 'output_token_limit_reached';

export type AgentRuntimeBudgetCode =
  | 'AGENT_BUDGET_001'
  | 'AGENT_BUDGET_002'
  | 'AGENT_BUDGET_003'
  | 'AGENT_BUDGET_004';

export interface AgentRuntimeBudgetStop {
  code: AgentRuntimeBudgetCode;
  reason: AgentRuntimeBudgetReason;
  message: string;
}

export type AgentRuntimeObservationKind =
  | 'run_started'
  | 'model_request_started'
  | 'model_output_recorded'
  | 'tool_call_started'
  | 'budget_stopped';

/** Only bounded counters and timing metadata are observable; prompts/results are excluded. */
export interface AgentRuntimeObservation {
  kind: AgentRuntimeObservationKind;
  at: number;
  elapsedMs: number;
  modelTurnsStarted: number;
  toolCallsStarted: number;
  outputTokensUsed: number;
  outputTokensRemaining: number;
  deadlineRemainingMs: number;
  code?: AgentRuntimeBudgetCode;
  reason?: AgentRuntimeBudgetReason;
}

export interface AgentRuntimeObserver {
  observe(observation: Readonly<AgentRuntimeObservation>): void;
}

export class CallbackAgentRuntimeObserver implements AgentRuntimeObserver {
  constructor(
    private readonly callback: (
      observation: Readonly<AgentRuntimeObservation>,
    ) => void,
  ) {}

  observe(observation: Readonly<AgentRuntimeObservation>): void {
    this.callback(observation);
  }
}

export class AgentRuntimeBudgetExceededError extends Error {
  readonly retryable = false;

  constructor(readonly budget: AgentRuntimeBudgetStop) {
    super(`${budget.code}: ${budget.message}`);
    this.name = 'AgentRuntimeBudgetExceededError';
  }

  get code(): AgentRuntimeBudgetCode {
    return this.budget.code;
  }

  get reason(): AgentRuntimeBudgetReason {
    return this.budget.reason;
  }
}

export interface AgentModelRequestBudget {
  maxTokens: number;
  modelTurn: number;
  outputTokensRemaining: number;
  deadlineRemainingMs: number;
}

export interface AgentRuntimeHooks {
  beforeToolCall: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  shouldStopAfterTurn: (
    context: ShouldStopAfterTurnContext,
  ) => Promise<boolean>;
  observeAgentEvent: (event: AgentEvent, signal: AbortSignal) => void;
}

type AgentRunBudgetOptions = {
  now?: () => number;
  observer?: AgentRuntimeObserver;
};

export const AGENT_RUNTIME_BUDGET_STOPS: Readonly<
  Record<AgentRuntimeBudgetReason, Readonly<AgentRuntimeBudgetStop>>
> = Object.freeze({
  deadline_exceeded: {
    code: 'AGENT_BUDGET_001',
    reason: 'deadline_exceeded',
    message: 'Agent 运行时间预算已用尽',
  },
  model_turn_limit_reached: {
    code: 'AGENT_BUDGET_002',
    reason: 'model_turn_limit_reached',
    message: 'Agent 模型轮次预算已用尽',
  },
  tool_call_limit_reached: {
    code: 'AGENT_BUDGET_003',
    reason: 'tool_call_limit_reached',
    message: 'Agent 工具调用预算已用尽',
  },
  output_token_limit_reached: {
    code: 'AGENT_BUDGET_004',
    reason: 'output_token_limit_reached',
    message: 'Agent 输出 Token 预算已用尽',
  },
});

export function readAgentRuntimePolicy(
  read: AgentRuntimeConfigReader,
): AgentRuntimePolicy {
  const policy = {
    runTimeoutMs: readPositiveInteger(
      read,
      AGENT_RUNTIME_CONFIG_KEYS.runTimeoutMs,
      DEFAULT_AGENT_RUNTIME_POLICY.runTimeoutMs,
      MAX_AGENT_RUNTIME_POLICY.runTimeoutMs,
    ),
    maxModelTurns: readPositiveInteger(
      read,
      AGENT_RUNTIME_CONFIG_KEYS.maxModelTurns,
      DEFAULT_AGENT_RUNTIME_POLICY.maxModelTurns,
      MAX_AGENT_RUNTIME_POLICY.maxModelTurns,
    ),
    maxToolCalls: readPositiveInteger(
      read,
      AGENT_RUNTIME_CONFIG_KEYS.maxToolCalls,
      DEFAULT_AGENT_RUNTIME_POLICY.maxToolCalls,
      MAX_AGENT_RUNTIME_POLICY.maxToolCalls,
    ),
    totalOutputTokens: readPositiveInteger(
      read,
      AGENT_RUNTIME_CONFIG_KEYS.totalOutputTokens,
      DEFAULT_AGENT_RUNTIME_POLICY.totalOutputTokens,
      MAX_AGENT_RUNTIME_POLICY.totalOutputTokens,
    ),
    requestMaxTokens: readPositiveInteger(
      read,
      AGENT_RUNTIME_CONFIG_KEYS.requestMaxTokens,
      DEFAULT_AGENT_RUNTIME_POLICY.requestMaxTokens,
      MAX_AGENT_RUNTIME_POLICY.requestMaxTokens,
    ),
  };
  assertAgentRuntimePolicy(policy);
  return Object.freeze(policy);
}

export function assertAgentRuntimePolicy(policy: AgentRuntimePolicy): void {
  for (const [field, maximum] of Object.entries(MAX_AGENT_RUNTIME_POLICY)) {
    const value = policy[field as keyof AgentRuntimePolicy];
    if (!Number.isInteger(value) || value <= 0 || value > maximum) {
      throw new Error(`Agent runtime policy 配置无效: ${field}`);
    }
  }
  if (policy.requestMaxTokens > policy.totalOutputTokens) {
    throw new Error(
      'Agent runtime policy 配置无效: requestMaxTokens 不能超过 totalOutputTokens',
    );
  }
}

export function createAgentRunBudget(
  policy: AgentRuntimePolicy,
  options: AgentRunBudgetOptions = {},
): AgentRunBudget {
  assertAgentRuntimePolicy(policy);
  return new AgentRunBudget(policy, options);
}

export class AgentRunBudget {
  readonly startedAt: number;
  readonly deadlineAt: number;
  readonly policy: Readonly<AgentRuntimePolicy>;
  private readonly now: () => number;
  private readonly observer?: AgentRuntimeObserver;
  private modelTurnsStarted = 0;
  private toolCallsStarted = 0;
  private outputTokensUsed = 0;
  private stop?: AgentRuntimeBudgetStop;

  constructor(policy: AgentRuntimePolicy, options: AgentRunBudgetOptions = {}) {
    assertAgentRuntimePolicy(policy);
    this.policy = Object.freeze({ ...policy });
    this.now = options.now ?? Date.now;
    this.observer = options.observer;
    this.startedAt = this.now();
    this.deadlineAt = this.startedAt + policy.runTimeoutMs;
    this.emit('run_started');
  }

  startModelRequest(modelMaxTokens?: number): AgentModelRequestBudget {
    this.throwIfStopped();
    this.throwIfDeadlineReached();
    if (this.modelTurnsStarted >= this.policy.maxModelTurns) {
      throw this.stopAndCreateError('model_turn_limit_reached');
    }
    const outputTokensRemaining = this.remainingOutputTokens();
    if (outputTokensRemaining <= 0) {
      throw this.stopAndCreateError('output_token_limit_reached');
    }
    const providerLimit = positiveProviderLimit(modelMaxTokens);
    const maxTokens = Math.min(
      this.policy.requestMaxTokens,
      outputTokensRemaining,
      providerLimit,
    );
    this.modelTurnsStarted += 1;
    this.emit('model_request_started');
    return {
      maxTokens,
      modelTurn: this.modelTurnsStarted,
      outputTokensRemaining,
      deadlineRemainingMs: this.remainingTimeMs(),
    };
  }

  recordModelOutput(outputTokens: number): void {
    if (!Number.isFinite(outputTokens) || outputTokens <= 0) return;
    this.outputTokensUsed += Math.floor(outputTokens);
    this.emit('model_output_recorded');
  }

  beforeToolCall(): BeforeToolCallResult | undefined {
    const deadlineStop = this.stopIfDeadlineReached();
    if (deadlineStop) return this.blockedToolResult(deadlineStop);
    if (this.stop) return this.blockedToolResult(this.stop);
    if (this.toolCallsStarted >= this.policy.maxToolCalls) {
      return this.blockedToolResult(this.stopWith('tool_call_limit_reached'));
    }
    this.toolCallsStarted += 1;
    this.emit('tool_call_started');
    return undefined;
  }

  shouldStopAfterTurn(): boolean {
    if (this.stopIfDeadlineReached()) return true;
    // 下一轮模型请求会在 startModelRequest() 前精确检查轮次和输出预算。
    // 此处不能仅凭 toolResults 推断还会继续：终止型工具（例如等待审批）也有
    // toolResult，若提前标记预算耗尽会把正常等待误报为失败。
    return Boolean(this.stop);
  }

  remainingTimeMs(): number {
    return Math.max(0, this.deadlineAt - this.now());
  }

  remainingOutputTokens(): number {
    return Math.max(0, this.policy.totalOutputTokens - this.outputTokensUsed);
  }

  termination(): Readonly<AgentRuntimeBudgetStop> | undefined {
    return this.stop ? { ...this.stop } : undefined;
  }

  /** Called by the run-level timer before aborting the Agent. */
  checkDeadline(): Readonly<AgentRuntimeBudgetStop> | undefined {
    return this.stopIfDeadlineReached();
  }

  hooks(): AgentRuntimeHooks {
    return {
      beforeToolCall: async (_context, signal) =>
        signal?.aborted ? undefined : this.beforeToolCall(),
      shouldStopAfterTurn: async (_context) => this.shouldStopAfterTurn(),
      observeAgentEvent: (event) => {
        if (event.type !== 'turn_end' || event.message.role !== 'assistant')
          return;
        this.recordModelOutput(event.message.usage.output);
      },
    };
  }

  private throwIfDeadlineReached(): void {
    const stop = this.stopIfDeadlineReached();
    if (stop) throw new AgentRuntimeBudgetExceededError(stop);
  }

  private throwIfStopped(): void {
    if (this.stop) throw new AgentRuntimeBudgetExceededError(this.stop);
  }

  private stopIfDeadlineReached(): AgentRuntimeBudgetStop | undefined {
    return this.remainingTimeMs() === 0
      ? this.stopWith('deadline_exceeded')
      : undefined;
  }

  private stopAndCreateError(
    reason: AgentRuntimeBudgetReason,
  ): AgentRuntimeBudgetExceededError {
    return new AgentRuntimeBudgetExceededError(this.stopWith(reason));
  }

  private stopWith(reason: AgentRuntimeBudgetReason): AgentRuntimeBudgetStop {
    if (!this.stop) {
      this.stop = { ...AGENT_RUNTIME_BUDGET_STOPS[reason] };
      this.emit('budget_stopped');
    }
    return this.stop;
  }

  private blockedToolResult(
    stop: AgentRuntimeBudgetStop,
  ): BeforeToolCallResult {
    return {
      block: true,
      terminate: true,
      reason: `${stop.code}: ${stop.message}`,
    };
  }

  private emit(kind: AgentRuntimeObservationKind): void {
    if (!this.observer) return;
    const now = this.now();
    const observation: AgentRuntimeObservation = {
      kind,
      at: now,
      elapsedMs: Math.max(0, now - this.startedAt),
      modelTurnsStarted: this.modelTurnsStarted,
      toolCallsStarted: this.toolCallsStarted,
      outputTokensUsed: this.outputTokensUsed,
      outputTokensRemaining: this.remainingOutputTokens(),
      deadlineRemainingMs: Math.max(0, this.deadlineAt - now),
      ...(kind === 'budget_stopped' && this.stop
        ? { code: this.stop.code, reason: this.stop.reason }
        : {}),
    };
    try {
      this.observer.observe(Object.freeze(observation));
    } catch {
      // Observability must never change Agent execution semantics.
    }
  }
}

function readPositiveInteger(
  read: AgentRuntimeConfigReader,
  key: string,
  fallback: number,
  maximum: number,
): number {
  const raw = read(key);
  if (raw === undefined) return fallback;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`Agent runtime 配置无效: ${key}`);
  }
  return value;
}

function positiveProviderLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : Number.POSITIVE_INFINITY;
}
