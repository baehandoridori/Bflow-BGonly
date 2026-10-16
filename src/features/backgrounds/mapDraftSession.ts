import type { BackgroundSnapshot } from './types.ts';
import type { KeptMapEdit } from '../../shared/backgroundKeptEdits.ts';
import { createMapDocumentStore, gestureStartMap, mapDraftChanged } from './mapDocument.ts';
import type { MapDocumentState, MapDocumentStore } from './mapDocument.ts';
import { MAP_KEEP_DELAY_MS, keptEntryOf, mapDraftSavedAlready, planKeptRestore } from './mapDraftKeep.ts';
import type { KeptSignal } from './mapKeptSignal.ts';

// The drafts of the account signed in (with their views and selection), and their copy on this PC (v1.140.0). They outlive
// the screen: every settled edit of a map is handed over to be written within 0.3 seconds, and once in each 0.3 seconds while
// the edits go on. Only what this session wrote or restored is ever removed, and nothing is written before the list of this
// login was read. A pure factory: the writes, the signal and the timers are handed in, and nothing here reaches the page or the library.

export type MapDraftSessionDeps = {
  userId: string;                                                  // '': a document that keeps nothing
  put(mapId: string, entry: KeptMapEdit | null): Promise<void>;
  signal: { read(): KeptSignal; write(patch: Partial<KeptSignal>): void };
  timers: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
  now(): number;
};
export type MapDraftSession = {
  readonly userId: string;
  readonly store: MapDocumentStore;       // created here, once: createMapDocumentStore()
  shownMapId: string | null;              // the map picked on the screen in this run; null: none picked (the first map is on show)
  /** Each read of the library, with nothing running (6.5): own saves whose answer was lost are put back on it, and once per login what this PC kept comes back. */
  catchUp(snapshot: BackgroundSnapshot): { count: number; mapId: string | null } | null;
  /** Every draft goes, at once (4.7: the editor could not draw them). Their copies on this PC go as any discarded draft's do (5). */
  discardAll(): void;
  flush(): Promise<void>;                 // never rejects
  dispose(): void;
};
export function createMapDraftSession(deps: MapDraftSessionDeps): MapDraftSession {
  const store = createMapDocumentStore();
  const keeps = deps.userId !== '';
  /** The one timer set for each map whose settled edit waits to be written. */
  const timers: Map<string, unknown> = new Map();
  /** The maps whose entry this session began to write, or restored: the only entries it ever removes (P5). */
  const owned: Set<string> = new Set();
  /** The maps whose removal was refused: sent again with whatever goes next, and by the flush (P8). */
  const unremoved: Set<string> = new Set();
  /** The writes and removals sent whose answer has not come yet (P9). */
  const sent: Set<Promise<void>> = new Set();
  let seen = store.getState().drafts, disposed = false, restored = false;
  /** The list of this login was read: before that nothing is written or removed (P4). */
  const ready = () => { const signal = deps.signal.read(); return signal.userId === deps.userId && signal.status === 'ready'; };
  /** One id put in or taken out of a list of the signal, written only when that changes the list. */
  function mark(key: 'kept' | 'failed', mapId: string, on: boolean) {
    const list = deps.signal.read()[key];
    if (list.includes(mapId) === on) return;
    const next = on ? [...list, mapId] : list.filter(id => id !== mapId);
    deps.signal.write(key === 'kept' ? { kept: next } : { failed: next });
  }
  const fail = (mapId: string) => mark('failed', mapId, true), unfail = (mapId: string) => mark('failed', mapId, false);

  function observe(state: MapDocumentState) {
    if (disposed || !keeps || state.gesture !== null) return;
    const drafts = state.drafts;
    // The dot comes on and goes off with the edit itself (P3).
    const changed = Object.keys(drafts).filter(mapId => mapDraftChanged(drafts[mapId])), shown = deps.signal.read().changed;
    if (changed.length !== shown.length || changed.some(mapId => !shown.includes(mapId))) deps.signal.write({ changed });
    for (const [mapId, draft] of Object.entries(drafts)) {
      if (draft === seen[mapId]) continue;
      if (mapDraftChanged(draft)) arm(mapId); else drop(mapId);
    }
    for (const mapId of Object.keys(seen)) if (!(mapId in drafts)) drop(mapId);
    seen = drafts;
  }
  // Set only when none is set: edits that go on are still written once in each 0.3 seconds (P2).
  function arm(mapId: string) { if (!timers.has(mapId)) timers.set(mapId, deps.timers.set(() => fire(mapId), MAP_KEEP_DELAY_MS)); }
  function unarm(mapId: string) {
    if (!timers.has(mapId)) return;
    deps.timers.clear(timers.get(mapId));
    timers.delete(mapId);
  }
  function fire(mapId: string) {
    timers.delete(mapId);
    if (disposed) return;
    // Before the list is read an entry not read yet would be written over: wait, and say so when it cannot be read (P4).
    if (!ready()) { if (deps.signal.read().status === 'unavailable') fail(mapId); arm(mapId); return; }
    write(mapId);
  }
  /** The draft of that map as it settled: during a drag, the map as the drag found it. A clean draft, or none, has nothing to write. */
  function write(mapId: string) {
    const state = store.getState(), draft = state.drafts[mapId];
    if (!mapDraftChanged(draft)) return;
    send(mapId, keptEntryOf(draft, gestureStartMap(state, mapId) ?? draft.value, deps.now()));
  }
  // A draft gone clean or gone: its timer and its mark first, then its entry, if this session wrote or restored it (P6).
  function drop(mapId: string) { unarm(mapId); unfail(mapId); if (!owned.delete(mapId)) return; send(mapId, null); }
  function send(mapId: string, entry: KeptMapEdit | null) {
    if (disposed) return;
    // A removal refused before goes out again with this, while its map has no unsaved edits (P8).
    for (const other of [...unremoved]) if (other !== mapId && !mapDraftChanged(store.getState().drafts[other])) { unremoved.delete(other); post(other, null); }
    // This session's from the moment it is sent, not from the answer (P5). The file holds it as far as this PC knows (P7).
    if (entry) { owned.add(mapId); mark('kept', mapId, true); }
    else mark('kept', mapId, false);
    post(mapId, entry);
  }
  function post(mapId: string, entry: KeptMapEdit | null) {
    // One that throws as it is called is refused like any other.
    const answer: Promise<void> = new Promise<void>(done => done(deps.put(mapId, entry))).then(() => {
      sent.delete(answer);
      if (disposed) return;
      if (entry) unfail(mapId); else unremoved.delete(mapId);
    }, error => {
      sent.delete(answer);
      if (disposed) return;
      if (!entry) { unremoved.add(mapId); return; }
      console.warn('[background] kept map edit not written:', mapId, error);
      // Saved or discarded while it was out: nothing of it is left to keep (P8).
      if (mapDraftChanged(store.getState().drafts[mapId])) fail(mapId);
    });
    sent.add(answer);
  }
  const unsubscribe = store.subscribe(() => observe(store.getState()));

  return {
    userId: deps.userId,
    store,
    shownMapId: null,
    catchUp(snapshot) {
      // Each time: a save of this PC whose answer was lost (the screen was left while it ran) is put back on what the library holds.
      const saved = Object.values(store.getState().drafts).filter(draft => mapDraftSavedAlready(draft, snapshot))
        .flatMap(draft => snapshot.maps.filter(map => map.id === draft.value.id));
      if (saved.length) store.dispatch({ type: 'rebase-drafts', maps: saved });
      // Once per login, and only from a list of this login that was read: what this PC kept comes back.
      if (restored || !keeps || !ready()) return null;
      restored = true;
      const plan = planKeptRestore(deps.signal.read().listed, snapshot, store.getState().drafts);
      for (const item of plan.skipped) console.warn('[background] kept map edit not restored:', item.mapId, item.reason);
      if (plan.restore.length) {
        store.dispatch({ type: 'restore-drafts', drafts: plan.restore });
        // In the file already: a restore writes nothing.
        for (const item of plan.restore) { owned.add(item.value.id); unarm(item.value.id); }
      }
      for (const mapId of plan.equal) { owned.add(mapId); drop(mapId); }
      return { count: plan.restore.length, mapId: plan.newest };
    },
    discardAll() { store.dispatch({ type: 'drop-drafts', mapIds: Object.keys(store.getState().drafts) }); },
    async flush() {
      if (disposed || !ready()) return;
      // Each edit that waits, and each whose last write was refused, is written now (P9).
      for (const mapId of new Set([...timers.keys(), ...deps.signal.read().failed])) { unarm(mapId); write(mapId); }
      for (const mapId of [...unremoved]) if (!mapDraftChanged(store.getState().drafts[mapId])) { unremoved.delete(mapId); post(mapId, null); }
      // What this session sent and has no answer for, sent here or before.
      await Promise.allSettled([...sent]);
    },
    dispose() {
      disposed = true;
      for (const timer of timers.values()) deps.timers.clear(timer);
      timers.clear();
      unsubscribe();
    },
  };
}
