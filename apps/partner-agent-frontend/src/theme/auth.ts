import { colors } from './colors';
import { radius } from './radius';
import { spacing } from './spacing';
import { typography } from './typography';

export const authTokens = {
  layout: {
    maxWidth: 420,
    sectionGap: spacing.xxl,
    fieldGroupGap: spacing.lg,
    actionGroupGap: spacing.lg,
  },
  field: {
    minHeight: spacing.minTouchTarget,
    horizontalPadding: spacing.xs,
    verticalPadding: spacing.xs,
    passwordRightPadding: 56,
    background: colors.canvas,
    text: colors.ink,
    placeholder: colors.textTertiary,
    border: colors.border,
    focusBorder: colors.brand500,
    label: typography.caption,
    labelLetterSpacing: 1,
    defaultBorderWidth: 1,
    focusBorderWidth: 2,
  },
  primaryAction: {
    minHeight: 50,
    minWidth: 220,
    horizontalPadding: spacing.xxl,
    radius: radius.pill,
    border: colors.brand500,
    text: colors.brand600,
    background: colors.brandActionSoft,
    pressedOpacity: 0.72,
    disabledOpacity: 0.4,
    pressedScale: 0.985,
  },
  providerButton: {
    size: spacing.minTouchTarget,
    radius: radius.pill,
    background: colors.surface,
    border: colors.border,
    pressedOpacity: 0.7,
  },
} as const;
