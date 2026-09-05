import { describe, expect, it } from 'vitest';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { MemoryChatTaskStore } from './memory-chat-task.store.js';
import { LocalCoreApplicationService } from './local-core-application.service.js';
import type { ConfirmationTransactionService } from './confirmation-transaction.service.js';
import type { ChatTaskScheduler } from './chat-task-scheduler.js';
import type { PrivacyDecisionService } from './privacy-decision.service.js';

describe('会话列表与恢复', () => {
  it('isolates owners and recovers the oldest active task separately from latest', async () => {
    const sessions = new MemorySessionStore();
    const tasks = new MemoryChatTaskStore(sessions);
    const app = new LocalCoreApplicationService(
      sessions,
      {} as ConfirmationTransactionService,
      tasks,
      {} as ChatTaskScheduler,
      {} as PrivacyDecisionService,
    );
    const submit = (ownerId: string, inputId: string, sessionId?: string) =>
      tasks.submitText({
        ownerId,
        inputId,
        operationId: inputId,
        requestFingerprint: inputId,
        clientSource: 'test',
        text: '讨论\n  聊天恢复',
        ...(sessionId ? { sessionId } : {}),
      });
    const first = await submit('a', 'first');
    const sessionId = first.task!.sessionId;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await submit('a', 'second', sessionId);
    await submit('b', 'private');
    const result = await app.executeQuery('ListChatSessions', {
      userId: 'a',
      input: {},
    });
    expect(result).toMatchObject({
      items: [
        {
          id: sessionId,
          title: '讨论 聊天恢复',
          message_count: 2,
          active_task: {
            task_id: first.task!.taskId,
            operation_id: 'first',
            state: 'queued',
          },
          latest_task: {
            task_id: second.task!.taskId,
            operation_id: 'second',
            state: 'queued',
          },
        },
      ],
    });
    expect((result as { items: unknown[] }).items).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('contextMessages');
    await expect(
      app.executeQuery('GetChatSession', {
        userId: 'b',
        input: { session_id: sessionId },
      }),
    ).rejects.toThrow();
    expect(await tasks.getSessionTaskRefs('b', sessionId)).toEqual({});
    await tasks.markRunning(first.task!.taskId, 'a');
    await tasks.markCompleted(first.task!.taskId, 'a');
    expect(await tasks.getSessionTaskRefs('a', sessionId)).toMatchObject({
      active_task: { task_id: second.task!.taskId },
    });
    const restored = await app.executeQuery('GetChatSession', {
      userId: 'a',
      input: { session_id: sessionId },
    });
    expect(restored).toMatchObject({
      messages: [
        { content: '讨论\n  聊天恢复' },
        { content: '讨论\n  聊天恢复' },
      ],
    });
  });

  it('sorts owner sessions by recent activity and returns an empty initial list', async () => {
    const sessions = new MemorySessionStore();
    await expect(sessions.list('a')).resolves.toEqual([]);
    await sessions.createIfAllowed('older', 'a', 10);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await sessions.createIfAllowed('newer', 'a', 10);
    expect((await sessions.list('a')).map((item) => item.id)).toEqual([
      'newer',
      'older',
    ]);
  });
});
