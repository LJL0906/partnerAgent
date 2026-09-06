import { Text, View } from 'react-native';

import { useAuthStore } from '@/features/auth/auth-store';
import { AppIcon } from '@/components/ui/app-icon';
import type { ChatMessage } from '@/store/chat-store';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { formatMessageTime } from './message-time';
import { MessageContent } from './message-content';

export function UserMessage({ message }: { message: ChatMessage }) {
  const username = useAuthStore((state) => state.username) || '我';
  const messageTime = formatMessageTime(message.createdAt);
  return (
    <View style={{ alignSelf: 'flex-end', width: '92%' }}>
      <View style={{ width: '100%', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-end', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end' }}>
          <View style={{ maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs, marginBottom: 2 }}>
            {messageTime ? <Text numberOfLines={1} style={[typography.caption, { color: colors.textTertiary, flexShrink: 0 }]}>{messageTime}</Text> : null}
            <Text numberOfLines={1} ellipsizeMode="tail" style={[typography.caption, { color: colors.textSecondary, flexShrink: 1 }]}>{username}</Text>
          </View>
          <View style={{ alignSelf: 'flex-end', maxWidth: '100%', flexShrink: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceSubtle, borderColor: colors.border, borderWidth: 1, borderRadius: radius.large, borderCurve: 'continuous' }}>
            <MessageContent align="right" content={message.content} format={message.format ?? 'text'} />
          </View>
        </View>
        <View accessibilityLabel="我的头像" accessibilityRole="image" style={{ width: 36, height: 36, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.infoSoft, borderColor: colors.border, borderWidth: 1 }}>
          <AppIcon decorative color={colors.brand500} name="profile" size={19} />
        </View>
      </View>
    </View>
  );
}
