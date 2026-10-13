import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundMap, BackgroundSnapshot } from '../src/features/backgrounds/types.ts';
import { applyBackgroundCommand, emptyBackgroundSnapshot } from '../src/features/backgrounds/domain.ts';
import { createBackgroundStore } from '../src/features/backgrounds/useBackgroundStore.ts';
import { createMapDocument, createMapDocumentStore, mapDraft, mapDraftChanged, reduceMapDocument } from '../src/features/backgrounds/mapDocument.ts';
import type { MapDocumentStore, MapDraft } from '../src/features/backgrounds/mapDocument.ts';
import { MAP_EDIT_LABEL, MAP_SAVED_NOTICE_MS, mapEditStatus } from '../src/features/backgrounds/mapEditStatus.ts';
import type { MapEditStatus } from '../src/features/backgrounds/mapEditStatus.ts';
import { saveMapChanges, savedMaps } from '../src/features/backgrounds/mapWorkflow.ts';

const A = '00000000-0000-4000-8000-00000000000a';
const mapA: BackgroundMap = { id: A, revision: 3, name: '교실', parentId: null, placeId: null, imageUrl: '', nodes: [] };
/** The draft of the map as the reducer leaves it: opened, edited `edits` times, then undone `undos` times. */
function draftAfter(edits: number, undos = 0): MapDraft {
  let state = reduceMapDocument(createMapDocument(), { type: 'begin-editing', map: mapA });
  for (let step = 1; step <= edits; step++) state = reduceMapDocument(state, { type: 'update', map: { ...mapDraft(state, A)!.value, name: String(step) } });
  for (let step = 0; step < undos; step++) state = reduceMapDocument(state, { type: 'undo', mapId: A });
  return mapDraft(state, A)!;
}

test('the band shows one of four phases: the ten rows of the table, each compared whole', () => {
  const opened = draftAfter(0), once = draftAfter(1), twelve = draftAfter(12), pushedOut = draftAfter(60, 50);
  // Sixty edits and fifty undos: undo holds nothing more, and the ten edits the history let go of are still in the value.
  assert.deepEqual([pushedOut.past.length, pushedOut.future.length, pushedOut.dropped, pushedOut.value.name], [0, 50, 10, '10']);
  // A map that only exists locally. The reducer opens no such draft today, so this one is made by hand.
  const neverSaved: MapDraft = { value: mapA, baseRevision: null, past: [], future: [], dropped: 0 };
  const changedOnce: MapEditStatus = { phase: 'changed', changed: true, steps: 1, detail: '저장 안 한 변경 1개', canSave: true, saveLabel: '도면 저장', announce: '' };
  const savingOnce: MapEditStatus = { phase: 'saving', changed: true, steps: 1, detail: '저장 중…', canSave: false, saveLabel: '저장 중…', announce: '도면을 저장하는 중이에요' };
  const rows: { row: number; draft: MapDraft; saving: boolean; justSaved: boolean; expected: MapEditStatus }[] = [
    { row: 1, draft: opened, saving: false, justSaved: false, expected: { phase: 'clean', changed: false, steps: 0, detail: '저장된 그대로예요', canSave: false, saveLabel: '도면 저장', announce: '' } },
    { row: 2, draft: once, saving: false, justSaved: false, expected: changedOnce },
    // Unsaved edits win over the saved notice.
    { row: 3, draft: once, saving: false, justSaved: true, expected: changedOnce },
    { row: 4, draft: once, saving: true, justSaved: false, expected: savingOnce },
    // Saving wins over everything.
    { row: 5, draft: opened, saving: true, justSaved: true, expected: { phase: 'saving', changed: false, steps: 0, detail: '저장 중…', canSave: false, saveLabel: '저장 중…', announce: '도면을 저장하는 중이에요' } },
    { row: 6, draft: opened, saving: false, justSaved: true, expected: { phase: 'saved', changed: false, steps: 0, detail: '도면을 저장했어요', canSave: false, saveLabel: '도면 저장', announce: '도면을 저장했어요' } },
    { row: 7, draft: neverSaved, saving: false, justSaved: false, expected: { phase: 'changed', changed: true, steps: 0, detail: '아직 저장한 적 없는 도면이에요', canSave: true, saveLabel: '도면 저장', announce: '' } },
    { row: 8, draft: twelve, saving: false, justSaved: false, expected: { phase: 'changed', changed: true, steps: 12, detail: '저장 안 한 변경 12개', canSave: true, saveLabel: '도면 저장', announce: '' } },
    { row: 9, draft: pushedOut, saving: false, justSaved: false, expected: { phase: 'changed', changed: true, steps: 10, detail: '저장 안 한 변경 10개', canSave: true, saveLabel: '도면 저장', announce: '' } },
    // Saved, edited inside the four seconds of the notice, saved again: all three are true at once, and saving still wins.
    { row: 10, draft: once, saving: true, justSaved: true, expected: savingOnce },
  ];
  assert.equal(rows.length, 10);
  for (const { row, draft, saving, justSaved, expected } of rows) assert.deepEqual(mapEditStatus(draft, saving, justSaved), expected, `#${row}`);
});

