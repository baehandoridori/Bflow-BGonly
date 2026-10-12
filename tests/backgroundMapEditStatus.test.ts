import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundMap } from '../src/features/backgrounds/types.ts';
import { createMapDocument, mapDraft, reduceMapDocument } from '../src/features/backgrounds/mapDocument.ts';
import type { MapDraft } from '../src/features/backgrounds/mapDocument.ts';
import { MAP_EDIT_LABEL, MAP_SAVED_NOTICE_MS, mapEditStatus } from '../src/features/backgrounds/mapEditStatus.ts';
import type { MapEditStatus } from '../src/features/backgrounds/mapEditStatus.ts';

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
