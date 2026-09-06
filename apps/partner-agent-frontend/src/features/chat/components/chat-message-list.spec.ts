import React from 'react';
// @ts-ignore react-dom/server has no installed declaration in this Expo app.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatItem } from '@partner-agent/contracts';

import { ChatMessageList } from './chat-message-list';
import type { MessageScrollController } from '../use-message-scroll';

vi.mock('react-native', () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) => React.createElement('main', null, children),
  View: ({ children }: { children?: React.ReactNode }) => React.createElement('section', null, children),
  Text: ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children),
}));
vi.mock('@/components/ui/app-button', () => ({ AppButton: () => null }));
vi.mock('./empty-chat-state', () => ({ EmptyChatState: () => React.createElement('span', null, 'EMPTY') }));
vi.mock('./message-bubble', () => ({
  ChatItemBubble: () => React.createElement('span', null, 'CANONICAL'),
}));
vi.mock('@/store/chat-store', () => ({ findSessionToolViewForItem: () => undefined }));

const props = {
  items: [] as ChatItem[], toolViews: [],
  horizontalPadding: 16, scroll: {} as MessageScrollController, onPrivacyPress: () => {},
};

const item: ChatItem = { schema_version: 1, id: 'current', type: 'message', status: 'completed',
  collapsed: false, created_at: 1, updated_at: 1, revision: 1, payload: { role: 'user', content: 'new' } };

describe('chat list snapshot precedence', () => {
  it('does not display legacy messages alongside an authoritative empty state', () => {
    const html = renderToStaticMarkup(React.createElement(ChatMessageList, props));
    expect(html).toContain('EMPTY');
  });
  it('renders supplied items instead of the compatibility projection', () => {
    const html = renderToStaticMarkup(React.createElement(ChatMessageList, { ...props, items: [item] }));
    expect(html).toContain('CANONICAL');
  });
});
