import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import type { BackgroundMap } from './types.ts';
import type { MapDocumentAction, MapDocumentState, MapUpdateOptions, MapViewport } from './mapDocument.ts';
import { createMapDraftSession } from './mapDraftSession.ts';
import type { MapDraftSession } from './mapDraftSession.ts';
import { primeKeptMapEdits, setKeptMapFlush, useKeptMapEdits } from './mapKeptSignal.ts';

export type BackgroundMapDocument = {
  /** State of the current render. */
  state: MapDocumentState;
  /** State right now, including dispatches of the running event handler. */
  getState(): MapDocumentState;
  dispatch(action: MapDocumentAction): void;
  /** Synchronous, for pointer and key handlers. */
  isGestureActive(): boolean;
  beginEditing(map: BackgroundMap): void;
  enterNewMap(map: BackgroundMap): void;
  discard(mapId: string): void;
  /** After a save: each saved map that has a draft goes on from what was saved. A map without a draft gets none. */
  rebaseDrafts(maps: readonly BackgroundMap[]): void;
  /** A draft with nothing unsaved in it follows the library: on to a newer revision of its map, or away with a map that is gone. */
  followSaved(maps: readonly BackgroundMap[]): void;
  update(map: BackgroundMap, options?: MapUpdateOptions): void;
  endCoalescing(): void;
  undo(mapId: string): void;
  redo(mapId: string): void;
  /** True when this call started the gesture; false when the map has no draft or a gesture is running. */
  beginGesture(mapId: string): boolean;
  previewGesture(map: BackgroundMap): void;
  finishGesture(): void;
  cancelGesture(): void;
  select(mapId: string, id: string | null): void;
  selectMany(mapId: string, ids: readonly string[]): void;
  setViewport(mapId: string, viewport: Partial<Pick<MapViewport, 'x' | 'y' | 'zoom'>>): void;
  /** The account's document and its copy on this PC: what outlives the screen. */ session: MapDraftSession;
};

let active: MapDraftSession | null = null;
let hooked = false;
export function mapDraftSessionOf(userId: string): MapDraftSession {
  if (active?.userId === userId) return active;
  active?.dispose();
  active = createMapDraftSession({
    userId,
    put: (mapId, entry) => window.electronAPI.backgroundKeptPut(mapId, entry),
    signal: { read: useKeptMapEdits.getState, write: patch => useKeptMapEdits.setState(patch) },
    timers: { set: (run, ms) => window.setTimeout(run, ms), clear: handle => window.clearTimeout(handle as number) },
    now: Date.now,
  });
  if (!hooked) {
    hooked = true;
    // Tray 종료 and 지금 업데이트: main waits up to three seconds for what each window has to finish. 로그아웃 waits as well, while the session is alive.
    window.electronAPI?.onBeforeQuitFlush?.(() => active?.flush());
    setKeptMapFlush(() => active?.flush() ?? Promise.resolve());
    useAuthStore.subscribe((now, before) => { if (now.currentUser?.id !== before.currentUser?.id) { active?.dispose(); active = null; } });
  }
  return active;
}

/** Thin React binding of the map document reducer. Every map surface of one editor shares it. */
export function useBackgroundMapDocument(userId: string): BackgroundMapDocument {
  const [session] = useState(() => mapDraftSessionOf(userId));
  const store = session.store;
  useEffect(() => () => { store.dispatch({ type: 'gesture-cancel' }); store.dispatch({ type: 'end-coalescing' }); }, [store]);
  useEffect(() => { if (userId) primeKeptMapEdits(userId); }, [userId]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const actions = useMemo(() => ({
    getState: store.getState,
    dispatch: store.dispatch,
    isGestureActive: () => store.getState().gesture !== null,
    beginEditing: (map: BackgroundMap) => store.dispatch({ type: 'begin-editing', map }),
    enterNewMap: (map: BackgroundMap) => store.dispatch({ type: 'enter-new-map', map }),
    discard: (mapId: string) => store.dispatch({ type: 'discard', mapId }),
    rebaseDrafts: (maps: readonly BackgroundMap[]) => store.dispatch({ type: 'rebase-drafts', maps }),
    followSaved: (maps: readonly BackgroundMap[]) => store.dispatch({ type: 'follow-saved', maps }),
    update: (map: BackgroundMap, options?: MapUpdateOptions) => store.dispatch({ type: 'update', map, ...options }),
    endCoalescing: () => store.dispatch({ type: 'end-coalescing' }),
    undo: (mapId: string) => store.dispatch({ type: 'undo', mapId }),
    redo: (mapId: string) => store.dispatch({ type: 'redo', mapId }),
    beginGesture: (mapId: string) => {
      if (store.getState().gesture) return false;
      store.dispatch({ type: 'gesture-begin', mapId });
      return store.getState().gesture?.mapId === mapId;
    },
    previewGesture: (map: BackgroundMap) => store.dispatch({ type: 'gesture-preview', map }),
    finishGesture: () => store.dispatch({ type: 'gesture-finish' }),
    cancelGesture: () => store.dispatch({ type: 'gesture-cancel' }),
    select: (mapId: string, id: string | null) => store.dispatch({ type: 'select', mapId, id }),
    selectMany: (mapId: string, ids: readonly string[]) => store.dispatch({ type: 'select-many', mapId, ids }),
    setViewport: (mapId: string, viewport: Partial<Pick<MapViewport, 'x' | 'y' | 'zoom'>>) => store.dispatch({ type: 'set-viewport', mapId, viewport }),
    session,
  }), [store, session]);
  return useMemo(() => ({ state, ...actions }), [state, actions]);
}
