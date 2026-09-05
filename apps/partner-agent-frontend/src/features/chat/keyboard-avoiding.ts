import type { PlatformOSType } from 'react-native';

export function getKeyboardAvoidingProps(platform: PlatformOSType, topInset: number) {
  if (platform === 'ios') {
    return { enabled: true, behavior: 'padding' as const, keyboardVerticalOffset: topInset };
  }
  if (platform === 'android') {
    return { enabled: true, behavior: 'height' as const, keyboardVerticalOffset: 0 };
  }
  return { enabled: false, behavior: undefined, keyboardVerticalOffset: 0 };
}
