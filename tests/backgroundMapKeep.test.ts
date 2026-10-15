import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundCamera, BackgroundMap, BackgroundSnapshot, BackgroundSpace } from '../src/features/backgrounds/types.ts';
import { applyBackgroundCommand, validateBackgroundEntity, validateBackgroundSnapshot } from '../src/features/backgrounds/domain.ts';
import { canUndoMap, createMapDocument, gestureStartMap, mapDraft, mapDraftChanged, mapDraftSteps, reduceMapDocument } from '../src/features/backgrounds/mapDocument.ts';
import type { MapDocumentAction, MapDocumentState, MapDraft, MapRestoredDraft } from '../src/features/backgrounds/mapDocument.ts';
import { mapEditStatus } from '../src/features/backgrounds/mapEditStatus.ts';
import type { MapEditStatus } from '../src/features/backgrounds/mapEditStatus.ts';

// The unsaved map edits this PC keeps, as the page sees them. Every verdict comes from the real modules of the library
// (domain.ts, mapDocument.ts, mapWorkflow.ts) on one library that is whole in itself: the places 학교 > 교실, one view V,
// and three maps, 본관 (revision 2, its space 2층 opens the map below) > 2층 (revision 5, on 학교, its space 교실 opens 교실 안
// and stands for 교실, a camera looks at V) > 교실 안 (revision 1).

const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const [MAIN, FLOOR, ROOM] = [1, 2, 3].map(uid);
const [SCHOOL, CLASS] = [0x11, 0x12].map(uid);
const [V, VARIANT, REVISION] = [0x21, 0x22, 0x23].map(uid);
const [FLOOR_SPACE, CLASS_SPACE, CAMERA] = [0x31, 0x32, 0x33].map(uid);
/** A rectangle of the plan that stands for `placeId` and opens `childMapId`. */
const space = (id: string, name: string, placeId: string | null, childMapId: string | null): BackgroundSpace =>
  ({ id, type: 'space', name, placeId, childMapId, x: 100, y: 100, width: 300, height: 200, rotation: 0, shape: 'rect', points: [], locked: false });
const lens: BackgroundCamera = { id: CAMERA, type: 'camera', name: '교실 카메라', spaceId: CLASS_SPACE, x: 200, y: 150, angle: 90, fov: 55, viewIds: [V], locked: false };
const MAIN_MAP: BackgroundMap = { id: MAIN, revision: 2, name: '본관', parentId: null, placeId: null, imageUrl: '', nodes: [space(FLOOR_SPACE, '2층', null, FLOOR)] };
const FLOOR_MAP: BackgroundMap = { id: FLOOR, revision: 5, name: '2층', parentId: MAIN, placeId: SCHOOL, imageUrl: 'https://example.com/2f.png',
  nodes: [space(CLASS_SPACE, '교실', CLASS, ROOM), lens] };
const ROOM_MAP: BackgroundMap = { id: ROOM, revision: 1, name: '교실 안', parentId: FLOOR, placeId: null, imageUrl: '', nodes: [] };
const LIBRARY: BackgroundSnapshot = {
  places: [{ id: SCHOOL, revision: 1, name: '학교', parentId: null, folderPath: '' }, { id: CLASS, revision: 1, name: '교실', parentId: SCHOOL, folderPath: '' }],
  maps: [MAIN_MAP, FLOOR_MAP, ROOM_MAP],
  views: [{ id: V, revision: 1, name: '교실 전경', placeId: CLASS, cameraPlaceId: null, visiblePlaceIds: [], relatedPlaceIds: [], shot: 'wide', tags: [], memo: '',
    variants: [{ id: VARIANT, name: '낮', time: 'day', revisions: [{ id: REVISION, imageUrl: '', filePath: '', createdAt: '2026-10-13T00:00:00.000Z' }], activeRevisionId: REVISION }] }],
  groups: [],
  usages: [],
  canManage: true,
};

/** The reducer of the document, one action after the other. */
const run = (state: MapDocumentState, ...actions: MapDocumentAction[]) => actions.reduce((next, action) => reduceMapDocument(next, action), state);
/** A draft of the map opened for editing (nothing changed in it), in a new document or in the one given. */
const opened = (map: BackgroundMap, state: MapDocumentState = createMapDocument()) => run(state, { type: 'begin-editing', map });
/** One edit of the draft of a map, its name: one undo step. */
const edited = (state: MapDocumentState, mapId: string, name: string) => run(state, { type: 'update', map: { ...mapDraft(state, mapId)!.value, name } });
/** Kept drafts brought back, as the session hands them over after a restart. */
const restore = (state: MapDocumentState, drafts: MapRestoredDraft[]) => run(state, { type: 'restore-drafts', drafts });
/** 2층 as this PC left it: another name. */
const KEPT_FLOOR: BackgroundMap = { ...FLOOR_MAP, name: '2층 (고친 것)' };

