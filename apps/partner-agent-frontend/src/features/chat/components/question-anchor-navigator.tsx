import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import {
  findAnchorAtRailPosition,
  findAnchorWithHysteresis,
  getQuestionAnchorPreviewWidth,
  isPointInsideQuestionRail,
  selectRailAnchors,
  type QuestionAnchor,
} from './question-anchor-model';

const railTouchWidth = 44;

export function QuestionAnchorNavigator({
  anchors,
  activeId,
  onSelect,
}: {
  anchors: QuestionAnchor[];
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dragPreview, setDragPreview] = useState<QuestionAnchor>();
  const draggingRef = useRef(false);
  const dragCompletedRef = useRef(false);
  const dragPreviewRef = useRef<QuestionAnchor | undefined>(undefined);
  const lastPreviewUpdateRef = useRef(0);
  const railLengthRef = useRef(0);
  const { width, height } = useWindowDimensions();
  if (anchors.length < 2) return null;
  const highlightedId = dragPreview?.id ?? activeId;
  const previewWidth = getQuestionAnchorPreviewWidth(width);
  const railAnchors = selectRailAnchors(
    anchors,
    highlightedId,
    Math.max(6, Math.floor((height - 88) / 12)),
  );

  const select = (id: string) => {
    setOpen(false);
    onSelect(id);
  };

  const selectAtRailPosition = (position: number) => {
    const anchor = findAnchorAtRailPosition(anchors, position, railLengthRef.current);
    if (anchor) onSelect(anchor.id);
  };

  const previewAtRailPosition = (positionY: number, positionX: number, force = false) => {
    if (dragPreviewRef.current && !isPointInsideQuestionRail(
      positionX, positionY, railTouchWidth, railLengthRef.current,
    )) return dragPreviewRef.current;
    const anchor = findAnchorWithHysteresis(
      anchors, positionY, railLengthRef.current, dragPreviewRef.current?.id, 8,
    );
    if (!anchor || anchor.id === dragPreviewRef.current?.id) return anchor;
    const now = Date.now();
    if (!force && now - lastPreviewUpdateRef.current < 50) return dragPreviewRef.current;
    dragPreviewRef.current = anchor;
    lastPreviewUpdateRef.current = now;
    setDragPreview(anchor);
    return anchor;
  };

  const clearDragPreview = () => {
    draggingRef.current = false;
    dragPreviewRef.current = undefined;
    setDragPreview(undefined);
  };

  const activeIndex = Math.max(0, anchors.findIndex((anchor) => anchor.id === activeId));
  const selectAdjacent = (direction: -1 | 1) => {
    const anchor = anchors[Math.min(anchors.length - 1, Math.max(0, activeIndex + direction))];
    if (anchor) onSelect(anchor.id);
  };

  return (
    <View
      pointerEvents="box-none"
      style={{ bottom: spacing.sm, left: 2, position: 'absolute', top: spacing.sm, zIndex: 20 }}>
      <View style={{ alignItems: 'center', flex: 1, gap: 3, justifyContent: 'flex-end', width: railTouchWidth }}>
        <Pressable
          accessibilityActions={[{ name: 'decrement' }, { name: 'increment' }]}
          accessibilityHint="点击跳转，或长按后上下滑动浏览问题"
          accessibilityLabel="问题锚点轨道"
          accessibilityRole="adjustable"
          accessibilityValue={{
            max: anchors.length,
            min: 1,
            now: activeIndex + 1,
            text: `第 ${activeIndex + 1} 个问题，共 ${anchors.length} 个`,
          }}
          delayLongPress={220}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') selectAdjacent(1);
            if (event.nativeEvent.actionName === 'decrement') selectAdjacent(-1);
          }}
          onLayout={(event) => { railLengthRef.current = event.nativeEvent.layout.height; }}
          onLongPress={(event) => {
            setOpen(false);
            draggingRef.current = true;
            previewAtRailPosition(event.nativeEvent.locationY, event.nativeEvent.locationX, true);
          }}
          onPress={(event) => {
            if (!dragCompletedRef.current) selectAtRailPosition(event.nativeEvent.locationY);
          }}
          onPressIn={() => {
            dragCompletedRef.current = false;
            dragPreviewRef.current = undefined;
            lastPreviewUpdateRef.current = 0;
          }}
          onPressOut={(event) => {
            if (!draggingRef.current) return;
            const anchor = previewAtRailPosition(
              event.nativeEvent.locationY, event.nativeEvent.locationX, true,
            );
            dragCompletedRef.current = true;
            clearDragPreview();
            if (anchor) onSelect(anchor.id);
          }}
          onResponderTerminate={clearDragPreview}
          onResponderTerminationRequest={() => !draggingRef.current}
          onTouchMove={(event) => {
            if (draggingRef.current) {
              previewAtRailPosition(event.nativeEvent.locationY, event.nativeEvent.locationX);
            }
          }}
          style={({ pressed }) => ({
            alignItems: 'center', gap: 1, opacity: pressed ? 0.82 : 1,
            paddingVertical: 2, width: railTouchWidth,
          })}>
          {railAnchors.map((anchor) => {
            const active = anchor.id === highlightedId;
            return (
              <View
                key={anchor.id}
                pointerEvents="none"
                style={{ alignItems: 'center', height: 8, justifyContent: 'center', width: 28 }}>
                <View style={{
                  backgroundColor: active ? colors.brand600 : colors.textTertiary,
                  borderRadius: 2, height: active ? 2 : 1, opacity: active ? 1 : 0.55,
                  width: active ? 22 : 8,
                }} />
              </View>
            );
          })}
        </Pressable>
        <Pressable
          accessibilityLabel="打开问题锚点列表"
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => setOpen((value) => !value)}
          style={({ pressed }) => ({
            alignItems: 'center', backgroundColor: open ? colors.infoSoft : colors.surface,
            borderColor: colors.border, borderRadius: radius.small, borderWidth: 1,
            height: 28, justifyContent: 'center', opacity: pressed ? 0.7 : 1, width: 28,
          })}>
          <AppIcon decorative color={open ? colors.brand600 : colors.textSecondary} name="todo" size={16} />
        </Pressable>
      </View>

      {dragPreview ? (
        <View pointerEvents="none" style={{
          backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.medium,
          borderWidth: 1, bottom: 34, boxShadow: '0 4px 14px rgba(23, 24, 33, 0.14)',
          flexDirection: 'row', gap: spacing.xs, left: 46, paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs, position: 'absolute', width: previewWidth,
        }}>
          <Text style={[typography.caption, {
            color: colors.brand600, fontVariant: ['tabular-nums'], width: 38,
          }]}>
            {dragPreview.ordinal}/{anchors.length}
          </Text>
          <Text numberOfLines={2} style={[typography.caption, { color: colors.ink, flex: 1, minWidth: 0 }]}>
            {dragPreview.label}
          </Text>
        </View>
      ) : null}

      {open ? (
        <View
          accessibilityLabel="问题锚点列表"
          style={{
            backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.large,
            borderWidth: 1, bottom: 0, boxShadow: '0 8px 24px rgba(23, 24, 33, 0.14)', left: 40,
            maxHeight: Math.min(height * 0.52, 360), overflow: 'hidden', position: 'absolute',
            width: Math.min(width - 48, 300),
          }}>
          <View style={{ alignItems: 'center', borderBottomColor: colors.divider,
            borderBottomWidth: 1, flexDirection: 'row', paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm }}>
            <Text selectable style={[typography.label, { color: colors.ink, flex: 1 }]}>问题目录</Text>
            <Pressable accessibilityLabel="关闭问题锚点列表" accessibilityRole="button"
              hitSlop={8} onPress={() => setOpen(false)}>
              <AppIcon decorative color={colors.textSecondary} name="close" size={18} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: spacing.xxs, padding: spacing.sm }}
            keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {anchors.map((anchor) => {
              const active = anchor.id === activeId;
              return (
                <Pressable key={anchor.id} accessibilityRole="button" onPress={() => select(anchor.id)}
                  style={({ pressed }) => ({
                    backgroundColor: active ? colors.infoSoft : 'transparent',
                    borderRadius: radius.medium, flexDirection: 'row', gap: spacing.sm,
                    opacity: pressed ? 0.68 : 1, paddingHorizontal: spacing.sm, paddingVertical: 10,
                  })}>
                  <Text style={[typography.caption, { color: active ? colors.brand600 : colors.textTertiary,
                    fontVariant: ['tabular-nums'], width: 22 }]}>{anchor.ordinal}</Text>
                  <Text numberOfLines={2} style={[typography.body, {
                    color: active ? colors.brand600 : colors.ink, flex: 1,
                    fontWeight: active ? '600' : '400',
                  }]}>{anchor.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
