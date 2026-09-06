import React from 'react';
// @ts-ignore react-dom/server has no installed declaration in this Expo app.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  View: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement('view', props, children),
}));
vi.mock('@/components/ui/app-header', () => ({
  AppHeader: ({ trailing }: { trailing?: React.ReactNode }) => React.createElement('header', null, trailing),
}));
vi.mock('@/components/ui/app-button', () => ({
  AppButton: ({ accessibilityLabel }: { accessibilityLabel?: string }) => React.createElement('button', null, accessibilityLabel),
}));
vi.mock('./task-todo-popover', () => ({ TaskTodoPopover: () => React.createElement('todo-trigger') }));
vi.mock('@/components/navigation/floating-menu', () => ({ HeaderNavigation: () => React.createElement('nav-trigger', null, '打开页面菜单') }));

// eslint-disable-next-line import/first
import { ChatHeader } from './chat-header';

describe('chat header actions', () => {
  it('places the compact navigation trigger immediately after new chat and aligns the row', () => {
    const html = renderToStaticMarkup(React.createElement(ChatHeader, {
      title: '聊天', disabled: false, todos: [], onOpenSessions: vi.fn(), onCreateSession: vi.fn(),
    }));
    expect(html.indexOf('新建对话')).toBeLessThan(html.indexOf('打开页面菜单'));
    expect(html).toContain('align-items:center');
  });
});
