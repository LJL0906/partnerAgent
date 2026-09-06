import { Text } from 'react-native';

import { ChatItemCard } from './chat-item-card';

export function SummaryCard({ content, period }: { content: string; period?: string }) {
  return (
    <ChatItemCard title="摘要" subtitle={period} tone="neutral">
      <Text selectable style={{ color: '#171821', fontSize: 14, lineHeight: 20 }}>{content}</Text>
    </ChatItemCard>
  );
}
