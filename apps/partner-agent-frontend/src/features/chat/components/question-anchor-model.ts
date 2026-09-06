import type { ChatItem } from '@partner-agent/contracts';

export interface QuestionAnchor {
  id: string;
  label: string;
  ordinal: number;
}

export function getQuestionAnchorPreviewWidth(viewportWidth: number): number {
  return Math.max(120, Math.min(viewportWidth - 62, 260));
}

export function isPointInsideQuestionRail(
  positionX: number,
  positionY: number,
  railWidth: number,
  railLength: number,
): boolean {
  return positionX >= 0 && positionX <= railWidth
    && positionY >= 0 && positionY <= railLength;
}

export function buildQuestionAnchors(items: readonly ChatItem[]): QuestionAnchor[] {
  return items.flatMap((item) => {
    if (item.type !== 'message' || item.payload.role !== 'user') return [];
    const label = item.payload.content.replace(/\s+/g, ' ').trim();
    if (!label) return [];
    return [{ id: item.id, label, ordinal: 0 }];
  }).map((anchor, index) => ({ ...anchor, ordinal: index + 1 }));
}

export function selectRailAnchors(
  anchors: readonly QuestionAnchor[],
  activeId: string | undefined,
  maximum: number,
): QuestionAnchor[] {
  if (anchors.length <= maximum) return [...anchors];
  const activeIndex = anchors.findIndex((anchor) => anchor.id === activeId);
  const sampleCount = Math.max(2, maximum - (activeIndex >= 0 ? 1 : 0));
  const indices = new Set(Array.from({ length: sampleCount }, (_, index) =>
    Math.round(index * (anchors.length - 1) / (sampleCount - 1))));
  if (activeIndex >= 0) indices.add(activeIndex);
  return [...indices].sort((left, right) => left - right).map((index) => anchors[index]);
}

export function findAnchorAtRailPosition(
  anchors: readonly QuestionAnchor[],
  position: number,
  railLength: number,
): QuestionAnchor | undefined {
  if (!anchors.length) return undefined;
  if (anchors.length === 1 || railLength <= 0) return anchors[0];
  const ratio = Math.min(1, Math.max(0, position / railLength));
  return anchors[Math.round(ratio * (anchors.length - 1))];
}

export function findAnchorWithHysteresis(
  anchors: readonly QuestionAnchor[],
  position: number,
  railLength: number,
  currentId: string | undefined,
  hysteresis: number,
): QuestionAnchor | undefined {
  const currentIndex = anchors.findIndex((anchor) => anchor.id === currentId);
  if (currentIndex >= 0 && railLength > 0 && (position < 0 || position > railLength)) {
    return anchors[currentIndex];
  }
  if (currentIndex < 0 || anchors.length < 2 || railLength <= 0) {
    return findAnchorAtRailPosition(anchors, position, railLength);
  }
  const step = railLength / (anchors.length - 1);
  const stableDistance = Math.min(Math.max(0, hysteresis), step * 0.45);
  const lowerBoundary = currentIndex === 0
    ? Number.NEGATIVE_INFINITY
    : (currentIndex - 0.5) * step - stableDistance;
  const upperBoundary = currentIndex === anchors.length - 1
    ? Number.POSITIVE_INFINITY
    : (currentIndex + 0.5) * step + stableDistance;
  if (position >= lowerBoundary && position <= upperBoundary) return anchors[currentIndex];
  return findAnchorAtRailPosition(anchors, position, railLength);
}
