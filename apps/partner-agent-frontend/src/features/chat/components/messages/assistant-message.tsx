import { Text, View } from 'react-native';

import { AssistantAvatar } from '@/components/ui/assistant-avatar';
import type { ChatMessage } from '@/store/chat-store';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { formatMessageTime } from './message-time';

import { MessageContent } from './message-content';

export function AssistantMessage({ message }: { message: ChatMessage }) {
  const messageTime = formatMessageTime(message.createdAt);
  return (
    <View style={{ alignSelf: 'flex-start', width: '92%' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
        <AssistantAvatar size={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 2 }}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={[typography.caption, { color: colors.textSecondary, flexShrink: 1 }]}>紫灵AI</Text>
            {messageTime ? <Text numberOfLines={1} style={[typography.caption, { color: colors.textTertiary, flexShrink: 0 }]}>{messageTime}</Text> : null}
          </View>
          {message.thinkingContent && !message.content ? (
            <View style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: 10, backgroundColor: colors.infoSoft }}>
              <Text selectable style={{ color: colors.textSecondary, ...typography.body }}>正在思考：{message.thinkingContent}</Text>
            </View>
          ) : null}
          {message.content ? <MessageContent content={message.content} format={message.format ?? 'markdown'} localizeTimeMetadata /> : null}
        </View>
      </View>
    </View>
  );
}


