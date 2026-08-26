/** 주간 시간표 배치·스냅 순수 유틸. UI/DOM 의존성 없음 (node --test 대상). */
export const SNAP_MINUTES = 15;

/** 시간표 열의 세로 픽셀 위치를 분 단위로 바꾼다. 스냅은 호출자가 담당한다. */
export function pxToMinutes(px: number, hourPx: number): number {
  if (!Number.isFinite(px) || !Number.isFinite(hourPx) || hourPx <= 0) return 0;
  return (px / hourPx) * 60;
}

export function snapMinutes(min: number, step: number = SNAP_MINUTES): number {
  const snapped = Math.round(min / step) * step;
  return Math.max(0, Math.min(24 * 60, snapped));
}

export function timeToMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60
    + (Number.isFinite(minutes) ? minutes : 0);
}

export function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, min));
  const hours = Math.floor(clamped / 60) % 24;
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export interface TimeBlockInput {
  id: string;
  startMin: number;
  endMin: number;
}

export interface TimeBlockLayout extends TimeBlockInput {
  col: number;
  span: number;
  cols: number;
}

const overlaps = (a: TimeBlockInput, b: TimeBlockInput) => (
  a.startMin < b.endMin && b.startMin < a.endMin
);

/** 충돌 클러스터 균등 분할 + 우측 빈 컬럼 확장 (D10). */
export function layoutDayBlocks(blocks: TimeBlockInput[]): TimeBlockLayout[] {
  const sorted = [...blocks].sort((a, b) => (
    a.startMin - b.startMin
    || (b.endMin - b.startMin) - (a.endMin - a.startMin)
    || a.id.localeCompare(b.id)
  ));

  const clusters: TimeBlockInput[][] = [];
  let current: TimeBlockInput[] = [];
  let maxEnd = -1;

  for (const block of sorted) {
    if (current.length > 0 && block.startMin >= maxEnd) {
      clusters.push(current);
      current = [];
      maxEnd = -1;
    }
    current.push(block);
    maxEnd = Math.max(maxEnd, block.endMin);
  }
  if (current.length > 0) clusters.push(current);

  const out: TimeBlockLayout[] = [];
  for (const cluster of clusters) {
    const colEnd: number[] = [];
    const placed: Array<TimeBlockInput & { col: number }> = [];

    for (const block of cluster) {
      let col = colEnd.findIndex((end) => end <= block.startMin);
      if (col === -1) {
        col = colEnd.length;
        colEnd.push(0);
      }
      colEnd[col] = block.endMin;
      placed.push({ ...block, col });
    }

    const cols = colEnd.length;
    for (const block of placed) {
      let span = 1;
      while (block.col + span < cols) {
        const nextCol = block.col + span;
        const blocked = placed.some((candidate) => (
          candidate.col === nextCol && overlaps(block, candidate)
        ));
        if (blocked) break;
        span += 1;
      }
      out.push({ ...block, span, cols });
    }
  }

  return out;
}
