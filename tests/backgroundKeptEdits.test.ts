import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEPT_EDITS, KEPT_EDITS_REFUSAL, keptEditsFileName, keptEntriesOf, keptEntryProblem } from '../src/shared/backgroundKeptEdits.ts';
import type { KeptMapEdit } from '../src/shared/backgroundKeptEdits.ts';

// The unsaved map edits this PC keeps: the checks, the limits and the file name of the shared module; the store of main in
// a temporary folder (never the app's own folder), on the real file functions wrapped so that each call is written down and
// can be made to fail as a file held for a moment by antivirus software does; its two channels with a stand-in session; and
// what main waits for as it quits. Main's module names its own modules without an extension, as its build does: it is
// bundled here first, and nothing of the app is started.

let nonce = 0;
async function load(entry: string) {
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${nonce++}`);
}

const MAP = '00000000-0000-4000-8000-000000000001', MAP2 = '00000000-0000-4000-8000-000000000002', MAP3 = '00000000-0000-4000-8000-000000000003';
const entry = (mapId = MAP, patch = {}): KeptMapEdit => ({ baseRevision: 5, steps: 2, keptAt: 1700000000000, value: { id: mapId, name: '2층' }, ...patch });
/** The error of a file another program holds for a moment: a code, and nothing else to speak of. */
const locked = (code: string) => Object.assign(new Error(code), { code });

type FileStep = 'readFile' | 'open' | 'rename' | 'mkdir' | 'writeFile' | 'sync' | 'close';
/** For a call of that name, by its count from 1: an error to throw in its place, or a promise to wait for before it is made. */
type Fail = Partial<Record<FileStep, (count: number) => unknown>>;
/**
 * The four file functions of `node:fs/promises` the store takes, each call written down in `log` as [name, ...args] before
 * it is made, and the handle `open` gives back wrapped the same way (writeFile, sync, close). `fail` makes a call fail, or wait.
 */
function wrapped(log: unknown[][], fail: Fail = {}) {
  const counts = new Map<FileStep, number>();
  async function call(name: FileStep, args: unknown[]) {
    log.push([name, ...args]);
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    const answer = fail[name]?.(count);
    if (answer instanceof Error) throw answer;
    await answer;
  }
  return {
    readFile: async (file: string, encoding: 'utf8') => { await call('readFile', [file, encoding]); return fs.readFile(file, encoding); },
    open: async (file: string, flags: string) => {
      await call('open', [file, flags]);
      const handle = await fs.open(file, flags);
      return {
        writeFile: async (text: string, encoding: 'utf8') => { await call('writeFile', [text, encoding]); return handle.writeFile(text, encoding); },
        sync: async () => { await call('sync', []); return handle.sync(); },
        close: async () => { await call('close', []); return handle.close(); },
      };
    },
    rename: async (from: string, to: string) => { await call('rename', [from, to]); return fs.rename(from, to); },
    mkdir: async (folder: string, options: { recursive: true }) => { await call('mkdir', [folder, options]); return fs.mkdir(folder, options); },
  };
}
/** The names of the calls written down, in their order. */
const named = (log: unknown[][]) => log.map(([name]) => name);
/** How many calls of that name were written down. */
const callsOf = (log: unknown[][], name: FileStep) => log.filter(([called]) => called === name).length;

test('KE-1: the shared module — what may be written, what is handed out, and one file per account', () => {
  assert.deepEqual(KEPT_EDITS, { version: 1, maxEntryChars: 4_000_000, maxEntries: 100 });
  assert.equal(keptEntryProblem(MAP, entry()), null);
  // A map never saved, and an underlay left out: both may be written.
  assert.equal(keptEntryProblem(MAP, entry(MAP, { baseRevision: null })), null);
  assert.equal(keptEntryProblem(MAP, entry(MAP, { imageOmitted: true })), null);
  // A key of no version of this file, the value of another map, a count below zero, a revision written as text, an
  // omission that says it is none, and a name that is no map id: each is refused for its shape.
  const wrong: [unknown, unknown][] = [
    [MAP, { ...entry(), token: 'x' }],
    [MAP, entry(MAP, { value: { id: MAP2, name: '2층' } })],
    [MAP, entry(MAP, { steps: -1 })],
    [MAP, entry(MAP, { baseRevision: '5' })],
    [MAP, entry(MAP, { imageOmitted: false })],
    ['map-1', entry('map-1')],
  ];
  for (const [mapId, kept] of wrong) assert.equal(keptEntryProblem(mapId, kept), KEPT_EDITS_REFUSAL.shape, JSON.stringify(kept));
  // Too big: more than four million characters as it is written, and not one fewer.
  const sized = (length: number) => entry(MAP, { value: { id: MAP, name: 'a'.repeat(length) } });
  const room = KEPT_EDITS.maxEntryChars - JSON.stringify(sized(0)).length;
  assert.equal(JSON.stringify(sized(room)).length, 4_000_000);
  assert.equal(keptEntryProblem(MAP, sized(room)), null);
  assert.equal(keptEntryProblem(MAP, sized(room + 1)), KEPT_EDITS_REFUSAL.size);
  assert.equal(keptEntryProblem(MAP, entry(MAP, { value: { id: MAP, name: 'a'.repeat(4_000_001) } })), KEPT_EDITS_REFUSAL.size);
  // What is handed out: the entries that pass, as they are; anything but an object of entries is none.
  assert.deepEqual(keptEntriesOf({ [MAP]: entry(), [MAP2]: { ...entry(MAP2), token: 'x' } }), { [MAP]: entry() });
  for (const nothing of [null, [], 'x']) assert.deepEqual(keptEntriesOf(nothing), {});
  // One file per account: an id of lower-case letters, digits, - and _ as it is; any other in the hex of its UTF-8 bytes,
  // so no id reaches out of the folder, and two ids that differ only in case never share a file (Windows does not tell them apart).
  for (const id of ['fcc4b438-2696-4e88-a03f-d6f34e73e08f', '1']) assert.equal(keptEditsFileName(id), `background-map-kept.${id}.json`);
  assert.equal(keptEditsFileName('a.b'), 'background-map-kept.=612e62.json');
  assert.equal(keptEditsFileName('../x'), 'background-map-kept.=2e2e2f78.json');
  assert.equal(keptEditsFileName('A'), 'background-map-kept.=41.json');
  assert.equal(keptEditsFileName('a'), 'background-map-kept.a.json');
  assert.equal(keptEditsFileName('가'), 'background-map-kept.=eab080.json');
});

test('KE-2a: the store writes one line of JSON per account, in the order the writes were sent, and leaves no temporary file', async () => {
  const { createKeptEditsStore } = await load('electron/backgroundKeptEdits.ts');
  const folder = mkdtempSync(join(tmpdir(), 'bflow-kept-'));
  try {
    const store = createKeptEditsStore(folder), fileOf = (userId: string) => join(folder, keptEditsFileName(userId));
    await store.put('1', MAP, entry());
    assert.deepEqual(await store.list('1'), { [MAP]: entry() });
    // Two accounts, two files, and neither sees what the other keeps.
    await store.put('2', MAP2, entry(MAP2));
    assert.deepEqual(readdirSync(folder).sort(), [keptEditsFileName('1'), keptEditsFileName('2')].sort());
    assert.deepEqual(await store.list('1'), { [MAP]: entry() });
    assert.deepEqual(await store.list('2'), { [MAP2]: entry(MAP2) });
    assert.deepEqual(readdirSync(folder).filter(name => name.endsWith('.tmp')), []);
    // One line with no indent: the version, then the entries.
    const text = readFileSync(fileOf('1'), 'utf8');
    assert.ok(!text.includes('\n'), text);
    assert.deepEqual(JSON.parse(text), { version: 1, entries: { [MAP]: entry() } });
    assert.equal(text, JSON.stringify({ version: 1, entries: { [MAP]: entry() } }));
    // A put and a remove of one map sent with no wait between them are done in the order they were sent, either way round.
    await Promise.all([store.put('1', MAP2, entry(MAP2)), store.put('1', MAP2, null)]);
    assert.deepEqual(await store.list('1'), { [MAP]: entry() });
    await Promise.all([store.put('1', MAP3, null), store.put('1', MAP3, entry(MAP3))]);
    assert.deepEqual(await store.list('1'), { [MAP]: entry(), [MAP3]: entry(MAP3) });
    // Removing what is not kept writes nothing: the file is not touched, and an account with no file gets none.
    const log: unknown[][] = [], watched = createKeptEditsStore(folder, wrapped(log));
    const touched = statSync(fileOf('1')).mtimeMs;
    await watched.put('1', MAP2, null);
    assert.equal(statSync(fileOf('1')).mtimeMs, touched);
    assert.equal(callsOf(log, 'open') + callsOf(log, 'rename'), 0);
    await watched.put('3', MAP, null);
    assert.ok(!readdirSync(folder).includes(keptEditsFileName('3')));
    // The last entry removed leaves the file, with no entries.
    await store.put('1', MAP, null);
    await store.put('1', MAP3, null);
    assert.equal(readFileSync(fileOf('1'), 'utf8'), '{"version":1,"entries":{}}');
    // flush waits for a put no one waited for.
    const sent = store.put('2', MAP3, entry(MAP3));
    await store.flush();
    assert.deepEqual(JSON.parse(readFileSync(fileOf('2'), 'utf8')).entries, { [MAP2]: entry(MAP2), [MAP3]: entry(MAP3) });
    await sent;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('KE-2b: what cannot be read is never read as nothing — a broken file is moved aside under a numbered name, another version and a folder are refused, a lock is tried three times', async () => {
  const { createKeptEditsStore } = await load('electron/backgroundKeptEdits.ts');
  const folder = mkdtempSync(join(tmpdir(), 'bflow-kept-'));
  try {
    const name = keptEditsFileName('1');
    /** A folder of its own for each case, inside the temporary one. */
    let cases = 0;
    const own = () => { const inside = join(folder, `case-${++cases}`); mkdirSync(inside); return inside; };
    const asideIn = (inside: string) => readdirSync(inside).filter(file => file.startsWith(`${name}.broken-`)).sort();
    // A broken file: moved aside as it was, read as empty, and the next put writes a new file.
    {
      const inside = own(), store = createKeptEditsStore(inside);
      writeFileSync(join(inside, name), '{"version":1,"entries":{');
      assert.deepEqual(await store.list('1'), {});
      const aside = asideIn(inside);
      assert.equal(aside.length, 1);
      assert.equal(readFileSync(join(inside, aside[0]), 'utf8'), '{"version":1,"entries":{');
      assert.ok(!readdirSync(inside).includes(name));
      await store.put('1', MAP, entry());
      assert.deepEqual(JSON.parse(readFileSync(join(inside, name), 'utf8')), { version: 1, entries: { [MAP]: entry() } });
    }
    // Broken twice in one millisecond (a clock that stands still): the second is moved under a name of its own, and the first stays.
    {
      const inside = own(), store = createKeptEditsStore(inside, fs, () => 1700000000000);
      writeFileSync(join(inside, name), 'first');
      assert.deepEqual(await store.list('1'), {});
      await store.put('1', MAP, entry());
      writeFileSync(join(inside, name), 'second');
      assert.deepEqual(await store.list('1'), {});
      assert.deepEqual(asideIn(inside), [`${name}.broken-1700000000000-1`, `${name}.broken-1700000000000-2`]);
      assert.equal(readFileSync(join(inside, `${name}.broken-1700000000000-1`), 'utf8'), 'first');
      assert.equal(readFileSync(join(inside, `${name}.broken-1700000000000-2`), 'utf8'), 'second');
    }
    // A file of another version, or with no object of entries: refused for the list and the put, and left as it is.
    {
      const inside = own(), store = createKeptEditsStore(inside);
      for (const text of ['{"version":2,"entries":{}}', '{"version":1,"entries":[]}', '{"version":1}', 'null']) {
        writeFileSync(join(inside, name), text);
        await assert.rejects(store.list('1'), /업데이트/);
        await assert.rejects(store.put('1', MAP, entry()), /업데이트/);
        assert.equal(readFileSync(join(inside, name), 'utf8'), text);
      }
    }
    // A folder where the file should be: refused, read once (it is no lock), never read as nothing.
    {
      const inside = own(), log: unknown[][] = [], store = createKeptEditsStore(inside, wrapped(log));
      mkdirSync(join(inside, name));
      await assert.rejects(store.list('1'), { code: 'EISDIR' });
      assert.equal(callsOf(log, 'readFile'), 1);
      await assert.rejects(store.put('1', MAP, entry()), { code: 'EISDIR' });
      assert.deepEqual(named(log), ['readFile', 'readFile']);
    }
    // A file held for a moment: tried again 80 ms on, and read.
    {
      const inside = own();
      await createKeptEditsStore(inside).put('1', MAP, entry());
      const log: unknown[][] = [], store = createKeptEditsStore(inside, wrapped(log, { readFile: count => count === 1 ? locked('EBUSY') : undefined }));
      assert.deepEqual(await store.list('1'), { [MAP]: entry() });
      assert.equal(callsOf(log, 'readFile'), 2);
    }
    // A lock that stays: three tries, then that error, for the list and for the put alike; nothing is written.
    for (const code of ['EACCES', 'EPERM', 'EBUSY']) {
      const inside = own();
      await createKeptEditsStore(inside).put('1', MAP, entry());
      const text = readFileSync(join(inside, name), 'utf8');
      const log: unknown[][] = [], store = createKeptEditsStore(inside, wrapped(log, { readFile: () => locked(code) }));
      await assert.rejects(store.list('1'), { code });
      assert.equal(callsOf(log, 'readFile'), 3, code);
      await assert.rejects(store.put('1', MAP2, entry(MAP2)), { code });
      assert.equal(callsOf(log, 'readFile'), 6, code);
      assert.equal(callsOf(log, 'open') + callsOf(log, 'rename'), 0, code);
      assert.equal(readFileSync(join(inside, name), 'utf8'), text);
    }
    // A rename held once: tried again, and the put is done.
    {
      const inside = own(), log: unknown[][] = [];
      const store = createKeptEditsStore(inside, wrapped(log, { rename: count => count === 1 ? locked('EPERM') : undefined }));
      await store.put('1', MAP, entry());
      assert.equal(callsOf(log, 'rename'), 2);
      assert.deepEqual(JSON.parse(readFileSync(join(inside, name), 'utf8')).entries, { [MAP]: entry() });
    }
    // A broken file that cannot be moved aside: three tries, then that error for the list and the put alike. The broken file
    // stays under its own name as it was, and nothing is written over it.
    {
      const inside = own(), log: unknown[][] = [];
      writeFileSync(join(inside, name), '{"version":1,');
      const store = createKeptEditsStore(inside, wrapped(log, { rename: () => locked('EPERM') }));
      await assert.rejects(store.list('1'), { code: 'EPERM' });
      assert.equal(callsOf(log, 'rename'), 3);
      await assert.rejects(store.put('1', MAP, entry()), { code: 'EPERM' });
      assert.equal(callsOf(log, 'rename'), 6);
      assert.equal(readFileSync(join(inside, name), 'utf8'), '{"version":1,');
      assert.deepEqual(asideIn(inside), []);
      assert.equal(callsOf(log, 'open'), 0);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('KE-2c: a write is synced before its rename, and what may be written is checked first', async () => {
  const { createKeptEditsStore } = await load('electron/backgroundKeptEdits.ts');
  const folder = mkdtempSync(join(tmpdir(), 'bflow-kept-'));
  try {
    const file = join(folder, keptEditsFileName('1'));
    // One put: the file is read, a temporary file is written, put on the disk and closed, and only then put in its place.
    {
      const log: unknown[][] = [], store = createKeptEditsStore(folder, wrapped(log));
      await store.put('1', MAP, entry());
      assert.deepEqual(log.filter(([name]) => name !== 'mkdir'), [
        ['readFile', file, 'utf8'],
        ['open', `${file}.tmp`, 'w'],
        ['writeFile', JSON.stringify({ version: 1, entries: { [MAP]: entry() } }), 'utf8'],
        ['sync'],
        ['close'],
        ['rename', `${file}.tmp`, file],
      ]);
    }
    // A sync that fails: the handle is closed, nothing is put in place of the file, and the put is refused.
    {
      const log: unknown[][] = [], store = createKeptEditsStore(folder, wrapped(log, { sync: () => new Error('the disk did not answer') }));
      await assert.rejects(store.put('1', MAP2, entry(MAP2)), /the disk did not answer/);
      assert.deepEqual(named(log).filter(name => name !== 'mkdir'), ['readFile', 'open', 'writeFile', 'sync', 'close']);
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).entries, { [MAP]: entry() });
    }
    // A hundred maps at most: a new one past them is refused, and one kept already may still change.
    {
      const many = join(folder, 'many'), store = createKeptEditsStore(many);
      const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      for (let n = 1; n <= 100; n++) await store.put('1', id(n), entry(id(n)));
      await assert.rejects(store.put('1', id(101), entry(id(101))), /100개/);
      await store.put('1', id(100), entry(id(100), { steps: 9 }));
      const kept = await store.list('1');
      assert.equal(Object.keys(kept).length, 100);
      assert.equal(kept[id(100)].steps, 9);
      assert.ok(!(id(101) in kept));
    }
    // What may not be written is refused before the file is read: too big, a key of no version, a remove of no map id.
    {
      const log: unknown[][] = [], store = createKeptEditsStore(folder, wrapped(log));
      await assert.rejects(store.put('1', MAP, entry(MAP, { value: { id: MAP, name: 'a'.repeat(4_000_001) } })), /너무 커요/);
      await assert.rejects(store.put('1', MAP, { ...entry(), token: 'x' }), /모양/);
      await assert.rejects(store.put('1', 5, null), /모양/);
      assert.deepEqual(log, []);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('KE-3: the two channels — the epoch of the page, the account of the main session, and a list whose session changed is dropped', async () => {
  const { createKeptEditsStore, registerKeptEditsIpc } = await load('electron/backgroundKeptEdits.ts');
  type Handler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;
  /** Main with a session the test sets as it goes (`session.origin`): the names the channels registered, and their handlers. */
  function channels(store: unknown, session: { origin: { userId: string; epoch: number } }) {
    const handlers = new Map<string, Handler>();
    registerKeptEditsIpc({ ipc: { handle: (name: string, handler: Handler) => { handlers.set(name, handler); } }, getSessionOriginOrThrow: () => session.origin, store });
    return { names: [...handlers.keys()], list: handlers.get('background-kept:list')!, put: handlers.get('background-kept:put')! };
  }
  /** A store that keeps nothing and writes down what it was asked. */
  const asked: unknown[][] = [];
  const counting = { list: async (...args: unknown[]) => { asked.push(['list', ...args]); return {}; }, put: async (...args: unknown[]) => { asked.push(['put', ...args]); }, flush: async () => {} };
  const page = channels(counting, { origin: { userId: '1', epoch: 3 } });
  assert.deepEqual(page.names, ['background-kept:list', 'background-kept:put']);
  // A page of another session, or one that sends none: refused, and the store is never asked.
  for (const epoch of [2, 4, '3', undefined]) {
    await assert.rejects(page.list(undefined, epoch), /세션/);
    await assert.rejects(page.put(undefined, MAP, entry(), epoch), /세션/);
  }
  assert.deepEqual(asked, []);
  // The account is the session's: the page names none, and another login reads its own file.
  const folder = mkdtempSync(join(tmpdir(), 'bflow-kept-'));
  try {
    const session = { origin: { userId: '1', epoch: 1 } }, real = channels(createKeptEditsStore(folder), session);
    await real.put(undefined, MAP, entry(), 1);
    assert.deepEqual(await real.list(undefined, 1), { [MAP]: entry() });
    session.origin = { userId: '2', epoch: 2 };
    assert.deepEqual(await real.list(undefined, 2), {});
    assert.deepEqual(readdirSync(folder), [keptEditsFileName('1')]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  // The session changes while the list is read (the same account logs in again, or another one does): that answer is dropped.
  for (const next of [{ userId: '1', epoch: 4 }, { userId: '2', epoch: 4 }]) {
    let answer: (entries: unknown) => void = () => {};
    const session = { origin: { userId: '1', epoch: 3 } };
    const slow = channels({ ...counting, list: () => new Promise(done => { answer = done; }) }, session);
    const listing = slow.list(undefined, 3);
    session.origin = next;
    answer({ [MAP]: entry() });
    await assert.rejects(listing, /보관 목록 응답/);
  }
  // Two puts sent one after the other reach the store in that order, before either is waited for.
  const order: unknown[][] = [];
  const putting = channels({ ...counting, put: async (...args: unknown[]) => { order.push(args); } }, { origin: { userId: '1', epoch: 3 } });
  const first = putting.put(undefined, MAP, entry(), 3), second = putting.put(undefined, MAP, null, 3);
  assert.deepEqual(order, [['1', MAP, entry()], ['1', MAP, null]]);
  await Promise.all([first, second]);
});

test('KE-5: before quitting — what main still writes is waited for after the windows answered, two seconds at most', async () => {
  const { createKeptEditsStore, finishKeptEditsBeforeExit, registerKeptEditsIpc } = await load('electron/backgroundKeptEdits.ts');
  const folder = mkdtempSync(join(tmpdir(), 'bflow-kept-'));
  try {
    const file = join(folder, keptEditsFileName('1'));
    type Handler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;
    /** Main as the app quits, on the file functions given: the channel a window puts through, and the store the last step waits for. */
    function quitting(files: unknown) {
      const store = createKeptEditsStore(folder, files), handlers = new Map<string, Handler>();
      registerKeptEditsIpc({ ipc: { handle: (name: string, handler: Handler) => { handlers.set(name, handler); } }, getSessionOriginOrThrow: () => ({ userId: '1', epoch: 1 }), store });
      return { store, put: (mapId: string, kept: KeptMapEdit | null) => handlers.get('background-kept:put')!(undefined, mapId, kept, 1) };
    }
    /** What is on the disk as main exits: the entries of the file, and any temporary file left beside it. */
    const exit = () => ({ entries: JSON.parse(readFileSync(file, 'utf8')).entries, temporary: readdirSync(folder).filter(name => name.endsWith('.tmp')) });
    /** Each rename takes 50 ms, as a slow disk might. */
    const slowRename = () => wrapped([], { rename: () => new Promise(done => setTimeout(done, 50)) });
    // The windows have given up (or answered) while main still writes what one of them sent: it is on the disk as main exits.
    {
      const { store, put } = quitting(slowRename());
      const sent = put(MAP, entry());
      await finishKeptEditsBeforeExit({ rendererFlush: Promise.resolve('timeout'), store });
      assert.deepEqual(exit(), { entries: { [MAP]: entry() }, temporary: [] });
      await sent;
    }
    // A window answers 20 ms on, and what it sent as it finished reaches main before its answer: that too is on the disk.
    {
      const { store, put } = quitting(slowRename());
      let sent: Promise<unknown> = Promise.resolve();
      const finished = finishKeptEditsBeforeExit({ rendererFlush: new Promise(done => setTimeout(() => done('flushed'), 20)), store });
      setTimeout(() => { sent = put(MAP2, entry(MAP2)); }, 5);
      await finished;
      assert.deepEqual(exit(), { entries: { [MAP]: entry(), [MAP2]: entry(MAP2) }, temporary: [] });
      await sent;
    }
    // The windows' answer is a refusal: the last step does not throw.
    {
      const { store } = quitting(fs);
      await assert.doesNotReject(finishKeptEditsBeforeExit({ rendererFlush: Promise.reject(new Error('the window is gone')), store }));
    }
    // A rename that never ends: main still exits once maxMs is over (two seconds in the app, 100 ms here).
    {
      const { store, put } = quitting(wrapped([], { rename: () => new Promise(() => {}) }));
      void put(MAP3, entry(MAP3));
      const started = Date.now();
      let guard: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        finishKeptEditsBeforeExit({ rendererFlush: Promise.resolve('timeout'), store, maxMs: 100 }).then(() => 'returned'),
        new Promise(done => { guard = setTimeout(() => done('still waiting'), 1000); }),
      ]);
      clearTimeout(guard);
      const took = Date.now() - started;
      assert.equal(outcome, 'returned');
      assert.ok(took >= 95 && took < 1000, `returned after ${took} ms`);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('KE-4: the mirror of the preview — the login, one key per account, the limit, a full storage and another version', async () => {
  const bundle = await build({ entryPoints: ['src/mocks/devElectronAPI.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false });
  type Api = {
    backgroundKeptList(): Promise<unknown>;
    backgroundKeptPut(mapId: unknown, entry: unknown): Promise<void>;
    loginCanonicalSession(input: { name: string; password: string; rememberMe: boolean }): Promise<unknown>;
  };
  /** One page of the preview in a browser tab: its localStorage is the map `values`, and its `setItem` is whatever the test makes it. */
  function preview() {
    const values = new Map<string, string>(), storage = { setItem: (key: string, value: string) => { values.set(key, value); } };
    const window = { electronAPI: undefined as Api | undefined, location: { protocol: 'http:' }, localStorage: {
      getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => storage.setItem(key, value), removeItem: (key: string) => { values.delete(key); },
    } };
    const document = { documentElement: { dataset: {} }, createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillStyle: '', font: '', fillRect() {}, fillText() {}, drawImage() {} }),
      toDataURL: () => 'data:image/webp;base64,UklGRg==' }) };
    const module = { exports: {} as { installDevElectronAPI(): void } };
    new Function('module', 'exports', 'window', 'document', 'navigator', 'Image', 'BroadcastChannel', 'fetch', bundle.outputFiles[0].text)(
      module, module.exports, window, document, {}, undefined, undefined, () => { throw new Error('No external requests in preview'); },
    );
    module.exports.installDevElectronAPI();
    return { values, storage, api: window.electronAPI! };
  }
  const { values, storage, api } = preview();
  const KEY = 'bflow:preview:background-map-kept:';
  const stored = (key: string) => JSON.parse(values.get(key) ?? 'null');
  const keptKeys = () => [...values.keys()].filter(key => key.startsWith(KEY)).sort();
  let writes = 0;
  storage.setItem = (key, value) => { if (key.startsWith(KEY)) writes++; values.set(key, value); };
  // No login: nothing is read or written.
  await assert.rejects(api.backgroundKeptList(), /로그인/);
  await assert.rejects(api.backgroundKeptPut(MAP, entry()), /로그인/);
  assert.deepEqual(keptKeys(), []);
  // One value per account, in the shape of main's file.
  await api.loginCanonicalSession({ name: '배한솔', password: '1234', rememberMe: false });
  await api.backgroundKeptPut(MAP, entry());
  assert.deepEqual(JSON.parse(values.get('bflow:preview:background-map-kept:1')!), { version: 1, entries: { [MAP]: entry() } });
  assert.deepEqual(await api.backgroundKeptList(), { [MAP]: entry() });
  // Removed, the entries are empty; removing what is not kept writes nothing.
  await api.backgroundKeptPut(MAP, null);
  assert.deepEqual(stored(`${KEY}1`), { version: 1, entries: {} });
  const written = writes;
  await api.backgroundKeptPut(MAP2, null);
  assert.equal(writes, written);
  // Another account writes a value of its own, and the first is left as it was.
  await api.backgroundKeptPut(MAP, entry());
  const first = values.get(`${KEY}1`);
  await api.loginCanonicalSession({ name: '장삐쭈', password: '1234', rememberMe: false });
  await api.backgroundKeptPut(MAP2, entry(MAP2));
  const keys = keptKeys();
  assert.equal(keys.length, 2);
  assert.ok(keys.includes(`${KEY}1`));
  assert.deepEqual(stored(keys.find(key => key !== `${KEY}1`)!), { version: 1, entries: { [MAP2]: entry(MAP2) } });
  assert.equal(values.get(`${KEY}1`), first);
  assert.deepEqual(await api.backgroundKeptList(), { [MAP2]: entry(MAP2) });
  // A hundred maps at most, as in main: a new one past them is refused, and one kept already may still change.
  await api.loginCanonicalSession({ name: '배한솔', password: '1234', rememberMe: false });
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  for (let n = 2; n <= 100; n++) await api.backgroundKeptPut(id(n), entry(id(n)));
  assert.equal(Object.keys(stored(`${KEY}1`).entries).length, 100);
  await assert.rejects(api.backgroundKeptPut(id(101), entry(id(101))), /100개/);
  await api.backgroundKeptPut(id(100), entry(id(100), { steps: 9 }));
  assert.equal(stored(`${KEY}1`).entries[id(100)].steps, 9);
  // A full storage (for these values alone): the put is refused, not dropped in silence, and the value stays as it was.
  const full = values.get(`${KEY}1`);
  storage.setItem = (key, value) => { if (key.startsWith(KEY)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); values.set(key, value); };
  await assert.rejects(api.backgroundKeptPut(id(50), entry(id(50), { steps: 4 })), { name: 'QuotaExceededError' });
  assert.equal(values.get(`${KEY}1`), full);
  storage.setItem = (key, value) => { values.set(key, value); };
  // What is handed out passes the check, as in main.
  values.set(`${KEY}1`, JSON.stringify({ version: 1, entries: { [MAP]: entry(), [MAP2]: { ...entry(MAP2), token: 'x' } } }));
  assert.deepEqual(await api.backgroundKeptList(), { [MAP]: entry() });
  // A value of another version: refused for the list and the put alike, and left as it is.
  values.set(`${KEY}1`, '{"version":2,"entries":{}}');
  await assert.rejects(api.backgroundKeptList(), /업데이트/);
  await assert.rejects(api.backgroundKeptPut(MAP, entry()), /업데이트/);
  assert.equal(values.get(`${KEY}1`), '{"version":2,"entries":{}}');
});
