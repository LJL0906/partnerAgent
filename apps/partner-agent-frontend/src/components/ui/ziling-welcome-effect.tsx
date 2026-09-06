import { Text, useWindowDimensions, View } from 'react-native';
import { colors } from '@/theme/colors';

export function PurpleWelcomeText({ register }: { register: boolean }) {
  const { width } = useWindowDimensions();
  const title = register ? '开始使用紫灵' : '欢迎回来';
  const availableWidth = Math.min(Math.max(width - 56, 260), 420);
  const titleSize = Math.min(27, Math.max(21, availableWidth * 0.075));
  const eyebrow = register ? '紫灵 · 新连接' : '紫灵 · 私人智能';

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={`主人，${title}`} style={{ height: 118, width: '100%' }}>
      <View pointerEvents="none" style={{ paddingLeft: 10, paddingTop: 34 }}>
        <Text style={{ color: colors.brand500, fontSize: 10, fontWeight: '500', letterSpacing: 2.6, lineHeight: 16 }}>{eyebrow.toUpperCase()}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={{ color: colors.ink, fontSize: titleSize, fontWeight: '300', letterSpacing: 2.4, lineHeight: titleSize + 12, marginTop: 5, maxWidth: availableWidth - 20 }}>{title}</Text>
        <View style={{ backgroundColor: colors.brand500, height: 1, marginTop: 8, opacity: 0.65, width: register ? 92 : 72 }} />
      </View>
    </View>
  );
}
