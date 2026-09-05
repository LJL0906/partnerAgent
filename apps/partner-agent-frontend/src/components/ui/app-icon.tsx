import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import type { ColorValue, ViewStyle } from 'react-native';

import { colors } from '@/theme/colors';

const iconMap = {
  assistant: { ios: 'bubble.left.and.bubble.right', android: 'chat_bubble', web: 'chat_bubble' },
  today: { ios: 'calendar', android: 'calendar_today', web: 'calendar_today' },
  execute: { ios: 'bolt', android: 'bolt', web: 'bolt' },
  memory: { ios: 'brain.head.profile', android: 'neurology', web: 'neurology' },
  profile: { ios: 'person', android: 'person', web: 'person' },
  back: { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' },
  more: { ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' },
  history: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
  add: { ios: 'plus', android: 'add', web: 'add' },
  send: { ios: 'arrow.up', android: 'send', web: 'send' },
  stop: { ios: 'stop.fill', android: 'stop', web: 'stop' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
  warning: { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' },
  error: { ios: 'exclamationmark.circle', android: 'error', web: 'error' },
  offline: { ios: 'wifi.slash', android: 'wifi_off', web: 'wifi_off' },
  refresh: { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' },
  retry: { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' },
  sparkle: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  lock: { ios: 'lock', android: 'lock', web: 'lock' },
  eye: { ios: 'eye', android: 'visibility', web: 'visibility' },
  eyeOff: { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' },
  shield: { ios: 'checkmark.shield', android: 'verified_user', web: 'verified_user' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' },
  clock: { ios: 'clock', android: 'schedule', web: 'schedule' },
} as const satisfies Record<string, ComponentProps<typeof SymbolView>['name']>;

export type AppIconName = keyof typeof iconMap;

type AccessibleIconProps =
  | { accessibilityLabel: string; decorative?: false }
  | { accessibilityLabel?: never; decorative: true };

export type AppIconProps = AccessibleIconProps & {
  name: AppIconName;
  size?: number;
  color?: ColorValue;
  style?: ViewStyle;
};

export function AppIcon({ name, size = 24, color = colors.ink, style, accessibilityLabel, decorative = false }: AppIconProps) {
  return (
    <SymbolView
      accessibilityElementsHidden={decorative}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      accessible={!decorative}
      name={iconMap[name]}
      size={size}
      style={[{ width: size, height: size }, style]}
      tintColor={color}
      type="monochrome"
      weight="regular"
    />
  );
}
