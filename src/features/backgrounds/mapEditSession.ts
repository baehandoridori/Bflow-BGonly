import type { BackgroundMap } from './types.ts';

/**
 * One drag in the plan or on a 3D gizmo: any number of previews, at most one undo entry.
 * The plan editor, the 3D view and the plan inset all read the preview while it lasts.
 */
export type MapGesture = { initial: BackgroundMap; preview: BackgroundMap };

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>, keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]));
}

export function beginMapGesture(map: BackgroundMap): MapGesture {
  return { initial: map, preview: map };
}
export function previewMapGesture(gesture: MapGesture, next: BackgroundMap): MapGesture {
  if (next.id !== gesture.initial.id) throw new Error('편집 중인 도면과 다른 도면의 변경은 반영할 수 없습니다.');
  return { initial: gesture.initial, preview: next };
}
/** `historyEntry` is the snapshot to push for undo, or null when the drag ended where it started. */
export function finishMapGesture(gesture: MapGesture): { value: BackgroundMap; historyEntry: BackgroundMap | null } {
  if (sameValue(gesture.initial, gesture.preview)) return { value: gesture.initial, historyEntry: null };
  return { value: gesture.preview, historyEntry: gesture.initial };
}
export function cancelMapGesture(gesture: MapGesture): BackgroundMap {
  return gesture.initial;
}

/** Undo state of one map draft. Extra draft fields (such as the base revision) pass through untouched. */
export type MapHistory = { value: BackgroundMap; past: BackgroundMap[]; future: BackgroundMap[] };
export const MAP_HISTORY_LIMIT = 50;

/** A finished edit: `entry` (the value before it) becomes one undo step and redo is cleared. */
export function commitMapHistory<H extends MapHistory>(history: H, next: BackgroundMap, entry: BackgroundMap = history.value): H {
  return { ...history, value: next, past: [...history.past.slice(-(MAP_HISTORY_LIMIT - 1)), entry], future: [] };
}
/** A preview in the middle of a drag: the value changes, the undo steps do not. */
export function replaceMapHistoryValue<H extends MapHistory>(history: H, next: BackgroundMap): H {
  return next === history.value ? history : { ...history, value: next };
}
export function undoMapHistory<H extends MapHistory>(history: H): H {
  if (!history.past.length) return history;
  return { ...history, value: history.past[history.past.length - 1], past: history.past.slice(0, -1), future: [...history.future, history.value] };
}
export function redoMapHistory<H extends MapHistory>(history: H): H {
  if (!history.future.length) return history;
  return { ...history, value: history.future[history.future.length - 1], past: [...history.past, history.value], future: history.future.slice(0, -1) };
}