test('the wording: the label, how long the notice stays, and a clean band that never begins like an unsaved one', () => {
  assert.equal(MAP_EDIT_LABEL, '편집 중'); assert.equal(MAP_SAVED_NOTICE_MS, 4000);
  // Clean and unsaved are told apart at the first word.
  const clean = mapEditStatus(draftAfter(0), false, false), unsaved = mapEditStatus(draftAfter(1), false, false);
  assert.equal(clean.phase, 'clean'); assert.equal(clean.detail.startsWith('저장 안 한'), false);
  assert.equal(unsaved.phase, 'changed'); assert.equal(unsaved.detail.startsWith('저장 안 한'), true);
  // The number has no ceiling: sixty edits read as sixty, past the fifty that undo keeps.
  const sixty = mapEditStatus(draftAfter(60), false, false);
  assert.deepEqual([sixty.steps, sixty.detail], [60, '저장 안 한 변경 60개']);
  // The never-saved sentence hangs on the draft having no saved revision, not on a count of zero. Made by hand, as in row 7.
  const neverSavedEdited = mapEditStatus({ ...draftAfter(2), baseRevision: null }, false, false);
  assert.deepEqual([neverSavedEdited.steps, neverSavedEdited.detail], [2, '아직 저장한 적 없는 도면이에요']);
});

// F-1 to F-5: saving and going on editing, on the real store of the library and one document, without a screen.
// What these do by hand is what the editor does in `persistMaps`: it saves a command, then puts the drafts back from it.

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}
/** The real store on a library that holds the map on revision 3. The gateway applies every save it is sent, and counts them. */
async function openLibrary() {
  const store = createBackgroundStore();
  const server: { snapshot: BackgroundSnapshot; writes: number } = { snapshot: { ...emptyBackgroundSnapshot(true), maps: [mapA] }, writes: 0 };
  await store.getState().initialize('admin', {
    read: async () => server.snapshot,
    execute: async ({ command }) => { server.writes++; server.snapshot = applyBackgroundCommand(server.snapshot, command, { canManage: true }); return server.snapshot; },
  });
  return { store, server, saved: () => store.getState().snapshot.maps[0] };
}
/** A document with that map open for editing. */
function openDocument(map: BackgroundMap): MapDocumentStore {
  const doc = createMapDocumentStore();
  doc.dispatch({ type: 'begin-editing', map });
  return doc;
}
const draftOf = (doc: MapDocumentStore) => mapDraft(doc.getState(), A)!;
/** One finished edit: the map under another name. */
const rename = (doc: MapDocumentStore, name: string) => doc.dispatch({ type: 'update', map: { ...draftOf(doc).value, name } });
/** The save of the map as the editor builds it: the draft as it is now, on the revision that draft was opened on. */
const saveCommand = (snapshot: BackgroundSnapshot, doc: MapDocumentStore) => saveMapChanges(snapshot, doc.getState().drafts, [draftOf(doc).value]);

test('F-1: a save, more edits and a second save go through when the draft is put back from the command', async () => {
  const { store, server, saved } = await openLibrary(), doc = openDocument(saved());
  doc.dispatch({ type: 'set-viewport', mapId: A, viewport: { x: 40, y: 20, zoom: 2 } });
  doc.dispatch({ type: 'select', mapId: A, id: 'desk' });
  rename(doc, '교실 1');
  // What the handler of a save holds across its wait: the snapshot of the render that started the save.
  const held = store.getState().snapshot, command = saveCommand(held, doc);
  await store.getState().execute(command);
  assert.deepEqual([held.maps[0].revision, saved().revision], [3, 4]);
  // The draft is put back from the command, in one dispatch. The selection and the view are not touched.
  const viewports = doc.getState().viewports;
  doc.dispatch({ type: 'rebase-drafts', maps: savedMaps(command) });
  assert.deepEqual(draftOf(doc).value, saved());
  assert.deepEqual([draftOf(doc).baseRevision, mapDraftChanged(draftOf(doc))], [4, false]);
  assert.equal(doc.getState().viewports, viewports);
  // Editing goes on, and the next save goes through.
  rename(doc, '교실 2');
  await store.getState().execute(saveCommand(store.getState().snapshot, doc));
  assert.deepEqual([saved().revision, saved().name, server.writes], [5, '교실 2', 2]);
});

