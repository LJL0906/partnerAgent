import { Text, View } from 'react-native';
import { AppIcon } from '@/components/ui/app-icon';
import type { ChatMessage } from '@/store/chat-store';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export function SystemMessage({ message }: { message: ChatMessage }) {
  const isModelSwitchTip = message.content.startsWith('模型由 ');
  return <View accessibilityRole="alert" style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, paddingHorizontal: 14, paddingVertical: spacing.sm, backgroundColor: isModelSwitchTip ? colors.infoSoft : colors.dangerSoft, borderRadius: radius.medium, borderCurve: 'continuous' }}>
    <AppIcon decorative color={isModelSwitchTip ? colors.brand500 : colors.danger} name={isModelSwitchTip ? 'info' : 'error'} size={18} />
    <Text selectable style={{ flex: 1, color: isModelSwitchTip ? colors.brand500 : colors.danger, ...typography.label }}>{message.content}</Text>
  </View>;
}
