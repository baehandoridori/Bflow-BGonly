import type { BackgroundMap, BackgroundPoint } from './types.ts';
import { beginMapGesture, cancelMapGesture, commitMapHistory, finishMapGesture, previewMapGesture, redoMapHistory, replaceMapHistoryValue, undoMapHistory } from './mapEditSession.ts';
import type { MapGesture } from './mapEditSession.ts';
import { MAP_PLAN_EXTENT, mapPlanBounds } from './mapSpatial.ts';

/**
 * The one editable document behind every map surface (plan SVG, 3D viewport, companion plan):
 * per-map drafts with their undo history, per-map plan viewport and selection, and the single
 * gesture in progress. The display mode is not document state: switching between the plan and
 * 3D is not an action here, so it can never change a draft, the selection or the history.
 */
export type MapDraft = { value: BackgroundMap; baseRevision: number | null; past: BackgroundMap[]; future: BackgroundMap[] };
export type MapViewport = { x: number; y: number; zoom: number;
  /**
   * The node the views that show one node (the 3D view, its companion plan) work on. `select` and `select-many` set it
   * to the last id of `selectedIds` (the primary), or to null when nothing is selected. `pick-one` moves it alone and
   * leaves the selection as it is: a pick in 3D while several are selected. Read through singleViewId.
   */
  selectedId: string | null;
  /**
   * Every selected node id in the order it was picked. Raw: an id whose node an undo, a discard or a refresh
   * removed stays listed, and is left out where the selection is read (mapSelection).
   */
  selectedIds: readonly string[] };
export type MapDocumentGesture = MapGesture & { mapId: string };
export type MapDocumentState = {
  drafts: Record<string, MapDraft>;
  viewports: Record<string, MapViewport>;
  gesture: MapDocumentGesture | null;
  /** The field edit that an update with the same key joins instead of adding an undo step. */
  coalescing: { mapId: string; key: string } | null;
};
export type MapUpdateOptions = {
  /** false replaces the value without an undo step. Default true. */
  history?: boolean;
  /** Consecutive updates of one map with the same key share one undo step. */
  coalesceKey?: string;
};
export type MapDocumentAction =
  | { type: 'begin-editing'; map: BackgroundMap }
  | { type: 'enter-new-map'; map: BackgroundMap }
  | { type: 'discard'; mapId: string }
  | { type: 'drop-drafts'; mapIds: readonly string[] }
  | ({ type: 'update'; map: BackgroundMap } & MapUpdateOptions)
  | { type: 'end-coalescing' }
  | { type: 'undo'; mapId: string }
  | { type: 'redo'; mapId: string }
  | { type: 'gesture-begin'; mapId: string }
  | { type: 'gesture-preview'; map: BackgroundMap }
  | { type: 'gesture-finish' }
  | { type: 'gesture-cancel' }
  | { type: 'select'; mapId: string; id: string | null }
  | { type: 'select-many'; mapId: string; ids: readonly string[] }
  | { type: 'pick-one'; mapId: string; id: string | null }
  | { type: 'set-viewport'; mapId: string; viewport: Partial<Pick<MapViewport, 'x' | 'y' | 'zoom'>> };

export const MAP_ZOOM_LIMITS = { min: 0.1, max: 4 } as const;
/** Bounds of the label size factor. The upper bound follows the zoom floor. */
export const MAP_LABEL_SCALE_LIMITS = { min: 0.4, max: 1 / MAP_ZOOM_LIMITS.min } as const;
/** The one empty selection, so that nothing selected is always the same list. */
const NO_SELECTION: readonly string[] = [];
const DEFAULT_VIEWPORT: MapViewport = { x: 0, y: 0, zoom: 1, selectedId: null, selectedIds: NO_SELECTION };
const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

export function createMapDocument(): MapDocumentState {
  return { drafts: {}, viewports: {}, gesture: null, coalescing: null };
}

function openDraft(state: MapDocumentState, map: BackgroundMap): MapDocumentState {
  const draft: MapDraft = { value: structuredClone(map), baseRevision: map.revision, past: [], future: [] };
  return { ...state, drafts: { ...state.drafts, [map.id]: draft }, gesture: state.gesture?.mapId === map.id ? null : state.gesture, coalescing: null };
}
function dropDrafts(state: MapDocumentState, mapIds: readonly string[]): MapDocumentState {
  const removed = mapIds.filter(id => has(state.drafts, id));
  const gesture = state.gesture && mapIds.includes(state.gesture.mapId) ? null : state.gesture;
  if (!removed.length && gesture === state.gesture && !state.coalescing) return state;
  const drafts = { ...state.drafts };
  for (const id of removed) delete drafts[id];
  return { ...state, drafts: removed.length ? drafts : state.drafts, gesture, coalescing: null };
}
function withDraft(state: MapDocumentState, mapId: string, draft: MapDraft, rest?: Partial<MapDocumentState>): MapDocumentState {
  const drafts = draft === state.drafts[mapId] ? state.drafts : { ...state.drafts, [mapId]: draft };
  return { ...state, ...rest, drafts };
}
/**
 * `select` and `select-many`: the list replaces the selection of the map, and the single views go to its last id.
 * An id is not checked against the map: a viewer has no draft to look it up in.
 */
