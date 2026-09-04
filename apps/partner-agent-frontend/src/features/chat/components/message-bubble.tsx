import { Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { StatusBadge } from '@/components/ui/status-badge';
import type { ChatMessage } from '@/store/chat-store';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'tool') {
    const finished = message.toolSuccess !== undefined;
    const succeeded = message.toolSuccess === true;
    const label = finished
      ? `${message.tool ?? '工具'}执行${succeeded ? '完成' : '失败'}`
      : message.content;
    return (
      <View style={{ alignSelf: 'stretch', alignItems: 'flex-start' }}>
        <StatusBadge
          label={label}
          tone={!finished ? 'ai' : succeeded ? 'success' : 'danger'}
        />
      </View>
    );
  }

  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <View
        accessibilityRole="alert"
        style={{
          alignSelf: 'stretch',
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing.xs,
          paddingHorizontal: 14,
          paddingVertical: spacing.sm,
          backgroundColor: colors.dangerSoft,
          borderRadius: radius.medium,
          borderCurve: 'continuous',
        }}>
        <AppIcon decorative color={colors.danger} name="error" size={18} />
        <Text selectable style={{ flex: 1, color: colors.danger, ...typography.label }}>
          {message.content}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ alignSelf: isUser ? 'flex-end' : 'stretch', maxWidth: isUser ? '88%' : '100%' }}>
      {!isUser ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
          <View
            style={{
              width: 36,
              height: 36,
              flexShrink: 0,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.medium,
              borderCurve: 'continuous',
              backgroundColor: colors.aiCore,
            }}>
            <AppIcon accessibilityLabel="伙伴" color={colors.violet500} name="sparkle" size={18} />
          </View>
          <Text selectable style={{ flex: 1, color: colors.ink, ...typography.body }}>
            {message.content}
          </Text>
        </View>
      ) : (
        <View
          style={{
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.surfaceSubtle,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: radius.large,
            borderCurve: 'continuous',
          }}>
          <Text selectable style={{ color: colors.ink, ...typography.body }}>
            {message.content}
          </Text>
        </View>
      )}
    </View>
  );
}
