import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

export interface ScrollMetrics {
  offset: number;
  contentHeight: number;
  viewportHeight: number;
}

// “判断是否到底”的容差;只用于恢复跟随,不做贴底猜测。
const BOTTOM_TOLERANCE = 2;

function isAtBottom(metrics: ScrollMetrics): boolean {
  return metrics.contentHeight - metrics.viewportHeight - metrics.offset <= BOTTOM_TOLERANCE;
}

export function isScrollAtBottom(metrics: ScrollMetrics): boolean {
  return isAtBottom(metrics);
}

export interface ScrollDecision {
  pinned: boolean;
  previousOffset: number;
}

/**
 * 纯决策函数:给定滚动事件与当前状态,决定新的 pinned 状态与下一个 offset。
 * 从控制器中抽出以便无 DOM 单测;控制器行为与这里完全一致。
 */
export function deriveScrollState(
  pinned: boolean,
  previousOffset: number,
  metrics: ScrollMetrics,
): ScrollDecision {
  if (isAtBottom(metrics)) {
    // 滚到底:恢复跟随。
    return { pinned: true, previousOffset: metrics.offset };
  }
  if (metrics.offset < previousOffset && pinned) {
    // 用户主动上滑读历史:暂停跟随,停在用户位置。
    return { pinned: false, previousOffset: metrics.offset };
  }
  return { pinned, previousOffset: metrics.offset };
}

export interface MessageScrollController {
  attachScrollView: (node: ScrollView | null) => void;
  handleScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  handleContentSizeChange: (width: number, height: number) => void;
  handleLayout: (event: LayoutChangeEvent) => void;
  scrollToLatest: () => void;
}

interface MessageScrollOptions {
  /** 只用于触发控制器重建(切会话时闭包归零);不参与逻辑判断。 */
  sessionRevision: number;
  onPinnedChange: (pinned: boolean) => void;
  onOverflowChange: (overflow: boolean) => void;
}

/**
 * 聊天消息滚动控制器(纯闭包,不依赖 React 状态渲染)。
 *
 * 行为(单一状态 `pinned`,不做几何猜测):
 * - pinned 默认 true:内容增长时自动滚到最新消息(贴底)。
 * - 用户向上滚动(offset 减小,即读历史):pinned 立即 false,视图停在用户位置,
 *   内容继续增长也不被拉回。
 * - 用户滚动到底,或点“回到最新”:pinned 恢复 true,立即滚到最新。
 *
 * 变更通过 onPinnedChange/onOverflowChange 回调通知宿主组件更新渲染状态;
 * 所有可变状态保存在闭包内,不引入 React ref,从而避免 React Compiler 的
 * react-hooks/refs 与 react-hooks/set-state-in-effect。控制器需配合
 * useMemo 保持引用稳定;切换会话时由宿主以 key 重挂消息区,或重新创建控制器。
 */
export function createMessageScroll(options: MessageScrollOptions): MessageScrollController {
  const { onPinnedChange, onOverflowChange } = options;
  // 内部滚动视图句柄:纯闭包对象,不用 React ref,由 attachScrollView 回调写入。
  const scrollViewRef = { current: null as ScrollView | null };
  let pinned = true;
  let previousOffset = 0;
  let contentHeight = 0;
  let viewportHeight = 0;

  const setPinned = (value: boolean) => {
    if (pinned === value) return;
    pinned = value;
    onPinnedChange(value);
  };

  const updateOverflow = () => {
    onOverflowChange(contentHeight > viewportHeight);
  };

  const scrollToLatest = () => {
    requestAnimationFrame(() => {
      scrollViewRef?.current?.scrollToEnd({ animated: false });
    });
  };

  const handleContentSizeChange = (width: number, height: number) => {
    contentHeight = height;
    updateOverflow();
    // 只在仍在贴底时跟随内容增长;用户暂停读历史时不打扰。
    if (pinned) scrollToLatest();
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const metrics: ScrollMetrics = {
      offset: event.nativeEvent.contentOffset.y,
      contentHeight: event.nativeEvent.contentSize.height,
      viewportHeight: event.nativeEvent.layoutMeasurement.height,
    };
    const decision = deriveScrollState(pinned, previousOffset, metrics);
    if (decision.pinned !== pinned) setPinned(decision.pinned);
    previousOffset = decision.previousOffset;
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextViewportHeight = event.nativeEvent.layout.height;
    if (nextViewportHeight > 0) {
      viewportHeight = nextViewportHeight;
      updateOverflow();
    }
    // 布局变化(键盘收放/旋转/新会话重挂)后:若仍在贴底,保持回到贴底;
    // 若用户在读历史(pinned=false),则保持在原位置,不被拉回底部。
    previousOffset = 0;
    if (pinned) scrollToLatest();
  };

  const attachScrollView = (node: ScrollView | null) => {
    if (scrollViewRef) scrollViewRef.current = node;
  };

  return {
    attachScrollView,
    handleScroll,
    handleContentSizeChange,
    handleLayout,
    scrollToLatest,
  };
}