import { describe, expect, it, vi } from 'vitest';
import type { PiAgentService } from '../agent/pi-agent.service.js';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { ChatTaskEventBus, type ChatTaskEvent } from './chat-task-event.bus.js';
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
  it('publishes completion only after the assistant message and terminal task are persisted', async () => {
    const sessions = new MemorySessionStore();
    const store = new MemoryChatTaskStore(sessions);
    const accepted = await store.submitText(command);
    const bus = new ChatTaskEventBus();
    const events: ChatTaskEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const agent = {
      chat: async function* () {
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
    new PiChatTaskScheduler(agent, store, bus).schedule(accepted.task!);
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
    const agent = {
      chat: async function* () {
        yield {
          type: 'privacy_decision_required',
          data: { result: 'pending_user_decision' },
          timestamp: Date.now(),
        };
      },
      cancel: vi.fn(),
    } as unknown as PiAgentService;
    new PiChatTaskScheduler(agent, store, new ChatTaskEventBus()).schedule(
      accepted.task!,
    );
    await vi.waitFor(async () =>
      expect(
        (await store.getTask(command.ownerId, accepted.task!.taskId))?.state,
      ).toBe('waiting_privacy_decision'),
    );
  });

  it('redacts secrets before persisting or publishing an error', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const accepted = await store.submitText(command);
    const bus = new ChatTaskEventBus();
    const events: ChatTaskEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const agent = {
      chat: async function* () {
        yield {
          type: 'error',
          data: { result: 'blocked', message: 'password=hunter2' },
          timestamp: Date.now(),
        };
      },
      cancel: vi.fn(),
    } as unknown as PiAgentService;
    new PiChatTaskScheduler(agent, store, bus).schedule(accepted.task!);
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
});