test('KP-1a: restore-drafts brings a kept draft back with the count it had, nothing to undo, and a newer revision does not move it', () => {
  // The library every test of this file stands on is whole: what fails below fails for what it tests, not for the library.
  validateBackgroundSnapshot(LIBRARY);
  const restored = restore(createMapDocument(), [{ value: KEPT_FLOOR, baseRevision: 5, steps: 3 }]), draft = mapDraft(restored, FLOOR)!;
  // Unsaved with the count it had, nothing to undo: the edits are counted as ones the history no longer holds.
  assert.deepEqual([mapDraftChanged(draft), mapDraftSteps(draft), canUndoMap(restored, FLOOR), draft.dropped, draft.past.length], [true, 3, false, 3, 0]);
  assert.deepEqual([draft.value, draft.baseRevision, draft.future], [KEPT_FLOOR, 5, []]);
  assert.equal(mapEditStatus(draft, false, false).detail, '저장 안 한 변경 3개');
  // Two edits more count on from there. Two undos come back to the value restored, and stop there.
  const more = edited(edited(restored, FLOOR, '가'), FLOOR, '나');
  assert.equal(mapDraftSteps(mapDraft(more, FLOOR)), 5);
  const back = run(more, { type: 'undo', mapId: FLOOR }, { type: 'undo', mapId: FLOOR });
  assert.equal(mapDraftSteps(mapDraft(back, FLOOR)), 3);
  assert.deepEqual(mapDraft(back, FLOOR)!.value, KEPT_FLOOR);
  assert.equal(canUndoMap(back, FLOOR), false);
  // The library moved on to revision 6: a draft with unsaved edits does not follow it, so the document is the very same.
  assert.equal(run(restored, { type: 'follow-saved', maps: [MAIN_MAP, { ...FLOOR_MAP, revision: 6 }, ROOM_MAP] }), restored);
  // Kept with a count of nought: one at least, so it still reads as unsaved.
  const nought = mapDraft(restore(createMapDocument(), [{ value: KEPT_FLOOR, baseRevision: 5, steps: 0 }]), FLOOR)!;
  assert.deepEqual([nought.dropped, mapDraftSteps(nought), mapDraftChanged(nought)], [1, 1, true]);
});

test('KP-1b: restore-drafts never replaces unsaved edits, replaces a clean draft, ends the gesture and the field edit of that map, and keeps its own copy', () => {
  const kept: MapRestoredDraft = { value: KEPT_FLOOR, baseRevision: 5, steps: 3 };
  const keptMain: MapRestoredDraft = { value: { ...MAIN_MAP, name: '본관 (보관)' }, baseRevision: 2, steps: 1 };
  // Over a draft with unsaved edits nothing happens: the very same document.
  const changed = edited(opened(FLOOR_MAP), FLOOR, '이 PC에서 고침');
  assert.equal(restore(changed, [kept]), changed);
  // A clean draft (opened, nothing done in it) is replaced by the kept one.
  const clean = opened(FLOOR_MAP);
  const replacing: MapDraft = { value: KEPT_FLOOR, baseRevision: 5, past: [], future: [], dropped: 3 };
  assert.deepEqual(mapDraft(restore(clean, [kept]), FLOOR), replacing);
  // Of two at once, the one over unsaved edits stays as it was (the very same draft), and the other comes back.
  const mainChanged = edited(opened(MAIN_MAP), MAIN, '본관 (이 PC)');
  const mixed = restore(mainChanged, [kept, keptMain]);
  assert.equal(mapDraft(mixed, MAIN), mapDraft(mainChanged, MAIN));
  assert.deepEqual(mapDraft(mixed, FLOOR), replacing);
  // A drag of that map, and a field edit of it put there by hand (the reducer leaves none on a clean draft), end with the draft.
  const both = opened(MAIN_MAP, clean);
  const own: MapDocumentState = { ...run(both, { type: 'gesture-begin', mapId: FLOOR }), coalescing: { mapId: FLOOR, key: 'x' } };
  const ended = restore(own, [kept]);
  assert.deepEqual([ended.gesture, ended.coalescing, gestureStartMap(ended, FLOOR)], [null, null, undefined]);
  assert.deepEqual(mapDraft(ended, FLOOR), replacing);
  // On another map they go on: the very same objects.
  const other: MapDocumentState = { ...run(both, { type: 'gesture-begin', mapId: MAIN }), coalescing: { mapId: MAIN, key: 'x' } };
  const goesOn = restore(other, [kept]);
  assert.equal(goesOn.gesture, other.gesture);
  assert.equal(goesOn.coalescing, other.coalescing);
  assert.deepEqual(gestureStartMap(goesOn, MAIN), MAIN_MAP);
  assert.deepEqual(mapDraft(goesOn, FLOOR), replacing);
  // What it was handed is copied: changed afterwards, the document does not change with it.
  const handed = structuredClone(KEPT_FLOOR);
  const copied = restore(createMapDocument(), [{ value: handed, baseRevision: 5, steps: 3 }]);
  handed.name = '나중에 바뀐 이름';
  handed.nodes.pop();
  assert.deepEqual(mapDraft(copied, FLOOR)!.value, KEPT_FLOOR);
  // Nothing to put in (no kept draft at all, or each one over unsaved edits): the very same document.
  assert.equal(restore(clean, []), clean);
  const twoChanged = edited(edited(opened(MAIN_MAP, opened(FLOOR_MAP)), FLOOR, '가'), MAIN, '나');
  assert.equal(restore(twoChanged, [kept, keptMain]), twoChanged);
});

