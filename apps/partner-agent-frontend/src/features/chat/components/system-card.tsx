import { Text } from 'react-native';

import { ChatItemCard } from './chat-item-card';

export type SystemCardProps = {
  title?: string;
  content: string;
  previewOnly?: boolean;
};

export function SystemCard({ title = '系统提示', content, previewOnly = false }: SystemCardProps) {
  return (
    <ChatItemCard previewOnly={previewOnly} title={title} tone="system">
      <Text accessibilityRole="alert" selectable style={{ color: '#D64545', fontSize: 14, lineHeight: 20 }}>{content}</Text>
    </ChatItemCard>
  );
}

