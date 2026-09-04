export const colors = {
  canvas: '#F7F8FC',
  surface: '#FFFFFF',
  surfaceSubtle: '#F1F3F9',
  ink: '#171821',
  textSecondary: '#676C7E',
  textTertiary: '#969BAB',
  border: '#E1E4EE',
  divider: '#ECEEF5',
  overlay: 'rgba(17, 18, 27, 0.44)',
  brand400: '#7180FF',
  brand500: '#5967F2',
  brand600: '#4654DD',
  violet500: '#8A5CF6',
  aiCore: '#171820',
  success: '#168A63',
  successSoft: '#EAF9F3',
  warning: '#B66D0C',
  warningSoft: '#FFF6E7',
  danger: '#D64545',
  dangerSoft: '#FFF0F0',
  info: '#4967D8',
  infoSoft: '#EEF1FF',
} as const;

export const gradients = {
  brand: ['#5268FF', '#765AF7', '#A45CF2'] as const,
  brandAngle: 110,
} as const;

export type ColorToken = keyof typeof colors;
