import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { AppIcon } from './app-icon';
import { colors } from '@/theme/colors';

export function ZilingConnectionOrb({ accessibilityLabel = '紫灵AI', size = 164 }: { accessibilityLabel?: string; size?: number }) {
  const [pulse] = useState(() => new Animated.Value(0));
  const [orbit] = useState(() => new Animated.Value(0));
  const [signal] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const pulseLoop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    const orbitLoop = Animated.loop(Animated.timing(orbit, { toValue: 1, duration: 5200, easing: Easing.linear, useNativeDriver: true }));
    const signalLoop = Animated.loop(Animated.sequence([
      Animated.timing(signal, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(signal, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    pulseLoop.start(); orbitLoop.start(); signalLoop.start();
    return () => { pulseLoop.stop(); orbitLoop.stop(); signalLoop.stop(); };
  }, [orbit, pulse, signal]);
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.34] });
  const orbitRotation = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const signalScale = signal.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1.7] });
  const signalOpacity = signal.interpolate({ inputRange: [0, 0.72, 1], outputRange: [0.28, 0.12, 0] });
  const scale = size / 164;
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <Animated.View style={{ position: 'absolute', width: 132 * scale, height: 132 * scale, borderRadius: 66 * scale, borderWidth: 1, borderColor: colors.brand400, opacity: pulseOpacity, transform: [{ scale: pulseScale }] }} />
    <Animated.View style={{ position: 'absolute', width: 108 * scale, height: 108 * scale, borderRadius: 54 * scale, borderWidth: 1, borderColor: colors.violet500, opacity: signalOpacity, transform: [{ scale: signalScale }] }} />
    <View style={{ position: 'absolute', width: 118 * scale, height: 54 * scale, borderRadius: 54 * scale, borderWidth: 1, borderColor: colors.brand400, opacity: 0.34, transform: [{ rotate: '24deg' }] }} />
    <Animated.View style={{ position: 'absolute', width: 118 * scale, height: 54 * scale, borderRadius: 54 * scale, borderWidth: 1, borderColor: colors.violet500, opacity: 0.28, transform: [{ rotate: orbitRotation }] }} />
    <Animated.View style={{ position: 'absolute', width: 142 * scale, height: 142 * scale, transform: [{ rotate: orbitRotation }] }}>
      <View style={{ position: 'absolute', top: 8 * scale, left: 67 * scale, width: 10 * scale, height: 10 * scale, borderRadius: 5 * scale, backgroundColor: colors.violet500, shadowColor: colors.violet500, shadowOpacity: 0.36, shadowRadius: 8 * scale }} />
      <View style={{ position: 'absolute', right: 4 * scale, bottom: 36 * scale, width: 6 * scale, height: 6 * scale, borderRadius: 3 * scale, backgroundColor: colors.brand500 }} />
    </Animated.View>
    <View accessibilityLabel={accessibilityLabel} style={{ width: 76 * scale, height: 76 * scale, alignItems: 'center', justifyContent: 'center', borderRadius: 38 * scale, backgroundColor: colors.infoSoft, borderColor: colors.brand400, borderWidth: 1, boxShadow: '0 10px 28px rgba(89, 103, 242, 0.18)' }}>
      <AppIcon accessibilityLabel={accessibilityLabel} color={colors.violet500} name="sparkle" size={42 * scale} />
    </View>
  </View>;
}
