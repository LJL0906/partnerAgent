import { Text, View } from 'react-native';

import type { ChatMessage } from '@/store/chat-store';
import { colors } from '@/theme/colors';

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'tool') {
    const finished = message.toolSuccess !== undefined;
    return (
      <View
        style={{
          alignSelf: 'stretch',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 12,
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 16,
          borderCurve: 'continuous',
        }}>
        <View
          style={{
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: finished ? colors.primary : colors.ai,
          }}
        />
        <Text selectable style={{ flex: 1, color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
          {finished
            ? `${message.tool ?? '工具'}执行${message.toolSuccess ? '完成' : '失败'}`
            : message.content}
        </Text>
      </View>
    );
  }

  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  return (
    <View
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: isSystem ? '100%' : '84%',
        paddingHorizontal: isSystem ? 12 : 16,
        paddingVertical: isSystem ? 10 : 13,
        backgroundColor: isUser ? colors.primarySoft : isSystem ? colors.errorSoft : colors.card,
        borderColor: isUser ? colors.primarySoft : isSystem ? colors.error : colors.border,
        borderWidth: 1,
        borderRadius: isSystem ? 12 : 18,
        borderCurve: 'continuous',
      }}>
      <Text
        selectable
        style={{ color: isSystem ? colors.error : colors.text, fontSize: 16, lineHeight: 24 }}>
        {message.content}
      </Text>
    </View>
  );
}
