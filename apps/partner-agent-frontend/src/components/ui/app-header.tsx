import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

import { AppButton } from './app-button';
import type { AppIconName } from './app-icon';

export type AppHeaderAction = { icon: AppIconName; accessibilityLabel: string; onPress: () => void };
export type AppHeaderProps = {
  title: string;
  subtitle?: string;
  brand?: boolean;
  leadingAction?: AppHeaderAction;
  trailingAction?: AppHeaderAction;
  trailing?: ReactNode;
};

export function AppHeader({ title, subtitle, brand = false, leadingAction, trailingAction, trailing }: AppHeaderProps) {
  return (
    <View accessibilityRole="header" style={{ alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 56, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
      {leadingAction ? <AppButton accessibilityLabel={leadingAction.accessibilityLabel} icon={leadingAction.icon} onPress={leadingAction.onPress} variant="icon" /> : null}
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {brand ? (
          <Text accessibilityLabel={title} maxFontSizeMultiplier={2} numberOfLines={2} style={typography.brand}>
            <Text style={{ color: colors.brand500 }}>{title.slice(0, 1)}</Text>
            <Text style={{ color: colors.violet500 }}>{title.slice(1)}</Text>
          </Text>
        ) : (
          <Text maxFontSizeMultiplier={2} numberOfLines={2} style={[typography.pageTitle, { color: colors.ink }]}>{title}</Text>
        )}
        {subtitle ? <Text maxFontSizeMultiplier={2} numberOfLines={2} style={[typography.caption, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {trailing ?? (trailingAction ? <AppButton accessibilityLabel={trailingAction.accessibilityLabel} icon={trailingAction.icon} onPress={trailingAction.onPress} variant="icon" /> : null)}
    </View>
  );
}
