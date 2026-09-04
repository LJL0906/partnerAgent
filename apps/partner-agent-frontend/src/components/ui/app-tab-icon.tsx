import { Text, View } from 'react-native';
import type { ColorValue } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { typography } from '@/theme/typography';

import { AppIcon } from './app-icon';
import type { AppIconName } from './app-icon';

export type AppTabIconProps = {
  name: AppIconName;
  focused: boolean;
  color?: ColorValue;
  size?: number;
  badge?: number;
  accessibilityLabel: string;
};

export function AppTabIcon({ name, focused, color = colors.textTertiary, size = 24, badge, accessibilityLabel }: AppTabIconProps) {
  const badgeText = badge && badge > 99 ? '99+' : badge?.toString();
  return (
    <View accessibilityLabel={accessibilityLabel} accessibilityRole="image" accessible style={{ alignItems: 'center', backgroundColor: focused ? colors.aiCore : 'transparent', borderCurve: 'continuous', borderRadius: radius.small, height: 36, justifyContent: 'center', position: 'relative', width: 44 }}>
      <AppIcon decorative color={focused ? colors.surface : color} name={name} size={size} />
      {focused ? <View accessibilityElementsHidden style={{ backgroundColor: colors.violet500, borderRadius: radius.pill, bottom: 3, height: 3, position: 'absolute', width: 10 }} /> : null}
      {badgeText ? (
        <View accessibilityLabel={`${badgeText} 条待处理`} accessible style={{ alignItems: 'center', backgroundColor: colors.danger, borderColor: colors.surface, borderRadius: radius.pill, borderWidth: 2, justifyContent: 'center', minHeight: 18, minWidth: 18, paddingHorizontal: badgeText.length > 1 ? 4 : 0, position: 'absolute', right: -5, top: -5 }}>
          <Text style={[typography.caption, { color: colors.surface, fontSize: 10, lineHeight: 12 }]}>{badgeText}</Text>
        </View>
      ) : null}
    </View>
  );
}
