import React from 'react';
// @ts-ignore react-dom/server has no installed declaration in this Expo app.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ApprovalCard } from './approval-card';
import type { AppButtonProps } from '@/components/ui/app-button';
import { CandidateCard } from './candidate-card';
import type { CandidatePreviewDecision } from './chat-item-types';
import { SystemCard } from './system-card';
import { ThinkingCard } from './thinking-card';
import { ToolCallCard } from './tool-call-card';

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn(async () => undefined) },
  Pressable: ({ children, accessibilityState, ...props }: { children?: React.ReactNode; accessibilityState?: { expanded?: boolean }; [key: string]: unknown }) => React.createElement('pressable', { ...props, 'data-expanded': accessibilityState?.expanded }, children),
  ScrollView: ({ children, style, ...props }: { children?: React.ReactNode; style?: { maxHeight?: number }; [key: string]: unknown }) => React.createElement('scroll-view', { ...props, 'data-max-height': style?.maxHeight }, children),
  Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('text', props, children),
  View: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('view', props, children),
}));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => undefined) }));
vi.mock('expo-audio', () => ({
  useAudioPlayer: (source: string | null) => ({ source, pause: vi.fn(), play: vi.fn() }),
  useAudioPlayerStatus: () => ({ currentTime: 0, duration: 0, playing: false }),
}));
vi.mock('expo-image', () => ({ Image: ({ contentFit: _contentFit, ...props }: Record<string, unknown>) => React.createElement('image', props) }));
vi.mock('expo-video', () => ({
  useVideoPlayer: (source: string) => ({ source, loop: false, muted: false, play: vi.fn(), pause: vi.fn() }),
  VideoView: ({ contentFit: _contentFit, player, ...props }: Record<string, unknown>) => React.createElement('video-view', { ...props, src: (player as { source?: string })?.source }),
}));
vi.mock('@/components/ui/app-button', () => ({ AppButton: (props: Record<string, unknown>) => React.createElement('app-button', props) }));
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: (props: Record<string, unknown>) => React.createElement('icon', props) }));
type TestButtonProps = Omit<Partial<AppButtonProps>, 'onPress'> & { onPress?: () => void };

const markup = (element: React.ReactElement) => renderToStaticMarkup(element);

function findElements(element: React.ReactNode, predicate: (value: React.ReactElement) => boolean): React.ReactElement[] {
  if (!React.isValidElement(element)) return [];
  const matches = predicate(element) ? [element] : [];
  const children = React.Children.toArray((element.props as { children?: React.ReactNode }).children);
  return matches.concat(children.flatMap((child) => findElements(child, predicate)));
}

