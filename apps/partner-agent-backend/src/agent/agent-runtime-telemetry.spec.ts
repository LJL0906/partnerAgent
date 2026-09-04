import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRuntimePolicy } from './agent-runtime-policy.js';
import {
  AgentRunTrace,
  AgentRuntimeTelemetry,
} from './agent-runtime-telemetry.js';
import { InMemoryObservabilitySink } from '../observability/observability.types.js';

const POLICY: AgentRuntimePolicy = {
  runTimeoutMs: 1_000,
  maxModelTurns: 2,
  maxToolCalls: 1,
  totalOutputTokens: 100,
  requestMaxTokens: 60,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('AgentRunTrace', () => {
  it('emits bounded metadata, timings and stable budget failure labels', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T00:00:00.000Z'));
    const events: Record<string, unknown>[] = [];
    const longLabel = `unsafe\n${'x'.repeat(200)}`;
    const trace = new AgentRunTrace(
      {
        ownerId: 'owner-a',
        sessionId: longLabel,
        taskId: 'task\u0000id',
        operationId: 'operation\tid',
        source: 'source\rname',
      },
      (event) => events.push(event),
    );

    trace.attachBudget(POLICY);
    trace.budget.startModelRequest();
    trace.firstToken();
    trace.firstToken();
    trace.toolStarted(longLabel, 'tool\nname');
    vi.advanceTimersByTime(25);
    trace.toolFinished(longLabel, 'tool\nname', true);
    trace.budget.beforeToolCall();
    trace.budget.beforeToolCall();
    trace.finish('failed', trace.budget.termination());

    expect(
      events.filter(({ event }) => event === 'agent_runtime.first_token'),
    ).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'agent_runtime.tool_finished',
        tool_name: 'tool_name',
        success: true,
        elapsed_ms: 25,
      }),
    );
    expect(events.at(-1)).toMatchObject({
      event: 'agent_runtime.run_finished',
      reason: 'failed',
      failure_code: 'AGENT_BUDGET_003',
      failure_reason: 'tool_call_limit_reached',
    });

    for (const event of events) {
      expectSafeLabel(event.session_id);
      expectSafeLabel(event.task_id);
      expectSafeLabel(event.operation_id);
      expectSafeLabel(event.source);
      if (event.tool_call_id) expectSafeLabel(event.tool_call_id);
      if (event.tool_name) expectSafeLabel(event.tool_name);
      expect(Object.keys(event)).not.toEqual(
        expect.arrayContaining([
          'message',
          'prompt',
          'content',
          'args',
          'result',
          'error',
        ]),
      );
    }
  });

  it('never lets a telemetry writer failure alter runtime behavior', () => {
    const trace = new AgentRunTrace(
      { ownerId: 'owner-a', sessionId: 'session-a', source: 'test' },
      () => {
        throw new Error('telemetry unavailable');
      },
    );

    expect(() => trace.attachBudget(POLICY)).not.toThrow();
    expect(() => trace.firstToken()).not.toThrow();
    expect(() => trace.toolStarted('call-a', 'tool-a')).not.toThrow();
    expect(() => trace.toolFinished('call-a', 'tool-a', false)).not.toThrow();
    expect(() => trace.finish('completed')).not.toThrow();
  });

  it('emits typed run, turn, tool, waiting, cancellation and budget metadata', () => {
    const sink = new InMemoryObservabilitySink();
    const telemetry = new AgentRuntimeTelemetry(sink);
    const trace = telemetry.start(
      { ownerId: 'owner-a', sessionId: 'session-a', source: 'test' },
      POLICY,
    );
    trace.budget.startModelRequest();
    trace.toolStarted('call-a', 'tool-a');
    trace.budget.beforeToolCall();
    trace.toolFinished('call-a', 'tool-a', true);
    trace.finish('waiting_tool_approval');

    const cancelled = telemetry.start(
      { ownerId: 'owner-a', sessionId: 'session-b', source: 'test' },
      POLICY,
    );
    cancelled.finish('cancelled');

    const budgeted = telemetry.start(
      { ownerId: 'owner-a', sessionId: 'session-c', source: 'test' },
      { ...POLICY, maxToolCalls: 1 },
    );
    budgeted.budget.beforeToolCall();
    budgeted.budget.beforeToolCall();
    budgeted.finish('failed', budgeted.budget.termination());

    expect(sink.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'agent_run_started' }),
        expect.objectContaining({ kind: 'agent_turn_started', turn: 1 }),
        expect.objectContaining({
          kind: 'agent_tool_finished',
          status: 'succeeded',
        }),
        expect.objectContaining({
          kind: 'agent_run_finished',
          reason: 'waiting_tool_approval',
        }),
        expect.objectContaining({
          kind: 'agent_run_finished',
          reason: 'cancelled',
        }),
        expect.objectContaining({
          kind: 'agent_run_finished',
          reason: 'failed',
          errorCode: 'AGENT_BUDGET_003',
        }),
      ]),
    );
  });

  it('fails fast when a trace is used before its budget is attached', () => {
    const trace = new AgentRunTrace(
      { ownerId: 'owner-a', sessionId: 'session-a', source: 'test' },
      () => undefined,
    );
    expect(() => trace.budget).toThrow('尚未初始化');
  });
});

function expectSafeLabel(value: unknown): void {
  const label = String(value);
  expect(label.length).toBeLessThanOrEqual(128);
  expect(
    [...label].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    }),
  ).toBe(false);
}
