import type { TextStyle } from 'react-native';

type TypographyToken = Pick<TextStyle, 'fontSize' | 'fontWeight' | 'letterSpacing' | 'lineHeight'>;

export const typography = {
  brand: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.8 },
  display: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  pageTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  sectionTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  bodyStrong: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  control: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  caption: { fontSize: 11, lineHeight: 16, fontWeight: '400' },
} as const satisfies Record<string, TypographyToken>;

export const fontFamilies = {
  ios: 'System',
  android: 'sans-serif',
  web: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;
