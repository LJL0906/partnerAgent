import { parseSubmitTextInputCommandResult, type ChatSessionSummary,
  type SubmitTextInputCommandResult } from '@partner-agent/contracts';
import fixture from '@partner-agent/contracts/fixtures/chat-session-v1.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentStreamConnection } from '@/api/agent-stream';
import { useChatStore } from '@/store/chat-store';

import { sendChatMessage, type PendingChatSubmission } from './chat-message-submission';
import { applyAgentEvent } from './chat-event-state';
import { reconcileChatFromRest } from './use-chat';

const mocks = vi.hoisted(() => ({ uuid: 0 }));
const operationId = '11111111-1111-4111-8111-111111111111';

vi.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${++mocks.uuid}` }));
vi.mock('expo-constants', () => ({ default: { expoConfig: undefined, expoGoConfig: undefined } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

describe('chat message submission', () => {
  beforeEach(() => {
    mocks.uuid = 0;
    useChatStore.getState().resetChat();
    useChatStore.getState().setSessionId('session-1');
  });

  it('returns failure while the stream is unavailable so the draft is preserved', async () => {
    const reportError = vi.fn();
    const submitted = await sendChatMessage('保留草稿', {
      ...refs(),
      reconcileFromRest: vi.fn(),
      reportError,
      streamReadyRef: { current: undefined },
      submit: vi.fn(),
    });

    expect(submitted).toBe(false);
    expect(reportError).toHaveBeenCalledOnce();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('ignores a submitted message response after the user switches sessions', async () => {
    let resolve!: (value: SubmitTextInputCommandResult) => void;
    const submit = vi.fn<Submit>(() => new Promise((done) => { resolve = done; }));
    const connection = fakeConnection();
    const sending = sendChatMessage('旧会话', {
      ...refs(), reconcileFromRest: vi.fn(), reportError: vi.fn(),
      streamReadyRef: { current: Promise.resolve(connection) }, submit,
    });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    useChatStore.getState().selectSession('session-2', false);
    resolve(acceptedResult());
    expect(await sending).toBe(false);
    expect(useChatStore.getState()).toMatchObject({ sessionId: 'session-2', messages: [], activeTaskId: undefined });
    expect(connection.setChannels).not.toHaveBeenCalled();
  });

  it('does not expose an operation channel before the server has persisted its ownership', async () => {
    let resolve!: (value: SubmitTextInputCommandResult) => void;
    const submit = vi.fn<Submit>(() => new Promise((done) => { resolve = done; }));
    const sending = sendChatMessage('避免提前订阅', {
      ...refs(), reconcileFromRest: vi.fn(), reportError: vi.fn(),
      streamReadyRef: { current: Promise.resolve(fakeConnection()) }, submit,
    });

    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(useChatStore.getState().activeOperationId).toBeUndefined();
    resolve(acceptedResult());
    await expect(sending).resolves.toBe(true);
  });

  it('reuses ids and the optimistic message when an explicit REST retry succeeds', async () => {
    const submit = vi
      .fn<Submit>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(acceptedResult());
    const sharedRefs = refs();
    const connection = fakeConnection();
    const context = {
      ...sharedRefs,
      reconcileFromRest: vi.fn(async () => undefined),
      reportError: vi.fn(),
      streamReadyRef: { current: Promise.resolve(connection) },
      submit,
    };

    await expect(sendChatMessage('同一条消息', context)).resolves.toBe(false);
    expect(useChatStore.getState().taskStatus).toBe('recovering');
    expect(sharedRefs.currentTaskIdRef.current).toBe('__pending_task__');
    expect(sharedRefs.pendingSubmissionRef.current).toMatchObject({ inputId: 'uuid-1', operationId: 'uuid-2' });
    await expect(sendChatMessage('同一条消息', context)).resolves.toBe(true);

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      inputId: 'uuid-1',
      operationId: 'uuid-2',
    });
    expect(submit.mock.calls[1]?.[0]).toMatchObject({
      inputId: 'uuid-1',
      operationId: 'uuid-2',
    });
    expect(useChatStore.getState().messages.filter((message) => message.role === 'user')).toEqual([
      expect.objectContaining({ id: 'message:message-user-1', role: 'user', content: '同一条消息' }),
    ]);
    expect(sharedRefs.pendingSubmissionRef.current).toBeUndefined();
  });

  it('allows a late authoritative event to recover an unknown HTTP result', async () => {
    const sharedRefs = refs();
    await sendChatMessage('迟到成功', {
      ...sharedRefs, reconcileFromRest: vi.fn(async () => undefined), reportError: vi.fn(),
      streamReadyRef: { current: Promise.resolve(fakeConnection()) },
      submit: vi.fn<Submit>().mockRejectedValue(new TypeError('network disconnected')),
    });
    expect(useChatStore.getState().taskStatus).toBe('recovering');
    applyAgentEvent({ schema_version: 1, event_id: 'late', channel: 'operation:uuid-2', sequence: 1,
      session_id: 'session-1', task_id: 'task-1', operation_id: 'uuid-2', event_type: 'text_delta',
      timestamp: 1, item_id: 'task:task-1:assistant', item_revision: 1,
      message_id: 'assistant-message', text_offset: 0, data: '已受理' }, sharedRefs.assistantMessageIdRef);
    expect(useChatStore.getState().taskStatus).toBe('running');
    expect(useChatStore.getState().messages).toContainEqual(
      expect.objectContaining({ id: 'task:task-1:assistant', content: '已受理' }),
    );
    expect(useChatStore.getState().messages.some((message) =>
      message.content.includes('尚未确认'))).toBe(false);
  });

  it('does not send a local-only session id before the first message is accepted', async () => {
    const submit = vi.fn<Submit>().mockResolvedValue(acceptedResult());
    await sendChatMessage('创建正式会话', {
      ...refs(), reconcileFromRest: vi.fn(), reportError: vi.fn(),
      streamReadyRef: { current: Promise.resolve(fakeConnection()) }, submit,
    });
    expect(submit.mock.calls[0]?.[0]).not.toHaveProperty('sessionId');
  });

  it('always submits the normal chat mode so the Agent can recognize intent', async () => {
    const chatSubmit = vi.fn<Submit>().mockResolvedValue(acceptedResult());
    await sendChatMessage('帮我安排周一提交周报', {
      ...refs(), reconcileFromRest: vi.fn(), reportError: vi.fn(),
      streamReadyRef: { current: Promise.resolve(fakeConnection()) }, submit: chatSubmit,
    });
    expect(chatSubmit).toHaveBeenCalledWith(expect.objectContaining({ outputMode: 'chat' }));
  });

  it('clears the pending retry identity after REST returns its authoritative user item', async () => {
    const recovered = structuredClone(fixture.snapshot) as ChatSessionSummary;
    recovered.active_task = { task_id: 'task-1', operation_id: operationId, state: 'running' };
    const sharedRefs = refs();
    sharedRefs.pendingSubmissionRef.current = {
      inputId: 'input-1', operationId, optimisticMessageId: 'optimistic-user',
      sessionId: 'session-1', text: '帮我安排周一提交周报',
    };
    await sendChatMessage('帮我安排周一提交周报', {
      ...sharedRefs,
      reconcileFromRest: async (taskId, sessionId) => {
        await reconcileChatFromRest(taskId, sessionId, { queries: {
          getTaskStatus: vi.fn(), getChatSession: vi.fn(async () => recovered),
        } });
      },
      reportError: vi.fn(), streamReadyRef: { current: Promise.resolve(fakeConnection()) },
      submit: vi.fn<Submit>().mockRejectedValue(new TypeError('response lost')),
    });

    expect(sharedRefs.pendingSubmissionRef.current).toBeUndefined();
    expect(sharedRefs.currentTaskIdRef.current).toBe('task-1');
    expect(useChatStore.getState()).toMatchObject({ taskStatus: 'running', isStreaming: true });
    expect(useChatStore.getState().messages.some((message) =>
      message.content.includes('尚未确认'))).toBe(false);
  });
});

type Submit = NonNullable<Parameters<typeof sendChatMessage>[1]['submit']>;

function refs() {
  return {
    assistantMessageIdRef: { current: undefined },
    currentTaskIdRef: { current: undefined },
    pendingSubmissionRef: { current: undefined as PendingChatSubmission | undefined },
    previousTaskIdRef: { current: undefined },
    modelConfigId: 'deepseek:deepseek-v4-flash',
    reasoningLevel: 'medium' as const,
  };
}

function acceptedResult(): SubmitTextInputCommandResult {
  return parseSubmitTextInputCommandResult(fixture.submit_result);
}

function fakeConnection(): AgentStreamConnection {
  const connection = (() => undefined) as AgentStreamConnection;
  connection.close = vi.fn();
  connection.getChannels = vi.fn(() => ['user:self' as const]);
  connection.setChannels = vi.fn(async () => ({}));
  connection.subscribe = vi.fn(async () => ({ request_id: 'request', accepted: [], rejected: [] }));
  connection.unsubscribe = vi.fn(async () => undefined);
  return connection;
}

