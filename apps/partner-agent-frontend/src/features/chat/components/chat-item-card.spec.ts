import React from 'react';
// @ts-ignore react-dom/server has no installed declaration in this Expo app.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ChatItemCard } from './chat-item-card';

vi.mock('react-native', () => ({
  Pressable: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('pressable', props, children),
  Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('text', props, children),
  View: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('view', props, children),
}));
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: (props: Record<string, unknown>) => React.createElement('icon', props) }));

const markup = (element: React.ReactElement) => renderToStaticMarkup(element);

describe('ChatItemCard', () => {
  it('keeps action feedback visible while the detail body is folded', () => {
    const html = markup(React.createElement(ChatItemCard, {
      title: '工具审批', defaultExpanded: false,
      notice: React.createElement('span', null, '请求失败，请检查状态'),
    }, React.createElement('span', null, '折叠的详情')));
    expect(html).toContain('请求失败，请检查状态');
    expect(html).not.toContain('折叠的详情');
  });

  it('renders a shared card header, body, and preview-only semantic label', () => {
    const html = markup(
      React.createElement(
        ChatItemCard,
        { title: '工具调用', subtitle: '搜索知识库', tone: 'tool', previewOnly: true },
        React.createElement('text', null, '调用详情'),
      ),
    );

    expect(html).toContain('工具调用');
    expect(html).toContain('搜索知识库');
    expect(html).toContain('预览');
    expect(html).toContain('尚未入库');
    expect(html).toContain('调用详情');
  });

  it('keeps non-collapsible content visible without a toggle button', () => {
    const html = markup(
      React.createElement(
        ChatItemCard,
        { title: '正文', collapsible: false },
        React.createElement('text', null, '正文内容'),
      ),
    );

    expect(html).toContain('正文内容');
    expect(html).not.toContain('accessibilityRole="button"');
  });

  it('supports collapsed non-body content', () => {
    const html = markup(
      React.createElement(
        ChatItemCard,
        { title: '运行状态', defaultExpanded: false },
        React.createElement('text', null, '运行详情'),
      ),
    );

    expect(html).not.toContain('运行详情');
    expect(html).toContain('accessibilityRole="button"');
  });
});




