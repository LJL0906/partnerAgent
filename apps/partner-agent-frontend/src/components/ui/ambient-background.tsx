import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';

import { colors } from '@/theme/colors';

/**
 * 高端低对比 AI 光场背景。
 * 仅在页面边缘提供柔和层次，中部内容区域保持干净。
 */
export function AmbientBackground() {
  const [breath] = useState(() => new Animated.Value(0));
  const [drift] = useState(() => new Animated.Value(0));
  const [sheen] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 5_600, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 5_600, useNativeDriver: true }),
      ]),
    );
    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 9_000, useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 9_000, useNativeDriver: true }),
      ]),
    );
    const sheenLoop = Animated.loop(
      Animated.timing(sheen, { toValue: 1, duration: 13_000, useNativeDriver: true }),
    );
    breathLoop.start();
    driftLoop.start();
    sheenLoop.start();
    return () => {
      breathLoop.stop();
      driftLoop.stop();
      sheenLoop.stop();
    };
  }, [breath, drift, sheen]);

  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.08] });
  const breathOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.12] });
  const driftX = drift.interpolate({ inputRange: [0, 1], outputRange: [-12, 14] });
  const driftY = drift.interpolate({ inputRange: [0, 1], outputRange: [8, -10] });
  const sheenX = sheen.interpolate({ inputRange: [0, 1], outputRange: [-180, 260] });
  const sheenOpacity = sheen.interpolate({ inputRange: [0, 0.18, 0.5, 0.82, 1], outputRange: [0, 0.16, 0.05, 0.16, 0] });

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: 280,
          height: 220,
          borderRadius: 140,
          backgroundColor: colors.brand400,
          right: -130,
          top: 30,
          opacity: breathOpacity,
          transform: [{ scale: breathScale }, { translateX: driftX }, { translateY: driftY }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: 220,
          height: 170,
          borderRadius: 110,
          backgroundColor: colors.violet500,
          right: -120,
          top: 76,
          opacity: 0.035,
          transform: [{ rotate: '-18deg' }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          width: 168,
          height: 118,
          borderRadius: 84,
          borderWidth: 1,
          borderColor: colors.brand500,
          right: -82,
          top: 112,
          opacity: 0.1,
          transform: [{ rotate: '-24deg' }, { scale: breathScale }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          width: 230,
          height: 156,
          borderRadius: 118,
          backgroundColor: colors.violet500,
          left: -148,
          bottom: 66,
          opacity: 0.035,
          transform: [{ translateX: driftX }, { translateY: driftY }, { rotate: '18deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: 112,
          height: 74,
          borderRadius: 56,
          borderWidth: 1,
          borderColor: colors.violet500,
          left: -44,
          bottom: 112,
          opacity: 0.08,
          transform: [{ rotate: '22deg' }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          width: 120,
          height: 120,
          borderRadius: 60,
          backgroundColor: colors.brand500,
          right: 34,
          top: 102,
          opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.015, 0.045] }),
          transform: [{ scale: breathScale }],
        }}
      />
      <View style={{ position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 1, borderColor: colors.brand400, right: 18, top: 166, opacity: 0.055 }} />
      <View style={{ position: 'absolute', width: 54, height: 54, borderRadius: 27, borderWidth: 1, borderColor: colors.violet500, left: 42, top: 122, opacity: 0.045 }} />
      <Animated.View style={{ position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: colors.violet500, left: 78, top: 154, opacity: 0.24, transform: [{ translateX: driftX }, { translateY: driftY }] }} />
      <Animated.View style={{ position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: colors.brand400, left: 116, top: 94, opacity: 0.2, transform: [{ translateX: driftX }] }} />
      <Animated.View style={{ position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: colors.brand500, right: 132, top: 280, opacity: 0.18, transform: [{ translateY: driftY }] }} />
      <View style={{ position: 'absolute', width: 42, height: 1, backgroundColor: colors.violet500, opacity: 0.09, left: 28, top: 184, transform: [{ rotate: '58deg' }] }} />
      <Animated.View
        style={{
          position: 'absolute',
          top: -80,
          bottom: -80,
          left: 0,
          width: 3,
          backgroundColor: colors.surface,
          opacity: sheenOpacity,
          transform: [{ translateX: sheenX }, { rotate: '22deg' }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.brand500,
          right: 54,
          top: 156,
          opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.38] }),
          transform: [{ translateY: driftY }, { scale: breathScale }],
        }}
      />
      <View style={{ position: 'absolute', width: 54, height: 1, backgroundColor: colors.brand500, opacity: 0.08, right: 24, top: 238, transform: [{ rotate: '-28deg' }] }} />
    </View>
  );
}
