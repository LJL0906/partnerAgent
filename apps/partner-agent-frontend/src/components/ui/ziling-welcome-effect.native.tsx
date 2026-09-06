import { Canvas, Circle, Group, LinearGradient, Path, vec } from '@shopify/react-native-skia';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors } from '@/theme/colors';

interface PurpleWelcomeTextProps {
  register: boolean;
}

export function PurpleWelcomeText({ register }: PurpleWelcomeTextProps) {
  const { width } = useWindowDimensions();
  const title = register ? '开始使用紫灵' : '欢迎回来';
  const availableWidth = Math.min(Math.max(width - 56, 260), 420);
  const titleSize = Math.min(27, Math.max(21, availableWidth * 0.075));
  const eyebrow = register ? '紫灵 · 新连接' : '紫灵 · 私人智能';

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={`主人，${title}`} style={{ height: 118, width: '100%' }}>
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Group>
          <Path
            path="M24 31 C88 0, 164 2, 224 25 C280 47, 332 46, 392 20"
            style="stroke"
            strokeWidth={1}
            color="rgba(89, 103, 242, 0.16)"
          />
          <Path
            path="M18 88 C82 111, 157 112, 216 91 C273 71, 334 72, 402 98"
            style="stroke"
            strokeWidth={1}
            color="rgba(138, 92, 246, 0.13)"
          />
          <Path
            path="M52 95 C106 25, 284 10, 369 83"
            style="stroke"
            strokeWidth={1.5}
            color="rgba(113, 128, 255, 0.16)"
          />
          <Circle cx={42} cy={31} r={2.5} color={colors.brand500} opacity={0.55} />
          <Circle cx={availableWidth - 30} cy={88} r={3} color={colors.violet500} opacity={0.48} />
          <Circle cx={availableWidth * 0.64} cy={27} r={1.8} color={colors.brand400} opacity={0.5} />
          <Circle cx={availableWidth * 0.3} cy={98} r={1.5} color={colors.violet500} opacity={0.38} />
          <Circle cx={availableWidth - 62} cy={47} r={1.2} color={colors.brand500} opacity={0.45} />
          <LinearGradient start={vec(54, 91)} end={vec(160, 91)} colors={[colors.brand500, colors.violet500]} />
        </Group>
      </Canvas>
      <View pointerEvents="none" style={{ paddingLeft: 10, paddingTop: 34 }}>
        <Text style={{ color: colors.brand500, fontSize: 10, fontWeight: '500', letterSpacing: 2.6, lineHeight: 16 }}>
          {eyebrow.toUpperCase()}
        </Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={{ color: colors.ink, fontSize: titleSize, fontWeight: '300', letterSpacing: 2.4, lineHeight: titleSize + 12, marginTop: 5, maxWidth: availableWidth - 20 }}>
          {title}
        </Text>
        <View style={{ backgroundColor: colors.brand500, height: 1, marginTop: 8, opacity: 0.65, width: register ? 92 : 72 }} />
      </View>
    </View>
  );
}
