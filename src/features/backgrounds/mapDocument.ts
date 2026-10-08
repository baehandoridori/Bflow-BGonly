import type { BackgroundMap, BackgroundPoint } from './types.ts';
import { beginMapGesture, cancelMapGesture, commitMapHistory, finishMapGesture, previewMapGesture, redoMapHistory, replaceMapHistoryValue, undoMapHistory } from './mapEditSession.ts';
import type { MapGesture } from './mapEditSession.ts';
import { MAP_PLAN_EXTENT } from './mapSpatial.ts';

/**
 * The one editable document behind every map surface (plan SVG, 3D viewport, companion plan):
 * per-map drafts with their undo history, per-map plan viewport and selection, and the single
 * gesture in progress. The display mode is not document state: switching between the plan and
 * 3D is not an action here, so it can never change a draft, the selection or the history.
 */
export type MapDraft = { value: BackgroundMap; baseRevision: number | null; past: BackgroundMap[]; future: BackgroundMap[] };
export type MapViewport = { x: number; y: number; zoom: number; selectedId: string | null };
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
  | { type: 'set-viewport'; mapId: string; viewport: Partial<Pick<MapViewport, 'x' | 'y' | 'zoom'>> };

export const MAP_ZOOM_LIMITS = { min: 0.25, max: 4 } as const;
const DEFAULT_VIEWPORT: MapViewport = { x: 0, y: 0, zoom: 1, selectedId: null };
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
    case 'select': {
      const viewport = mapViewport(state, action.mapId);
      if (viewport.selectedId === action.id) return state;
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
