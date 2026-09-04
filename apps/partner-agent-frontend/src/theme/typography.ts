import type { TextStyle } from 'react-native';

type TypographyToken = Pick<TextStyle, 'fontSize' | 'fontWeight' | 'letterSpacing' | 'lineHeight'>;

export const typography = {
  brand: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -1 },
  display: { fontSize: 28, lineHeight: 36, fontWeight: '700' },
  pageTitle: { fontSize: 22, lineHeight: 30, fontWeight: '700' },
  sectionTitle: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  control: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 18, fontWeight: '400' },
} as const satisfies Record<string, TypographyToken>;

export const fontFamilies = {
  ios: 'System',
  android: 'sans-serif',
  web: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;
