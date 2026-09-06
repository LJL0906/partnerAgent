import { Text, View } from 'react-native';

import { ChatItemCard } from './chat-item-card';

export type ThinkingCardProps = {
  content: string;
  previewOnly?: boolean;
};

export function ThinkingCard({ content, previewOnly = false }: ThinkingCardProps) {
  return (
    <ChatItemCard defaultExpanded={false} previewOnly={previewOnly} title="思考过程" tone="thinking">
      <View style={{ gap: 4 }}>
        <Text selectable style={{ color: '#676C7E', fontSize: 14, lineHeight: 20 }}>{content}</Text>
      </View>
    </ChatItemCard>
  );
}

