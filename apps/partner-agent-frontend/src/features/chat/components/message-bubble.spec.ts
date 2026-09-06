import React from 'react';
// @ts-ignore react-dom/server has no installed declaration in this Expo app.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

let currentUsername: string | undefined = '测试用户';
const openURL = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('react-native', () => ({
  Linking: { openURL },
  Pressable: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('pressable', props, children),
  Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('text', props, children),
  View: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('view', props, children),
}));
vi.mock('@/features/auth/auth-store', () => ({ useAuthStore: (selector: (state: { username?: string }) => unknown) => selector({ username: currentUsername }) }));
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: (props: Record<string, unknown>) => React.createElement('icon', props) }));
vi.mock('@/components/ui/assistant-avatar', () => ({ AssistantAvatar: (props: Record<string, unknown>) => React.createElement('assistant-avatar', props) }));
vi.mock('@/components/ui/status-badge', () => ({ StatusBadge: (props: Record<string, unknown>) => React.createElement('status-badge', props) }));
vi.mock('./structured-preview-card', () => ({ StructuredPreviewCard: (props: Record<string, unknown>) => React.createElement('structured-preview-card', props) }));

// eslint-disable-next-line import/first
import { ChatItemBubble, MessageBubble } from './message-bubble';
// eslint-disable-next-line import/first
import { openSafeLink } from './messages/message-content';
// eslint-disable-next-line import/first
import type { ChatMessage } from '@/store/chat-store';

const message = (role: ChatMessage['role'], overrides: Partial<ChatMessage> = {}): ChatMessage => ({ id: role, role, content: `${role} 内容`, ...overrides });
const markup = (input: ChatMessage) => renderToStaticMarkup(React.createElement(MessageBubble, { message: input }));

describe('MessageBubble characterization', () => {
  it('preserves user rendering, username, and valid time', () => {
    currentUsername = '测试用户';
    const html = markup(message('user', { content: '你好', createdAt: '2026-09-05T08:09:00.000Z' }));
    expect(html).toContain('你好');
    expect(html).toContain('我的头像');
  });

  it('uses the fallback user name and omits invalid time', () => {
    currentUsername = '';
    const html = markup(message('user', { createdAt: 'not-a-date' }));
    expect(html).not.toContain('not-a-date');
  });

  it('preserves assistant rendering and author/time metadata', () => {
    const html = markup(message('assistant', { content: '答案', createdAt: '2026-09-05T08:09:00.000Z' }));
    expect(html).toContain('紫灵AI');
    expect(html).toContain('答案');
    expect(html).toContain('assistant-avatar');
  });

  it.each(['模型由 A 切换为 B', '系统错误'])('preserves system information/error rendering: %s', (content) => {
    const html = markup(message('system', { content }));
    expect(html).toContain(content);
    expect(html).toContain('accessibilityRole="alert"');
  });

  it('preserves tool running, success, and failure labels', () => {
    expect(markup(message('tool', { content: '执行中' }))).toContain('执行中');
    expect(markup(message('tool', { tool: '搜索', toolSuccess: true }))).toContain('搜索执行完成');
    expect(markup(message('tool', { tool: '搜索', toolSuccess: false }))).toContain('搜索执行失败');
  });
});









  it('renders assistant markdown paragraphs and fenced code without collapsing the body', () => {
    const html = markup(message('assistant', { content: '第一段\n\n第二段\n```ts\nconst answer = 42;\n```' }));
    expect(html).toContain('第一段');
    expect(html).toContain('第二段');
    expect(html).toContain('const answer = 42;');
    expect(html).not.toContain('```ts');
  });

  it('renders user multiline content without collapsing it', () => {
    const html = markup(message('user', { content: '第一行\n第二行\n```\nconst value = true;\n```' }));
    expect(html).toContain('第一行');
    expect(html).toContain('第二行');
    expect(html).toContain('const value = true;');
    expect(html).not.toContain('```');
  });

  it('falls back to plain text for an unclosed fenced block', () => {
    const html = markup(message('assistant', { content: '`	s\nconst value = true;' }));
    expect(html).toContain('`	s');
    expect(html).toContain('const value = true;');
  });

  it('keeps unsupported markup as escaped plain text', () => {
    const html = markup(message('assistant', { content: '<script>alert("xss")</script> **未支持语法**' }));
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).toContain('**未支持语法**');
    expect(html).not.toContain('<script>');
  });



