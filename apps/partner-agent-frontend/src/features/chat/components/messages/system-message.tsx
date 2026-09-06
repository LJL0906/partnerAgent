import { Text, View } from 'react-native';
import { AppIcon } from '@/components/ui/app-icon';
import type { ChatMessage } from '@/store/chat-store';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export function SystemMessage({ message }: { message: ChatMessage }) {
  const isModelSwitchTip = message.content.startsWith('模型由 ')
    || message.content.startsWith('模型保持为 ');
  if (isModelSwitchTip) {
    return <View accessibilityLabel="提示" style={{ alignSelf: 'stretch', alignItems: 'center', paddingHorizontal: 14, paddingVertical: spacing.xs }}>
      <Text selectable style={{ color: colors.textTertiary, textAlign: 'center', ...typography.caption }}>{message.content}</Text>
    </View>;
  }
  return <View accessibilityRole="alert" style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, paddingHorizontal: 14, paddingVertical: spacing.sm, backgroundColor: colors.dangerSoft, borderRadius: radius.medium, borderCurve: 'continuous' }}>
    <AppIcon decorative color={colors.danger} name="error" size={18} />
    <Text selectable style={{ flex: 1, color: colors.danger, ...typography.label }}>{message.content}</Text>
  </View>;
}
