import type { ChatPreviewV1, SessionMessageDto, SessionToolView } from '@partner-agent/contracts';
import { describe, expect, it } from 'vitest';
import { buildChatItemsSnapshot } from './chat-item-adapter.js';

const operationId = '11111111-1111-4111-8111-111111111111';

describe('buildChatItemsSnapshot', () => {
  it('builds recoverable message, runtime, safe tool and preview items', () => {
    const messages: SessionMessageDto[] = [
      {
        id: 'message-user-1', session_id: 'session-1', sequence: 1, role: 'user',
        content: '安排周报', status: 'complete', operation_id: operationId,
        model_config_id: 'deepseek:deepseek-chat', reasoning_level: 'off', revision: 1,
        created_at: '2026-09-06T08:00:00.000Z',
      },
      {
        id: 'message-assistant-1', session_id: 'session-1', sequence: 2, role: 'assistant',
        content: '', status: 'complete', task_id: 'task-1', operation_id: operationId,
        model_config_id: 'deepseek:deepseek-chat', reasoning_level: 'off', revision: 3,
        thinking_summary: '先核对时间，再比较两个提醒方案。',
        created_at: '2026-09-06T08:00:02.000Z',
      },
    ];
    const toolViews: SessionToolView[] = [{
      session_id: 'session-1', tool_call_id: 'tool-call-1', confirmation_id: 'confirmation-1',
      task_id: 'task-1', operation_id: operationId, tool_name: 'send_message', status: 'pending',
      version: 2, request_summary: '发送周报', risk_level: 'high',
      allowed_actions: ['confirm', 'dismiss'],
    }];
    const preview: ChatPreviewV1 = {
      schema_version: 1, preview_id: 'preview-1', kind: 'action',
      confirmation_status: 'unconfirmed', applied: false,
      source_refs: [{ kind: 'chat_message', id: 'message-user-1' }],
      content: { title: '提交周报', confidence: 0.9 }, warnings: [],
    };

    const items = buildChatItemsSnapshot({
      messages,
      tasks: [{
        taskId: 'task-1', sessionId: 'session-1', operationId,
        state: 'waiting_tool_approval', revision: 2,
        updatedAt: new Date('2026-09-06T08:00:03.000Z'),
      }],
      toolViews,
      previews: [{
        preview, sessionId: 'session-1', taskId: 'task-1', operationId, messageId: 'message-assistant-1',
        revision: 1, createdAt: new Date('2026-09-06T08:00:03.000Z'),
      }],
      candidates: [{
        candidateId: 'candidate-1', batchId: 'batch-1', sessionId: 'session-1',
        taskId: 'task-1', operationId, kind: 'action', preview: { title: '提交周报' },
        sourceRefs: [], confidence: 0.9, risk: 'normal', revision: 1, sequence: 2,
        createdAt: new Date('2026-09-06T08:00:03.000Z'),
      }],
    });

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'message:message-user-1', revision: 1, status: 'completed' }),
      expect.objectContaining({ id: 'task:task-1:assistant', message_id: 'message-assistant-1', revision: 3 }),
      expect.objectContaining({
        id: 'task:task-1:thinking', type: 'thinking', sequence: 2,
        payload: { text: '先核对时间，再比较两个提醒方案。', display: 'summary' },
      }),
      expect.objectContaining({ id: 'task:task-1:runtime', status: 'pending', revision: 2 }),
      expect.objectContaining({
        id: 'approval:confirmation-1', tool_call_id: 'tool-call-1',
        approval_id: 'confirmation-1', revision: 2,
      }),
      expect.objectContaining({
        id: 'candidate:candidate-1', type: 'candidate', sequence: 2,
      }),
    ]));
    expect(items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'preview:preview-1' }),
    ]));
    expect(JSON.stringify(items)).not.toContain('metadata');
    expect(JSON.stringify(items)).not.toContain('arguments');
  });

  it('maps every persisted message status without returning undefined', () => {
    const statuses: SessionMessageDto['status'][] = [
      'pending', 'streaming', 'complete', 'failed', 'cancelled',
    ];
    const items = buildChatItemsSnapshot({
      messages: statuses.map((status, index) => ({
        id: `message-${index}`, session_id: 'session-1', sequence: index + 1,
        role: 'user', content: status, status, revision: 1,
        created_at: '2026-09-06T08:00:00.000Z',
      })),
      tasks: [], toolViews: [], previews: [], candidates: [],
    });

    expect(items.map((item) => item.status)).toEqual([
      'pending', 'streaming', 'completed', 'failed', 'cancelled',
    ]);
  });
});
