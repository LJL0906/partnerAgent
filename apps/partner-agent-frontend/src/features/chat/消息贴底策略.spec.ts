import { describe, expect, it } from 'vitest';
import { createBottomFollowPolicy } from './消息贴底策略';

const bottom = { offset: 600, contentHeight: 1000, viewportHeight: 400 };

describe('消息贴底策略', () => {
  it('does not issue another scroll when already at the measured bottom', () => {
    const policy = createBottomFollowPolicy();
    policy.onScroll(bottom);
    expect(policy.needsFollow).toBe(false);
    policy.onViewport(300);
    expect(policy.needsFollow).toBe(true);
    policy.onScroll({ ...bottom, viewportHeight: 300, offset: 700 });
    expect(policy.needsFollow).toBe(false);
    policy.onContentSize(1000);
    policy.onViewport(300);
    expect(policy.needsFollow).toBe(false);
  });

  it('starts following and keeps following while content grows before scrollToEnd catches up', () => {
    const policy = createBottomFollowPolicy();
    expect(policy.following).toBe(true);
    policy.onScroll(bottom);
    policy.onScroll({ ...bottom, contentHeight: 1100 });
    policy.onScroll({ ...bottom, contentHeight: 1300 });
    expect(policy.following).toBe(true);
  });

  it('uses the measured full content including padding and footer to reach the bottom', () => {
    const policy = createBottomFollowPolicy();
    policy.onContentSize(1020);
    policy.onViewport(400);
    expect(policy.bottomOffset).toBe(620);
    policy.onContentSize(1220);
    expect(policy.bottomOffset).toBe(820);
  });

  it('pauses immediately on a drag and only resumes when the bottom is reached', () => {
    const policy = createBottomFollowPolicy();
    policy.onScroll(bottom);
    policy.pause();
    expect(policy.following).toBe(false);
    policy.onScroll({ ...bottom, offset: 590 });
    policy.onScroll({ ...bottom, offset: 595 });
    expect(policy.following).toBe(false);
    policy.onScroll(bottom);
    expect(policy.following).toBe(true);
  });

  it('does not reactivate for incoming content while the user reads history', () => {
    const policy = createBottomFollowPolicy();
    policy.onScroll(bottom);
    policy.onWheel(-10);
    policy.onScroll({ ...bottom, offset: 590 });
    policy.onScroll({ ...bottom, offset: 590, contentHeight: 1200 });
    expect(policy.following).toBe(false);
  });

  it('keeps following when scrolling down at the boundary emits no scroll event', () => {
    const policy = createBottomFollowPolicy();
    policy.onScroll(bottom);
    policy.onWheel(100);
    expect(policy.following).toBe(true);
  });

  it('recognizes scrollbar or keyboard movement away from the bottom', () => {
    const policy = createBottomFollowPolicy();
    policy.onScroll(bottom);
    policy.onScroll({ ...bottom, offset: 500 });
    expect(policy.following).toBe(false);
  });

  it('keeps following when the viewport shrinks or content is clamped by layout', () => {
    const policy = createBottomFollowPolicy();
    policy.onScroll(bottom);
    policy.onScroll({ ...bottom, viewportHeight: 300 });
    expect(policy.following).toBe(true);
    policy.onScroll({ offset: 300, contentHeight: 700, viewportHeight: 300 });
    expect(policy.following).toBe(true);
  });

  it('resumes explicitly and keeps following through intermediate scroll positions', () => {
    const policy = createBottomFollowPolicy();
    policy.onScroll(bottom);
    policy.onWheel(-100);
    policy.onScroll({ ...bottom, offset: 200 });
    policy.follow();
    policy.onScroll({ ...bottom, offset: 400 });
    expect(policy.following).toBe(true);
    expect(createBottomFollowPolicy().following).toBe(true);
  });

  it('does not leave short content stuck after a gesture with no scrolling', () => {
    const policy = createBottomFollowPolicy();
    policy.onContentSize(200);
    policy.onViewport(400);
    policy.pause();
    policy.finishGesture();
    expect(policy.following).toBe(true);
    policy.onWheel(-100);
    expect(policy.following).toBe(true);
  });
});
