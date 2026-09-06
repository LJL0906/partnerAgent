import { Text } from 'react-native';

import { ChatItemCard } from './chat-item-card';

export function ReminderCard({ title, dueAt }: { title: string; dueAt?: number }) {
  const due = dueAt ? new Date(dueAt).toLocaleString() : undefined;
  return (
    <ChatItemCard title="提醒" subtitle={due} tone="runtime">
      <Text selectable style={{ color: '#171821', fontSize: 14, lineHeight: 20 }}>{title}</Text>
    </ChatItemCard>
  );
}