test('F-2: a draft opened from the snapshot the handler still holds is refused on the next save', async () => {
  const { store, server, saved } = await openLibrary(), doc = openDocument(saved());
  rename(doc, '교실 1');
  const held = store.getState().snapshot;
  await store.getState().execute(saveCommand(held, doc));
  // The wrong way to go on editing: the saved draft is dropped, and opened again from the map that handler holds.
  doc.dispatch({ type: 'drop-drafts', mapIds: [A] });
  doc.dispatch({ type: 'begin-editing', map: held.maps[0] });
  assert.deepEqual([draftOf(doc).baseRevision, saved().revision], [3, 4]);
  rename(doc, '교실 2');
  // That draft is on the revision before its own save: the store turns the next save away, and nothing is written.
  await assert.rejects(store.getState().execute(saveCommand(store.getState().snapshot, doc)), /다른 사용자가 내용을 변경했습니다/);
  assert.deepEqual([saved().revision, saved().name, server.writes], [4, '교실 1', 1]);
});

test("F-3: the echo of one's own save changes nothing", async () => {
  const { store, saved } = await openLibrary(), doc = openDocument(saved());
  rename(doc, '교실 1');
  const command = saveCommand(store.getState().snapshot, doc);
  await store.getState().execute(command);
  doc.dispatch({ type: 'rebase-drafts', maps: savedMaps(command) });
  // The signal of that save makes the store read the library again: the same map, on the revision the draft is on already.
  assert.equal(await store.getState().refresh(), true);
  assert.equal(saved().revision, draftOf(doc).baseRevision);
  const before = doc.getState();
  doc.dispatch({ type: 'follow-saved', maps: store.getState().snapshot.maps });
  assert.equal(doc.getState(), before);
});

test('F-4: following while a save runs would keep the values of a save that failed', async () => {
  const store = createBackgroundStore(), reply = deferred<BackgroundSnapshot>(), library: BackgroundSnapshot = { ...emptyBackgroundSnapshot(true), maps: [mapA] };
  await store.getState().initialize('admin', { read: async () => library, execute: () => reply.promise });
  const saved = () => store.getState().snapshot.maps[0], doc = openDocument(saved());
  // The settings dialog saves the map under another name, over a draft with nothing unsaved: its own value, on the revision of that draft.
  const renamed: BackgroundMap = { ...mapA, name: '음악실' };
  const save = store.getState().execute(saveMapChanges(store.getState().snapshot, { ...doc.getState().drafts, [A]: { value: renamed, baseRevision: draftOf(doc).baseRevision } }, [renamed]));
  // While the save runs the store shows what was sent: a revision and a name that nothing has confirmed yet.
  assert.deepEqual([store.getState().pending, saved().revision, saved().name], [true, 4, '음악실']);
  // A copy of the document follows the library at that moment. The editor does not: while a save runs it is `disabled`.
  const copy = createMapDocumentStore(doc.getState());
  copy.dispatch({ type: 'follow-saved', maps: store.getState().snapshot.maps });
  const followed = draftOf(copy);
  assert.deepEqual([followed.baseRevision, followed.value.name, mapDraftChanged(followed)], [4, '음악실', false]);
  reply.reject(new Error('저장 실패'));
  await assert.rejects(save, /저장 실패/);
  // The store is back on what the library holds. The copy still has the values of the save that failed, and reads as saved.
  assert.deepEqual([store.getState().pending, saved().revision, saved().name], [false, 3, '교실']);
  assert.equal(draftOf(copy), followed);
  assert.deepEqual([draftOf(doc).baseRevision, draftOf(doc).value.name, mapDraftChanged(draftOf(doc))], [3, '교실', false]);
});

test('F-5: saving an untouched draft still writes and raises the revision', async () => {
  const { store, server, saved } = await openLibrary(), doc = openDocument(saved());
  assert.equal(mapDraftChanged(draftOf(doc)), false);
  // Nothing was edited, and the save is still a write: every open screen is told, and the map is on a later revision.
  await store.getState().execute(saveCommand(store.getState().snapshot, doc));
  assert.deepEqual([server.writes, saved()], [1, { ...mapA, revision: 4 }]);
});
