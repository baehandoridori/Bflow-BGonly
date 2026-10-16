import fs from 'node:fs/promises';
import path from 'node:path';
import { KEPT_EDITS, KEPT_EDITS_REFUSAL, keptEditsFileName, keptEntriesOf, keptEntryProblem } from '../src/shared/backgroundKeptEdits';
import type { KeptMapEdit } from '../src/shared/backgroundKeptEdits';

// The unsaved map edits this PC keeps (v1.140.0): one JSON file per account in the app's folder, read and written here alone,
// one call after another. The page names no account: the channels take it from the session of main. Nothing of it leaves this PC.

export type KeptEditsFiles = Pick<typeof import('node:fs/promises'), 'readFile' | 'open' | 'rename' | 'mkdir'>;
export type KeptEditsStore = {
  list(userId: string): Promise<Record<string, KeptMapEdit>>;
  put(userId: string, mapId: unknown, entry: unknown): Promise<void>;   // entry null: remove
  flush(maxMs?: number): Promise<void>;                                  // default 2000
};
export function createKeptEditsStore(folder: string, files: KeptEditsFiles = fs, now: () => number = Date.now): KeptEditsStore {
  type KeptDocument = { version: number; entries: Record<string, unknown> };
  let tail: Promise<unknown> = Promise.resolve(), broken = 0;
  /** Every read and write of every account, one after another; one that fails does not stop the next. */
  function run<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work, work);
    tail = result.catch(() => undefined);
    return result;
  }
  function fileOf(userId: string): string {
    return path.join(folder, keptEditsFileName(userId));
  }
  /** No file yet: empty. A broken one: moved aside under a name of its own, then empty. One that cannot be read, or of another version: thrown, never read as nothing, so no write takes its place. */
  async function read(file: string): Promise<KeptDocument> {
    let text: string;
    try {
      text = await waitOutLock(() => files.readFile(file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { version: KEPT_EDITS.version, entries: {} };
      throw error;
    }
    let stored: { version?: unknown; entries?: unknown } | null;
    try {
      stored = JSON.parse(text);
    } catch {
      const aside = `${file}.broken-${now()}-${++broken}`;
      await waitOutLock(() => files.rename(file, aside));
      return { version: KEPT_EDITS.version, entries: {} };
    }
    if (!stored || stored.version !== KEPT_EDITS.version || !stored.entries || typeof stored.entries !== 'object' || Array.isArray(stored.entries)) throw new Error(KEPT_EDITS_REFUSAL.version);
    return { version: KEPT_EDITS.version, entries: stored.entries as Record<string, unknown> };
  }
  /** The whole document, put on the disk under a temporary name and only then in place of the file. */
  async function write(file: string, document: KeptDocument): Promise<void> {
    await files.mkdir(folder, { recursive: true });
    const temp = `${file}.tmp`, text = JSON.stringify(document);
    await waitOutLock(async () => { const handle = await files.open(temp, 'w'); try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); } });
    await waitOutLock(() => files.rename(temp, file));
  }
  return {
    list: userId => run(async () => keptEntriesOf((await read(fileOf(userId))).entries)),
    put: (userId, mapId, entry) => run(async () => {
      const problem = entry === null ? (typeof mapId === 'string' ? null : KEPT_EDITS_REFUSAL.shape) : keptEntryProblem(mapId, entry);
      if (problem) throw new Error(problem);
      const key = mapId as string, file = fileOf(userId), document = await read(file);
      const has = Object.prototype.hasOwnProperty.call(document.entries, key);
      if (entry === null) {
        if (!has) return;
        delete document.entries[key];
      } else {
        if (!has && Object.keys(document.entries).length >= KEPT_EDITS.maxEntries) throw new Error(KEPT_EDITS_REFUSAL.count);
        document.entries[key] = entry;
      }
      // The other entries are written back as they were read, those that do not pass the check too.
      await write(file, document);
    }),
    flush: async (maxMs = 2000) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([tail, new Promise(done => { timer = setTimeout(done, maxMs); })]);
      clearTimeout(timer);
    },
  };
}
/** The last step of quitting for this file (3.4): after the windows answered or gave up, what main still writes is waited for. Never throws. */
export async function finishKeptEditsBeforeExit(deps: { rendererFlush: Promise<unknown>; store: Pick<KeptEditsStore, 'flush'>; maxMs?: number }): Promise<void> {
  await deps.rendererFlush.catch(() => undefined);
  await deps.store.flush(deps.maxMs);
}
/** A file antivirus software holds for a moment is waited out: three tries, 80 ms apart. Any other error, or a lock that stays, is thrown. */
async function waitOutLock<T>(work: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try { return await work(); }
    catch (error) { if (tries >= 3 || !['EBUSY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException)?.code ?? '')) throw error; }
    await new Promise(done => setTimeout(done, 80));
  }
}

export type KeptEditsIpcDependencies = { ipc: { handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>): void }; getSessionOriginOrThrow(): { userId: string; epoch: number }; store: KeptEditsStore };
export function registerKeptEditsIpc(deps: KeptEditsIpcDependencies): void {
  function originFor(requestEpoch: unknown) {
    const origin = { ...deps.getSessionOriginOrThrow() };
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== origin.epoch) throw new Error('로그인 세션이 변경되었습니다. 화면을 다시 열어 주세요.');
    return origin;
  }
  deps.ipc.handle('background-kept:list', async (_event, requestEpoch) => {
    const origin = originFor(requestEpoch);
    const entries = await deps.store.list(origin.userId);
    const now = deps.getSessionOriginOrThrow();
    if (now.userId !== origin.userId || now.epoch !== origin.epoch) throw new Error('로그인 세션이 변경되어 보관 목록 응답을 폐기했습니다.');
    return entries;
  });
  // The store is called before any wait: puts and removes of one map keep the order they were sent in.
  deps.ipc.handle('background-kept:put', async (_event, mapId, entry, requestEpoch) => { const origin = originFor(requestEpoch); await deps.store.put(origin.userId, mapId, entry); });
}