test('KP-2: the band says when the map was saved or deleted elsewhere first, or could not be kept — each new row compared whole', () => {
  const twice = mapDraft(edited(edited(opened(FLOOR_MAP), FLOOR, '가'), FLOOR, '나'), FLOOR)!, clean = mapDraft(opened(FLOOR_MAP), FLOOR)!;
  assert.deepEqual([mapDraftChanged(twice), mapDraftSteps(twice), mapDraftChanged(clean)], [true, 2, false]);
  const moved: MapEditStatus = { phase: 'stale', changed: true, steps: 2, detail: '다른 곳에서 먼저 저장됐어요', canSave: true, saveLabel: '도면 저장', announce: '이 도면이 다른 곳에서 먼저 저장됐어요. 도면 저장을 누르면 어떻게 할지 고를 수 있어요' };
  const gone: MapEditStatus = { phase: 'stale', changed: true, steps: 2, detail: '다른 곳에서 지워졌어요', canSave: true, saveLabel: '도면 저장', announce: '이 도면이 다른 곳에서 지워졌어요. 도면 저장을 누르면 어떻게 할지 고를 수 있어요' };
  assert.deepEqual(mapEditStatus(twice, false, false, 'moved'), moved);
  assert.deepEqual(mapEditStatus(twice, false, false, 'gone'), gone);
  // A save that runs wins over it, as over everything: the row of a save as it is today.
  const saving: MapEditStatus = { phase: 'saving', changed: true, steps: 2, detail: '저장 중…', canSave: false, saveLabel: '저장 중…', announce: '도면을 저장하는 중이에요' };
  assert.deepEqual(mapEditStatus(twice, true, false, 'moved'), saving);
  // A clean draft has nothing of this PC to lose: the clean row, whatever is said of the map.
  const cleanRow: MapEditStatus = { phase: 'clean', changed: false, steps: 0, detail: '저장된 그대로예요', canSave: false, saveLabel: '도면 저장', announce: '' };
  for (const note of ['moved', 'gone', 'unkept'] as const) assert.deepEqual(mapEditStatus(clean, false, false, note), cleanRow, note);
  // Not kept on this PC: the row of unsaved edits, filled as it is, in other words.
  const unkept: MapEditStatus = { phase: 'changed', changed: true, steps: 2, detail: '이 PC에 보관하지 못했어요', canSave: true, saveLabel: '도면 저장', announce: '저장 안 한 변경을 이 PC에 보관하지 못했어요. 도면 저장을 눌러 주세요' };
  assert.deepEqual(mapEditStatus(twice, false, false, 'unkept'), unkept);
  // Just saved, edited again, and saved elsewhere meanwhile: unsaved edits win over the notice, so it is the stale row.
  assert.deepEqual(mapEditStatus(twice, false, true, 'moved'), moved);
});
