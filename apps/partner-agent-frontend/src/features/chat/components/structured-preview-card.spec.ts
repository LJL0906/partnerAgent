import React from 'react';
// @ts-ignore react-dom/server has no installed declaration in this Expo app.
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatPreviewV1 } from '@partner-agent/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  buildStructuredPreviewCopyText,
  copyStructuredPreview,
  StructuredPreviewCard,
} from './structured-preview-card';

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => undefined) }));
vi.mock('react-native', () => ({
  Pressable: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('pressable', props, children),
  Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('text', props, children),
  View: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('view', props, children),
}));
vi.mock('@/components/ui/app-button', () => ({ AppButton: (props: Record<string, unknown>) => React.createElement('app-button', props) }));
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: (props: Record<string, unknown>) => React.createElement('icon', props) }));

const preview: ChatPreviewV1 = {
  schema_version: 1,
  preview_id: 'preview-secret-identity',
  kind: 'action',
  confirmation_status: 'unconfirmed',
  applied: false,
  source_refs: [{ kind: 'chat_message', id: 'message-42' }],
  content: {
    title: '周一提交周报',
    description: '整理本周结果并发送给团队',
    planned_at: '2026-09-07T09:00:00+08:00',
    deadline_at: '2026-09-07T18:00:00+08:00',
    timezone: 'Asia/Shanghai',
    priority: 'high',
    confidence: 0.76,
    uncertainty: '尚未确认收件人',
    risk_summary: '发送前需检查敏感数据',
  },
  warnings: [{ code: 'RECIPIENT_UNKNOWN', path: '/content/description', message: '收件人需要确认' }],
};

describe('StructuredPreviewCard', () => {
  it('renders a concise action preview with formatted time and useful warnings', () => {
    const html = renderToStaticMarkup(React.createElement(StructuredPreviewCard, {
      preview,
      createdAt: Date.parse('2026-09-06T12:00:00+08:00'),
    }));

    expect(html).toContain('待确认 · 尚未生效');
    expect(html).toContain('周一提交周报');
    expect(html).toContain('整理本周结果并发送给团队');
    expect(html).toContain('9月7日');
    expect(html).toContain('周一');
    expect(html).toContain('09:00');
    expect(html).toContain('尚未确认收件人');
    expect(html).toContain('收件人需要确认');
    expect(html).toContain('#FFFFFF');
    expect(html).not.toContain('#EAF9F3');
    expect(html).not.toContain('聊天消息：message-42');
    expect(html).not.toContain('生成时间');
    expect(html).not.toContain('Asia/Shanghai');
    expect(html).not.toContain('可信度');
    expect(html).not.toContain('76%');
    expect(html).toContain('accessibilityLabel="复制预览"');
    expect(html).toContain('accessibilityState="[object Object]"');
    expect(html).toContain('name="close"');
    expect(html).not.toContain('accessibilityLabel="关闭行动预览"');
    expect(html).not.toContain('>复制预览<');
    expect(html).not.toContain('title="确认"');
    expect(html).not.toContain('title="修改"');
    expect(html).not.toContain('title="拒绝"');
    expect(html).not.toContain('title="稍后处理"');
  });

  it('copies only the safe fields visible on the card', () => {
    const text = buildStructuredPreviewCopyText(
      preview,
      Date.parse('2026-09-06T12:00:00+08:00'),
    );

    expect(text).toContain('待确认，尚未生效');
    expect(text).toContain('周一提交周报');
    expect(text).toContain('9月7日');
    expect(text).toContain('收件人需要确认');
    expect(text).not.toContain('preview-secret-identity');
    expect(text).not.toContain('message-42');
    expect(text).not.toContain('Asia/Shanghai');
    expect(text).not.toContain('可信度');
    expect(text).not.toContain('confirmation_status');
    expect(text).not.toContain('applied');
  });

  it('returns real local feedback for copy success and failure', async () => {
    const write = vi.fn(async () => undefined);
    await expect(copyStructuredPreview(preview, 1, write)).resolves.toBe('已复制预览内容。');
    expect(write).toHaveBeenCalledWith(expect.stringContaining('周一提交周报'));

    await expect(copyStructuredPreview(preview, 1, async () => false))
      .resolves.toBe('复制失败，请重试。');
    await expect(copyStructuredPreview(preview, 1, async () => { throw new Error('denied'); }))
      .resolves.toBe('复制失败，请重试。');
  });
});
