import { describe, expect, it } from 'vitest';
import {
  deriveScrollState,
  isScrollAtBottom,
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
});
