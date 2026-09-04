import { describe, expect, it, vi } from 'vitest';
import {
  MemoryAgentRunTraceStore,
  type AgentRunTraceRecord,
} from './agent-run-trace.store.js';
import {
  AgentRunTraceQueryService,
  AgentRunTraceSink,
} from './agent-run-trace.service.js';
import { AgentRuntimeTelemetry } from '../agent/agent-runtime-telemetry.js';

describe('Agent run trace', () => {
  it('forms continuous traces for reply, two-turn tool, cancel, budget stop and approval wait', async () => {
    const store = new MemoryAgentRunTraceStore();
    const telemetry = new AgentRuntimeTelemetry(new AgentRunTraceSink(store));
    const policy = {
      runTimeoutMs: 1_000,
      maxModelTurns: 3,
      maxToolCalls: 1,
      totalOutputTokens: 100,
      requestMaxTokens: 60,
    };
    const start = (sessionId: string) =>
      telemetry.start(
        { ownerId: 'owner-a', sessionId, source: 'test' },
        policy,
      );

    const reply = start('reply');
    reply.budget.startModelRequest();
    reply.firstToken();
    reply.finish('completed');

    const tool = start('tool');
    tool.budget.startModelRequest();
    tool.toolStarted('call-a', 'get_current_time');
    tool.budget.beforeToolCall();
    tool.toolFinished('call-a', 'get_current_time', true);
    tool.budget.startModelRequest();
    tool.finish('completed');

    const cancelled = start('cancelled');
    cancelled.finish('cancelled');

    const budgeted = start('budgeted');
    budgeted.budget.beforeToolCall();
    budgeted.budget.beforeToolCall();
    budgeted.finish('failed', budgeted.budget.termination());

    const waiting = start('waiting');
    waiting.budget.startModelRequest();
    waiting.finish('waiting_tool_approval');

    await vi.waitFor(async () =>
      expect(
        (
          await store.query({
            ownerId: 'owner-a',
            from: new Date(Date.now() - 1_000),
            to: new Date(Date.now() + 1_000),
            limit: 100,
          })
        ).items.filter((event) => event.eventType === 'agent_run_finished'),
      ).toHaveLength(5),
    );
    const page = await store.query({
      ownerId: 'owner-a',
      from: new Date(Date.now() - 1_000),
      to: new Date(Date.now() + 1_000),
      limit: 100,
    });
    expect(
      page.items
        .filter((event) => event.runId === tool.runId)
        .filter((event) => event.eventType === 'agent_turn_started'),
    ).toHaveLength(2);
    expect(
      page.items
        .filter((event) => event.eventType === 'agent_run_finished')
        .map((event) => event.status),
    ).toEqual(
      expect.arrayContaining([
        'completed',
        'cancelled',
        'failed',
        'waiting_tool_approval',
      ]),
    );
    expect(
      page.items.find(
        (event) =>
          event.runId === budgeted.runId &&
          event.eventType === 'agent_run_finished',
      ),
    ).toMatchObject({ errorCode: 'AGENT_BUDGET_003' });
  });

  it('stores a continuous metadata-only run and queries it by owner', async () => {
    const store = new MemoryAgentRunTraceStore();
    const sink = new AgentRunTraceSink(store);
    const at = Date.parse('2026-09-05T00:00:00.000Z');
    const common = {
      runId: '00000000-0000-4000-8000-000000000001',
      ownerId: 'owner-a',
      sessionId: 'session-a',
      taskId: 'task-a',
      operationId: 'operation-a',
      source: 'test',
      at,
      elapsedMs: 0,
    };
    sink.record({
      ...common,
      kind: 'agent_run_started',
      policy: {
        runTimeoutMs: 1_000,
        maxModelTurns: 2,
        maxToolCalls: 1,
        totalOutputTokens: 100,
        requestMaxTokens: 60,
      },
    });
    sink.record({
      ...common,
      kind: 'agent_turn_started',
      turn: 1,
      outputTokensUsed: 0,
      outputTokensRemaining: 100,
      deadlineRemainingMs: 950,
    });
    sink.record({
      ...common,
      kind: 'agent_tool_started',
      toolCallId: 'call-a',
      toolName: 'get_current_time',
    });
    sink.record({
      ...common,
      kind: 'agent_tool_finished',
      toolCallId: 'call-a',
      toolName: 'get_current_time',
      status: 'succeeded',
      durationMs: 5,
    });
    sink.record({
      ...common,
      kind: 'agent_run_finished',
      reason: 'completed',
      modelTurnsStarted: 2,
      toolCallsStarted: 1,
      outputTokensUsed: 20,
    });
    await vi.waitFor(async () =>
      expect(
        (
          await store.query({
            ownerId: 'owner-a',
            from: new Date(at - 1),
            to: new Date(at + 1),
          })
        ).items,
      ).toHaveLength(5),
    );

    const service = new AgentRunTraceQueryService(store);
    const page = await service.query(
      {
        ownerId: 'owner-a',
        runId: common.runId,
        from: new Date(at - 1),
        to: new Date(at + 1),
        limit: 3,
      },
      new Date(at + 1),
    );
    expect(page.items.map((item) => item.eventType)).toEqual([
      'agent_run_started',
      'agent_turn_started',
      'agent_tool_started',
    ]);
    expect(page.nextCursor).toBeDefined();
    expect(
      await service.query(
        {
          ownerId: 'owner-b',
          from: new Date(at - 1),
          to: new Date(at + 1),
        },
        new Date(at + 1),
      ),
    ).toEqual({ items: [] });

    const serialized = JSON.stringify(
      await service.query(
        {
          ownerId: 'owner-a',
          from: new Date(at - 1),
          to: new Date(at + 1),
        },
        new Date(at + 1),
      ),
    );
    for (const forbidden of [
      'prompt',
      'output-body',
      'tool-arguments',
      'tool-result',
      'raw-error',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('enforces page and time-range limits', async () => {
    const service = new AgentRunTraceQueryService(
      new MemoryAgentRunTraceStore(),
    );
    const now = new Date('2026-09-05T00:00:00.000Z');
    await expect(
      service.query(
        {
          ownerId: 'owner-a',
          from: new Date('2026-08-01T00:00:00.000Z'),
          to: now,
        },
        now,
      ),
    ).rejects.toThrow('不能超过 7 天');
    await expect(
      service.query(
        {
          ownerId: 'owner-a',
          from: new Date(now.getTime() - 1_000),
          to: now,
          limit: 101,
        },
        now,
      ),
    ).rejects.toThrow('trace limit');
  });

  it('isolates asynchronous store failures', () => {
    const failingStore = {
      append: vi.fn().mockRejectedValue(new Error('db unavailable')),
      query: vi.fn(),
      prune: vi.fn().mockRejectedValue(new Error('db unavailable')),
      pruneExpired: vi.fn().mockRejectedValue(new Error('db unavailable')),
    };
    const sink = new AgentRunTraceSink(failingStore);
    expect(() =>
      sink.record({
        kind: 'agent_run_started',
        runId: '00000000-0000-4000-8000-000000000001',
        ownerId: 'owner-a',
        sessionId: 'session-a',
        source: 'test',
        at: Date.now(),
        elapsedMs: 0,
        policy: {
          runTimeoutMs: 1_000,
          maxModelTurns: 1,
          maxToolCalls: 1,
          totalOutputTokens: 10,
          requestMaxTokens: 10,
        },
      }),
    ).not.toThrow();
  });
});

void ({} as AgentRunTraceRecord);
