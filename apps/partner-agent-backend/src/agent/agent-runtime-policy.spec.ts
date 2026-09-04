import type {
  AgentEvent,
  BeforeToolCallContext,
  ShouldStopAfterTurnContext,
} from '@earendil-works/pi-agent-core';
import {
  AGENT_RUNTIME_CONFIG_KEYS,
  AgentRuntimeBudgetExceededError,
  CallbackAgentRuntimeObserver,
  DEFAULT_AGENT_RUNTIME_POLICY,
  MAX_AGENT_RUNTIME_POLICY,
  createAgentRunBudget,
  readAgentRuntimePolicy,
  type AgentRuntimeObservation,
  type AgentRuntimePolicy,
} from './agent-runtime-policy.js';

const POLICY: AgentRuntimePolicy = {
  runTimeoutMs: 1_000,
  maxModelTurns: 2,
  maxToolCalls: 2,
  totalOutputTokens: 100,
  requestMaxTokens: 60,
};

describe('agent runtime policy', () => {
  it('loads bounded defaults when configuration is absent', () => {
    expect(readAgentRuntimePolicy(() => undefined)).toEqual(
      DEFAULT_AGENT_RUNTIME_POLICY,
    );
  });

  it('loads explicit integer configuration', () => {
    const values: Record<string, string> = {
      [AGENT_RUNTIME_CONFIG_KEYS.runTimeoutMs]: '90000',
      [AGENT_RUNTIME_CONFIG_KEYS.maxModelTurns]: '6',
      [AGENT_RUNTIME_CONFIG_KEYS.maxToolCalls]: '9',
      [AGENT_RUNTIME_CONFIG_KEYS.totalOutputTokens]: '12000',
      [AGENT_RUNTIME_CONFIG_KEYS.requestMaxTokens]: '3000',
    };
    expect(readAgentRuntimePolicy((key) => values[key])).toEqual({
      runTimeoutMs: 90_000,
      maxModelTurns: 6,
      maxToolCalls: 9,
      totalOutputTokens: 12_000,
      requestMaxTokens: 3_000,
    });
  });

  it.each([
    [AGENT_RUNTIME_CONFIG_KEYS.runTimeoutMs, '0'],
    [AGENT_RUNTIME_CONFIG_KEYS.maxModelTurns, '1.5'],
    [AGENT_RUNTIME_CONFIG_KEYS.maxToolCalls, '-1'],
    [AGENT_RUNTIME_CONFIG_KEYS.totalOutputTokens, 'NaN'],
    [
      AGENT_RUNTIME_CONFIG_KEYS.requestMaxTokens,
      String(MAX_AGENT_RUNTIME_POLICY.requestMaxTokens + 1),
    ],
  ])('fails fast for invalid %s', (key, value) => {
    expect(() =>
      readAgentRuntimePolicy((requested) =>
        requested === key ? value : undefined,
      ),
    ).toThrow(key);
  });

  it('fails fast when the per-request cap exceeds the total output budget', () => {
    expect(() =>
      readAgentRuntimePolicy((key) => {
        if (key === AGENT_RUNTIME_CONFIG_KEYS.totalOutputTokens) return '1000';
        if (key === AGENT_RUNTIME_CONFIG_KEYS.requestMaxTokens) return '1001';
        return undefined;
      }),
    ).toThrow('requestMaxTokens');
  });

  it('caps each request by configured, remaining and provider token limits', () => {
    const budget = createAgentRunBudget(POLICY);
    expect(budget.startModelRequest(40)).toMatchObject({
      maxTokens: 40,
      modelTurn: 1,
      outputTokensRemaining: 100,
    });
    budget.recordModelOutput(55);
    expect(budget.startModelRequest(500)).toMatchObject({
      maxTokens: 45,
      modelTurn: 2,
      outputTokensRemaining: 45,
    });
  });

  it('returns a stable model-turn budget code and reason', () => {
    const budget = createAgentRunBudget(POLICY);
    budget.startModelRequest();
    budget.startModelRequest();
    expect(() => budget.startModelRequest()).toThrowError(
      expect.objectContaining<Partial<AgentRuntimeBudgetExceededError>>({
        code: 'AGENT_BUDGET_002',
        reason: 'model_turn_limit_reached',
        retryable: false,
      }),
    );
  });

  it('blocks the first tool call beyond the limit without exposing arguments', () => {
    const budget = createAgentRunBudget(POLICY);
    expect(budget.beforeToolCall()).toBeUndefined();
    expect(budget.beforeToolCall()).toBeUndefined();
    expect(budget.beforeToolCall()).toEqual({
      block: true,
      terminate: true,
      reason: 'AGENT_BUDGET_003: Agent 工具调用预算已用尽',
    });
    expect(budget.termination()).toMatchObject({
      code: 'AGENT_BUDGET_003',
      reason: 'tool_call_limit_reached',
    });
  });

  it('accounts output from Pi turn_end and rejects the next model request', async () => {
    const budget = createAgentRunBudget(POLICY);
    const hooks = budget.hooks();
    budget.startModelRequest();
    hooks.observeAgentEvent(turnEndEvent(100), new AbortController().signal);
    await expect(
      hooks.shouldStopAfterTurn({} as ShouldStopAfterTurnContext),
    ).resolves.toBe(false);
    expect(() => budget.startModelRequest()).toThrowError(
      expect.objectContaining<Partial<AgentRuntimeBudgetExceededError>>({
        code: 'AGENT_BUDGET_004',
        reason: 'output_token_limit_reached',
      }),
    );
  });

  it('enforces the whole-run deadline with a stable reason', async () => {
    let now = 10_000;
    const budget = createAgentRunBudget(POLICY, { now: () => now });
    expect(budget.remainingTimeMs()).toBe(1_000);
    now += 1_000;
    expect(budget.beforeToolCall()).toMatchObject({
      block: true,
      terminate: true,
      reason: expect.stringContaining('AGENT_BUDGET_001'),
    });
    await expect(
      budget.hooks().shouldStopAfterTurn({} as ShouldStopAfterTurnContext),
    ).resolves.toBe(true);
    expect(() => budget.startModelRequest()).toThrowError(
      expect.objectContaining<Partial<AgentRuntimeBudgetExceededError>>({
        code: 'AGENT_BUDGET_001',
        reason: 'deadline_exceeded',
      }),
    );
  });

  it('provides Pi-compatible hooks and ignores an already-aborted tool hook', async () => {
    const budget = createAgentRunBudget(POLICY);
    const controller = new AbortController();
    controller.abort();
    await expect(
      budget
        .hooks()
        .beforeToolCall({} as BeforeToolCallContext, controller.signal),
    ).resolves.toBeUndefined();
    expect(budget.beforeToolCall()).toBeUndefined();
  });

  it('emits metadata-only observations and isolates observer failures', () => {
    const observations: AgentRuntimeObservation[] = [];
    const observer = new CallbackAgentRuntimeObserver((observation) => {
      observations.push({ ...observation });
      if (observation.kind === 'model_output_recorded') {
        throw new Error('telemetry unavailable');
      }
    });
    const budget = createAgentRunBudget(POLICY, { observer });
    budget.startModelRequest();
    expect(() => budget.recordModelOutput(10)).not.toThrow();
    budget.beforeToolCall();

    expect(observations.map(({ kind }) => kind)).toEqual([
      'run_started',
      'model_request_started',
      'model_output_recorded',
      'tool_call_started',
    ]);
    for (const observation of observations) {
      expect(Object.keys(observation)).not.toEqual(
        expect.arrayContaining([
          'message',
          'prompt',
          'content',
          'args',
          'result',
        ]),
      );
    }
  });
});

function turnEndEvent(output: number): AgentEvent {
  return {
    type: 'turn_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'not observed by runtime policy' }],
      api: 'openai-completions',
      provider: 'test',
      model: 'test',
      usage: {
        input: 1,
        output,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: output + 1,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    },
    toolResults: [],
  };
}
