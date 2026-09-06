import React from 'react';
// @ts-ignore react-dom/server has no installed declaration in this Expo app.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

let currentUsername: string | undefined = '测试用户';
vi.mock('react-native', () => ({
  Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('text', props, children),
  View: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('view', props, children),
}));
vi.mock('@/features/auth/auth-store', () => ({ useAuthStore: (selector: (state: { username?: string }) => unknown) => selector({ username: currentUsername }) }));
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: (props: Record<string, unknown>) => React.createElement('icon', props) }));
vi.mock('@/components/ui/assistant-avatar', () => ({ AssistantAvatar: (props: Record<string, unknown>) => React.createElement('assistant-avatar', props) }));
vi.mock('@/components/ui/status-badge', () => ({ StatusBadge: (props: Record<string, unknown>) => React.createElement('status-badge', props) }));

// eslint-disable-next-line import/first
import { ChatItemBubble, MessageBubble } from './message-bubble';
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
  const base = { schema_version: 1 as const, created_at: 1, updated_at: 1, collapsed: true };
  it('passes pending undo state and operation feedback without downgrading it to queued', () => {
    const onUndo = vi.fn();
    const item: import('@partner-agent/contracts').ToolChatItem = { ...base, id: 'tool', type: 'tool', status: 'pending',
      execution_id: 'execution-1', payload: { tool: 'tool', undo_available: true } };
    const feedback = { phase: 'unknown' as const, message: '结果未知' };
    const element = ChatItemBubble({ item, actions: { onUndoTool: onUndo, toolFeedback: { 'execution:execution-1': feedback } } });
    expect(element?.props).toMatchObject({ state: 'pending', undoAvailable: true, feedback });
  });

  it('passes acknowledgement feedback separately from authoritative approval status', () => {
    const confirm = vi.fn();
    const item: import('@partner-agent/contracts').ApprovalChatItem = { ...base, id: 'approval', type: 'approval', status: 'pending',
      approval_id: 'c1', payload: { approval_id: 'c1', tool: 'tool', request_summary: '执行工具', risk_level: 'low' } };
    const feedback = { phase: 'acknowledged' as const, message: '等待更新' };
    const element = ChatItemBubble({ item, actions: { onConfirmTool: confirm, toolFeedback: { 'confirmation:c1': feedback } } });
    expect(element?.props).toMatchObject({ status: 'pending', feedback, previewOnly: false });
    expect(element?.props.onReject).toBeUndefined();
  });

  it('never supplies no-op approval buttons when no action handler exists', () => {
    const item: import('@partner-agent/contracts').ApprovalChatItem = { ...base, id: 'approval', type: 'approval', status: 'pending',
      approval_id: 'c1', payload: { approval_id: 'c1', tool: 'tool', request_summary: '执行工具', risk_level: 'low' } };
    const element = ChatItemBubble({ item });
    expect(element?.props.onApprove).toBeUndefined();
    expect(element?.props.onReject).toBeUndefined();
  });
});

  it('renders links, tables, and structured JSON as safe body blocks', () => {
    const html = markup(message('assistant', { content: '[文档](https://example.com)\n\n| 名称 | 值 |\n| --- | --- |\n| 版本 | 1 |\n\n{"active":true}' }));
    expect(html).toContain('文档');
    expect(html).toContain('accessibilityRole="link"');
    expect(html).toContain('accessibilityRole="table"');
    expect(html).toContain('版本');
    expect(html).toContain('&quot;active&quot;: true');
  });
