export interface TimelineCarouselSelection {
  selectedIndex: number;
  floatingIndex: number;
  pointerRatio: number;
  snapRatio: number;
  visibleIndices: number[];
}

export function clampTimelineRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio));
}

export function getTimelineCarouselSelection(totalScenes: number, pointerRatio: number): TimelineCarouselSelection {
  if (totalScenes <= 0) {
    return { selectedIndex: -1, floatingIndex: -1, pointerRatio: 0, snapRatio: 0, visibleIndices: [] };
  }

  const ratio = clampTimelineRatio(pointerRatio);
  const maxIndex = totalScenes - 1;
  const floatingIndex = maxIndex === 0 ? 0 : ratio * maxIndex;
  const selectedIndex = maxIndex === 0 ? 0 : Math.round(floatingIndex);
  const snapRatio = maxIndex === 0 ? 0 : selectedIndex / maxIndex;
  const visibleIndices = [selectedIndex - 2, selectedIndex - 1, selectedIndex, selectedIndex + 1, selectedIndex + 2]
    .filter((index) => index >= 0 && index < totalScenes);

  return { selectedIndex, floatingIndex, pointerRatio: ratio, snapRatio, visibleIndices };
}
