import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { PressableProps, StyleProp, TextStyle, ViewStyle } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

import { AppIcon } from './app-icon';
import type { AppIconName } from './app-icon';

export type AppButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'icon';
export type AppButtonSize = 'sm' | 'md' | 'lg';
export type AppButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  title?: string;
  children?: string;
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  loading?: boolean;
  icon?: AppIconName;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

const variants = {
  primary: { background: colors.brand500, border: colors.brand500, text: colors.surface },
  secondary: { background: colors.surface, border: colors.border, text: colors.ink },
  tertiary: { background: 'transparent', border: 'transparent', text: colors.brand500 },
  danger: { background: colors.dangerSoft, border: colors.dangerSoft, text: colors.danger },
  icon: { background: 'transparent', border: 'transparent', text: colors.ink },
} as const;

const sizes = {
  sm: { height: 36, horizontal: 12 },
  md: { height: 44, horizontal: 16 },
  lg: { height: 52, horizontal: 20 },
} as const;

export function AppButton({
  title,
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
  style,
  textStyle,
  accessibilityLabel,
  ...props
}: AppButtonProps) {
  const label = title ?? children;
  const palette = variants[variant];
  const dimensions = sizes[size];
  const unavailable = disabled || loading;
  const iconOnly = variant === 'icon';

  return (
    <Pressable
      {...props}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      hitSlop={size === 'sm' ? spacing.xxs : undefined}
      style={({ pressed }) => [
        {
          alignItems: 'center',
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          backgroundColor: pressed && variant === 'primary' ? colors.brand600 : palette.background,
          borderColor: palette.border,
          borderCurve: 'continuous',
          borderRadius: iconOnly ? radius.pill : radius.small,
          borderWidth: variant === 'secondary' ? 1 : 0,
          flexDirection: 'row',
          gap: spacing.xs,
          justifyContent: 'center',
          minHeight: iconOnly ? spacing.minTouchTarget : dimensions.height,
          minWidth: iconOnly ? spacing.minTouchTarget : undefined,
          opacity: unavailable ? 0.48 : pressed ? 0.88 : 1,
          paddingHorizontal: iconOnly ? 0 : dimensions.horizontal,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={palette.text} size="small" style={{ position: 'absolute' }} />
      ) : null}
      <View
        accessibilityElementsHidden={loading}
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          gap: spacing.xs,
          opacity: loading ? 0 : 1,
        }}>
          {icon ? <AppIcon decorative color={palette.text} name={icon} size={20} /> : null}
          {label ? (
            <Text maxFontSizeMultiplier={2} style={[typography.control, { color: palette.text, flexShrink: 1, textAlign: 'center' }, textStyle]}>
              {label}
            </Text>
          ) : null}
      </View>
    </Pressable>
  );
}
