export interface ScrollMetrics {
  offset: number;
  contentHeight: number;
  viewportHeight: number;
}

// Only allow rounding differences; being near the bottom is not reaching it.
const BOTTOM_EPSILON = 2;
export function isAtBottom(metrics: ScrollMetrics): boolean {
  return metrics.contentHeight - metrics.viewportHeight - metrics.offset <= BOTTOM_EPSILON;
}

export function createBottomFollowPolicy() {
  let following = true;
  let previous: ScrollMetrics | undefined;
  let contentHeight: number | undefined;
  let viewportHeight: number | undefined;
  const measured = (): ScrollMetrics | undefined => contentHeight === undefined || viewportHeight === undefined
    ? undefined : { offset: previous?.offset ?? 0, contentHeight, viewportHeight };
  return {
    get following() { return following; },
    get needsFollow() { const metrics = measured(); return following && metrics !== undefined && !isAtBottom(metrics); },
    get bottomOffset() { return Math.max(0, (contentHeight ?? 0) - (viewportHeight ?? 0)); },
    pause() { following = false; },
    follow() { following = true; },
    onContentSize(height: number) { contentHeight = height; },
    onViewport(height: number) { viewportHeight = height; },
    onScroll(metrics: ScrollMetrics) {
      contentHeight = metrics.contentHeight;
      viewportHeight = metrics.viewportHeight;
      if (isAtBottom(metrics)) following = true;
      else if (previous && metrics.offset < previous.offset &&
        metrics.contentHeight === previous.contentHeight &&
        metrics.viewportHeight === previous.viewportHeight) {
        // Includes Web scrollbar/keyboard scrolling, which has no native drag event.
        following = false;
      }
      // Layout changes or our own scroll commands must not disable following.
      previous = metrics;
    },
    onWheel(deltaY: number) {
      if (!deltaY) return;
      const metrics = measured();
      // Scrolling down at the boundary may not emit any subsequent scroll event.
      following = deltaY > 0 && metrics !== undefined && isAtBottom(metrics);
      if (metrics && metrics.contentHeight <= metrics.viewportHeight) following = true;
    },
    finishGesture() {
      const metrics = measured();
      if (metrics && isAtBottom(metrics)) following = true;
    },
  };
}
