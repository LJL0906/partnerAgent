import { describe, expect, it, vi } from 'vitest';
import {
  createMessageScroll,
  deriveScrollState,
  isScrollAtBottom,
  shouldShowBackToLatest,
  type ScrollMetrics,
} from './use-message-scroll';

const bottom = { offset: 600, contentHeight: 1000, viewportHeight: 400 } as ScrollMetrics;

describe('useMessageScroll 决策', () => {
  it('keeps following while at the bottom', () => {
    const decision = deriveScrollState(true, 600, bottom);
    expect(decision.pinned).toBe(true);
  });

  it('pauses as soon as the user scrolls upward (away from bottom)', () => {
    // 用户上滑读历史:offset 减小,仍在底部之外。
    const decision = deriveScrollState(true, 600, { offset: 500, contentHeight: 1000, viewportHeight: 400 });
    expect(decision.pinned).toBe(false);
  });

  it('stays paused through content growth while reading history', () => {
    // 用户停在历史位置后,内容继续增长(offset 不变),不得被拉回底部。
    let state = deriveScrollState(true, 600, { offset: 500, contentHeight: 1000, viewportHeight: 400 });
    state = deriveScrollState(state.pinned, state.previousOffset, { offset: 500, contentHeight: 1200, viewportHeight: 400 });
    expect(state.pinned).toBe(false);
  });

  it('resumes following only when the user reaches the bottom', () => {
    const state = deriveScrollState(false, 500, { offset: 500, contentHeight: 1200, viewportHeight: 400 });
    // 未到底:保持暂停。
    expect(state.pinned).toBe(false);
    // 滚到底:恢复跟随。
    const atBottom = deriveScrollState(false, 500, { offset: 800, contentHeight: 1200, viewportHeight: 400 });
    expect(atBottom.pinned).toBe(true);
  });

  it('does not unpin when the offset only decreases to the bottom via a programmatic scroll', () => {
    // 程序化 scrollToEnd 触发 onScroll 时,offset 仍会上报一次旧值;只要不在底部,
    // 单帧回位但 offset 未进一步变小时,保持原状态,避免误暂停。
    const state = deriveScrollState(true, 600, { offset: 600, contentHeight: 1000, viewportHeight: 400 });
    expect(state.pinned).toBe(true);
  });

  it('detects an overflow only when content height exceeds the viewport', () => {
    expect(isScrollAtBottom(bottom)).toBe(true);
    expect(isScrollAtBottom({ offset: 590, contentHeight: 1000, viewportHeight: 400 })).toBe(false);
  });

  it('restores pinned state immediately when returning to the latest message', () => {
    const pinnedChanges: boolean[] = [];
    const scrollToEnd = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const scroll = createMessageScroll({
      sessionRevision: 1,
      onPinnedChange: (pinned) => pinnedChanges.push(pinned),
      onOverflowChange: () => undefined,
    });
    scroll.attachScrollView({ scrollToEnd } as never);
    scroll.handleScroll({ nativeEvent: {
      contentOffset: { y: 600 }, contentSize: { height: 1000 }, layoutMeasurement: { height: 400 },
    } } as never);
    scroll.handleScroll({ nativeEvent: {
      contentOffset: { y: 500 }, contentSize: { height: 1000 }, layoutMeasurement: { height: 400 },
    } } as never);

    scroll.scrollToLatest();

    expect(pinnedChanges).toEqual([false, true]);
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
    vi.unstubAllGlobals();
  });

  it('pauses bottom following and scrolls to a selected question offset', () => {
    const pinnedChanges: boolean[] = [];
    const scrollTo = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const scroll = createMessageScroll({
      sessionRevision: 1,
      onPinnedChange: (pinned) => pinnedChanges.push(pinned),
      onOverflowChange: () => undefined,
    });
    scroll.attachScrollView({ scrollTo } as never);

    scroll.scrollToOffset(240);

    expect(pinnedChanges).toEqual([false]);
    expect(scrollTo).toHaveBeenCalledWith({ y: 240, animated: true });
    vi.unstubAllGlobals();
  });

  it('does not jump to the bottom when an inline card intentionally changes height', () => {
    const scrollToEnd = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const scroll = createMessageScroll({
      sessionRevision: 1,
      onPinnedChange: () => undefined,
      onOverflowChange: () => undefined,
    });
    scroll.attachScrollView({ scrollToEnd } as never);
    scroll.handleContentSizeChange(320, 1000);
    scrollToEnd.mockClear();

    scroll.preserveNextContentResize();
    scroll.handleContentSizeChange(320, 1180);

    expect(scrollToEnd).not.toHaveBeenCalled();
    scroll.handleContentSizeChange(320, 1200);
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('never shows the previous session back-to-latest state after a session switch', () => {
    expect(shouldShowBackToLatest(8, {
      sessionRevision: 7,
      pinned: false,
      hasOverflow: true,
    })).toBe(false);
  });
});
