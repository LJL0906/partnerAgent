import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { PiAgentService } from '../agent/pi-agent.service.js';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { MemoryEgressDecisionStore } from '../model-gateway/memory-egress-decision.store.js';
import { EgressDecisionError } from '../model-gateway/egress.types.js';
import type { ExternalToolApprovalService } from '../tools/confirmation-center.service.js';
import { ChatTaskEventBus, type ChatTaskEvent } from './chat-task-event.bus.js';
import type { ChatTaskNotifier } from './chat-task-notifier.js';
import { PiChatTaskScheduler } from './chat-task-scheduler.js';
import { MemoryChatTaskStore } from './memory-chat-task.store.js';

const command = {
  ownerId: 'owner',
  operationId: 'operation',
  requestFingerprint: 'fingerprint',
  clientSource: 'web',
  text: 'hello',
  inputId: 'input',
};

describe('PiChatTaskScheduler', () => {
  it('publishes task wakeups and consumes remote wakeup hints', async () => {
    const sessions = new MemorySessionStore();
    const store = new MemoryChatTaskStore(sessions);
    let wakeup: ((taskId: string) => void) | undefined;
    const notifier = {
      start: vi.fn(async (listener: (taskId: string) => void) => {
        wakeup = listener;
      }),
      notify: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } satisfies ChatTaskNotifier;
    const agent = {
      resumeTask: async function* (
        sessionId: string,
        text: string,
        ownerId: string,
      ) {
        await sessions.appendMessage(sessionId, ownerId, 'assistant', text);
        yield { type: 'done', timestamp: Date.now() };
      },
      cancel: vi.fn(),
    } as unknown as PiAgentService;
    const scheduler = new PiChatTaskScheduler(
      agent,
      store,
      new ChatTaskEventBus(),
      new MemoryEgressDecisionStore(),
      new ConfigService({ CHAT_TASK_POLL_MS: '60000' }),
      undefined,
      notifier,
    );
    await scheduler.onModuleInit();

    const local = await store.submitText(command);
    scheduler.schedule(local.task!);
    await vi.waitFor(async () =>
      expect(
        (await store.getTask(command.ownerId, local.task!.taskId))?.state,
      ).toBe('completed'),
    );
    expect(notifier.notify).toHaveBeenCalledWith(local.task!.taskId);

    const remote = await store.submitText({
      ...command,
      operationId: 'remote-operation',
      inputId: 'remote-input',
      requestFingerprint: 'remote-fingerprint',
    });
    wakeup?.(remote.task!.taskId);
    await vi.waitFor(async () =>
      expect(
        (await store.getTask(command.ownerId, remote.task!.taskId))?.state,
      ).toBe('completed'),
    );

    await scheduler.onModuleDestroy();
    expect(notifier.stop).toHaveBeenCalledOnce();
  });

  it('publishes completion only after the assistant message and terminal task are persisted', async () => {
    const sessions = new MemorySessionStore();
    const store = new MemoryChatTaskStore(sessions);
    const accepted = await store.submitText(command);
    const bus = new ChatTaskEventBus();
    const events: ChatTaskEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const agent = {
      resumeTask: async function* () {
        await sessions.appendMessage(
          accepted.task!.sessionId,
          command.ownerId,
          'assistant',
          'world',
        );
        yield { type: 'done', timestamp: Date.now() };
      },
      cancel: vi.fn(),
    } as unknown as PiAgentService;
    new PiChatTaskScheduler(
      agent,
      store,
      bus,
      new MemoryEgressDecisionStore(),
    ).schedule(accepted.task!);
    await vi.waitFor(async () =>
      expect(
        (await store.getTask(command.ownerId, accepted.task!.taskId))?.state,
      ).toBe('completed'),
    );
    const task = await store.getTask(command.ownerId, accepted.task!.taskId);
    expect(task?.resultMessageId).toBeTruthy();
    expect(events.at(-1)).toMatchObject({
      type: 'state_changed',
      state: 'completed',
    });
  });

  it('persists privacy waiting without marking the task failed', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const accepted = await store.submitText(command);
    const decisions = new MemoryEgressDecisionStore();
    const decision = await decisions.createOrGetPending({
      ownerId: command.ownerId,
      taskId: accepted.task!.taskId,
      sessionId: accepted.task!.sessionId,
      operationId: command.operationId,
      requestFingerprint: 'payload-fingerprint',
      provider: 'deepseek',
      modelId: 'model-1',
      source: 'submit_text_input',
      categories: ['secret'],
      ttlMs: 900_000,
    });
    const bus = new ChatTaskEventBus();
    const events: ChatTaskEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const agent = {
      resumeTask: async function* () {
        yield {
          type: 'privacy_decision_required',
          data: {
            result: 'pending_user_decision',
            egress_id: 'egress-1',
            categories: ['secret'],
            provider: 'deepseek',
            model_id: 'model-1',
            expires_at: '2026-09-04T12:00:00.000Z',
          },
          timestamp: Date.now(),
        };
      },
      cancel: vi.fn(),
    } as unknown as PiAgentService;
    new PiChatTaskScheduler(agent, store, bus, decisions).schedule(
      accepted.task!,
    );
    await vi.waitFor(async () =>
      expect(
        (await store.getTask(command.ownerId, accepted.task!.taskId))?.state,
      ).toBe('waiting_privacy_decision'),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'state_changed',
      state: 'waiting_privacy_decision',
      data: { egress_id: decision.id, categories: ['secret'] },
    });
  });

  it('resumes privacy waits only through the dedicated atomic claim', async () => {
    const sessions = new MemorySessionStore();
    const store = new MemoryChatTaskStore(sessions);
    const accepted = await store.submitText(command);
    await store.markRunning(accepted.task!.taskId, command.ownerId);
    await store.markWaiting(accepted.task!.taskId, command.ownerId);
    const agent = {
      resumeTask: async function* () {
        await sessions.appendMessage(
          accepted.task!.sessionId,
          command.ownerId,
          'assistant',
          'resumed',
        );
        yield { type: 'done', timestamp: Date.now() };
      },
      cancel: vi.fn(),
    } as unknown as PiAgentService;
    const scheduler = new PiChatTaskScheduler(
      agent,
      store,
      new ChatTaskEventBus(),
      new MemoryEgressDecisionStore(),
    );
    scheduler.resumeAfterPrivacyDecision(accepted.task!);
    scheduler.resumeAfterPrivacyDecision(accepted.task!);
    await vi.waitFor(async () =>
      expect(
        (await store.getTask(command.ownerId, accepted.task!.taskId))?.state,
      ).toBe('completed'),
    );
    expect(agent.cancel).not.toHaveBeenCalled();
  });

  it('redacts secrets before persisting or publishing an error', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const accepted = await store.submitText(command);
    const bus = new ChatTaskEventBus();
    const events: ChatTaskEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const agent = {
      resumeTask: async function* () {
        yield {
          type: 'error',
          data: { result: 'blocked', message: 'password=hunter2' },
          timestamp: Date.now(),
        };
      },
      cancel: vi.fn(),
    } as unknown as PiAgentService;
    new PiChatTaskScheduler(
      agent,
      store,
      bus,
      new MemoryEgressDecisionStore(),
    ).schedule(accepted.task!);
    await vi.waitFor(async () =>
      expect(
        (await store.getTask(command.ownerId, accepted.task!.taskId))?.state,
      ).toBe('failed'),
    );
    const serialized = JSON.stringify({
      task: await store.getTask(command.ownerId, accepted.task!.taskId),
      events,
    });
    expect(serialized).not.toContain('hunter2');
    expect(serialized).toContain('EGRESS_001');
  });

  it('persists a directly thrown egress safety failure with the safe code and message', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const accepted = await store.submitText(command);
    const bus = new ChatTaskEventBus();
    const events: ChatTaskEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const agent = {
      resumeTask: async function* () {
        yield* [];
        throw new EgressDecisionError('blocked', [], {
          reason: 'audit_unavailable',
        });
      },
      cancel: vi.fn(),
    } as unknown as PiAgentService;

    new PiChatTaskScheduler(
      agent,
      store,
      bus,
      new MemoryEgressDecisionStore(),
    ).schedule(accepted.task!);

    await vi.waitFor(async () =>
      expect(
        (await store.getTask(command.ownerId, accepted.task!.taskId))?.state,
      ).toBe('failed'),
    );
    expect(
      await store.getTask(command.ownerId, accepted.task!.taskId),
    ).toMatchObject({
      errorCode: 'EGRESS_001',
      errorMessage: '外发安全检查暂时不可用，本次内容未发送。',
    });
    expect(events.at(-1)).toMatchObject({
      state: 'failed',
      data: {
        code: 'EGRESS_001',
        message: '外发安全检查暂时不可用，本次内容未发送。',
      },
    });
  });

  it('recovers an expired running task when a worker starts', async () => {
    const sessions = new MemorySessionStore();
    const store = new MemoryChatTaskStore(sessions);
    const accepted = await store.submitText(command);
    await store.claimNextRunnable('crashed-worker', 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const agent = {
      resumeTask: async function* () {
        await sessions.appendMessage(
          accepted.task!.sessionId,
          command.ownerId,
          'assistant',
          'recovered',
        );
        yield { type: 'done', timestamp: Date.now() };
      },
      cancel: vi.fn(),
    } as unknown as PiAgentService;
    const scheduler = new PiChatTaskScheduler(
      agent,
      store,
      new ChatTaskEventBus(),
      new MemoryEgressDecisionStore(),
      new ConfigService({ CHAT_TASK_POLL_MS: '60000' }),
    );

    await scheduler.onModuleInit();
    await vi.waitFor(async () =>
      expect(
        (await store.getTask(command.ownerId, accepted.task!.taskId))?.state,
      ).toBe('completed'),
    );
    await scheduler.onModuleDestroy();
  });

  it('runs tasks from one session strictly in series', async () => {
    const sessions = new MemorySessionStore();
    const store = new MemoryChatTaskStore(sessions);
    const first = await store.submitText({ ...command, sessionId: 'shared' });
    const second = await store.submitText({
      ...command,
      operationId: 'operation-2',
      inputId: 'input-2',
      requestFingerprint: 'fingerprint-2',
      text: 'second',
      sessionId: 'shared',
    });
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const agent = {
      resumeTask: async function* (
        sessionId: string,
        text: string,
        ownerId: string,
      ) {
        calls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (calls === 1) await gate;
        await sessions.appendMessage(sessionId, ownerId, 'assistant', text);
        inFlight -= 1;
        yield { type: 'done', timestamp: Date.now() };
      },
      cancel: vi.fn(),
    } as unknown as PiAgentService;
    const scheduler = new PiChatTaskScheduler(
      agent,
      store,
      new ChatTaskEventBus(),
      new MemoryEgressDecisionStore(),
    );

    scheduler.schedule(first.task!);
    scheduler.schedule(second.task!);
    await vi.waitFor(() => expect(calls).toBe(1));
    releaseFirst();
    await vi.waitFor(() => expect(calls).toBe(2));
    await vi.waitFor(async () =>
      expect(
        (await store.getTask(command.ownerId, second.task!.taskId))?.state,
      ).toBe('completed'),
    );
    expect(maxInFlight).toBe(1);
  });

  it('waits for tool approval and resumes only after a fenced decision claim', async () => {
    const sessions = new MemorySessionStore();
    const store = new MemoryChatTaskStore(sessions);
    const accepted = await store.submitText(command);
    let continuationCount = 0;
    const agent = {
      resumeTask: async function* () {
        yield {
          type: 'tool_confirmation_pending',
          data: { confirmationId: 'confirmation-1' },
          timestamp: Date.now(),
        };
        yield { type: 'done', timestamp: Date.now() };
      },
      hasToolDecisionContext: vi.fn().mockResolvedValue(true),
      continueAfterToolDecision: async function* (
        sessionId: string,
        ownerId: string,
      ) {
        continuationCount += 1;
        if (continuationCount === 1) {
          yield {
            type: 'tool_confirmation_pending',
            data: { confirmationId: 'confirmation-2' },
            timestamp: Date.now(),
          };
          yield { type: 'done', timestamp: Date.now() };
          return;
        }
        await sessions.appendMessage(
          sessionId,
          ownerId,
          'assistant',
          'tool resumed',
        );
        yield { type: 'done', timestamp: Date.now() };
      },
      cancel: vi.fn(),
    } as unknown as PiAgentService;
    const scheduler = new PiChatTaskScheduler(
      agent,
      store,
      new ChatTaskEventBus(),
      new MemoryEgressDecisionStore(),
    );
    scheduler.schedule(accepted.task!);
    await vi.waitFor(async () =>
      expect(
        await store.getTask(command.ownerId, accepted.task!.taskId),
      ).toMatchObject({
        state: 'waiting_tool_approval',
        waitingToolConfirmationId: 'confirmation-1',
      }),
    );

    await expect(
      scheduler.claimToolDecision(
        accepted.task!,
        'stale-confirmation',
        'tool-call-stale',
        'external-tool',
      ),
    ).resolves.toBeUndefined();
    const claim = await scheduler.claimToolDecision(
      accepted.task!,
      'confirmation-1',
      'tool-call-1',
      'external-tool',
    );
    expect(claim).toEqual({
      confirmationId: 'confirmation-1',
      leaseToken: expect.stringContaining('tool-decision:'),
    });
    await expect(
      scheduler.claimToolDecision(
        accepted.task!,
        'confirmation-1',
        'tool-call-1',
        'external-tool',
      ),
    ).resolves.toBeUndefined();
    scheduler.resumeClaimedToolDecision(accepted.task!, claim!, {
      toolCallId: 'tool-call-1',
      toolName: 'external-tool',
      result: { content: [{ type: 'text', text: 'ok' }], details: {} },
    });
    await vi.waitFor(async () =>
      expect(
        await store.getTask(command.ownerId, accepted.task!.taskId),
      ).toMatchObject({
        state: 'waiting_tool_approval',
        waitingToolConfirmationId: 'confirmation-2',
      }),
    );
    const secondClaim = await scheduler.claimToolDecision(
      accepted.task!,
      'confirmation-2',
      'tool-call-2',
      'external-tool',
    );
    expect(secondClaim).toBeDefined();
    await scheduler.failClaimedToolDecision(
      accepted.task!,
      claim!,
      new Error('stale callback'),
    );
    await expect(
      store.getTask(command.ownerId, accepted.task!.taskId),
    ).resolves.toMatchObject({ state: 'running' });
    scheduler.resumeClaimedToolDecision(accepted.task!, secondClaim!, {
      toolCallId: 'tool-call-2',
      toolName: 'external-tool',
      result: { content: [{ type: 'text', text: 'ok again' }], details: {} },
    });
    await vi.waitFor(async () =>
      expect(
        (await store.getTask(command.ownerId, accepted.task!.taskId))?.state,
      ).toBe('completed'),
    );
  });

  it('recovers persisted tool decisions on startup', async () => {
    const sessions = new MemorySessionStore();
    const store = new MemoryChatTaskStore(sessions);
    await store.submitText({
      ...command,
      operationId: 'recover-operation',
      inputId: 'recover-input',
    });
    const claimed = await store.claimNextRunnable('seed-worker', 30_000);
    await store.markWaitingToolApproval(
      claimed!.taskId,
      claimed!.ownerId,
      'confirmation-recover',
      'seed-worker',
    );
    const continueAfterToolDecision = vi.fn(async function* () {
      await sessions.appendMessage(
        claimed!.sessionId,
        claimed!.ownerId,
        'assistant',
        'recovered',
      );
      yield { type: 'done', timestamp: Date.now() };
    });
    const agent = {
      hasToolDecisionContext: vi.fn().mockResolvedValue(true),
      continueAfterToolDecision,
      cancel: vi.fn(),
    } as unknown as PiAgentService;
    const approvals = {
      expirePendingConfirmations: vi.fn().mockResolvedValue([]),
      reconcileStaleConfirmations: vi.fn().mockResolvedValue([]),
      listRecoverableDecisions: vi.fn().mockResolvedValue([
        {
          confirmationId: 'confirmation-recover',
          ownerId: claimed!.ownerId,
          sessionId: claimed!.sessionId,
          taskId: claimed!.taskId,
          operationId: claimed!.operationId,
          tool: 'external-tool',
          toolCallId: 'tool-call-recover',
          decision: 'confirmed',
          replayed: true,
          outcome: {
            result: { content: [{ type: 'text', text: 'ok' }], details: {} },
          },
        },
      ]),
    } as unknown as ExternalToolApprovalService;
    const scheduler = new PiChatTaskScheduler(
      agent,
      store,
      new ChatTaskEventBus(),
      new MemoryEgressDecisionStore(),
      undefined,
      approvals,
    );

    await scheduler.onModuleInit();
    await vi.waitFor(async () =>
      expect(
        (await store.getTask(claimed!.ownerId, claimed!.taskId))?.state,
      ).toBe('completed'),
    );
    expect(continueAfterToolDecision).toHaveBeenCalledOnce();
    await scheduler.onModuleDestroy();
  });

  it('fails expired tool approvals and unblocks the session', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    await store.submitText({
      ...command,
      operationId: 'expired-operation',
      inputId: 'expired-input',
    });
    const claimed = await store.claimNextRunnable('seed-worker', 30_000);
    await store.markWaitingToolApproval(
      claimed!.taskId,
      claimed!.ownerId,
      'confirmation-expired',
      'seed-worker',
    );
    const approvals = {
      expirePendingConfirmations: vi.fn().mockResolvedValue([
        {
          confirmationId: 'confirmation-expired',
          ownerId: claimed!.ownerId,
          sessionId: claimed!.sessionId,
          taskId: claimed!.taskId,
          operationId: claimed!.operationId,
          tool: 'external-tool',
          toolCallId: 'tool-call-expired',
        },
      ]),
      reconcileStaleConfirmations: vi.fn().mockResolvedValue([]),
      listRecoverableDecisions: vi.fn().mockResolvedValue([]),
    } as unknown as ExternalToolApprovalService;
    const scheduler = new PiChatTaskScheduler(
      { cancel: vi.fn() } as unknown as PiAgentService,
      store,
      new ChatTaskEventBus(),
      new MemoryEgressDecisionStore(),
      undefined,
      approvals,
    );

    await scheduler.onModuleInit();
    await expect(
      store.getTask(claimed!.ownerId, claimed!.taskId),
    ).resolves.toMatchObject({
      state: 'failed',
      errorCode: 'TOOL_002',
    });
    await scheduler.onModuleDestroy();
  });

  it.each([
    ['expired', 'TOOL_002'],
    ['failed', 'TOOL_001'],
    ['indeterminate', 'TOOL_003'],
  ] as const)(
    'reconciles stale %s tool confirmation to %s',
    async (status, errorCode) => {
      const store = new MemoryChatTaskStore(new MemorySessionStore());
      await store.submitText({
        ...command,
        operationId: `stale-${status}-operation`,
        inputId: `stale-${status}-input`,
      });
      const claimed = await store.claimNextRunnable('seed-worker', 30_000);
      const confirmationId = `confirmation-${status}`;
      await store.markWaitingToolApproval(
        claimed!.taskId,
        claimed!.ownerId,
        confirmationId,
        'seed-worker',
      );
      const approvals = {
        expirePendingConfirmations: vi.fn().mockResolvedValue([]),
        reconcileStaleConfirmations: vi.fn().mockResolvedValue([
          {
            confirmationId,
            ownerId: claimed!.ownerId,
            sessionId: claimed!.sessionId,
            taskId: claimed!.taskId,
            operationId: claimed!.operationId,
            tool: 'external-tool',
            toolCallId: `tool-call-${status}`,
            status,
          },
        ]),
        listRecoverableDecisions: vi.fn().mockResolvedValue([]),
      } as unknown as ExternalToolApprovalService;
      const scheduler = new PiChatTaskScheduler(
        { cancel: vi.fn() } as unknown as PiAgentService,
        store,
        new ChatTaskEventBus(),
        new MemoryEgressDecisionStore(),
        undefined,
        approvals,
      );

      await scheduler.onModuleInit();
      await expect(
        store.getTask(claimed!.ownerId, claimed!.taskId),
      ).resolves.toMatchObject({
        state: 'failed',
        errorCode,
      });
      await scheduler.onModuleDestroy();
    },
  );
});