describe('specialized chat item cards', () => {
  it('disables both approval actions while awaiting the server, without claiming execution success', () => {
    const approve = vi.fn();
    const reject = vi.fn();
    const element = ApprovalCard({ title: '工具审批', status: 'pending', previewOnly: false,
      feedback: { phase: 'acknowledged', message: '请求已受理，等待服务端状态更新。' }, onApprove: approve, onReject: reject });
    const buttons = findElements(element, (node) => ['确认', '拒绝'].includes((node.props as { title?: string }).title ?? ''));
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const props = button.props as { disabled?: boolean; onPress?: () => void };
      expect(props.disabled).toBe(true);
      props.onPress?.();
    }
    expect(approve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
    expect(markup(element)).toContain('等待服务端');
    expect(markup(element)).not.toContain('提交正式对象');
  });

  it('does not allow repeating an undo when its result is uncertain', () => {
    const element = ToolCallCard({ toolName: '工具', state: 'succeeded', undoAvailable: true, onUndo: vi.fn(),
      feedback: { phase: 'unknown', message: '操作结果未知，请刷新状态。' } });
    expect(markup(element)).toContain('操作结果未知');
    expect(findElements(element, (node) => (node.props as { children?: unknown }).children === '撤销')).toHaveLength(0);
  });

  it('shows streaming reasoning in a lightweight disclosure with bounded height', () => {
    const html = markup(React.createElement(ThinkingCard, { content: '正在整理上下文', streaming: true }));

    expect(html).toContain('思考过程');
    expect(html).toContain('正在整理上下文');
    expect(html).toContain('data-expanded="true"');
    expect(html).toContain('data-max-height="240"');
    expect(html).not.toContain('box-shadow');
    expect(html).not.toContain('尚未入库');
  });

  it('keeps completed reasoning collapsed until the user opens it', () => {
    const html = markup(React.createElement(ThinkingCard, { content: '已经完成的推理' }));

    expect(html).toContain('data-expanded="false"');
    expect(html).not.toContain('已经完成的推理');
  });

  it('distinguishes tool state and keeps input/output previews available', () => {
    const html = markup(React.createElement(ToolCallCard, {
      toolName: '搜索知识库',
      state: 'executing',
      inputPreview: '{"query":"合同"}',
      outputPreview: '等待工具返回',
    }));

    expect(html).toContain('工具调用');
    expect(html).toContain('搜索知识库');
    expect(html).toContain('执行中');
    expect(html).toContain('合同');
    expect(html).toContain('等待工具返回');
  });

  it('emits structured preview decisions for all candidate actions without applying them', () => {
    const decisions: CandidatePreviewDecision[] = [];
    const element = CandidateCard({
      title: '候选提案 A',
      candidateId: 'candidate-1',
      candidateType: '计划草案',
      summary: '安全摘要',
      onDecision: (decision) => decisions.push(decision),
    });
    const buttons = findElements(element, (value) => Boolean((value.props as { title?: string }).title && ['确认', '修改', '拒绝', '稍后处理'].includes((value.props as { title: string }).title)));
    expect(buttons).toHaveLength(4);
    for (const button of buttons) (button.props as { onPress?: () => void }).onPress?.();
    expect(decisions).toEqual([
      { candidateId: 'candidate-1', action: 'confirm', applied: false, preview: { title: '候选提案 A', candidateType: '计划草案', summary: '安全摘要' } },
      { candidateId: 'candidate-1', action: 'modify', applied: false, preview: { title: '候选提案 A', candidateType: '计划草案', summary: '安全摘要' } },
      { candidateId: 'candidate-1', action: 'reject', applied: false, preview: { title: '候选提案 A', candidateType: '计划草案', summary: '安全摘要' } },
      { candidateId: 'candidate-1', action: 'later', applied: false, preview: { title: '候选提案 A', candidateType: '计划草案', summary: '安全摘要' } },
    ]);
  });
  it('marks candidates as pending without exposing storage terminology', () => {
    const html = markup(React.createElement(CandidateCard, {
      title: '候选提案 A',
      candidateType: '计划草案',
      summary: '用于后续确认的草案',
      previewOnly: true,
    }));

    expect(html).toContain('候选提案 A');
    expect(html).toContain('计划草案');
    expect(html).toContain('用于后续确认的草案');
    expect(html).toContain('待确认');
    expect(html).toContain('尚未生效');
    expect(html).not.toContain('尚未入库');
  });

  it('shows only useful candidate information with a formatted schedule and neutral styling', () => {
    const html = markup(React.createElement(CandidateCard, {
      title: '提交本周工作周报',
      summary: '整理本周结果并发送给团队。默认时区为 Asia/Shanghai。此为候选预览。',
      plannedAt: '2026-09-11T09:00:00+08:00',
      timezone: 'Asia/Shanghai',
      candidateType: '行动建议',
    }));

    expect(html).toContain('提交本周工作周报');
    expect(html).toContain('整理本周结果并发送给团队。');
    expect(html).toContain('9月11日');
    expect(html).toContain('周五');
    expect(html).toContain('09:00');
    expect(html).toContain('#FFFFFF');
    expect(html).not.toContain('#EAF9F3');
    expect(html).not.toContain('默认时区');
    expect(html).not.toContain('applied:false');
    expect(html).not.toContain('所有决策均为 preview');
  });

  it.each([
    ['pending', '待确认'],
    ['executing', '执行中'],
    ['succeeded', '已完成'],
    ['dismissed', '已拒绝'],
    ['expired', '已过期'],
    ['indeterminate', '结果待核对'],
    ['undone', '已撤销'],
    ['failed', '失败'],
  ] as const)('renders approval status %s and only permits pending decisions', (status, label) => {
    const element = ApprovalCard({
      title: '确认工具调用',
      status,
      onApprove: vi.fn(),
      onReject: vi.fn(),
    });
    const html = markup(element);
    const buttons = findElements(element, (value) => {
      const props = value.props as Partial<AppButtonProps>;
      return props.title === '确认' || props.title === '拒绝';
    });

    expect(html).toContain(label);
    expect(buttons).toHaveLength(status === 'pending' ? 2 : 0);
    if (status !== 'pending') {
      expect(html).not.toContain('确认后才会提交正式对象');
      expect(html).not.toContain('需要你的确认');
    }
  });

  it('does not show a stale custom decision prompt after approval expires', () => {
    const html = markup(React.createElement(ApprovalCard, {
      title: '确认工具调用',
      status: 'expired',
      decisionLabel: '点击确认即可执行',
    }));
    expect(html).not.toContain('点击确认即可执行');
  });

  it.each([
    ['pending', '待处理', false],
    ['executing', '执行中', false],
    ['indeterminate', '结果待核对', false],
    ['succeeded', '可撤销', true],
    ['failed', '失败', false],
    ['dismissed', '已拒绝', false],
    ['expired', '已过期', false],
    ['undone', '已撤销', false],
  ] as const)('gates undo by tool state %s even when available', (state, label, canUndo) => {
    const onUndo = vi.fn();
    const element = ToolCallCard({ toolName: '写入文件', state, undoAvailable: true, onUndo });
    const undoButtons = findElements(element, (value) => {
      const props = value.props as { accessibilityRole?: string; children?: React.ReactNode };
      return props.accessibilityRole === 'button' && props.children === '撤销';
    });

    expect(markup(element)).toContain(label);
    expect(undoButtons).toHaveLength(canUndo ? 1 : 0);
    if (canUndo) {
      (undoButtons[0].props as { onPress: () => void }).onPress();
      expect(onUndo).toHaveBeenCalledOnce();
    }
  });

  it.each([false, undefined])('hides undo when undoAvailable is %s despite a callback', (undoAvailable) => {
    const html = markup(React.createElement(ToolCallCard, {
      toolName: '写入文件', state: 'succeeded', undoAvailable, onUndo: vi.fn(),
    }));
    expect(html).not.toContain('撤销');
  });

  it('shows pending tool state without claiming undo is available', () => {
    const html = markup(React.createElement(ToolCallCard, { toolName: '写入文件', state: 'pending' }));
    expect(html).toContain('待处理');
    expect(html).not.toContain('撤销');
  });

  it.each([
    ['undone', '工具操作已撤销'],
    ['failed', '工具操作撤销失败'],
  ] as const)('keeps the server undo result for %s without a repeat undo button', (state, outputPreview) => {
    const element = ToolCallCard({
      toolName: '写入文件', state, outputPreview, undoAvailable: false, onUndo: vi.fn(),
    });
    expect(markup(element)).toContain(outputPreview);
    expect(findElements(element, (value) => (value.props as { onPress?: unknown }).onPress !== undefined)).toHaveLength(0);
  });
  it('injects approval callbacks into distinct approve and reject actions', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const element = ApprovalCard({
      title: '确认提案',
      summary: '确认后才会提交正式对象',
      onApprove,
      onReject,
    });
    const buttons = findElements(element, (value) => {
      const props = value.props as Partial<AppButtonProps>;
      return props.title === '确认' || props.title === '拒绝';
    });

    expect(buttons).toHaveLength(2);
    (buttons.find((button) => (button.props as Partial<AppButtonProps>).title === '确认')?.props as TestButtonProps).onPress?.();
    (buttons.find((button) => (button.props as Partial<AppButtonProps>).title === '拒绝')?.props as TestButtonProps).onPress?.();
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();

    expect(markup(element)).toContain('确认后才会提交正式对象');
  });

  it('renders system notices as alert cards with an explicit system tone', () => {
    const html = markup(React.createElement(SystemCard, { title: '系统提示', content: '连接已恢复' }));

    expect(html).toContain('系统提示');
    expect(html).toContain('连接已恢复');
    expect(html).toContain('alert');
  });
});












  it('supports an explicit editable preview with cancel and apply controls', () => {
    const html = markup(React.createElement(CandidateCard, {
      title: '候选提案 A', candidateId: 'candidate-1', summary: '安全摘要', onDecision: vi.fn(),
    }));
    expect(html).toContain('编辑候选内容');
    expect(html).not.toContain('仅修改本地草稿');
  });

  it('renders safe links, markdown tables, and JSON without collapsing body content', async () => {
    const { MessageContent } = await import('./messages/message-content');
    const html = markup(React.createElement(MessageContent, {
      content: '[项目文档](https://example.com/docs)\n\n| 项目 | 状态 |\n| --- | --- |\n| API | 完成 |\n\n{"ok":true,"count":2}',
    }));
    expect(html).toContain('项目文档');
    expect(html).toContain('accessibilityRole="link"');
    expect(html).toContain('accessibilityLabel="消息表格"');
    expect(html).not.toContain('accessibilityRole="table"');
    expect(html).toContain('API');
    expect(html).toContain('&quot;ok&quot;: true');
  });

  it('hides default timezone metadata and localizes English clock periods in message text', async () => {
    const { MessageContent, normalizeMessageMarkdown } = await import('./messages/message-content');
    const content = '时间：9月8日 周二 5:00 PM（Asia/Shanghai）\n当前时间左右（UTC 时间为 9月7日 09:00）\n所在时区（Asia/Shanghai，北京时间）\n- **UTC 时间**：09:00\n\n```text\nAsia/Shanghai\n```';
    const normalized = normalizeMessageMarkdown(content, true);

    expect(normalized).toContain('时间：9月8日 周二 下午 5:00');
    expect(normalized).toContain('当前时间左右');
    expect(normalized).toContain('所在时区（北京时间）');
    expect(normalized).not.toContain('UTC 时间');
    expect(normalized).not.toContain('（，北京时间）');
    expect(normalized.match(/Asia\/Shanghai/g)).toHaveLength(1);
    expect(normalizeMessageMarkdown('用户输入 Asia/Shanghai')).toContain('Asia/Shanghai');
    const plainText = markup(React.createElement(MessageContent, {
      content: '明天下午五点（Asia/Shanghai）', format: 'text', localizeTimeMetadata: true,
    }));
    expect(plainText).not.toContain('Asia/Shanghai');
  });

  it('keeps long content readable and exposes accessible labels', async () => {
    const { MessageContent } = await import('./messages/message-content');
    const longContent = '长内容 '.repeat(300);
    const html = markup(React.createElement(MessageContent, { content: longContent }));
    expect(html).toContain(longContent.trimEnd());
    expect(html).toContain('accessibilityLabel="消息正文"');
  });
