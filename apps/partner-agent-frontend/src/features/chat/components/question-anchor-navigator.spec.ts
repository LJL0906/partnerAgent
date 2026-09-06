import type { ChatItem } from '@partner-agent/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildQuestionAnchors,
  findAnchorAtRailPosition,
  findAnchorWithHysteresis,
  getQuestionAnchorPreviewWidth,
  isPointInsideQuestionRail,
  selectRailAnchors,
} from './question-anchor-model';

const base = {
  schema_version: 1 as const, status: 'completed' as const, collapsed: false,
  created_at: 1, updated_at: 1, revision: 1,
};

describe('question anchor navigator', () => {
  it('creates anchors only for non-empty user messages and keeps stable item ids', () => {
    const items: ChatItem[] = [
      { ...base, id: 'user-1', type: 'message',
        payload: { role: 'user', content: '  第一个\n问题  ' } },
      { ...base, id: 'assistant-1', type: 'message',
        payload: { role: 'assistant', content: '回答' } },
      { ...base, id: 'user-empty', type: 'message',
        payload: { role: 'user', content: '   ' } },
      { ...base, id: 'user-2', type: 'message',
        payload: { role: 'user', content: '第二个问题' } },
    ];

    expect(buildQuestionAnchors(items)).toEqual([
      { id: 'user-1', label: '第一个 问题', ordinal: 1 },
      { id: 'user-2', label: '第二个问题', ordinal: 2 },
    ]);
  });

  it('condenses a long rail while preserving its ends and active question', () => {
    const anchors = Array.from({ length: 30 }, (_, index) => ({
      id: `question-${index + 1}`, label: `问题 ${index + 1}`, ordinal: index + 1,
    }));

    const visible = selectRailAnchors(anchors, 'question-17', 8);

    expect(visible).toHaveLength(8);
    expect(visible[0]?.id).toBe('question-1');
    expect(visible.at(-1)?.id).toBe('question-30');
    expect(visible.some((anchor) => anchor.id === 'question-17')).toBe(true);
  });

  it('maps a dragged rail position to the nearest question and clamps its edges', () => {
    const anchors = Array.from({ length: 5 }, (_, index) => ({
      id: `question-${index + 1}`, label: `问题 ${index + 1}`, ordinal: index + 1,
    }));

    expect(findAnchorAtRailPosition(anchors, -20, 100)?.id).toBe('question-1');
    expect(findAnchorAtRailPosition(anchors, 51, 100)?.id).toBe('question-3');
    expect(findAnchorAtRailPosition(anchors, 130, 100)?.id).toBe('question-5');
    expect(findAnchorAtRailPosition([], 50, 100)).toBeUndefined();
  });

  it('keeps the current drag preview until the finger clears the hysteresis zone', () => {
    const anchors = Array.from({ length: 5 }, (_, index) => ({
      id: `question-${index + 1}`, label: `问题 ${index + 1}`, ordinal: index + 1,
    }));

    expect(findAnchorWithHysteresis(anchors, 68, 100, 'question-3', 8)?.id)
      .toBe('question-3');
    expect(findAnchorWithHysteresis(anchors, 71, 100, 'question-3', 8)?.id)
      .toBe('question-4');
    expect(findAnchorWithHysteresis(anchors, 29, 100, 'question-3', 8)?.id)
      .toBe('question-2');

    const denseAnchors = Array.from({ length: 11 }, (_, index) => ({
      id: `dense-${index + 1}`, label: `密集问题 ${index + 1}`, ordinal: index + 1,
    }));
    expect(findAnchorWithHysteresis(denseAnchors, 24, 40, 'dense-6', 8)?.id)
      .toBe('dense-7');
  });

  it('keeps the last preview while the held finger is outside the rail', () => {
    const anchors = Array.from({ length: 5 }, (_, index) => ({
      id: `question-${index + 1}`, label: `问题 ${index + 1}`, ordinal: index + 1,
    }));

    expect(findAnchorWithHysteresis(anchors, -12, 100, 'question-3', 8)?.id)
      .toBe('question-3');
    expect(findAnchorWithHysteresis(anchors, 126, 100, 'question-3', 8)?.id)
      .toBe('question-3');
    expect(isPointInsideQuestionRail(22, 50, 44, 100)).toBe(true);
    expect(isPointInsideQuestionRail(-1, 50, 44, 100)).toBe(false);
    expect(isPointInsideQuestionRail(45, 50, 44, 100)).toBe(false);
  });

  it('gives the drag preview an explicit responsive width on small screens', () => {
    expect(getQuestionAnchorPreviewWidth(320)).toBe(258);
    expect(getQuestionAnchorPreviewWidth(240)).toBe(178);
    expect(getQuestionAnchorPreviewWidth(720)).toBe(260);
  });
});
