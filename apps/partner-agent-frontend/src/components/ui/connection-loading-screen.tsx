import { useEffect, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';

import { AmbientBackground } from './ambient-background';
import { AppIcon } from './app-icon';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export function ConnectionLoadingScreen() {
  const [pulse] = useState(() => new Animated.Value(0));
  const [orbit] = useState(() => new Animated.Value(0));
  const [signal] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    const orbitLoop = Animated.loop(
      Animated.timing(orbit, { toValue: 1, duration: 5200, easing: Easing.linear, useNativeDriver: true }),
    );
    const signalLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(signal, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(signal, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    pulseLoop.start();
    orbitLoop.start();
    signalLoop.start();
    return () => {
      pulseLoop.stop();
      orbitLoop.stop();
      signalLoop.stop();
    };
  }, [orbit, pulse, signal]);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.34] });
  const orbitRotation = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const signalScale = signal.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1.7] });
  const signalOpacity = signal.interpolate({ inputRange: [0, 0.72, 1], outputRange: [0.28, 0.12, 0] });

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <AmbientBackground />
      <View accessibilityLiveRegion="polite" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.page }}>
        <View style={{ alignItems: 'center', gap: spacing.lg }}>
          <View style={{ width: 164, height: 164, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={{ position: 'absolute', width: 132, height: 132, borderRadius: 66, borderWidth: 1, borderColor: colors.brand400, opacity: pulseOpacity, transform: [{ scale: pulseScale }] }} />
            <Animated.View style={{ position: 'absolute', width: 108, height: 108, borderRadius: 54, borderWidth: 1, borderColor: colors.violet500, opacity: signalOpacity, transform: [{ scale: signalScale }] }} />
            <View style={{ position: 'absolute', width: 118, height: 54, borderRadius: 54, borderWidth: 1, borderColor: colors.brand400, opacity: 0.34, transform: [{ rotate: '24deg' }] }} />
            <Animated.View style={{ position: 'absolute', width: 118, height: 54, borderRadius: 54, borderWidth: 1, borderColor: colors.violet500, opacity: 0.28, transform: [{ rotate: orbitRotation }] }} />
            <Animated.View style={{ position: 'absolute', width: 142, height: 142, transform: [{ rotate: orbitRotation }] }}>
              <View style={{ position: 'absolute', top: 8, left: 67, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.violet500, shadowColor: colors.violet500, shadowOpacity: 0.36, shadowRadius: 8 }} />
              <View style={{ position: 'absolute', right: 4, bottom: 36, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand500 }} />
            </Animated.View>
            <View style={{ width: 76, height: 76, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.infoSoft, borderColor: colors.brand400, borderWidth: 1, boxShadow: '0 10px 28px rgba(89, 103, 242, 0.18)' }}>
              <AppIcon accessibilityLabel="紫灵AI正在连接" color={colors.violet500} name="sparkle" size={42} />
            </View>
          </View>
          <View style={{ alignItems: 'center', gap: spacing.xs }}>
            <Text maxFontSizeMultiplier={2} style={[typography.display, { color: colors.ink, textAlign: 'center', fontWeight: '600' }]}>紫灵正在连接</Text>
            <Text maxFontSizeMultiplier={2} style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>正在为你恢复安全、连续的对话。</Text>
            <Text maxFontSizeMultiplier={2} style={[typography.caption, { color: colors.violet500, marginTop: spacing.xs }]}>智能伙伴马上回来</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
