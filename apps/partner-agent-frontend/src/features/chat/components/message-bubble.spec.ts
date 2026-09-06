import React from 'react';
// @ts-ignore react-dom/server has no installed declaration in this Expo app.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

let currentUsername: string | undefined = '测试用户';
const openURL = vi.hoisted(() => vi.fn(async () => undefined));
const setStringAsync = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('react-native', () => ({
  Linking: { openURL },
  Modal: ({ children, visible, ...props }: { children?: React.ReactNode; visible?: boolean; [key: string]: unknown }) => visible ? React.createElement('modal', props, children) : null,
  Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default },
  Pressable: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('pressable', props, children),
  StyleSheet: { create: (styles: unknown) => styles, flatten: (style: unknown) => style ?? {} },
  Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('text', props, children),
  TouchableWithoutFeedback: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('touchable', props, children),
  View: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('view', props, children),
}));
vi.mock('expo-clipboard', () => ({ setStringAsync }));
vi.mock('expo-audio', () => ({
  useAudioPlayer: (source: string | null) => ({ source, pause: vi.fn(), play: vi.fn(), seekTo: vi.fn() }),
  useAudioPlayerStatus: () => ({ currentTime: 0, duration: 125, playing: false }),
}));
vi.mock('expo-image', () => ({ Image: ({ contentFit: _contentFit, source, ...props }: Record<string, unknown>) => React.createElement('image', { ...props, src: (source as { uri?: string })?.uri }) }));
vi.mock('expo-video', () => ({
  useVideoPlayer: (source: string) => ({ source, loop: false, muted: false, play: vi.fn(), pause: vi.fn() }),
  VideoView: ({ contentFit: _contentFit, player, ...props }: Record<string, unknown>) => React.createElement('video-view', { ...props, src: (player as { source?: string })?.source }),
}));
vi.mock('@/features/auth/auth-store', () => ({ useAuthStore: (selector: (state: { username?: string }) => unknown) => selector({ username: currentUsername }) }));
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: (props: Record<string, unknown>) => React.createElement('icon', props) }));
vi.mock('@/components/ui/assistant-avatar', () => ({ AssistantAvatar: (props: Record<string, unknown>) => React.createElement('assistant-avatar', props) }));
vi.mock('@/components/ui/status-badge', () => ({ StatusBadge: (props: Record<string, unknown>) => React.createElement('status-badge', props) }));
vi.mock('./structured-preview-card', () => ({ StructuredPreviewCard: (props: Record<string, unknown>) => React.createElement('structured-preview-card', props) }));
vi.mock('./candidate-card', () => ({ CandidateCard: (props: Record<string, unknown>) => React.createElement('candidate-card', props) }));

// eslint-disable-next-line import/first
import { ChatItemBubble, MessageBubble } from './message-bubble';
// eslint-disable-next-line import/first
import { openSafeLink } from './messages/message-content';
// eslint-disable-next-line import/first
import { copyCode } from './messages/message-code-block';
// eslint-disable-next-line import/first
import type { ChatMessage } from '@/store/chat-store';

const message = (role: ChatMessage['role'], overrides: Partial<ChatMessage> = {}): ChatMessage => ({ id: role, role, content: `${role} 内容`, format: role === 'assistant' ? 'markdown' : 'text', ...overrides });
const markup = (input: ChatMessage) => renderToStaticMarkup(React.createElement(MessageBubble, { message: input }));