function withSelection(state: MapDocumentState, mapId: string, viewport: MapViewport, ids: readonly string[]): MapDocumentState {
  const stored = viewport.selectedIds, same = ids.length === stored.length && ids.every((id, index) => id === stored[index]);
  // An unchanged list keeps its array, so readers keyed on it do not recompute.
  const selectedIds = same ? stored : ids.length ? ids : NO_SELECTION;
  const selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  if (same && viewport.selectedId === selectedId) return state;
  return { ...state, viewports: { ...state.viewports, [mapId]: { ...viewport, selectedId, selectedIds } }, coalescing: null };
}

export function reduceMapDocument(state: MapDocumentState, action: MapDocumentAction): MapDocumentState {
  switch (action.type) {
    case 'begin-editing':
      // An open draft is never replaced: its unsaved edits and history stay.
      return has(state.drafts, action.map.id) ? state : openDraft(state, action.map);
    case 'enter-new-map':
      return openDraft(state, action.map);
    case 'discard':
      return dropDrafts(state, [action.mapId]);
    case 'drop-drafts':
      return dropDrafts(state, action.mapIds);
    case 'update': {
      const id = action.map.id, draft = mapDraft(state, id);
      // While a gesture previews a map, that gesture is the only writer of the map.
      if (!draft || state.gesture?.mapId === id || action.map === draft.value) return state;
      if (action.history === false) return withDraft(state, id, replaceMapHistoryValue(draft, action.map), { coalescing: null });
      const key = action.coalesceKey ?? null;
      const joins = key !== null && state.coalescing?.mapId === id && state.coalescing.key === key;
      return withDraft(state, id, joins ? replaceMapHistoryValue(draft, action.map) : commitMapHistory(draft, action.map),
        { coalescing: key === null ? null : joins ? state.coalescing : { mapId: id, key } });
    }
    case 'end-coalescing':
      return state.coalescing ? { ...state, coalescing: null } : state;
    case 'undo':
    case 'redo': {
      if (state.gesture) return state;
      const draft = mapDraft(state, action.mapId);
      const next = draft && (action.type === 'undo' ? undoMapHistory(draft) : redoMapHistory(draft));
      if (!next || next === draft) return state.coalescing ? { ...state, coalescing: null } : state;
      return withDraft(state, action.mapId, next, { coalescing: null });
    }
    case 'gesture-begin': {
      const draft = mapDraft(state, action.mapId);
      if (state.gesture || !draft) return state;
      // `drafts` keeps its identity, so readers of the settled maps do not recompute at the start.
      return { ...state, gesture: { mapId: action.mapId, ...beginMapGesture(draft.value) }, coalescing: null };
    }
    case 'gesture-preview': {
      const gesture = state.gesture, draft = mapDraft(state, gesture?.mapId);
      if (!gesture || !draft || action.map.id !== gesture.mapId || action.map === gesture.preview) return state;
      const next = previewMapGesture(gesture, action.map);
      return withDraft(state, gesture.mapId, replaceMapHistoryValue(draft, next.preview), { gesture: { mapId: gesture.mapId, ...next } });
    }
    case 'gesture-finish': {
      const gesture = state.gesture, draft = mapDraft(state, gesture?.mapId);
      if (!gesture) return state;
      if (!draft) return { ...state, gesture: null };
      const { value, historyEntry } = finishMapGesture(gesture);
      return withDraft(state, gesture.mapId, historyEntry ? commitMapHistory(draft, value, historyEntry) : replaceMapHistoryValue(draft, value), { gesture: null });
    }
    case 'gesture-cancel': {
      const gesture = state.gesture, draft = mapDraft(state, gesture?.mapId);
      if (!gesture) return state;
      if (!draft) return { ...state, gesture: null };
      return withDraft(state, gesture.mapId, replaceMapHistoryValue(draft, cancelMapGesture(gesture)), { gesture: null });
    }
    case 'select':
      return withSelection(state, action.mapId, mapViewport(state, action.mapId), action.id === null ? NO_SELECTION : [action.id]);
    case 'select-many':
      return withSelection(state, action.mapId, mapViewport(state, action.mapId), [...new Set(action.ids)]);
    case 'pick-one': {
      const viewport = mapViewport(state, action.mapId);
      if (viewport.selectedId === action.id) return state;
      // The spread carries the same `selectedIds` array along: the selection is not touched.
      return { ...state, viewports: { ...state.viewports, [action.mapId]: { ...viewport, selectedId: action.id } }, coalescing: null };
    }
    case 'set-viewport': {
      const viewport = mapViewport(state, action.mapId), { x = viewport.x, y = viewport.y, zoom = viewport.zoom } = action.viewport;
      if (![x, y, zoom].every(Number.isFinite) || (x === viewport.x && y === viewport.y && zoom === viewport.zoom)) return state;
      return { ...state, viewports: { ...state.viewports, [action.mapId]: { ...viewport, x, y, zoom } } };
    }
    default:
      return state;
  }
}

