import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const THINKING_MAX_HEIGHT = 240;

export type ThinkingCardProps = {
  content: string;
  previewOnly?: boolean;
  streaming?: boolean;
};

export function ThinkingCard({ content, streaming = false }: ThinkingCardProps) {
  const [expanded, setExpanded] = useState(streaming);

  return (
    <View accessibilityLabel="思考过程" style={{ alignSelf: 'stretch' }}>
      <Pressable
        accessibilityLabel={expanded ? '收起思考过程' : '展开思考过程'}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={{ alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: spacing.xs, minHeight: 30 }}
      >
        <AppIcon decorative color={colors.textTertiary} name="back" size={12} style={{ transform: [{ rotate: expanded ? '90deg' : '-90deg' }] }} />
        <Text style={[typography.caption, { color: colors.textTertiary }]}>{streaming ? '正在思考…' : '思考过程 · 已完成'}</Text>
      </Pressable>
      {expanded ? (
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator
          style={{ maxHeight: THINKING_MAX_HEIGHT, marginLeft: 18 }}
          contentContainerStyle={{ paddingBottom: spacing.sm, paddingRight: spacing.sm }}
        >
          <Text selectable style={[typography.caption, { color: colors.textSecondary, lineHeight: 20 }]}>{content}</Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

