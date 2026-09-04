import type { CommandResult, SubmitTextInputResult } from '@partner-agent/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentStreamConnection } from '@/api/agent-stream';
import { useChatStore } from '@/store/chat-store';

import { sendChatMessage, type PendingChatSubmission } from './chat-message-submission';

const mocks = vi.hoisted(() => ({ uuid: 0 }));

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
      { id: 'message-1', role: 'user', content: '同一条消息' },
    ]);
    expect(sharedRefs.pendingSubmissionRef.current).toBeUndefined();
  });
});

type Submit = NonNullable<Parameters<typeof sendChatMessage>[1]['submit']>;

function refs() {
  return {
    assistantMessageIdRef: { current: undefined },
    currentTaskIdRef: { current: undefined },
    pendingSubmissionRef: { current: undefined as PendingChatSubmission | undefined },
    previousTaskIdRef: { current: undefined },
  };
}

function acceptedResult(): CommandResult<SubmitTextInputResult> {
  return {
    operation_id: 'uuid-2',
    status: 'accepted',
    task_refs: [{ task_id: 'task-1', kind: 'chat_response' }],
    resource_refs: [{ kind: 'chat_message', id: 'message-1' }],
  };
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
