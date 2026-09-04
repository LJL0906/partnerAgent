import type { ServerPushEventV1 } from '@partner-agent/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAgentEvent, loadChatReconciliation } from './use-chat';
import { useChatStore } from '../../store/chat-store';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'generated-message' }));

describe('chat REST reconciliation', () => {
  it('starts task and session queries together', async () => {
    const started: string[] = [];
    let resolveTask!: (value: { task_id: string; state: 'completed' }) => void;
    let resolveSession!: (value: {
      id: string;
      created_at: string;
      updated_at: string;
      message_count: number;
      messages: [];
    }) => void;
    const task = new Promise<{ task_id: string; state: 'completed' }>((resolve) => {
      resolveTask = resolve;
    });
    const session = new Promise<{
      id: string;
      created_at: string;
      updated_at: string;
      message_count: number;
      messages: [];
    }>((resolve) => {
      resolveSession = resolve;
    });

    const reconciliation = loadChatReconciliation('task-1', 'session-1', {
      getTaskStatus: vi.fn(() => {
        started.push('task');
        return task;
      }),
      getChatSession: vi.fn(() => {
        started.push('session');
        return session;
      }),
    });

    expect(started).toEqual(['task', 'session']);
    resolveTask({ task_id: 'task-1', state: 'completed' });
    resolveSession({
      id: 'session-1',
      created_at: '2026-09-04T00:00:00.000Z',
      updated_at: '2026-09-04T00:00:01.000Z',
      message_count: 0,
      messages: [],
    });
    const [taskResult, sessionResult] = await reconciliation;
    expect(taskResult.status).toBe('fulfilled');
    expect(sessionResult.status).toBe('fulfilled');
  });

  it('settles both results when either REST query fails', async () => {
    const [taskResult, sessionResult] = await loadChatReconciliation(
      'task-1',
      'session-1',
      {
        getTaskStatus: vi.fn(async () => {
          throw new Error('offline');
        }),
        getChatSession: vi.fn(async () => ({
          id: 'session-1',
          created_at: '2026-09-04T00:00:00.000Z',
          updated_at: '2026-09-04T00:00:01.000Z',
          message_count: 0,
          messages: [],
        })),
      },
    );

    expect(taskResult.status).toBe('rejected');
    expect(sessionResult.status).toBe('fulfilled');
  });
});

describe('chat event state merge', () => {
  beforeEach(() => {
    useChatStore.setState({
      sessionId: 'session-1',
      activeTaskId: 'task-1',
      activeOperationId: 'operation-1',
      messages: [],
      isStreaming: true,
      isThinking: true,
      connectionStatus: 'connected',
      taskStatus: 'queued',
    });
  });

  it('handles a normal delta and terminal event', () => {
    const assistantRef: { current: string | undefined } = { current: undefined };

    applyAgentEvent(event('text_delta', '你好'), assistantRef);
    applyAgentEvent(event('done', {}), assistantRef);

    expect(useChatStore.getState()).toMatchObject({
      taskStatus: 'completed',
      isStreaming: false,
      isThinking: false,
      activeTaskId: undefined,
      activeOperationId: undefined,
    });
    expect(useChatStore.getState().messages).toEqual([
      { id: 'generated-message', role: 'assistant', content: '你好' },
    ]);
  });

  it('ignores late running and text events after completion', () => {
    const assistantRef: { current: string | undefined } = { current: undefined };
    applyAgentEvent(event('text_delta', '最终回答'), assistantRef);
    applyAgentEvent(event('done', {}), assistantRef);
    const messagesAtCompletion = useChatStore.getState().messages;

    applyAgentEvent(event('task_state', { state: 'running' }), assistantRef);
    applyAgentEvent(event('text_delta', '迟到内容'), assistantRef);

    expect(useChatStore.getState().taskStatus).toBe('completed');
    expect(useChatStore.getState().messages).toEqual(messagesAtCompletion);
  });
});

function event<T extends ServerPushEventV1['event_type']>(
  eventType: T,
  data: Extract<ServerPushEventV1, { event_type: T }>['data'],
): Extract<ServerPushEventV1, { event_type: T }> {
  return {
    schema_version: 1,
    event_id: `event-${eventType}`,
    channel: 'task:task-1',
    sequence: 1,
    session_id: 'session-1',
    operation_id: 'operation-1',
    task_id: 'task-1',
    event_type: eventType,
    timestamp: 1,
    data,
  } as unknown as Extract<ServerPushEventV1, { event_type: T }>;
}
