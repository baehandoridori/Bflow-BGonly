import { useMemo, useState, useSyncExternalStore } from 'react';
import type { BackgroundMap } from './types.ts';
import { createMapDocumentStore } from './mapDocument.ts';
import type { MapDocumentAction, MapDocumentState, MapUpdateOptions, MapViewport } from './mapDocument.ts';

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
  /** After a successful save: the saved maps read from the snapshot again. */
  dropDrafts(mapIds: readonly string[]): void;
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
};

/** Thin React binding of the map document reducer. Every map surface of one editor shares it. */
export function useBackgroundMapDocument(): BackgroundMapDocument {
  const [store] = useState(() => createMapDocumentStore());
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const actions = useMemo(() => ({
    getState: store.getState,
    dispatch: store.dispatch,
    isGestureActive: () => store.getState().gesture !== null,
    beginEditing: (map: BackgroundMap) => store.dispatch({ type: 'begin-editing', map }),
    enterNewMap: (map: BackgroundMap) => store.dispatch({ type: 'enter-new-map', map }),
    discard: (mapId: string) => store.dispatch({ type: 'discard', mapId }),
    dropDrafts: (mapIds: readonly string[]) => store.dispatch({ type: 'drop-drafts', mapIds }),
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
  }), [store]);
  return useMemo(() => ({ state, ...actions }), [state, actions]);
}
