import { dateStamp } from './domain.ts';
import type { GanttTask } from './types.ts';

type Bounds = Pick<GanttTask, 'startDate' | 'endDate' | 'startTime' | 'endTime' | 'allDay'>;
const DAY = 86_400_000;

function validWidth(width: number): void {
  if (!Number.isFinite(width) || width <= 0) throw new Error('날짜 너비는 0보다 큰 숫자여야 합니다.');
}

/** Shared by bars, enclosing group/project brackets, and dependency endpoints. */
export function barGeometry(bounds: Bounds, kind: GanttTask['kind'] | 'project', base: string, dayWidth: number): { left: number; width: number } {
  validWidth(dayWidth);
  const start = dateStamp(bounds.startDate, bounds.allDay ? '' : bounds.startTime);
  const left = (start - dateStamp(base)) / DAY * dayWidth + 3;
  if (kind === 'milestone') return { left, width: 12 };
  const end = dateStamp(bounds.endDate, bounds.allDay ? '' : bounds.endTime);
  if (end < start) throw new Error('종료 시점은 시작보다 빠를 수 없습니다.');
  // Date-only ranges include the final date and leave a three-pixel inset at both ends.
  // Timed bars retain their exact elapsed width, with a minimum visible hit target.
  const elapsedWidth = (end - start + (bounds.allDay ? DAY : 0)) / DAY * dayWidth;
  return { left, width: Math.max(6, elapsedWidth - (bounds.allDay ? 6 : 0)) };
}

/** Keeps the visible date in place when project toggles change the date-axis origin. */
export function rebaseScroll(oldBase: string, newBase: string, scrollLeft: number, dayWidth: number): number {
  validWidth(dayWidth);
  return Math.max(0, scrollLeft + (dateStamp(oldBase) - dateStamp(newBase)) / DAY * dayWidth);
}

/** Keeps the date under the cursor fixed; the sticky outline anchors at its right edge. */
export function zoomScroll(oldWidth: number, newWidth: number, scrollLeft: number, pointerX: number, labelWidth: number): number {
  validWidth(oldWidth);validWidth(newWidth);
  const anchor = Math.max(0, pointerX - labelWidth);
  return Math.max(0, (scrollLeft + anchor) * newWidth / oldWidth - anchor);
}