export function mapDraft(state: MapDocumentState, mapId: string | null | undefined): MapDraft | undefined {
  return mapId != null && has(state.drafts, mapId) ? state.drafts[mapId] : undefined;
}
/** Plan viewport and selection of a map; a map that was never touched reads as the default. */
export function mapViewport(state: MapDocumentState, mapId: string | null | undefined): MapViewport {
  return mapId != null && has(state.viewports, mapId) ? state.viewports[mapId] : DEFAULT_VIEWPORT;
}
export type MapSelection = { /** Selected ids that are nodes of the map, in picked order. */ ids: readonly string[]; /** The last of them. */ primaryId: string | null };
const NOTHING_SELECTED: MapSelection = { ids: NO_SELECTION, primaryId: null };
/** The selection as it is on a map right now: the stored list (`MapViewport.selectedIds`) without the ids whose node is gone. Nothing is written. */
export function mapSelection(map: BackgroundMap | undefined, selectedIds: readonly string[]): MapSelection {
  if (!map || !selectedIds.length) return NOTHING_SELECTED;
  const alive = new Set(map.nodes.map(node => node.id));
  // All alive: the stored array itself. Otherwise a new array on every call, so a render reads this through a memo.
  const ids = selectedIds.every(id => alive.has(id)) ? selectedIds : selectedIds.filter(id => alive.has(id));
  return { ids, primaryId: ids.length ? ids[ids.length - 1] : null };
}
/**
 * The node a view that shows one node (the 3D view, its companion plan) works on. With at most one node selected it is
 * that selection. With several it is `selectedId` (`MapViewport.selectedId`), which such a view moves alone: null when
 * nothing is picked there, and the primary again when the node it named is gone.
 */
export function singleViewId(map: BackgroundMap | undefined, selection: MapSelection, selectedId: string | null): string | null {
  if (selection.ids.length <= 1) return selection.primaryId;
  if (selectedId === null) return null;
  return map?.nodes.some(node => node.id === selectedId) ? selectedId : selection.primaryId;
}
/**
 * The action that picks one node, or none (`id` null). On the plan the pick is the selection (`select`). In a view that
 * shows one node (`singleView`), while several are selected, it only moves the node that view works on (`pick-one`):
 * the group is left as it is for the plan.
 */
export function pickAction(mapId: string, id: string | null, singleView: boolean, selection: MapSelection): MapDocumentAction {
  return singleView && selection.ids.length > 1 ? { type: 'pick-one', mapId, id } : { type: 'select', mapId, id };
}
export function isMapGestureActive(state: MapDocumentState): boolean {
  return state.gesture !== null;
}
/** The map as it was when the active gesture on it started, for readers that must not follow every frame. */
export function gestureStartMap(state: MapDocumentState, mapId: string | null | undefined): BackgroundMap | undefined {
  return state.gesture && state.gesture.mapId === mapId ? state.gesture.initial : undefined;
}
/**
 * The map as it was before the running field edit with this key began. A value typed digit by digit is applied to
 * this map each time, so an in-between entry ("15" on the way to "150") leaves no trace in the result.
 */
export function fieldEditStartMap(state: MapDocumentState, mapId: string | null | undefined, key: string): BackgroundMap | undefined {
  const draft = mapDraft(state, mapId), edit = state.coalescing;
  return draft && edit && edit.mapId === mapId && edit.key === key ? draft.past[draft.past.length - 1] : undefined;
}
/** A new map, or a draft with at least one undo step, has something to save. */
export function mapDraftChanged(draft: MapDraft | undefined): boolean {
  return !!draft && (draft.baseRevision === null || draft.past.length > 0);
}
export function canUndoMap(state: MapDocumentState, mapId: string | null | undefined): boolean {
  return !state.gesture && !!mapDraft(state, mapId)?.past.length;
}
export function canRedoMap(state: MapDocumentState, mapId: string | null | undefined): boolean {
  return !state.gesture && !!mapDraft(state, mapId)?.future.length;
}

