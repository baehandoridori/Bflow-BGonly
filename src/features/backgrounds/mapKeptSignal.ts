import { create } from 'zustand';
import type { KeptMapEdit } from '../../shared/backgroundKeptEdits.ts';

// The unsaved map edits this PC keeps, as the parts of the app that are always loaded know them (the dot of the sidebar,
// the logout of the user menu) and as the background screen reads them: whether the list of this login was read, what it
// held, and which maps are kept, changed or not kept now. The session of the account writes the marks; this module reads
// the list and nothing else. `window` and the timers are read only as they are called.

export type KeptSignal = {
  userId: string | null;
  /**
   * 'loading' while the list of this login is read. 'unavailable': the read failed, or gave no answer within KEPT_LIST_TIMEOUT_MS.
   * Until it is 'ready' nothing is restored, written or removed: an entry this login has not read is never written over.
   */
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  /** The entries as listed at login: what a restore reads. */
  listed: Readonly<Record<string, KeptMapEdit>>;
  /** Ids of the maps the file holds now, as far as this PC knows: listed, plus each put sent, minus each remove sent. */
  kept: readonly string[];
  /** Ids of the maps whose draft has unsaved edits in this run. */
  changed: readonly string[];
  /** Ids of the maps whose last put was refused, or held back while the list could not be read. */
  failed: readonly string[];
};
const IDLE: KeptSignal = { userId: null, status: 'idle', listed: {}, kept: [], changed: [], failed: [] };
export const useKeptMapEdits = create<KeptSignal>(() => IDLE);   // IDLE: null · 'idle' · {} · [] · [] · []
export const KEPT_DOT_TEXT = '저장 안 한 도면 편집이 있어요';
export const KEPT_LIST_TIMEOUT_MS = 5000;
export function keptMapEditCount(signal: KeptSignal): number { return new Set([...signal.kept, ...signal.changed]).size; }
/** The maps the update notice says are kept: those the file holds as far as this PC knows, less those whose last write was refused. */
export function keptMapEditsStored(signal: KeptSignal): number { return signal.kept.filter(id => !signal.failed.includes(id)).length; }

/** Each read of the list and each release counts one up: the answer or the timer of a read that is no longer the last changes nothing. */
let calls = 0;
/** What the session of the account hung here to write what it still holds (setKeptMapFlush). */
let hung: (() => Promise<void>) | null = null;

export function primeKeptMapEdits(userId: string): void {
  const signal = useKeptMapEdits.getState();
  if (!userId || (signal.userId === userId && (signal.status === 'loading' || signal.status === 'ready'))) return;
  const call = ++calls;
  // Read again for the same account, the marks the session holds stay: only the list is read anew.
  useKeptMapEdits.setState(signal.userId === userId ? { status: 'loading' } : { ...IDLE, userId, status: 'loading' });
  const bridge = typeof window === 'undefined' ? undefined : window.electronAPI;
  if (!bridge?.backgroundKeptList) { useKeptMapEdits.setState({ status: 'unavailable' }); return; }
  /** An answer, or the timer, is taken only while this read is the last and the signal is still this account's. */
  const current = () => call === calls && useKeptMapEdits.getState().userId === userId;
  // Called at once; one that throws as it is called is a read that failed.
  new Promise<Record<string, KeptMapEdit>>(done => done(bridge.backgroundKeptList())).then(entries => {
    if (!current()) return;
    clearTimeout(timer);
    // Late or not: nothing was written while the list was not read.
    useKeptMapEdits.setState({ status: 'ready', listed: entries, kept: Object.keys(entries) });
  }, error => {
    if (!current()) return;
    clearTimeout(timer);
    console.warn('[background] kept map edits not read:', error);
    useKeptMapEdits.setState({ status: 'unavailable' });
  });
  // No answer in time: unavailable, so that 편집 시작 does not wait for ever. An answer that comes later is still taken.
  const timer = setTimeout(() => { if (current() && useKeptMapEdits.getState().status === 'loading') useKeptMapEdits.setState({ status: 'unavailable' }); }, KEPT_LIST_TIMEOUT_MS);
}
export function releaseKeptMapEdits(userId: string): void {
  ++calls;
  if (useKeptMapEdits.getState().userId === userId) useKeptMapEdits.setState(IDLE);
}
export function setKeptMapFlush(flush: (() => Promise<void>) | null): void {
  hung = flush;
}
export async function flushKeptMapEditsBeforeLogout(maxWaitMs = 3000): Promise<void> {
  const flush = hung;
  if (!flush) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // One that refuses, or throws as it is called, is done: the logout goes on.
  const flushed = new Promise<void>(done => done(flush())).catch(() => undefined);
  await Promise.race([flushed, new Promise<void>(done => { timer = setTimeout(() => done(), maxWaitMs); })]);
  clearTimeout(timer);
}
