import type { ServerPushEventV1 } from '@partner-agent/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  desiredChannels,
  initialChatChannels,
  loadChatReconciliation,
  reconcileChatFromRest,
  createUseChatToolControls,
} from './use-chat';
import { applyAgentEvent, toPrivacyDecisionSummary } from './chat-event-state';
import { useChatStore } from '../../store/chat-store';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'generated-message' }));
vi.mock('expo-constants', () => ({ default: { expoConfig: undefined, expoGoConfig: undefined } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

describe('chat subscription bootstrap', () => {
  it('subscribes only to the owner-scoped channel before REST creates the session', () => {
    expect(initialChatChannels()).toEqual(['user:self']);
  });

  it('adds the authoritative session, task and operation channels after REST acceptance', () => {
    expect(desiredChannels('session-1', 'task-1', 'operation-1')).toEqual([
      'user:self',
      'session:session-1',
      'task:task-1',
      'operation:operation-1',
    ]);
  });
});

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

describe('canonical REST snapshot boundary', () => {
  beforeEach(() => {
    useChatStore.getState().resetChat();
    useChatStore.getState().selectSession('session-1', true);
    useChatStore.getState().addMessage({ id: 'local', role: 'user', content: 'keep until valid snapshot' });
  });

  const snapshot = () => ({
    id: 'session-1', created_at: '', updated_at: '', message_count: 1,
    messages: [{ id: 'legacy', role: 'user' as const, content: 'legacy must not replace canonical', created_at: '' }],
  });
  const queries = (data: import('../../api/chat-api').RecoverableChatSession) => ({
    getTaskStatus: vi.fn(), getChatSession: vi.fn(async () => data),
  });

  it('treats items: [] as authoritative rather than restoring legacy messages', async () => {
    await reconcileChatFromRest(undefined, 'session-1', { queries: queries({ ...snapshot(), items: [] }) });
    expect(useChatStore.getState().items).toEqual([]);
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('restores older tasks from the same session even while another task is active', async () => {
    useChatStore.getState().setActiveTaskId('current-task');
    useChatStore.getState().setActiveOperationId('current-operation');
    const item: import('@partner-agent/contracts').ChatItem = {
      schema_version: 1, id: 'historical-answer', type: 'message', status: 'completed',
      collapsed: false, created_at: 1, updated_at: 1, session_id: 'session-1',
      task_id: 'previous-task', operation_id: 'previous-operation',
      payload: { role: 'assistant', content: 'previous answer' },
    };
    await reconcileChatFromRest(undefined, 'session-1', {
      queries: queries({ ...snapshot(), items: [item] }),
    });
    expect(useChatStore.getState().items).toEqual([item]);
  });

  it('rejects a response for another session without replacing local content', async () => {
    const before = useChatStore.getState().items;
    const result = await reconcileChatFromRest(undefined, 'session-1', {
      queries: queries({ ...snapshot(), id: 'foreign', items: [] }),
    });
    expect(result[1].status).toBe('rejected');
    expect(useChatStore.getState().items).toEqual(before);
  });

  it('validates the whole item list before any store mutation', async () => {
    const before = useChatStore.getState().items;
    const invalid = { ...snapshot(), items: [{ type: 'message', payload: null }] };
    const result = await reconcileChatFromRest(undefined, 'session-1', {
      queries: queries(invalid as unknown as import('../../api/chat-api').RecoverableChatSession),
    });
    expect(result[1].status).toBe('rejected');
    expect(useChatStore.getState().items).toEqual(before);
  });

  it('still applies a valid task response if the session snapshot is malformed', async () => {
    const result = await reconcileChatFromRest('task-1', 'session-1', {
      queries: {
        getTaskStatus: async () => ({ task_id: 'task-1', state: 'failed', error: 'task failed' }),
        getChatSession: async () => ({ ...snapshot(), items: null }) as unknown as import('../../api/chat-api').RecoverableChatSession,
      },
    });
    expect(result[1].status).toBe('rejected');
    expect(useChatStore.getState().taskStatus).toBe('failed');
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
      privacyDecision: undefined,
    });
  });

  it('does not append a restored running answer to the previous turn', async () => {
    const assistantRef: { current: string | undefined } = { current: undefined };
    await reconcileChatFromRest('task-1', 'session-1', {
      assistantMessageIdRef: assistantRef,
      queries: {
        getTaskStatus: async () => ({ task_id: 'task-1', state: 'running' }),
        getChatSession: async () => ({ id: 'session-1', created_at: '', updated_at: '', message_count: 3,
          messages: [
            { id: 'u1', role: 'user', content: 'first', created_at: '' },
            { id: 'a1', role: 'assistant', content: 'old answer', created_at: '' },
            { id: 'u2', role: 'user', content: 'second', created_at: '' },
          ],
        }),
      },
    });
    applyAgentEvent(event('text_delta', 'new answer'), assistantRef);
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['first', 'old answer', 'second', 'new answer']);
  });

  it('discards a REST snapshot that resolves after session switching', async () => {
    let resolve!: (value: import('../../api/chat-api').RecoverableChatSession) => void;
    const session = new Promise<import('../../api/chat-api').RecoverableChatSession>((done) => { resolve = done; });
    const reconciling = reconcileChatFromRest(undefined, 'session-1', {
      queries: { getTaskStatus: vi.fn(), getChatSession: () => session },
    });
    useChatStore.getState().selectSession('session-2', false);
    resolve({ id: 'session-1', created_at: '', updated_at: '', message_count: 1, messages: [{ id: 'old', role: 'user', content: 'old', created_at: '' }] });
    await reconciling;
    expect(useChatStore.getState().messages).toEqual([]);
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
      expect.objectContaining({ id: 'generated-message', role: 'assistant', content: '你好' }),
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

  it('maps the safe privacy summary from a task_state event', () => {
    const assistantRef: { current: string | undefined } = { current: undefined };

    applyAgentEvent(
      event('task_state', {
        state: 'waiting_privacy_decision',
        privacy_decision: {
          egress_id: 'egress-1',
          categories: ['api_key'],
          provider: 'provider',
          model_id: 'model',
          expires_at: '2026-09-04T01:00:00.000Z',
        },
      }),
      assistantRef,
    );

    expect(useChatStore.getState()).toMatchObject({
      taskStatus: 'waiting_privacy_decision',
      privacyDecision: {
        egress_id: 'egress-1',
        categories: ['api_key'],
        provider: 'provider',
        model_id: 'model',
        expires_at: '2026-09-04T01:00:00.000Z',
      },
    });
  });
});

describe('privacy decision REST reconciliation', () => {
  beforeEach(() => {
    useChatStore.setState({
      sessionId: 'session-1',
      activeTaskId: 'task-1',
      messages: [],
      isStreaming: true,
      isThinking: false,
      taskStatus: 'waiting_privacy_decision',
      privacyDecision: {
        egress_id: 'egress-1',
        categories: ['secret'],
        provider: 'provider',
        model_id: 'model',
        expires_at: '2026-09-04T01:00:00.000Z',
      },
    });
  });

  it('applies both TaskStatus and ChatSession without inventing a final state', async () => {
    await reconcileChatFromRest('task-1', 'session-1', {
      queries: {
        getTaskStatus: vi.fn(async () => ({
          task_id: 'task-1',
          state: 'running' as const,
        })),
        getChatSession: vi.fn(async () => ({
          id: 'session-1',
          created_at: '2026-09-04T00:00:00.000Z',
          updated_at: '2026-09-04T00:00:01.000Z',
          message_count: 1,
          messages: [
            {
              id: 'message-1',
              role: 'assistant' as const,
              content: '继续处理',
              created_at: '2026-09-04T00:00:00.000Z',
            },
          ],
        })),
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      taskStatus: 'running',
      privacyDecision: undefined,
      messages: [{ id: 'message-1', role: 'assistant', content: '继续处理' }],
      isStreaming: true,
    });
  });

  it('projects only contract fields and removes unknown categories', () => {
    const summary = toPrivacyDecisionSummary({
      egress_id: 'egress-1',
      categories: ['secret', 'raw-value'] as never,
      provider: 'provider',
      model_id: 'model',
      expires_at: '2026-09-04T01:00:00.000Z',
      raw_payload: 'must-not-leak',
    } as never);

    expect(summary).toEqual({
      egress_id: 'egress-1',
      categories: ['secret'],
      provider: 'provider',
      model_id: 'model',
      expires_at: '2026-09-04T01:00:00.000Z',
    });
    expect(summary).not.toHaveProperty('raw_payload');
  });

  it('maps a TaskStatus privacy summary during REST recovery', async () => {
    await reconcileChatFromRest('task-1', undefined, {
      queries: {
        getTaskStatus: vi.fn(async () => ({
          task_id: 'task-1',
          state: 'waiting_privacy_decision' as const,
          privacy_decision: {
            egress_id: 'egress-rest',
            categories: ['bank_card' as const],
            provider: 'provider',
            model_id: 'model',
            expires_at: '2026-09-04T01:00:00.000Z',
          },
        })),
        getChatSession: vi.fn(),
      },
    });

    expect(useChatStore.getState().privacyDecision).toMatchObject({
      egress_id: 'egress-rest',
      categories: ['bank_card'],
    });
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



describe('useChat tool controls', () => {   it('exposes the injected transport through the chat-facing control API', async () => {     const transport = {       confirmTool: vi.fn(async () => ({ request_id: 'r1', action: 'confirm' as const, status: 'completed' as const })),       dismissTool: vi.fn(async () => ({ request_id: 'r2', action: 'dismiss' as const, status: 'completed' as const })),       undoTool: vi.fn(async () => ({ request_id: 'r3', action: 'undo' as const, status: 'completed' as const })),     };     const controls = createUseChatToolControls(() => 'session-1', () => transport);     await controls.confirmTool('confirmation-1');     await controls.dismissTool('confirmation-2');     await controls.undoTool('execution-1');     expect(transport.confirmTool).toHaveBeenCalledWith({ session_id: 'session-1', confirmation_id: 'confirmation-1' });     expect(transport.dismissTool).toHaveBeenCalledWith({ session_id: 'session-1', confirmation_id: 'confirmation-2' });     expect(transport.undoTool).toHaveBeenCalledWith({ session_id: 'session-1', execution_id: 'execution-1' });   }); });
