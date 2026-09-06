import type { ServerPushEventV1 } from '@partner-agent/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildChatItemsSnapshot,
  mapServerPushEventToChatItems,
  mergeChatItems,
  previewCandidate,
} from './chat-item-adapter.js';

describe('chat item adapter', () => {
  it('keeps each persisted message identity and state instead of attaching latest task metadata', () => {
    const snapshot = buildChatItemsSnapshot([
      {
        id: 'message-1', role: 'user', content: '第一轮', created_at: '2026-09-05T10:00:00.000Z',
        sequence: 1, status: 'complete', session_id: 'session-1', task_id: 'task-1', operation_id: 'op-1',
        model_config_id: 'model-a', reasoning_level: 'low', metadata: { source: 'first' },
      },
      {
        id: 'message-2', role: 'assistant', content: '第二轮', created_at: '2026-09-05T10:02:00.000Z',
        sequence: 2, status: 'failed', session_id: 'session-1', task_id: 'task-2', operation_id: 'op-2',
        model_config_id: 'model-b', reasoning_level: 'high', metadata: { source: 'second' },
      },
    ]);

    expect(snapshot).toEqual([
      expect.objectContaining({ id: 'message-1', status: 'completed', sequence: 1, task_id: 'task-1', operation_id: 'op-1',
        payload: expect.objectContaining({ role: 'user', content: '第一轮', model_config_id: 'model-a', reasoning_level: 'low', metadata: { source: 'first' } }) }),
      expect.objectContaining({ id: 'message-2', status: 'failed', sequence: 2, task_id: 'task-2', operation_id: 'op-2',
        payload: expect.objectContaining({ role: 'assistant', content: '第二轮', model_config_id: 'model-b', reasoning_level: 'high', metadata: { source: 'second' } }) }),
    ]);
  });

  it('maps persisted messages and task state into a recoverable ChatItem snapshot', () => {
    const snapshot = buildChatItemsSnapshot(
      [
        {
          id: 'message-1',
          role: 'user',
          content: '帮我整理今天的事项',
          created_at: '2026-09-05T10:00:00.000Z',
        },
      ],
      {
        taskId: 'task-1',
        ownerId: 'owner-a',
        sessionId: 'session-1',
        operationId: 'op-1',
        state: 'waiting_privacy_decision',
        updatedAt: new Date('2026-09-05T10:01:00.000Z'),
      },
    );

    expect(snapshot).toEqual([
      expect.objectContaining({
        id: 'message-1',
        type: 'message',
        sequence: 1,
        session_id: 'session-1',
        message_id: 'message-1',
        payload: { role: 'user', content: '帮我整理今天的事项', format: 'text' },
      }),
      expect.objectContaining({
        id: 'task:task-1:runtime',
        type: 'runtime',
        status: 'pending',
        task_id: 'task-1',
        operation_id: 'op-1',
        payload: { state: 'waiting_privacy_decision' },
      }),
    ]);
  });

  it('maps WS v1 tool, privacy, candidate and error events without exposing raw data', () => {
    const events = [
      event('tool_confirmation_pending', 'event-approval', {
        confirmation_id: 'approval-1',
        tool: 'calendar.create',
        tool_call_id: 'call-1',
        risk_level: 'medium',
        request_summary: '创建日历事项',
        expires_at: 1_800_000_000_000,
      }),
      event('candidate', 'event-candidate', {
        candidate_refs: [{ kind: 'candidate', id: 'candidate-1' }],
        safe_summary: '建议创建一个行动项',
        risk_level: 'normal',
      }),
      event('error', 'event-error', { code: 'MODEL_002', message: 'Bearer sk-test-secret' }),
    ] as ServerPushEventV1[];

    const items = events.flatMap(mapServerPushEventToChatItems);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'approval', approval_id: 'approval-1', payload: expect.objectContaining({ request_summary: '创建日历事项' }) }),
      expect.objectContaining({ type: 'candidate', candidate_id: 'candidate-1', payload: expect.objectContaining({ applied: false, preview: { summary: '建议创建一个行动项' } }) }),
      expect.objectContaining({ type: 'error', payload: { code: 'MODEL_002', message: 'Bearer [REDACTED]' } }),
    ]));
    expect(JSON.stringify(items)).not.toContain('sk-test-secret');
  });

  it('deduplicates by stable id and absorbs terminal state updates', () => {
    const streaming = mapServerPushEventToChatItems(event('task_state', 'state-1', { state: 'running', privacy_decision: { egress_id: 'egress-1' } }))[0];
    const completed = mapServerPushEventToChatItems(event('done', 'done-1', {}))[0];
    const merged = mergeChatItems([streaming], completed);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(expect.objectContaining({ id: 'task:task-1:runtime', status: 'completed', payload: { state: 'completed' } }));
    expect(mergeChatItems(merged, completed)).toHaveLength(1);
  });

  it('prints candidate preview as safe structured data and never marks it applied', () => {
    expect(previewCandidate({ candidate_id: 'candidate-1', kind: 'action', title: '整理', apiKey: 'secret-value', nested: { raw: 'hidden' }, list: [{ token: 'nested-secret' }] })).toEqual({
      candidate_id: 'candidate-1', kind: 'action', applied: false,
      preview: { title: '整理', apiKey: '[REDACTED]', nested: { raw: '[REDACTED]' }, list: [{ token: '[REDACTED]' }] },
      sensitive_marks: ['apiKey', 'nested.raw', 'list.0.token'],
    });
  });
});

function event(event_type: ServerPushEventV1['event_type'], event_id: string, data: unknown): ServerPushEventV1 {
  return {
    schema_version: 1,
    event_id,
    channel: 'session:session-1',
    sequence: 1,
    session_id: 'session-1',
    operation_id: 'op-1',
    task_id: 'task-1',
    event_type,
    timestamp: 1_757_000_000_000,
    data,
  } as ServerPushEventV1;
}
