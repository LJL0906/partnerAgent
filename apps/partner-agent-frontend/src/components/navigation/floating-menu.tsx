import { useMemo, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/app-icon';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { shadows } from '@/theme/shadows';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const BUTTON_SIZE = 58;
const EDGE_GAP = 18;
const CHAT_INPUT_OFFSET = 120;
const MENU_GAP = 10;
const POPOVER_WIDTH = 156;
const POPOVER_HEIGHT = 6 * 42 + 2 * 8 + 2 * 8 + 34;
export const HEADER_NAV_BUTTON_SIZE = spacing.minTouchTarget;
const HEADER_NAV_POPOVER_GAP = 6;
const ITEMS = [
  { label: '聊天', icon: 'assistant' as const, path: '/chat' },
  { label: '今日', icon: 'today' as const, path: '/today' },
  { label: '执行', icon: 'execute' as const, path: '/execute' },
  { label: '确认中心', icon: 'check' as const, path: '/confirmations' },
  { label: '记忆', icon: 'memory' as const, path: '/memory' },
  { label: '设置', icon: 'profile' as const, path: '/profile' },
];

export function shouldRenderFloatingNavigation(pathname: string): boolean {
  return pathname !== '/chat';
}

export function getHeaderNavigationPopoverTop(triggerTop: number, triggerHeight: number): number {
  return triggerTop + triggerHeight + HEADER_NAV_POPOVER_GAP;
}

function NavigationItems({ pathname, onNavigate }: { pathname: string; onNavigate: (path: string) => void }) {
  return <View style={{ backgroundColor: colors.floatingMenuSurface, borderColor: colors.floatingMenuBorder, borderRadius: radius.medium, borderWidth: 1, padding: spacing.sm, boxShadow: shadows.overlay }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs, paddingBottom: spacing.xs }}>
      <View style={{ width: 5, height: 5, borderRadius: radius.pill, backgroundColor: colors.brand500 }} />
      <Text style={[typography.caption, { color: colors.textSecondary, letterSpacing: 0.5 }]}>导航</Text>
    </View>
    {ITEMS.map((item) => (
      <Pressable key={item.path} accessibilityRole="button" accessibilityLabel={`打开${item.label}`}
        onPress={() => onNavigate(item.path)}
        style={({ pressed }) => ({ alignItems: 'center', backgroundColor: pathname === item.path ? colors.floatingMenuActive : pressed ? colors.infoSoft : colors.floatingMenuSurface, borderRadius: radius.small, flexDirection: 'row', gap: spacing.sm, minHeight: 42, paddingHorizontal: spacing.xs, opacity: pressed ? 0.82 : 1 })}>
        <View style={{ width: 3, height: 22, borderRadius: radius.pill, backgroundColor: pathname === item.path ? colors.brand500 : 'transparent' }} />
        <View style={{ alignItems: 'center', backgroundColor: pathname === item.path ? colors.floatingMenuIconActive : colors.surfaceSubtle, borderColor: pathname === item.path ? colors.floatingMenuIconBorder : 'transparent', borderRadius: radius.small, borderWidth: 1, height: 28, justifyContent: 'center', width: 28 }}>
          <AppIcon decorative color={pathname === item.path ? colors.brand600 : colors.textSecondary} name={item.icon} size={17} />
        </View>
        <Text style={[typography.label, { color: pathname === item.path ? colors.brand600 : colors.ink, flex: 1, fontWeight: pathname === item.path ? '700' : '500' }]}>{item.label}</Text>
        {pathname === item.path ? <View style={{ backgroundColor: colors.brand500, borderRadius: radius.pill, height: 6, width: 6 }} /> : null}
      </Pressable>
    ))}
  </View>;
}

export function HeaderNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const triggerRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [popoverTop, setPopoverTop] = useState(0);
  const navigate = (path: string) => {
    setOpen(false);
    if (pathname === path) return;
    if (pathname === '/chat' && path === '/profile') {
      router.push({ pathname: '/profile', params: { returnTo: 'chat' } } as never);
      return;
    }
    router.push(path as never);
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const showBelowTrigger = (triggerTop: number, triggerHeight: number) => {
      setPopoverTop(getHeaderNavigationPopoverTop(triggerTop, triggerHeight));
      setOpen(true);
    };
    if (triggerRef.current) {
      triggerRef.current.measureInWindow((_x, triggerTop, _width, triggerHeight) => {
        showBelowTrigger(triggerTop, triggerHeight);
      });
      return;
    }
    showBelowTrigger(insets.top + spacing.xs, HEADER_NAV_BUTTON_SIZE);
  };

  return <>
    <View ref={triggerRef} collapsable={false} style={{ height: HEADER_NAV_BUTTON_SIZE, width: HEADER_NAV_BUTTON_SIZE }}>
      <Pressable accessibilityRole="button" accessibilityLabel={open ? '关闭页面菜单' : '打开页面菜单'}
        onPress={toggle}
        style={({ pressed }) => ({ alignItems: 'center', justifyContent: 'center', width: HEADER_NAV_BUTTON_SIZE,
          height: HEADER_NAV_BUTTON_SIZE, borderRadius: radius.medium,
          backgroundColor: colors.floatingButtonSurface, borderColor: open ? colors.brand500 : colors.floatingButtonBorder,
          borderWidth: 1, opacity: pressed ? 0.82 : 1 })}>
        <AppIcon decorative color={colors.floatingButtonIcon} name={open ? 'close' : 'sparkle'} size={20} />
      </Pressable>
    </View>
    <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
      <Pressable accessibilityLabel="关闭页面菜单" onPress={() => setOpen(false)} style={StyleSheet.absoluteFill}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]} />
        <Pressable accessibilityLabel="页面导航菜单" onPress={(event) => event.stopPropagation()}
          style={{ position: 'absolute', right: spacing.md, top: popoverTop, width: POPOVER_WIDTH }}>
          <NavigationItems pathname={pathname} onNavigate={navigate} />
        </Pressable>
      </Pressable>
    </Modal>
  </>;
}