describe('MessageBubble characterization', () => {
  it('preserves user rendering, username, and valid time', () => {
    currentUsername = '测试用户';
    const html = markup(message('user', { content: '你好', createdAt: '2026-09-05T08:09:00.000Z' }));
    expect(html).toContain('你好');
    expect(html).toContain('我的头像');
    expect(html).toContain('align-self:flex-end');
    expect(html).toContain('text-align:left');
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
    expect(html).toContain('align-self:flex-start');
  });

  it('renders model switches as muted tips without a highlighted alert surface', () => {
    const html = markup(message('system', { content: '模型由 A 切换成 B' }));
    expect(html).toContain('模型由 A 切换成 B');
    expect(html).toContain('accessibilityLabel="提示"');
    expect(html).not.toContain('accessibilityRole="alert"');
    expect(html).not.toContain('background-color');
  });

  it('keeps system errors visually emphasized as alerts', () => {
    const html = markup(message('system', { content: '系统错误' }));
    expect(html).toContain('系统错误');
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
    const html = markup(message('user', { content: '第一行\n第二行\n```\nconst value = true;\n```', format: 'markdown' }));
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
    expect(html).toContain('未支持语法');
    expect(html).not.toContain('**未支持语法**');
    expect(html).not.toContain('<script>');
  });



describe('ChatItem action wiring', () => {
  const base = { schema_version: 1 as const, created_at: 1, updated_at: 1, revision: 1, collapsed: true };

  it('does not render runtime status items in the conversation', () => {
    const item: import('@partner-agent/contracts').RuntimeChatItem = {
      ...base,
      id: 'task:task-1:runtime',
      type: 'runtime',
      status: 'completed',
      task_id: 'task-1',
      payload: { state: 'completed', detail: '任务已完成' },
    };

    expect(ChatItemBubble({ item })).toBeNull();
  });

  it('renders a formal candidate using its persisted title and summary', () => {
    const onCardLayoutChange = vi.fn();
    const item: import('@partner-agent/contracts').CandidateChatItem = {
      ...base, id: 'candidate-1', type: 'candidate', status: 'pending', candidate_id: 'candidate-1',
      payload: { candidate_id: 'candidate-1', kind: 'candidate', preview: {
        title: '周五提交周报', description: '上午九点提醒我提交',
        planned_at: '2026-09-11T09:00:00+08:00', timezone: 'Asia/Shanghai',
      }, applied: false, source_refs: [], risk: 'normal' },
    };
    const element = ChatItemBubble({ item, actions: { onCardLayoutChange } });
    expect((element?.type as { name?: string })?.name).toBe('CandidateCard');
    expect(element?.props).toMatchObject({
      title: '周五提交周报', summary: '上午九点提醒我提交', candidateType: '候选建议',
      plannedAt: '2026-09-11T09:00:00+08:00', timezone: 'Asia/Shanghai',
      onLayoutChangeIntent: onCardLayoutChange,
    });
  });

  it('renders standard markdown semantics instead of showing the source markers', () => {
    const html = markup(message('assistant', {
      content: '# 标题\n\n**重点**、*强调* 与 `inline`\n\n- 第一项\n- 第二项\n\n> 引用',
    }));
    expect(html).not.toContain('<streamdown-text');
    expect(html).toContain('accessibilityRole="header"');
    expect(html).toContain('标题');
    expect(html).not.toContain('**重点**');
  });

  it('uses icon-only copy actions for fenced and indented code blocks', () => {
    const html = markup(message('assistant', { content: '```ts\nconst answer = 42;\n```\n\n    echo hello' }));
    expect(html.match(/accessibilityLabel="复制代码"/g)).toHaveLength(2);
    expect(html).toContain('TypeScript');
    expect(html).toContain('name="copy"');
    expect(html).not.toContain('>复制<');
  });

  it('adds an icon-only copy action only to standalone markdown blocks', () => {
    const markdownHtml = markup(message('assistant', { content: '# 普通正文\n\n```markdown\n# 可复制\n\n块正文\n```', format: 'markdown' }));
    const ordinaryHtml = markup(message('assistant', { content: '# 普通正文\n\n正文', format: 'markdown' }));
    const textHtml = markup(message('user', { content: '# 普通文本', format: 'text' }));
    expect(markdownHtml.match(/accessibilityLabel="复制 Markdown"/g)).toHaveLength(1);
    expect(markdownHtml).toContain('name="copy"');
    expect(markdownHtml).not.toContain('>复制 Markdown<');
    expect(ordinaryHtml).not.toContain('accessibilityLabel="复制 Markdown"');
    expect(textHtml).not.toContain('accessibilityLabel="复制 Markdown"');
    expect(textHtml).toContain('<view accessibilityLabel="消息正文"');
  });

  it('copies the exact code block content', async () => {
    setStringAsync.mockClear();
    await copyCode('const answer = 42;');
    expect(setStringAsync).toHaveBeenCalledWith('const answer = 42;');
  });

  it('renders markdown and HTML image/video sources as inline media', () => {
    const html = markup(message('assistant', {
      content: '![预览](https://cdn.example.com/result.png)\n\n<img src="https://cdn.example.com/other.jpg" alt="另一张图" />\n\n<video controls src="https://cdn.example.com/demo.mp4"></video>',
    }));
    expect(html.match(/accessibilityLabel="打开图片预览"/g)).toHaveLength(2);
    expect(html.match(/accessibilityLabel="打开视频预览"/g)).toHaveLength(1);
    expect(html).toContain('result.png');
    expect(html).toContain('另一张图');
    expect(html).toContain('demo.mp4');
    expect(html).not.toContain('放大');
    expect(html).toContain('<image');
    expect(html).toContain('<video-view');
    expect(html).not.toContain('&lt;img');
    expect(html).not.toContain('&lt;video');
  });

  it('embeds standalone media links while keeping ordinary URLs clickable', () => {
    const html = markup(message('assistant', {
      content: 'https://cdn.example.com/photo.webp\n\nhttps://cdn.example.com/clip.webm\n\nhttps://example.com/docs',
    }));
    expect(html.match(/accessibilityLabel="打开图片预览"/g)).toHaveLength(1);
    expect(html.match(/accessibilityLabel="打开视频预览"/g)).toHaveLength(1);
    expect(html).toContain('accessibilityRole="link"');
  });

  it('renders HTML and standalone audio sources as playable message content', () => {
    const html = markup(message('assistant', {
      content: '<audio src="https://cdn.example.com/voice.mp3"></audio>\n\nhttps://cdn.example.com/reply.ogg',
    }));
    expect(html.match(/accessibilityLabel="播放音频"/g)).toHaveLength(2);
    expect(html).toContain('voice.mp3');
    expect(html).toContain('reply.ogg');
    expect(html).toContain('2:05');
    expect(html).not.toContain('&lt;audio');
  });

  it('rejects non-HTTP playback sources while allowing safe image data URLs', () => {
    const html = markup(message('assistant', {
      content: '<audio src="data:image/png;base64,AAAA"></audio>\n\n<video src="javascript:alert(1)"></video>\n\n![内嵌图片](data:image/png;base64,AAAA)',
    }));
    expect(html).not.toContain('accessibilityLabel="播放音频"');
    expect(html).not.toContain('accessibilityLabel="打开视频预览"');
    expect(html).toContain('accessibilityLabel="打开图片预览"');
  });

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
    expect(element?.props).not.toHaveProperty('onClose');
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
