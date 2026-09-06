import React from 'react';
// @ts-ignore react-dom/server has no installed declaration in this Expo app.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatItem } from '@partner-agent/contracts';

import { ChatMessageList } from './chat-message-list';
import type { MessageScrollController } from '../use-message-scroll';

vi.mock('react-native', () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) => React.createElement('main', null, children),
  View: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('section', props, children),
  Text: ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children),
  Pressable: ({ children, style, accessibilityLabel }: { children?: React.ReactNode; style?: unknown; accessibilityLabel?: string }) => React.createElement('button', {
    'aria-label': accessibilityLabel,
    style: typeof style === 'function' ? style({ pressed: false }) : style,
  }, children),
  useWindowDimensions: () => ({ width: 320, height: 640 }),
}));
vi.mock('@/components/ui/app-button', () => ({ AppButton: () => null }));
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: () => React.createElement('i') }));
vi.mock('./empty-chat-state', () => ({ EmptyChatState: () => React.createElement('span', null, 'EMPTY') }));
vi.mock('./message-bubble', () => ({
  ChatItemBubble: ({ item }: { item: ChatItem }) => React.createElement('span', null, `CANONICAL:${item.id}`),
}));
vi.mock('./candidate-selection-flow', () => ({
  CandidateSelectionFlow: ({ pages }: { pages: { choices: unknown[] }[] }) =>
    React.createElement('span', null, `CANDIDATE_FLOW:${pages.length}:${pages[0]?.choices.length ?? 0}`),
  buildCandidateQuestionPages: (items: ChatItem[]) => [{
    id: 'batch-1', anchorItemId: 'candidate:one', question: '请选择时间',
    itemIds: ['candidate:one', 'candidate:two'],
    choices: items.filter((entry) => entry.type === 'candidate').map((entry) => ({ id: entry.id })),
  }],
}));
vi.mock('./thinking-card', () => ({
  ThinkingCard: ({ content }: { content: string }) => React.createElement('span', null, `THINKING:${content}`),
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
    expect(html).toContain('CANONICAL:current');
  });
  it('shows an immediate thinking placeholder before the first reasoning delta arrives', () => {
    const html = renderToStaticMarkup(React.createElement(ChatMessageList, { ...props, items: [item], isThinking: true }));
    expect(html).toContain('THINKING:正在理解你的问题…');
  });
  it('does not duplicate the placeholder after a realtime thinking item exists', () => {
    const thinking: ChatItem = { schema_version: 1, id: 'task:task-1:thinking', type: 'thinking', status: 'streaming',
      collapsed: true, created_at: 2, updated_at: 2, revision: 1, payload: { text: '正在分析', display: 'progress' } };
    const html = renderToStaticMarkup(React.createElement(ChatMessageList, { ...props, items: [item, thinking], isThinking: true }));
    expect(html).not.toContain('THINKING:正在理解你的问题…');
  });
  it('keeps the thinking placeholder immediately above the current assistant response', () => {
    const assistant: ChatItem = { schema_version: 1, id: 'task:task-1:assistant', type: 'message', status: 'streaming',
      collapsed: false, created_at: 3, updated_at: 3, revision: 1, task_id: 'task-1', payload: { role: 'assistant', content: '回答中' } };
    const html = renderToStaticMarkup(React.createElement(ChatMessageList, { ...props, items: [item, assistant], isThinking: true }));
    expect(html.indexOf('THINKING:正在理解你的问题…')).toBeLessThan(html.indexOf('CANONICAL:task:task-1:assistant'));
  });
  it('shows a compact question anchor entry when the conversation has multiple user questions', () => {
    const second: ChatItem = { ...item, id: 'second', created_at: 2, updated_at: 2,
      payload: { role: 'user', content: '第二个问题' } };
    const html = renderToStaticMarkup(React.createElement(ChatMessageList, {
      ...props, items: [item, second],
    }));
    expect(html).toContain('打开问题锚点列表');
  });
  it('places the question directory button below the anchor rail for left-thumb reach', () => {
    const second: ChatItem = { ...item, id: 'second', created_at: 2, updated_at: 2,
      payload: { role: 'user', content: '第二个问题' } };
    const html = renderToStaticMarkup(React.createElement(ChatMessageList, {
      ...props, items: [item, second],
    }));
    expect(html.indexOf('问题锚点轨道')).toBeLessThan(html.indexOf('打开问题锚点列表'));
  });
  it('groups candidate choices into one selection flow instead of rendering duplicate cards', () => {
    const candidate = (id: string): ChatItem => ({
      schema_version: 1, id: `candidate:${id}`, type: 'candidate', status: 'pending',
      collapsed: true, created_at: 2, updated_at: 2, revision: 1, task_id: 'task-1',
      candidate_id: id, payload: { candidate_id: id, kind: 'action', applied: false,
        batch_ref: { kind: 'confirmation_batch', id: 'batch-1' }, preview: { title: id } },
    });
    const html = renderToStaticMarkup(React.createElement(ChatMessageList, {
      ...props, items: [item, candidate('one'), candidate('two')],
      onCandidateAnswers: vi.fn(),
    }));
    expect(html.match(/CANDIDATE_FLOW/g)).toHaveLength(1);
    expect(html).toContain('CANDIDATE_FLOW:1:2');
    expect(html).not.toContain('CANONICAL:candidate:one');
    expect(html).not.toContain('CANONICAL:candidate:two');
  });
});
