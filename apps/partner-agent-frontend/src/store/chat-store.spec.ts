import { beforeEach, describe, expect, it } from 'vitest';

import {
  mergeChatMessages,
  mergeChatTaskStatus,
  useChatStore,
  type ChatMessage,
  type ChatTaskStatus,
} from './chat-store';

const terminalStatuses: ChatTaskStatus[] = ['completed', 'cancelled', 'failed'];

describe('chat task status merge', () => {
  beforeEach(() => {
    useChatStore.setState({
      activeTaskId: undefined,
      activeOperationId: undefined,
      messages: [],
      isStreaming: false,
      isThinking: false,
      connectionStatus: 'idle',
      taskStatus: 'idle',
      privacyDecision: undefined,
    });
  });

  it.each(terminalStatuses)('keeps the first %s terminal state', (terminal: ChatTaskStatus) => {
    expect(mergeChatTaskStatus(terminal, 'queued')).toBe(terminal);
    expect(mergeChatTaskStatus(terminal, 'running')).toBe(terminal);
    for (const laterTerminal of terminalStatuses) {
      expect(mergeChatTaskStatus(terminal, laterTerminal)).toBe(terminal);
    }
  });

  it('reports whether a task status update was accepted', () => {
    const state = useChatStore.getState();

    expect(state.setTaskStatus('completed')).toBe(true);
    expect(useChatStore.getState().setTaskStatus('running')).toBe(false);
    expect(useChatStore.getState().taskStatus).toBe('completed');
  });

  it('does not move a running task back to queued', () => {
    expect(mergeChatTaskStatus('running', 'queued')).toBe('running');
  });

  it('starts a new task explicitly after a previous terminal task', () => {
    useChatStore.setState({
      activeTaskId: 'old-task',
      activeOperationId: 'old-operation',
      taskStatus: 'failed',
    });

    useChatStore.getState().beginTask();

    expect(useChatStore.getState()).toMatchObject({
      activeTaskId: undefined,
      activeOperationId: undefined,
      isStreaming: true,
      isThinking: true,
      taskStatus: 'queued',
    });
  });

  it('clears the privacy summary when the task leaves the waiting state', () => {
    useChatStore.setState({
      taskStatus: 'waiting_privacy_decision',
      privacyDecision: {
        egress_id: 'egress-1',
        categories: ['secret'],
        provider: 'provider',
        model_id: 'model',
        expires_at: '2026-09-04T01:00:00.000Z',
      },
    });

    useChatStore.getState().setTaskStatus('running');

    expect(useChatStore.getState().privacyDecision).toBeUndefined();
  });

  it('resets all chat data on logout', () => {
    useChatStore.setState({
      sessionId: 'session-1',
      activeTaskId: 'task-1',
      activeOperationId: 'operation-1',
      messages: [{ id: 'message-1', role: 'user', content: '敏感消息' }],
      isStreaming: true,
      isThinking: true,
      connectionStatus: 'connected',
      taskStatus: 'waiting_privacy_decision',
      privacyDecision: {
        egress_id: 'egress-1',
        categories: ['secret'],
        provider: 'provider',
        model_id: 'model',
        expires_at: '2026-09-04T01:00:00.000Z',
      },
    });

    useChatStore.getState().resetChat();

    expect(useChatStore.getState()).toMatchObject({
      sessionId: '',
      activeTaskId: undefined,
      activeOperationId: undefined,
      messages: [],
      isStreaming: false,
      isThinking: false,
      connectionStatus: 'idle',
      taskStatus: 'idle',
      privacyDecision: undefined,
    });
  });
});

describe('chat message reconciliation', () => {
  beforeEach(() => {
    useChatStore.setState({ messages: [] });
  });

  it('replaces optimistic and streaming messages with stable REST messages', () => {
    const current: ChatMessage[] = [
      { id: 'system-1', role: 'system', content: '连接已恢复' },
      { id: 'optimistic-user', role: 'user', content: '请继续' },
      { id: 'tool-1', role: 'tool', content: '正在执行', toolCallId: 'call-1' },
      { id: 'streaming-assistant', role: 'assistant', content: '已经处' },
    ];
    const recovered: ChatMessage[] = [
      { id: 'server-user', role: 'user', content: '请继续' },
      { id: 'server-assistant', role: 'assistant', content: '已经处理完成' },
    ];

    const merged = mergeChatMessages(current, recovered);

    expect(merged).toEqual(
      expect.arrayContaining([
        current[0],
        current[2],
        recovered[0],
        recovered[1],
      ]),
    );
    expect(merged.map((message) => message.id)).not.toContain('optimistic-user');
    expect(merged.map((message) => message.id)).not.toContain('streaming-assistant');
  });

  it('does not duplicate user or assistant messages on repeated REST recovery', () => {
    const recovered: ChatMessage[] = [
      { id: 'server-user', role: 'user', content: '同一条问题' },
      { id: 'server-assistant', role: 'assistant', content: '同一条回答' },
    ];

    useChatStore.getState().reconcileMessages(recovered);
    useChatStore.getState().reconcileMessages(recovered);

    expect(useChatStore.getState().messages).toEqual(recovered);
  });

  it('keeps newer assistant deltas while adopting the stable REST id', () => {
    const recovered: ChatMessage[] = [
      { id: 'server-assistant', role: 'assistant', content: '已经处理完成' },
    ];

    useChatStore.setState({
      messages: [
        {
          id: 'streaming-assistant',
          role: 'assistant',
          content: '已经处理完成，并继续生成',
        },
      ],
    });

    useChatStore.getState().reconcileMessages(recovered);
    useChatStore.getState().reconcileMessages(recovered);

    expect(useChatStore.getState().messages).toEqual([
      {
        id: 'server-assistant',
        role: 'assistant',
        content: '已经处理完成，并继续生成',
      },
    ]);
  });

  it('keeps distinct repeated messages returned by the server', () => {
    const merged = mergeChatMessages(
      [{ id: 'optimistic-user', role: 'user', content: '再试一次' }],
      [
        { id: 'server-user-1', role: 'user', content: '再试一次' },
        { id: 'server-user-2', role: 'user', content: '再试一次' },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((message) => message.id)).toEqual(['server-user-1', 'server-user-2']);
  });

  it('binds an optimistic user message to the stable server id', () => {
    useChatStore.setState({
      messages: [{ id: 'optimistic-user', role: 'user', content: '保存我' }],
    });

    useChatStore.getState().bindOptimisticMessageId('optimistic-user', 'server-user');

    expect(useChatStore.getState().messages).toEqual([
      { id: 'server-user', role: 'user', content: '保存我' },
    ]);
  });

  it('removes the optimistic duplicate when the stable message already exists', () => {
    useChatStore.setState({
      messages: [
        { id: 'optimistic-user', role: 'user', content: '保存我' },
        { id: 'server-user', role: 'user', content: '保存我' },
        { id: 'system-1', role: 'system', content: '保留' },
      ],
    });

    useChatStore.getState().bindOptimisticMessageId('optimistic-user', 'server-user');

    expect(useChatStore.getState().messages).toEqual([
      { id: 'server-user', role: 'user', content: '保存我' },
      { id: 'system-1', role: 'system', content: '保留' },
    ]);
  });
});
