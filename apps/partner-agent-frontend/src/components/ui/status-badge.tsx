import { Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

import { AppIcon } from './app-icon';
import type { AppIconName } from './app-icon';

export type StatusBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'ai';
export type StatusBadgeProps = { label: string; tone?: StatusBadgeTone; icon?: AppIconName; accessibilityLabel?: string };

const tones: Record<StatusBadgeTone, { background: string; color: string; icon: AppIconName }> = {
  neutral: { background: colors.surfaceSubtle, color: colors.textSecondary, icon: 'info' },
  info: { background: colors.infoSoft, color: colors.info, icon: 'info' },
  success: { background: colors.successSoft, color: colors.success, icon: 'check' },
  warning: { background: colors.warningSoft, color: colors.warning, icon: 'warning' },
  danger: { background: colors.dangerSoft, color: colors.danger, icon: 'error' },
  ai: { background: colors.infoSoft, color: colors.violet500, icon: 'sparkle' },
};

export function StatusBadge({ label, tone = 'neutral', icon, accessibilityLabel }: StatusBadgeProps) {
  const palette = tones[tone];
  return (
    <View
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="text"
      accessible
      style={{ alignItems: 'center', alignSelf: 'flex-start', backgroundColor: palette.background, borderCurve: 'continuous', borderRadius: radius.pill, flexDirection: 'row', gap: spacing.xxs, minHeight: 26, paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs }}>
      <AppIcon decorative color={palette.color} name={icon ?? palette.icon} size={14} />
      <Text maxFontSizeMultiplier={2} style={[typography.label, { color: palette.color, flexShrink: 1 }]}>{label}</Text>
    </View>
  );
}