export function FloatingNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: Math.max(EDGE_GAP, width - BUTTON_SIZE - EDGE_GAP), y: height - BUTTON_SIZE - insets.bottom - (pathname === '/chat' ? CHAT_INPUT_OFFSET : 28) });
  const [pan] = useState(() => new Animated.ValueXY(position));
  const [progress] = useState(() => new Animated.Value(0));
  const [popoverHeight, setPopoverHeight] = useState(0);
  const isLeft = position.x < width / 2;

  const panResponder = useMemo(() => PanResponder.create({
    // 轻触交给内部 Pressable；只有发生移动时才由拖拽响应器接管。
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => { pan.stopAnimation(); pan.setOffset({ x: position.x, y: position.y }); pan.setValue({ x: 0, y: 0 }); },
    onPanResponderMove: (_, gesture) => pan.setValue({ x: gesture.dx, y: gesture.dy }),
    onPanResponderRelease: (_, gesture) => {
      const nextX = gesture.dx + position.x < width / 2 ? EDGE_GAP : width - BUTTON_SIZE - EDGE_GAP;
      const nextY = Math.min(Math.max(EDGE_GAP + insets.top, gesture.dy + position.y), height - BUTTON_SIZE - Math.max(insets.bottom, EDGE_GAP));
      pan.flattenOffset();
      setPosition({ x: nextX, y: nextY });
      Animated.spring(pan, { toValue: { x: nextX, y: nextY }, useNativeDriver: false, friction: 7 }).start();
    },
  }), [height, insets.bottom, insets.top, pan, position.x, position.y, width]);

  function toggle() {
    const next = !open;
    setOpen(next);
    Animated.spring(progress, { toValue: next ? 1 : 0, useNativeDriver: false, friction: 7 }).start();
  }

  function navigate(path: string) {
    setOpen(false);
    Animated.timing(progress, { toValue: 0, duration: 160, useNativeDriver: false }).start();
    if (pathname !== path) router.push(path as never);
  }

  const popoverLeft = isLeft ? position.x + BUTTON_SIZE + MENU_GAP : position.x - POPOVER_WIDTH - MENU_GAP;
  const measuredPopoverHeight = popoverHeight || POPOVER_HEIGHT;
  const safeTop = insets.top + EDGE_GAP;
  const safeBottom = height - insets.bottom - EDGE_GAP;
  const centeredPopoverTop = position.y + BUTTON_SIZE / 2 - measuredPopoverHeight / 2;
  const popoverTop = Math.min(
    Math.max(centeredPopoverTop, safeTop),
    safeBottom - measuredPopoverHeight,
  );
  const opensAbove = popoverTop < centeredPopoverTop;

  if (!shouldRenderFloatingNavigation(pathname)) return null;

  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    {open ? <Pressable accessibilityLabel="关闭页面菜单" style={StyleSheet.absoluteFill} onPress={toggle} /> : null}
    <Animated.View
      pointerEvents={open ? 'box-none' : 'none'}
      style={{
        position: 'absolute',
        left: popoverLeft,
        top: popoverTop,
        width: POPOVER_WIDTH,
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [opensAbove ? -8 : 8, 0] }) },
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
        ],
      }}>
      <View onLayout={(event) => { const nextHeight = event.nativeEvent.layout.height; if (nextHeight !== popoverHeight) setPopoverHeight(nextHeight); }}>
        <NavigationItems pathname={pathname} onNavigate={navigate} />
      </View>
    </Animated.View>
    <Animated.View {...panResponder.panHandlers} style={{ position: 'absolute', left: pan.x, top: pan.y, width: BUTTON_SIZE, height: BUTTON_SIZE, borderRadius: radius.medium, backgroundColor: colors.floatingButtonSurface, borderColor: open ? colors.brand500 : colors.floatingButtonBorder, borderWidth: 1, alignItems: 'center', justifyContent: 'center', boxShadow: shadows.float, transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) }] }}>
      <Pressable accessibilityRole="button" accessibilityLabel={open ? '关闭页面菜单' : '打开页面菜单'} onPress={toggle} style={{ alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', borderRadius: radius.medium }}>
        <AppIcon decorative color={colors.floatingButtonIcon} name={open ? 'close' : 'sparkle'} size={26} />
      </Pressable>
    </Animated.View>
  </View>;

}

