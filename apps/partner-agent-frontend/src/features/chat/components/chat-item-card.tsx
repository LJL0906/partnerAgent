import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ReactNode } from 'react';

import { AppIcon } from '@/components/ui/app-icon';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { shadows } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

import type { ChatItemTone } from './chat-item-types';

const toneStyles: Record<ChatItemTone, { background: string; border: string; accent: string; icon: 'sparkle' | 'execute' | 'archive' | 'lock' | 'info' | 'warning' | 'clock' }> = {
  neutral: { background: colors.surface, border: colors.border, accent: colors.textSecondary, icon: 'info' },
  thinking: { background: colors.infoSoft, border: colors.floatingButtonBorder, accent: colors.brand500, icon: 'sparkle' },
  tool: { background: colors.surface, border: colors.floatingMenuBorder, accent: colors.violet500, icon: 'execute' },
  candidate: { background: colors.successSoft, border: colors.toastSuccessBorder, accent: colors.success, icon: 'archive' },
  approval: { background: colors.warningSoft, border: colors.toastWarningBorder, accent: colors.warning, icon: 'lock' },
  runtime: { background: colors.surfaceSubtle, border: colors.border, accent: colors.info, icon: 'clock' },
  system: { background: colors.dangerSoft, border: colors.toastDangerBorder, accent: colors.danger, icon: 'warning' },
};

export type ChatItemCardProps = {
  title: string;
  subtitle?: string;
  tone?: ChatItemTone;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  previewOnly?: boolean;
  children?: ReactNode;
  accessory?: ReactNode;
  notice?: ReactNode;
};

export function ChatItemCard({ title, subtitle, tone = 'neutral', collapsible = true, defaultExpanded = true, previewOnly = false, children, accessory, notice }: ChatItemCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const style = toneStyles[tone];
  const header = (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 40 }}>
      <View style={{ alignItems: 'center', backgroundColor: style.border, borderRadius: radius.pill, height: 28, justifyContent: 'center', width: 28 }}>
        <AppIcon decorative color={style.accent} name={style.icon} size={16} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[typography.bodyStrong, { color: colors.ink }]}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={[typography.caption, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {previewOnly ? <Text accessibilityLabel="预览，尚未入库" style={[typography.caption, { color: style.accent }]}>预览</Text> : null}
      {accessory}
      {collapsible ? <AppIcon decorative color={colors.textSecondary} name={expanded ? 'close' : 'info'} size={16} /> : null}
    </View>
  );

  return (
    <View accessibilityLabel={previewOnly ? `${title}，预览，尚未入库` : title} style={{ backgroundColor: style.background, borderColor: style.border, borderRadius: radius.large, borderWidth: 1, overflow: 'hidden', padding: spacing.md, boxShadow: shadows.float }}>
      {collapsible ? <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}>{header}</Pressable> : header}
      {notice}
      {expanded || !collapsible ? <View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>{children ?? null}</View> : null}
    </View>
  );
}


