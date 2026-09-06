import { Text, View } from 'react-native';

import { ZilingConnectionOrb } from '@/components/ui/ziling-connection-orb';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export function EmptyChatState() {
  return (
    <View style={{ alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg }}>
      <ZilingConnectionOrb accessibilityLabel="紫灵AI" size={164} />
      <View style={{ alignItems: 'center', gap: spacing.xxs }}>
        <Text maxFontSizeMultiplier={2} selectable style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>亲爱的，</Text>
        <Text maxFontSizeMultiplier={2} selectable style={[typography.sectionTitle, { color: colors.ink, fontWeight: '500', textAlign: 'center' }]}>今天想和我聊聊什么？</Text>
      </View>
    </View>
  );
}