describe('ChatItem action wiring', () => {
  const base = { schema_version: 1 as const, created_at: 1, updated_at: 1, revision: 1, collapsed: true };

  it('shows the authoritative model and reasoning recorded on an assistant item', () => {
    const item: import('@partner-agent/contracts').MessageChatItem = {
      ...base,
      id: 'task:task-1:assistant',
      type: 'message',
      status: 'completed',
      collapsed: false,
      message_id: 'message-1',
      payload: {
        role: 'assistant',
        content: '答案',
        model_config_id: 'model-config-1',
        reasoning_level: 'high',
      },
    };
    const html = renderToStaticMarkup(React.createElement(ChatItemBubble, { item }));
    expect(html).toContain('model-config-1');
    expect(html).toContain('推理：高');
  });
  it('routes an authoritative structured preview to the dedicated preview card', () => {
    const item: import('@partner-agent/contracts').StructuredPreviewChatItem = {
      ...base,
      id: 'preview:preview-1',
      type: 'structured_preview',
      status: 'completed',
      preview_id: 'preview-1',
      payload: {
        schema_version: 1,
        preview_id: 'preview-1',
        kind: 'action',
        confirmation_status: 'unconfirmed',
        applied: false,
        source_refs: [{ kind: 'chat_message', id: 'message-1' }],
        content: { title: '提交周报', confidence: 0.8 },
        warnings: [],
      },
    };

    const element = ChatItemBubble({ item });
    expect((element?.type as { name?: string })?.name).toBe('StructuredPreviewCard');
    expect(element?.props).toMatchObject({ preview: item.payload, createdAt: 1 });
    expect(element?.props).not.toHaveProperty('onDecision');
    expect(element?.props).not.toHaveProperty('onApprove');
    expect(element?.props).not.toHaveProperty('onReject');
  });
  it('passes pending undo state and operation feedback without downgrading it to queued', () => {
    const onUndo = vi.fn();
    const item: import('@partner-agent/contracts').ToolChatItem = { ...base, id: 'tool', type: 'tool', status: 'pending',
      execution_id: 'execution-1', payload: { tool: 'tool', undo_available: true } };
    const feedback = { phase: 'unknown' as const, message: '结果未知' };
    const toolView: import('@partner-agent/contracts').SessionToolView = {
      session_id: 'session-1', tool_call_id: 'tool-1', execution_id: 'execution-1',
      tool_name: 'tool', status: 'succeeded', version: 1, request_summary: '',
      risk_level: 'low', allowed_actions: ['undo'],
    };
    const element = ChatItemBubble({ item, toolView, actions: { onUndoTool: onUndo, toolFeedback: { 'execution:execution-1': feedback } } });
    expect(element?.props).toMatchObject({ state: 'succeeded', undoAvailable: true, feedback });
  });

  it('passes acknowledgement feedback separately from authoritative approval status', () => {
    const confirm = vi.fn();
    const item: import('@partner-agent/contracts').ApprovalChatItem = { ...base, id: 'approval', type: 'approval', status: 'pending',
      approval_id: 'c1', payload: { approval_id: 'c1', tool: 'tool', request_summary: '执行工具', risk_level: 'low' } };
    const feedback = { phase: 'acknowledged' as const, message: '等待更新' };
    const toolView: import('@partner-agent/contracts').SessionToolView = {
      session_id: 'session-1', tool_call_id: 'tool-1', confirmation_id: 'c1',
      tool_name: 'tool', status: 'pending', version: 1, request_summary: '执行工具',
      risk_level: 'low', allowed_actions: ['confirm'],
    };
    const element = ChatItemBubble({ item, toolView, actions: { onConfirmTool: confirm, toolFeedback: { 'confirmation:c1': feedback } } });
    expect(element?.props).toMatchObject({ status: 'pending', feedback, previewOnly: false });
    expect(element?.props.onReject).toBeUndefined();
  });

  it('never supplies no-op approval buttons when no action handler exists', () => {
    const item: import('@partner-agent/contracts').ApprovalChatItem = { ...base, id: 'approval', type: 'approval', status: 'completed',
      approval_id: 'c1', payload: { approval_id: 'c1', tool: 'tool', request_summary: '执行工具', risk_level: 'high' } };
    const element = ChatItemBubble({ item });
    expect(renderToStaticMarkup(element as React.ReactElement)).toContain('工具状态待同步');
  });

  it('does not invent a pending tool state before its authoritative view arrives', () => {
    const item: import('@partner-agent/contracts').ToolChatItem = {
      ...base, id: 'tool:tool-1', type: 'tool', status: 'completed', tool_call_id: 'tool-1',
      execution_id: 'execution-1', payload: { tool: 'writer', undo_available: true },
    };
    const html = renderToStaticMarkup(ChatItemBubble({ item }) as React.ReactElement);
    expect(html).toContain('工具状态待同步');
    expect(html).not.toContain('待确认');
  });

  it('prefers the authoritative tool view request and result summaries', () => {
    const item: import('@partner-agent/contracts').ToolChatItem = {
      ...base, id: 'tool:tool-1', type: 'tool', status: 'running', tool_call_id: 'tool-1',
      execution_id: 'execution-1', payload: { tool: 'stale-tool', input_summary: '旧请求', output_summary: '旧结果' },
    };
    const toolView: import('@partner-agent/contracts').SessionToolView = {
      session_id: 'session-1', tool_call_id: 'tool-1', execution_id: 'execution-1',
      tool_name: 'writer', status: 'indeterminate', version: 2, request_summary: '权威请求',
      result_summary: '权威结果', risk_level: 'high', allowed_actions: [],
    };
    const element = ChatItemBubble({ item, toolView });
    expect(element?.props).toMatchObject({
      toolName: 'writer', state: 'indeterminate', inputPreview: '权威请求',
      outputPreview: '权威结果', riskLevel: 'high',
    });
  });

  it('exposes only tool actions allowed by the authoritative tool view', () => {
    const confirm = vi.fn();
    const dismiss = vi.fn();
    const item: import('@partner-agent/contracts').ApprovalChatItem = {
      ...base, id: 'approval:c1', type: 'approval', status: 'pending', approval_id: 'c1',
      tool_call_id: 'tool-1',
      payload: { approval_id: 'c1', tool: 'writer', request_summary: '写入文件', risk_level: 'high' },
    };
    const toolView: import('@partner-agent/contracts').SessionToolView = {
      session_id: 'session-1', tool_call_id: 'tool-1', confirmation_id: 'c1',
      tool_name: 'writer', status: 'pending', version: 2, request_summary: '写入文件',
      risk_level: 'high', expires_at: '2026-09-06T16:00:00.000Z', allowed_actions: ['dismiss'],
    };
    const element = ChatItemBubble({ item, toolView, actions: { onConfirmTool: confirm, onDismissTool: dismiss } });
    expect(element?.props).toMatchObject({
      status: 'pending', riskLevel: 'high', expiresAt: toolView.expires_at,
      onApprove: undefined,
    });
    expect(element?.props.onReject).toBeTypeOf('function');
  });
});

  it('renders links, tables, and structured JSON as safe body blocks', () => {
    const html = markup(message('assistant', { content: '[文档](https://example.com)\n\n| 名称 | 值 |\n| --- | --- |\n| 版本 | 1 |\n\n{"active":true}' }));
    expect(html).toContain('文档');
    expect(html).toContain('accessibilityRole="link"');
    expect(html).toContain('accessibilityLabel="消息表格"');
    expect(html).not.toContain('accessibilityRole="table"');
    expect(html).toContain('版本');
    expect(html).toContain('&quot;active&quot;: true');
  });

  it('opens only preserved http and https link targets', async () => {
    openURL.mockClear();
    await expect(openSafeLink('https://example.com/docs')).resolves.toBe(true);
    await expect(openSafeLink('javascript:alert(1)')).resolves.toBe(false);
    await expect(openSafeLink('file:///secret')).resolves.toBe(false);
    expect(openURL).toHaveBeenCalledOnce();
    expect(openURL).toHaveBeenCalledWith('https://example.com/docs');
  });