/** Zoom about the centre of the plan view. */
export function zoomMapViewport(viewport: MapViewport, factor: number): MapViewport {
  const zoom = Math.min(MAP_ZOOM_LIMITS.max, Math.max(MAP_ZOOM_LIMITS.min, viewport.zoom * factor));
  if (!Number.isFinite(zoom) || zoom === viewport.zoom) return viewport;
  const halfWidth = MAP_PLAN_EXTENT.width / 2, halfHeight = MAP_PLAN_EXTENT.height / 2;
  return { ...viewport, zoom, x: viewport.x + halfWidth / viewport.zoom - halfWidth / zoom, y: viewport.y + halfHeight / viewport.zoom - halfHeight / zoom };
}
const clampZoom = (zoom: number) => Math.min(MAP_ZOOM_LIMITS.max, Math.max(MAP_ZOOM_LIMITS.min, zoom));
/** Map units covered by one CSS pixel of the plan canvas. */
export function mapScreenScale(zoom: number, canvas: { width: number; height: number }): number {
  // A canvas without a usable size counts as the base extent.
  const { width, height } = [canvas.width, canvas.height].every(side => Number.isFinite(side) && side > 0) ? canvas : MAP_PLAN_EXTENT;
  return 1 / (Math.min(width / MAP_PLAN_EXTENT.width, height / MAP_PLAN_EXTENT.height) * zoom);
}
/** Zoom while the plan point `anchor` keeps its place on screen. Same object back at a limit or for a broken input. */
export function zoomMapViewportAt(viewport: MapViewport, factor: number, anchor: BackgroundPoint): MapViewport {
  const zoom = clampZoom(viewport.zoom * factor);
  if (!Number.isFinite(zoom) || zoom === viewport.zoom || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return viewport;
  return { ...viewport, zoom, x: anchor.x - (anchor.x - viewport.x) * viewport.zoom / zoom, y: anchor.y - (anchor.y - viewport.y) * viewport.zoom / zoom };
}
/** Zoom factor of one wheel event. `pinch` is a ctrl-wheel (touchpad pinch). */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
  if (!Number.isFinite(deltaY)) return 1;
  // Lines and pages as pixels.
  const distance = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  const limit = pinch ? 20 : 180, rate = pinch ? 0.01 : 0.002;
  return Math.exp(-Math.min(limit, Math.max(-limit, distance)) * rate);
}
export const MAP_FIT_MARGIN = 0.04;
/** View that shows the whole plan bounds. A map inside the base extent gives { x: 0, y: 0, zoom: 1 }. */
export function fitMapViewport(map: BackgroundMap): Pick<MapViewport, 'x' | 'y' | 'zoom'> {
  const bounds = mapPlanBounds(map), { width, height } = MAP_PLAN_EXTENT;
  const margin = MAP_FIT_MARGIN * Math.max(bounds.width, bounds.height * width / height);
  // A side that leaves the base extent moves out by the margin. Any other side is the base edge itself:
  // the bounds can overshoot it by a rounding step, and that is not a side that left.
  const side = (base: number, edge: number, outward: 1 | -1) => (edge - base) * outward > 1e-6 ? edge + outward * margin : base;
  const left = side(0, bounds.x, -1), right = side(width, bounds.x + bounds.width, 1);
  const top = side(0, bounds.y, -1), bottom = side(height, bounds.y + bounds.height, 1);
  const zoom = clampZoom(Math.min(width / (right - left), height / (bottom - top)));
  return { x: (left + right) / 2 - width / (2 * zoom), y: (top + bottom) / 2 - height / (2 * zoom), zoom };
}
/**
 * Bring a plan point into view. The view is panned, never zoomed, and only when the point is
 * outside the visible box (or closer than `margin` to its edge); otherwise the same viewport returns.
 */
export function revealPlanPoint(viewport: MapViewport, point: BackgroundPoint, margin = 0): MapViewport {
  const width = MAP_PLAN_EXTENT.width / viewport.zoom, height = MAP_PLAN_EXTENT.height / viewport.zoom;
  const inset = Math.max(0, Math.min(margin, width / 4, height / 4));
  const inside = point.x >= viewport.x + inset && point.x <= viewport.x + width - inset
    && point.y >= viewport.y + inset && point.y <= viewport.y + height - inset;
  if (inside || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return viewport;
  return { ...viewport, x: point.x - width / 2, y: point.y - height / 2 };
}

export type MapDocumentStore = {
  getState(): MapDocumentState;
  dispatch(action: MapDocumentAction): void;
  subscribe(listener: () => void): () => void;
};
/** Synchronous holder of the document, so pointer handlers read the result of a dispatch at once. */
export function createMapDocumentStore(initial: MapDocumentState = createMapDocument()): MapDocumentStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reduceMapDocument(state, action);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
