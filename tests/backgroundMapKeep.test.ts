import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundCamera, BackgroundMap, BackgroundSnapshot, BackgroundSpace } from '../src/features/backgrounds/types.ts';
import { applyBackgroundCommand, validateBackgroundEntity, validateBackgroundSnapshot } from '../src/features/backgrounds/domain.ts';
import { canUndoMap, createMapDocument, gestureStartMap, mapDraft, mapDraftChanged, mapDraftSteps, reduceMapDocument } from '../src/features/backgrounds/mapDocument.ts';
import type { MapDocumentAction, MapDocumentState, MapDraft, MapRestoredDraft } from '../src/features/backgrounds/mapDocument.ts';
import { mapEditStatus } from '../src/features/backgrounds/mapEditStatus.ts';
import type { MapEditStatus } from '../src/features/backgrounds/mapEditStatus.ts';
import { MAP_KEEP_DELAY_MS, MAP_KEEP_TEXT, MAP_STALE_TEXT, keptEntryOf, mapDraftSavedAlready, mapDraftStanding, planKeptRestore, rescueMapCopy, rescueMapName } from '../src/features/backgrounds/mapDraftKeep.ts';
import { keptEntryProblem } from '../src/shared/backgroundKeptEdits.ts';
import type { KeptMapEdit } from '../src/shared/backgroundKeptEdits.ts';
import { KEPT_DOT_TEXT, KEPT_LIST_TIMEOUT_MS, flushKeptMapEditsBeforeLogout, keptMapEditCount, keptMapEditsStored, primeKeptMapEdits, releaseKeptMapEdits, setKeptMapFlush, useKeptMapEdits } from '../src/features/backgrounds/mapKeptSignal.ts';
import type { KeptSignal } from '../src/features/backgrounds/mapKeptSignal.ts';
import { createMapDraftSession } from '../src/features/backgrounds/mapDraftSession.ts';
import type { MapDraftSession } from '../src/features/backgrounds/mapDraftSession.ts';

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
/** The library with one of its maps as given in place of its own. */
const at = (map: BackgroundMap): BackgroundSnapshot => ({ ...LIBRARY, maps: LIBRARY.maps.map(item => item.id === map.id ? map : item) });

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

test('KP-3: keptEntryOf keeps the value, the count and the revision, and leaves a data: underlay out', () => {
  // An https underlay is kept as it is: the value whole, and no word of anything left out.
  const twice = mapDraft(edited(edited(opened(FLOOR_MAP), FLOOR, '가'), FLOOR, '나'), FLOOR)!;
  const linked = keptEntryOf(twice, twice.value, 1700000000000);
  assert.deepEqual(linked, { baseRevision: 5, steps: 2, keptAt: 1700000000000, value: twice.value });
  assert.deepEqual(Object.keys(linked).sort(), ['baseRevision', 'keptAt', 'steps', 'value']);
  // A data: picture is left out (the draft never changes the underlay): nothing in its place, and the mark that says so.
  const inline: BackgroundMap = { ...twice.value, imageUrl: 'data:image/png;base64,iVBORw0KGgo=' };
  const omitted = keptEntryOf(twice, inline, 1700000000001);
  assert.deepEqual(omitted, { baseRevision: 5, steps: 2, keptAt: 1700000000001, value: { ...inline, imageUrl: '' }, imageOmitted: true });
  assert.deepEqual(Object.keys(omitted).sort(), ['baseRevision', 'imageOmitted', 'keptAt', 'steps', 'value']);
  assert.equal(inline.imageUrl, 'data:image/png;base64,iVBORw0KGgo=', 'the value handed over was written into');
  // The count is the one the band shows: kept with 3, restored and edited once, it is 4 (the history holds one of them).
  const restoredOnce = mapDraft(edited(restore(createMapDocument(), [{ value: KEPT_FLOOR, baseRevision: 5, steps: 3 }]), FLOOR, '다'), FLOOR)!;
  assert.deepEqual([restoredOnce.past.length, keptEntryOf(restoredOnce, restoredOnce.value, 1700000000002).steps], [1, 4]);
  // What it makes may be written: the check of the store lets both through.
  for (const made of [linked, omitted]) assert.equal(keptEntryProblem(FLOOR, made), null);
});

test('KP-4: planKeptRestore — restore, equal, drafted or invalid, and the newest', () => {
  /** An entry as the store lists it: kept on revision 5 with two unsaved edits, unless the patch says otherwise. */
  const kept = (value: unknown, patch: Partial<KeptMapEdit> = {}): KeptMapEdit => ({ baseRevision: 5, steps: 2, keptAt: 1700000000000, value, ...patch });
  const planOf = (listed: Record<string, KeptMapEdit>, snapshot: BackgroundSnapshot = LIBRARY, drafts: Record<string, MapDraft> = {}) => planKeptRestore(listed, snapshot, drafts);
  const left = (mapId: string, reason: 'drafted' | 'invalid') => ({ restore: [], equal: [], skipped: [{ mapId, reason }], newest: null });
  const back = (mapId: string, value: BackgroundMap, baseRevision: number | null = 5, steps = 2) => ({ restore: [{ value, baseRevision, steps }], equal: [], skipped: [], newest: mapId });
  const removed = (mapId: string) => ({ restore: [], equal: [mapId], skipped: [], newest: null });
  // Not a map of this version, or a broken one: left out, and never thrown. A key it does not know, on the map or on a node.
  assert.deepEqual(planOf({ [FLOOR]: kept({ ...KEPT_FLOOR, glow: true }) }), left(FLOOR, 'invalid'));
  assert.deepEqual(planOf({ [FLOOR]: kept({ ...KEPT_FLOOR, nodes: [KEPT_FLOOR.nodes[0], { ...lens, glow: true }] }) }), left(FLOOR, 'invalid'));
  // A number that is a string.
  assert.deepEqual(planOf({ [FLOOR]: kept({ ...KEPT_FLOOR, nodes: [{ ...KEPT_FLOOR.nodes[0], x: '1' }, lens] }) }), left(FLOOR, 'invalid'));
  // No list of nodes, and a node that is no object.
  assert.deepEqual(planOf({ [FLOOR]: kept({ ...KEPT_FLOOR, nodes: {} }) }), left(FLOOR, 'invalid'));
  assert.deepEqual(planOf({ [FLOOR]: kept({ ...KEPT_FLOOR, nodes: [null] }) }), left(FLOOR, 'invalid'));
  // The value of another map under this id.
  assert.deepEqual(planOf({ [FLOOR]: kept({ ...KEPT_FLOOR, id: ROOM }) }), left(FLOOR, 'invalid'));
  // A name a draft can hold and the library would refuse comes back as it is: an object with none, one longer than 160, a map with none.
  const unnamed: BackgroundMap = { ...KEPT_FLOOR, nodes: [space(CLASS_SPACE, '', CLASS, ROOM), lens] };
  assert.deepEqual(planOf({ [FLOOR]: kept(unnamed) }), back(FLOOR, unnamed));
  assert.equal(planOf({ [FLOOR]: kept(unnamed) }).restore[0].value.nodes[0].name, '');
  const long: BackgroundMap = { ...KEPT_FLOOR, nodes: [space(CLASS_SPACE, '가'.repeat(161), CLASS, ROOM), lens] };
  assert.deepEqual(planOf({ [FLOOR]: kept(long) }), back(FLOOR, long));
  const nameless: BackgroundMap = { ...KEPT_FLOOR, name: '' };
  assert.deepEqual(planOf({ [FLOOR]: kept(nameless) }), back(FLOOR, nameless));
  // What the library holds already is removed: on the same revision, or on a later one (saved, and the removal of the entry lost).
  assert.deepEqual(planOf({ [FLOOR]: kept(FLOOR_MAP) }), removed(FLOOR));
  assert.deepEqual(planOf({ [FLOOR]: kept(KEPT_FLOOR) }, at({ ...KEPT_FLOOR, revision: 6 })), removed(FLOOR));
  // An underlay left out is the library's again before anything is compared: then it is the very map, and removed.
  assert.deepEqual(planOf({ [FLOOR]: kept({ ...FLOOR_MAP, imageUrl: '' }, { imageOmitted: true }) }), removed(FLOOR));
  // Saved elsewhere with other content, or gone from the library: it comes back.
  assert.deepEqual(planOf({ [FLOOR]: kept(KEPT_FLOOR) }, at({ ...FLOOR_MAP, revision: 6, name: '2층 (다른 곳)' })), back(FLOOR, KEPT_FLOOR));
  const NEW = uid(4), newMap: BackgroundMap = { id: NEW, revision: 1, name: '별관', parentId: null, placeId: null, imageUrl: '', nodes: [] };
  assert.deepEqual(planOf({ [NEW]: kept(newMap, { baseRevision: 1 }) }), back(NEW, newMap, 1));
  // An underlay left out comes back as the library's, or as none when the library has no such map.
  assert.deepEqual(planOf({ [FLOOR]: kept({ ...KEPT_FLOOR, imageUrl: '' }, { imageOmitted: true }) }), back(FLOOR, KEPT_FLOOR));
  assert.deepEqual(planOf({ [NEW]: kept({ ...newMap, imageUrl: 'https://example.com/old.png' }, { baseRevision: 1, imageOmitted: true }) }), back(NEW, newMap, 1));
  // A draft with unsaved edits on that map wins (it is written over the entry soon), whatever the entry is. A clean draft is
  // replaced: on the revision kept, or on a later one this PC saved meanwhile.
  const changedDrafts = edited(opened(FLOOR_MAP), FLOOR, '이 PC').drafts;
  assert.deepEqual(planOf({ [FLOOR]: kept(KEPT_FLOOR) }, LIBRARY, changedDrafts), left(FLOOR, 'drafted'));
  assert.deepEqual(planOf({ [FLOOR]: kept({ ...KEPT_FLOOR, glow: true }) }, LIBRARY, changedDrafts), left(FLOOR, 'drafted'));
  assert.deepEqual(planOf({ [FLOOR]: kept(KEPT_FLOOR) }, LIBRARY, opened(FLOOR_MAP).drafts), back(FLOOR, KEPT_FLOOR));
  const savedHere: BackgroundMap = { ...FLOOR_MAP, revision: 6, name: '2층 (이 PC가 저장)' };
  assert.deepEqual(planOf({ [FLOOR]: kept(KEPT_FLOOR) }, at(savedHere), opened(savedHere).drafts), back(FLOOR, KEPT_FLOOR));
  // Several at once, each by its row, in the order listed. The newest is the restored one kept last, wherever it stands:
  // 교실 안 was kept later still, but the library holds it.
  const keptMain: BackgroundMap = { ...MAIN_MAP, name: '본관 (고친 것)' };
  const listed = {
    [MAIN]: kept(keptMain, { baseRevision: 2, steps: 1, keptAt: 100 }),
    [FLOOR]: kept(KEPT_FLOOR, { steps: 3, keptAt: 300 }),
    [ROOM]: kept(ROOM_MAP, { baseRevision: 1, keptAt: 400 }),
    [NEW]: kept(newMap, { baseRevision: 1, steps: 1, keptAt: 200 }),
  };
  assert.deepEqual(planOf(listed), {
    restore: [{ value: keptMain, baseRevision: 2, steps: 1 }, { value: KEPT_FLOOR, baseRevision: 5, steps: 3 }, { value: newMap, baseRevision: 1, steps: 1 }],
    equal: [ROOM],
    skipped: [],
    newest: FLOOR,
  });
});

test('KP-5: mapDraftStanding and mapDraftSavedAlready read the library itself, and the same edits on another revision are current', () => {
  const twice = mapDraft(edited(edited(opened(FLOOR_MAP), FLOOR, '가'), FLOOR, '나'), FLOOR)!, clean = mapDraft(opened(FLOOR_MAP), FLOOR)!;
  const elsewhere = at({ ...FLOOR_MAP, revision: 6, name: '2층 (다른 곳)' }), gone = { ...LIBRARY, maps: LIBRARY.maps.filter(map => map.id !== FLOOR) };
  // No draft, a clean one (under a later revision too), one never saved: current.
  assert.equal(mapDraftStanding(undefined, LIBRARY), 'current');
  assert.equal(mapDraftStanding(clean, elsewhere), 'current');
  assert.equal(mapDraftStanding({ ...twice, baseRevision: null }, elsewhere), 'current');
  // On the revision the library has: current.
  assert.equal(mapDraftStanding(twice, LIBRARY), 'current');
  // Another revision with other content: moved. A lower one as well: the revisions are compared for being the same.
  assert.equal(mapDraftStanding(twice, elsewhere), 'moved');
  assert.equal(mapDraftStanding(twice, at({ ...FLOOR_MAP, revision: 4, name: '2층 (옛 것)' })), 'moved');
  // Another revision with the same content (a save of this PC whose answer was lost): current.
  const sameElsewhere = at({ ...twice.value, revision: 6 });
  assert.equal(mapDraftStanding(twice, sameElsewhere), 'current');
  // Gone from the library: gone. A clean draft of a map that is gone: current.
  assert.equal(mapDraftStanding(twice, gone), 'gone');
  assert.equal(mapDraftStanding(clean, gone), 'current');
  // Saved already: the same content on another revision, and nothing else. Not a clean draft, not a map that is gone, not
  // other content, and not a draft on the very revision with the same content (renamed and named back: two steps, both undone in effect).
  assert.equal(mapDraftSavedAlready(twice, sameElsewhere), true);
  assert.equal(mapDraftSavedAlready(clean, at({ ...clean.value, revision: 6 })), false);
  assert.equal(mapDraftSavedAlready(twice, gone), false);
  assert.equal(mapDraftSavedAlready(twice, elsewhere), false);
  const namedBack = mapDraft(edited(edited(opened(FLOOR_MAP), FLOOR, '가'), FLOOR, '2층'), FLOOR)!;
  assert.deepEqual([namedBack.past.length, mapDraftChanged(namedBack), namedBack.value], [2, true, FLOOR_MAP]);
  assert.equal(mapDraftSavedAlready(namedBack, LIBRARY), false);
  assert.equal(mapDraftStanding(namedBack, LIBRARY), 'current');
});

test('KP-6: rescueMapName cuts by whole characters to the 160 units the library counts', () => {
  assert.equal(rescueMapName('2층'), '2층 (내 편집)');
  const full = rescueMapName('가'.repeat(160));
  assert.equal(full.length, 160);
  assert.ok(full.endsWith(' (내 편집)'));
  assert.equal(full, '가'.repeat(153) + ' (내 편집)');
  // A pair of surrogates at the cut goes whole: no half of a character is left, and the name is a unit short.
  const pictured = rescueMapName('가'.repeat(152) + '😀😀');
  assert.equal(pictured, '가'.repeat(152) + ' (내 편집)');
  assert.equal(pictured.length, 159);
  // A space the cut leaves at the end goes, and so do the spaces around the name.
  assert.equal(rescueMapName('가'.repeat(152) + ' 나'), '가'.repeat(152) + ' (내 편집)');
  assert.equal(rescueMapName('  2층  '), '2층 (내 편집)');
});

test('KP-7: rescueMapCopy is a map the library takes, over a map moved, deleted, or with its place and view gone', () => {
  const COPY = uid(0x41);
  const value = mapDraft(edited(opened(FLOOR_MAP), FLOOR, '2층 (이 PC)'), FLOOR)!.value;
  /** The copy on that library, saved there as every new map is: the library is checked first, and whatever it throws is thrown. */
  const take = (base: BackgroundSnapshot, from: BackgroundMap = value) => {
    validateBackgroundSnapshot(base);
    const copy = rescueMapCopy(base, from, COPY);
    return { copy, after: applyBackgroundCommand(base, { type: 'save-maps', maps: [{ entity: copy, expectedRevision: null }] }, { canManage: true }) };
  };
  // Whole, once: a new id on revision 0, the name with the words after it, the same underlay, under the same map, on the same
  // place. Its space opens nothing (the map below hangs from 2층, not from the copy) and keeps its place; the camera keeps its view.
  const copied = take(LIBRARY);
  assert.deepEqual(copied.copy, { id: COPY, revision: 0, name: '2층 (이 PC) (내 편집)', imageUrl: 'https://example.com/2f.png', parentId: MAIN, placeId: SCHOOL,
    nodes: [space(CLASS_SPACE, '교실', CLASS, null), lens] });
  assert.deepEqual(copied.after.maps.find(map => map.id === COPY), { ...copied.copy, revision: 1 });
  // ⓐ 2층 was saved elsewhere meanwhile: the copy goes in beside it, and 2층 stays as it was saved there.
  const movedFloor: BackgroundMap = { ...FLOOR_MAP, revision: 6, name: '2층 (다른 곳)' };
  const moved = take(at(movedFloor));
  assert.deepEqual(moved.after.maps.find(map => map.id === FLOOR), movedFloor);
  assert.deepEqual(moved.copy, copied.copy);
  // ⓑ Everything under 본관 was deleted elsewhere (본관, 2층 and 교실 안): the copy is a map at the top.
  const deleted = take({ ...LIBRARY, maps: [] });
  assert.deepEqual(deleted.copy, { ...copied.copy, parentId: null });
  // ⓒ 2층 was saved elsewhere without 학교, 교실 and V, which were deleted then: the copy has no place, nor its space, and its camera no view.
  const detached: BackgroundMap = { ...FLOOR_MAP, revision: 6, placeId: null, nodes: [space(CLASS_SPACE, '교실', null, ROOM), { ...lens, viewIds: [] }] };
  const bare = take({ ...LIBRARY, places: [], views: [], maps: [MAIN_MAP, detached, ROOM_MAP] });
  assert.deepEqual(bare.copy, { ...copied.copy, placeId: null, nodes: [space(CLASS_SPACE, '교실', null, null), { ...lens, viewIds: [] }] });
  // ⓓ A name of 160 with pictures in it: cut so the whole fits, 159.
  const pictured = '가'.repeat(152) + '😀😀' + '가'.repeat(4);
  assert.equal(pictured.length, 160);
  const named = take(LIBRARY, { ...value, name: pictured });
  assert.deepEqual([named.copy.name, named.copy.name.length], ['가'.repeat(152) + ' (내 편집)', 159]);
  // An object whose name was emptied goes along as the draft holds it, and the library refuses it as it refuses that draft.
  assert.throws(() => take(LIBRARY, { ...value, nodes: [space(CLASS_SPACE, '', CLASS, ROOM), lens] }), /오브젝트 이름/);
});

test('KP-9: the words of mapDraftKeep.ts, letter for letter', () => {
  assert.equal(MAP_KEEP_DELAY_MS, 300);
  assert.equal(MAP_KEEP_TEXT.restored(2), "지난번에 저장하지 않은 편집이 있던 도면 2개를 다시 열었어요. 필요 없으면 '편집 끝내기'에서 버릴 수 있어요.");
  assert.equal(MAP_KEEP_TEXT.update(3), '이 PC에 저장 안 한 편집이 있는 도면 3개가 그대로 보관돼 있어요. 업데이트한 뒤 배경 화면을 열면 이어서 고칠 수 있어요.');
  assert.equal(MAP_KEEP_TEXT.below, '접어 둔 하위 도면에 저장 안 한 변경이 있어요');
  assert.equal(MAP_KEEP_TEXT.broken, '도면 화면을 그리지 못했어요. 저장하지 않은 도면 편집 때문일 수 있어요.');
  assert.equal(MAP_KEEP_TEXT.brokenDiscard, '저장하지 않은 편집을 버리고 다시 열기');
  assert.equal(MAP_KEEP_TEXT.noRight(2), '배경을 고칠 권한이 없어져서, 이 PC에서 저장하지 않은 도면 편집 2개를 저장할 수 없어요. 권한을 다시 받으면 이어서 고칠 수 있어요.');
  assert.equal(MAP_KEEP_TEXT.noRightDiscard, '고치던 내용 버리기');
  assert.equal(MAP_STALE_TEXT.moved.title, '다른 곳에서 이 도면이 먼저 저장됐어요');
  assert.equal(MAP_STALE_TEXT.moved.lead, '이 PC에서 고친 내용과 다른 곳에서 저장한 내용은 하나로 합칠 수 없어요.');
  assert.equal(MAP_STALE_TEXT.moved.drop, '내 편집 버리고 최신 내용 받기');
  assert.equal(MAP_STALE_TEXT.gone.title, '다른 곳에서 이 도면이 지워졌어요');
  assert.equal(MAP_STALE_TEXT.gone.lead, '지워진 도면에는 이 PC에서 고친 내용을 저장할 수 없어요.');
  assert.equal(MAP_STALE_TEXT.gone.drop, '내 편집 버리기');
  assert.equal(MAP_STALE_TEXT.kept, '고르기 전까지 이 PC의 편집은 그대로 보관돼요.');
  assert.equal(MAP_STALE_TEXT.unkept, '이 PC에 보관하지 못한 편집이에요. 고르기 전에 앱을 끄면 사라질 수 있어요.');
  assert.equal(MAP_STALE_TEXT.copy('2층 (내 편집)'), '새 도면은 ‘2층 (내 편집)’이라는 이름으로 생기고, 하위 도면으로 들어가는 연결과 다른 도면에서 들어오는 입구는 따라오지 않아요.');
  assert.equal(MAP_STALE_TEXT.save, '내 편집을 새 도면으로 저장');
});

// The signal (mapKeptSignal.ts): what the parts of the app that are always loaded know of the edits this PC keeps. Driven
// through a fake bridge on `window` whose answers each test settles, and the fake setTimeout of node.

/** Promises settle, and one turn of the loop goes by (setImmediate is not one of the fake timers). */
const settle = () => new Promise(done => setImmediate(done));
/** The signal as it is before any login. */
const IDLE_SIGNAL: KeptSignal = { userId: null, status: 'idle', listed: {}, kept: [], changed: [], failed: [] };
/** A list as main hands it over: 2층 kept with other words. */
const LISTED: Record<string, KeptMapEdit> = { [FLOOR]: { baseRevision: 5, steps: 2, keptAt: 1700000000000, value: KEPT_FLOOR } };
/** One read of the list the signal sent, held until the test answers it. */
type ListCall = { resolve(entries: Record<string, KeptMapEdit>): void; reject(error: Error): void };
/** For one test: the fake setTimeout, a bridge on `window` that logs each read, and a silent console.warn. All of it, the signal and what hangs on it go back as the test ends. */
function bridge(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: ListCall[] = [];
  const backgroundKeptList = () => new Promise<Record<string, KeptMapEdit>>((resolve, reject) => { calls.push({ resolve, reject }); });
  const host = globalThis as { window?: unknown };
  const attach = () => { host.window = { electronAPI: { backgroundKeptList } }; };
  attach();
  const warn = t.mock.method(console, 'warn', () => {});
  t.after(() => { delete host.window; useKeptMapEdits.setState({ userId: null, status: 'idle', listed: {}, kept: [], changed: [], failed: [] }); setKeptMapFlush(null); });
  return { calls, warn, host, attach };
}

test('KS-a: a login reads its list once — loading, ready, a refusal, no bridge, and five seconds without an answer', async t => {
  const { calls, warn, host, attach } = bridge(t);
  // The first prime of a login reads: loading until the answer, then the entries as listed and their ids as kept.
  primeKeptMapEdits('1');
  assert.deepEqual(useKeptMapEdits.getState(), { ...IDLE_SIGNAL, userId: '1', status: 'loading' });
  assert.equal(calls.length, 1);
  // While that account reads, and once it has read, another prime of it reads nothing.
  primeKeptMapEdits('1');
  assert.equal(calls.length, 1);
  calls[0].resolve(LISTED);
  await settle();
  assert.deepEqual(useKeptMapEdits.getState(), { ...IDLE_SIGNAL, userId: '1', status: 'ready', listed: LISTED, kept: [FLOOR] });
  primeKeptMapEdits('1');
  assert.equal(calls.length, 1);
  // A read refused: unavailable, and one line in the console.
  releaseKeptMapEdits('1');
  primeKeptMapEdits('1');
  assert.equal(calls.length, 2);
  calls[1].reject(new Error('잠김'));
  await settle();
  assert.equal(useKeptMapEdits.getState().status, 'unavailable');
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(warn.mock.calls[0].arguments[0], '[background] kept map edits not read:');
  // No bridge to ask, or no such function on it: unavailable at once, and nothing is read.
  for (const bare of [{}, { electronAPI: {} }]) {
    host.window = bare;
    releaseKeptMapEdits('1');
    primeKeptMapEdits('1');
    assert.deepEqual(useKeptMapEdits.getState(), { ...IDLE_SIGNAL, userId: '1', status: 'unavailable' });
  }
  assert.equal(calls.length, 2);
  attach();
  // No answer within five seconds: unavailable, so that 편집 시작 does not wait for ever. The answer of that very read, coming later, is taken.
  assert.equal(KEPT_LIST_TIMEOUT_MS, 5000);
  releaseKeptMapEdits('1');
  primeKeptMapEdits('1');
  t.mock.timers.tick(4999);
  assert.equal(useKeptMapEdits.getState().status, 'loading');
  t.mock.timers.tick(1);
  assert.equal(useKeptMapEdits.getState().status, 'unavailable');
  calls[2].resolve(LISTED);
  await settle();
  assert.deepEqual(useKeptMapEdits.getState(), { ...IDLE_SIGNAL, userId: '1', status: 'ready', listed: LISTED, kept: [FLOOR] });
  // From unavailable a prime of that account reads again: loading, and the marks the session holds in the signal stay.
  releaseKeptMapEdits('1');
  primeKeptMapEdits('1');
  calls[3].reject(new Error('잠김'));
  await settle();
  assert.equal(useKeptMapEdits.getState().status, 'unavailable');
  useKeptMapEdits.setState({ kept: [FLOOR], changed: [MAIN], failed: [FLOOR] });
  primeKeptMapEdits('1');
  assert.equal(calls.length, 5);
  assert.deepEqual(useKeptMapEdits.getState(), { ...IDLE_SIGNAL, userId: '1', status: 'loading', kept: [FLOOR], changed: [MAIN], failed: [FLOOR] });
});

test('KS-b: an earlier read changes nothing, and a release empties only its own account', async t => {
  const { calls } = bridge(t);
  // A login, a logout three seconds on and the same account again: the timer of the first read does not cut the second short.
  primeKeptMapEdits('1');
  t.mock.timers.tick(3000);
  releaseKeptMapEdits('1');
  assert.deepEqual(useKeptMapEdits.getState(), IDLE_SIGNAL);
  primeKeptMapEdits('1');
  t.mock.timers.tick(2100);
  assert.equal(useKeptMapEdits.getState().status, 'loading');
  t.mock.timers.tick(2899);
  assert.equal(useKeptMapEdits.getState().status, 'loading');
  t.mock.timers.tick(1);
  assert.equal(useKeptMapEdits.getState().status, 'unavailable');
  // Read, released and read again: the refusal of the first read, coming after the second was read, leaves the second as it is.
  releaseKeptMapEdits('1');
  primeKeptMapEdits('1');
  releaseKeptMapEdits('1');
  primeKeptMapEdits('1');
  assert.equal(calls.length, 4);
  calls[3].resolve(LISTED);
  await settle();
  calls[2].reject(new Error('늦은 거절'));
  await settle();
  assert.deepEqual(useKeptMapEdits.getState(), { ...IDLE_SIGNAL, userId: '1', status: 'ready', listed: LISTED, kept: [FLOOR] });
  // Another account read meanwhile: the late list of '1' is dropped.
  releaseKeptMapEdits('1');
  primeKeptMapEdits('1');
  primeKeptMapEdits('2');
  assert.equal(calls.length, 6);
  calls[4].resolve(LISTED);
  await settle();
  assert.deepEqual(useKeptMapEdits.getState(), { ...IDLE_SIGNAL, userId: '2', status: 'loading' });
  // A release is for its own account: with the signal on '1', that of '2' changes nothing, and that of '1' empties it.
  releaseKeptMapEdits('2');
  primeKeptMapEdits('1');
  calls[6].resolve(LISTED);
  await settle();
  const before = useKeptMapEdits.getState();
  assert.deepEqual(before, { ...IDLE_SIGNAL, userId: '1', status: 'ready', listed: LISTED, kept: [FLOOR] });
  releaseKeptMapEdits('2');
  assert.equal(useKeptMapEdits.getState(), before);
  releaseKeptMapEdits('1');
  assert.deepEqual(useKeptMapEdits.getState(), IDLE_SIGNAL);
});

test('KS-c: the flush before logout never throws, and the two counts', async t => {
  bridge(t);
  /** Where a promise stands once the promises settled and a turn of the loop went by: the fake clock does not move by itself. */
  const where = async (promise: Promise<unknown>) => {
    let at = 'pending';
    promise.then(() => { at = 'resolved'; }, () => { at = 'rejected'; });
    await settle();
    return at;
  };
  // Nothing hung on it: done at once.
  assert.equal(await where(flushKeptMapEditsBeforeLogout(3000)), 'resolved');
  // What the session hung on it is called, and waited for three seconds, no longer, when it never ends.
  let flushes = 0;
  setKeptMapFlush(() => { flushes++; return new Promise<void>(() => {}); });
  const endless = flushKeptMapEditsBeforeLogout(3000);
  assert.equal(flushes, 1);
  assert.equal(await where(endless), 'pending');
  t.mock.timers.tick(2999);
  assert.equal(await where(endless), 'pending');
  t.mock.timers.tick(1);
  assert.equal(await where(endless), 'resolved');
  // One that refuses, or throws as it is called: done at once, and nothing is thrown.
  setKeptMapFlush(() => Promise.reject(new Error('보관하지 못함')));
  assert.equal(await where(flushKeptMapEditsBeforeLogout(3000)), 'resolved');
  setKeptMapFlush(() => { throw new Error('던짐'); });
  assert.equal(await where(flushKeptMapEditsBeforeLogout(3000)), 'resolved');
  // Taken off again: nothing to wait for.
  setKeptMapFlush(null);
  assert.equal(await where(flushKeptMapEditsBeforeLogout(3000)), 'resolved');
  // The dot counts each map once, kept or changed in this run. The update notice counts the kept ones whose last write was not refused.
  assert.equal(keptMapEditCount({ ...IDLE_SIGNAL, kept: ['a', 'b'], changed: ['b', 'c'] }), 3);
  assert.equal(keptMapEditsStored({ ...IDLE_SIGNAL, kept: ['a', 'b'], failed: ['b', 'c'] }), 1);
  assert.equal(KEPT_DOT_TEXT, '저장 안 한 도면 편집이 있어요');
});

// The session (mapDraftSession.ts): the document of one account and its copy on this PC. Driven by a clock moved by hand,
// a fake signal and a fake file of main, so that nothing here waits on time that passes.

/** A clock moved by hand: what is set runs as its time comes, in the order of those times. */
function clock() {
  let now = 0, last = 0;
  const due = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    set: (run: () => void, ms: number): unknown => { due.set(++last, { at: now + ms, run }); return last; },
    clear: (handle: unknown) => { due.delete(handle as number); },
    /** How many are set and neither ran nor were cleared. */
    pending: () => due.size,
    /** The time moves on by `ms`; what comes due on the way runs at its time, and so does what is set meanwhile and comes due within. */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        let next: { handle: number; at: number; run: () => void } | undefined;
        for (const [handle, timer] of due) if (timer.at <= end && (!next || timer.at < next.at)) next = { handle, ...timer };
        if (!next) break;
        due.delete(next.handle);
        now = next.at;
        next.run();
      }
      now = end;
    },
  };
}
/** An answer of the fake file held back, given by hand: as the file gives it, or as a refusal. */
type HeldAnswer = { resolve(): void; reject(): void };
/**
 * A session of account 'u' on its own clock, signal and file, made anew for each case. Each put is logged as it is called and
 * leaves the file as main would. While `rules.hold` is on its answer waits in `held`; the next `refuseWrites` writes and
 * `refuseRemoves` removes are refused.
 */
function keeper(signalPatch: Partial<KeptSignal> = {}) {
  const time = clock();
  let signal: KeptSignal = { userId: 'u', status: 'ready', listed: {}, kept: [], changed: [], failed: [], ...signalPatch };
  const fake = { read: () => signal, write: (patch: Partial<KeptSignal>) => { signal = { ...signal, ...patch }; } };
  const puts: [string, KeptMapEdit | null][] = [], file: Record<string, KeptMapEdit> = {}, held: HeldAnswer[] = [];
  const rules = { hold: false, refuseWrites: 0, refuseRemoves: 0 };
  const put = (mapId: string, entry: KeptMapEdit | null) => new Promise<void>((resolve, reject) => {
    puts.push([mapId, entry]);
    const refused = entry ? rules.refuseWrites > 0 : rules.refuseRemoves > 0;
    if (refused && entry) rules.refuseWrites--;
    else if (refused) rules.refuseRemoves--;
    const answer = () => {
      if (refused) return reject(new Error('보관하지 못함'));
      if (entry) file[mapId] = entry; else delete file[mapId];
      resolve();
    };
    if (rules.hold) held.push({ resolve: answer, reject: () => reject(new Error('보관하지 못함')) });
    else answer();
  });
  const make = (patch: { userId?: string } = {}) =>
    createMapDraftSession({ userId: 'u', put, signal: fake, timers: { set: time.set, clear: time.clear }, now: time.now, ...patch });
  return { time, signal: () => signal, setSignal: fake.write, puts, file, held, rules, make };
}
/** One edit of a map in the document of the session, its name: one undo step. The map is opened first when it has no draft. */
function rename(session: MapDraftSession, map: BackgroundMap, name: string) {
  session.store.dispatch({ type: 'begin-editing', map });
  session.store.dispatch({ type: 'update', map: { ...mapDraft(session.store.getState(), map.id)!.value, name } });
}
/** A save of a map as its draft holds it: the draft is put back on what was saved, one revision on, as persistMaps does. */
function save(session: MapDraftSession, mapId: string) {
  const draft = mapDraft(session.store.getState(), mapId)!;
  session.store.dispatch({ type: 'rebase-drafts', maps: [{ ...draft.value, revision: (draft.baseRevision ?? 0) + 1 }] });
}
/** The calls of the fake file, each as its map and what it did. */
const sends = (puts: [string, KeptMapEdit | null][]) => puts.map(([mapId, entry]) => [mapId, entry === null ? 'remove' : 'write']);
/** The map with its space moved along to `x`: a drag on the plan. */
const moved = (map: BackgroundMap, x: number): BackgroundMap => ({ ...map, nodes: map.nodes.map(node => node.type === 'space' ? { ...node, x } : node) });

test('KP-8a: a settled edit is written within 0.3 seconds, every 0.3 seconds while the edits go on, never the preview of a drag, and the dot comes on at once', async () => {
  {
    const { time, signal, puts, make } = keeper();
    const session = make();
    // The first edit marks its map changed in the same tick, before anything is written: the dot comes on with the edit.
    rename(session, FLOOR_MAP, '가');
    assert.deepEqual(signal().changed, [FLOOR]);
    assert.equal(puts.length, 0);
    // Three edits 0.1 seconds apart: nothing yet. 0.3 seconds after the first, one write of all three, and the one map changed.
    time.advance(100); rename(session, FLOOR_MAP, '나');
    time.advance(100); rename(session, FLOOR_MAP, '다');
    await settle();
    assert.equal(puts.length, 0);
    time.advance(300); await settle();
    assert.deepEqual(puts, [[FLOOR, { baseRevision: 5, steps: 3, keptAt: 300, value: mapDraft(session.store.getState(), FLOOR)!.value }]]);
    assert.deepEqual(signal().changed, [FLOOR]);
  }
  {
    // Ten edits 0.12 seconds apart: written every 0.3 seconds while they go on (three by the tenth), and the tenth 0.3 seconds after it.
    const { time, puts, make } = keeper();
    const session = make();
    for (let index = 1; index <= 10; index++) {
      if (index > 1) time.advance(120);
      rename(session, FLOOR_MAP, `이름 ${index}`);
    }
    await settle();
    assert.deepEqual(puts.map(([, entry]) => entry!.steps), [3, 6, 9]);
    time.advance(300); await settle();
    assert.equal(puts.length, 4);
    assert.deepEqual(puts[3], [FLOOR, { baseRevision: 5, steps: 10, keptAt: 1380, value: mapDraft(session.store.getState(), FLOOR)!.value }]);
    assert.equal((puts[3][1]!.value as BackgroundMap).name, '이름 10');
  }
  {
    // Written once, then a drag of ten previews 0.5 seconds apart: nothing more while it runs. Released, what it ends on, 0.3 seconds later.
    const { time, puts, make } = keeper();
    const session = make();
    for (const name of ['가', '나', '다']) rename(session, FLOOR_MAP, name);
    time.advance(300); await settle();
    assert.equal(puts.length, 1);
    session.store.dispatch({ type: 'gesture-begin', mapId: FLOOR });
    const start = mapDraft(session.store.getState(), FLOOR)!.value;
    for (let step = 1; step <= 10; step++) {
      if (step > 1) time.advance(500);
      session.store.dispatch({ type: 'gesture-preview', map: moved(start, 100 + step * 10) });
    }
    await settle();
    assert.equal(puts.length, 1);
    session.store.dispatch({ type: 'gesture-finish' });
    time.advance(300); await settle();
    assert.equal(puts.length, 2);
    assert.deepEqual(puts[1][1]!.value, moved(start, 200));
    assert.deepEqual(puts[1][1]!.value, mapDraft(session.store.getState(), FLOOR)!.value);
  }
  {
    // A timer that comes due while a drag runs writes the map as it was when the drag started, never a preview.
    const { time, puts, make } = keeper();
    const session = make();
    rename(session, FLOOR_MAP, '가');
    const start = mapDraft(session.store.getState(), FLOOR)!.value;
    time.advance(100);
    session.store.dispatch({ type: 'gesture-begin', mapId: FLOOR });
    session.store.dispatch({ type: 'gesture-preview', map: moved(start, 40) });
    time.advance(200); await settle();
    assert.deepEqual(puts, [[FLOOR, { baseRevision: 5, steps: 1, keptAt: 300, value: start }]]);
  }
  {
    // A session with no account keeps nothing and marks nothing.
    const { time, signal, puts, make } = keeper();
    const session = make({ userId: '' });
    for (const name of ['가', '나', '다']) rename(session, FLOOR_MAP, name);
    time.advance(1000); await settle();
    assert.deepEqual([puts, signal().changed], [[], []]);
  }
});

test('KP-8b: only what this session wrote or restored is removed — a save, a discard, a write still in flight, and a refused remove', async () => {
  {
    // A save puts the draft back on what was saved: its entry is removed at once, nothing is written after, and nothing stays marked.
    const { time, signal, puts, file, make } = keeper();
    const session = make();
    rename(session, FLOOR_MAP, '가');
    time.advance(300); await settle();
    save(session, FLOOR);
    assert.deepEqual(sends(puts), [[FLOOR, 'write'], [FLOOR, 'remove']]);
    time.advance(1000); await settle();
    assert.equal(puts.length, 2);
    assert.deepEqual([signal().changed, signal().kept, file], [[], [], {}]);
  }
  {
    // A draft discarded before it was written: no call at all.
    const { time, puts, make } = keeper();
    const session = make();
    rename(session, FLOOR_MAP, '가');
    time.advance(200);
    session.store.dispatch({ type: 'discard', mapId: FLOOR });
    time.advance(1000); await settle();
    assert.deepEqual(puts, []);
  }
  {
    // Undone to clean while its write is still out: the remove goes at once, right behind that write (the entry was this session's as the write went).
    const { time, puts, held, rules, make } = keeper();
    rules.hold = true;
    const session = make();
    rename(session, FLOOR_MAP, '가');
    time.advance(300);
    session.store.dispatch({ type: 'undo', mapId: FLOOR });
    assert.deepEqual(sends(puts), [[FLOOR, 'write'], [FLOOR, 'remove']]);
    for (const answer of held) answer.resolve();
    await settle();
  }
  {
    // A remove refused, the map edited again and that write taken: the flush removes nothing of it, and the file holds the new entry.
    const { time, puts, file, rules, make } = keeper();
    const session = make();
    rename(session, FLOOR_MAP, '가');
    time.advance(300); await settle();
    rules.refuseRemoves = 1;
    session.store.dispatch({ type: 'undo', mapId: FLOOR });
    await settle();
    rename(session, FLOOR_MAP, '나');
    time.advance(300); await settle();
    await session.flush();
    assert.deepEqual(sends(puts), [[FLOOR, 'write'], [FLOOR, 'remove'], [FLOOR, 'write']]);
    assert.deepEqual(file, { [FLOOR]: puts[2][1] });
    assert.equal((file[FLOOR].value as BackgroundMap).name, '나');
  }
  {
    // A remove refused with no draft left: it goes out again with the next write, of another map.
    const { time, puts, file, rules, make } = keeper();
    const session = make();
    rename(session, FLOOR_MAP, '가');
    time.advance(300); await settle();
    rules.refuseRemoves = 1;
    session.store.dispatch({ type: 'discard', mapId: FLOOR });
    await settle();
    assert.deepEqual(file, { [FLOOR]: puts[0][1] });
    rename(session, MAIN_MAP, '본관 (고침)');
    time.advance(300); await settle();
    assert.deepEqual(sends(puts), [[FLOOR, 'write'], [FLOOR, 'remove'], [FLOOR, 'remove'], [MAIN, 'write']]);
    assert.deepEqual(Object.keys(file), [MAIN]);
  }
});

test('KP-8c: nothing is written before the list is read, a refusal is told and forgotten, and flush and dispose', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  {
    // While the list is read nothing is written. Once it is read, within 0.3 seconds.
    const { time, signal, setSignal, puts, make } = keeper({ status: 'loading' });
    const session = make();
    rename(session, FLOOR_MAP, '가');
    time.advance(900); await settle();
    assert.deepEqual([puts, signal().failed], [[], []]);
    setSignal({ status: 'ready' });
    time.advance(300); await settle();
    assert.deepEqual(sends(puts), [[FLOOR, 'write']]);
  }
  {
    // The list could not be read: nothing written a second on, and the map marked as not kept. Read at last: written within 0.3 seconds, the mark gone.
    const { time, signal, setSignal, puts, make } = keeper({ status: 'unavailable' });
    const session = make();
    rename(session, FLOOR_MAP, '가');
    time.advance(1000); await settle();
    assert.deepEqual([puts, signal().failed], [[], [FLOOR]]);
    setSignal({ status: 'ready' });
    time.advance(300); await settle();
    assert.deepEqual([sends(puts), signal().failed], [[[FLOOR, 'write']], []]);
  }
  {
    // Unavailable, an edit, 0.4 seconds and a save: the mark goes at once and stays gone, and no timer is left behind.
    const { time, signal, puts, make } = keeper({ status: 'unavailable' });
    const session = make();
    rename(session, FLOOR_MAP, '가');
    time.advance(400);
    assert.deepEqual(signal().failed, [FLOOR]);
    save(session, FLOOR);
    assert.deepEqual([signal().failed, time.pending()], [[], 0]);
    time.advance(1000); await settle();
    assert.deepEqual([signal().failed, time.pending(), puts], [[], 0, []]);
  }
  {
    // A write refused: a line in the console, and the map marked. The flush sends it again; taken, the mark goes.
    const { time, signal, puts, rules, make } = keeper();
    const session = make();
    rules.refuseWrites = 1;
    rename(session, FLOOR_MAP, '가');
    time.advance(300); await settle();
    assert.deepEqual(signal().failed, [FLOOR]);
    assert.deepEqual(warn.mock.calls.at(-1)!.arguments.slice(0, 2), ['[background] kept map edit not written:', FLOOR]);
    await session.flush();
    assert.deepEqual([sends(puts), signal().failed], [[[FLOOR, 'write'], [FLOOR, 'write']], []]);
  }
  {
    // A map whose write was refused, saved or discarded: its mark goes at once.
    const { time, signal, rules, make } = keeper();
    const session = make();
    rules.refuseWrites = 2;
    rename(session, FLOOR_MAP, '가');
    rename(session, MAIN_MAP, '나');
    time.advance(300); await settle();
    assert.deepEqual(signal().failed, [FLOOR, MAIN]);
    save(session, FLOOR);
    assert.deepEqual(signal().failed, [MAIN]);
    session.store.dispatch({ type: 'discard', mapId: MAIN });
    assert.deepEqual(signal().failed, []);
  }
  {
    // Saved while its write was out, and that write refused afterwards: no mark, nor once the map is edited again.
    const { time, signal, held, rules, make } = keeper();
    rules.hold = true;
    const session = make();
    rename(session, FLOOR_MAP, '가');
    time.advance(300);
    save(session, FLOOR);
    held[0].reject();
    await settle();
    assert.deepEqual(signal().failed, []);
    rename(session, FLOOR_MAP, '나');
    assert.deepEqual(signal().failed, []);
    for (const answer of held.slice(1)) answer.resolve();
    await settle();
  }
  {
    // A write out with no answer yet: the flush waits for it as well, though it did not send it.
    const { time, held, rules, make } = keeper();
    rules.hold = true;
    const session = make();
    rename(session, FLOOR_MAP, '가');
    time.advance(300);
    let flushed = false;
    void session.flush().then(() => { flushed = true; });
    await settle();
    assert.equal(flushed, false);
    held[0].resolve();
    await settle();
    assert.equal(flushed, true);
  }
  {
    // Disposed within 0.3 seconds of an edit: no timer is left, nothing is written a second on, nor after another edit.
    const { time, puts, make } = keeper();
    const session = make();
    rename(session, FLOOR_MAP, '가');
    time.advance(200);
    assert.equal(time.pending(), 1);
    session.dispose();
    assert.equal(time.pending(), 0);
    time.advance(1000); await settle();
    rename(session, FLOOR_MAP, '나');
    time.advance(1000); await settle();
    assert.deepEqual(puts, []);
  }
});

test('KP-8d: catching up — once per login what this PC kept comes back, an own save whose answer was lost is put back, and discardAll', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  /** An entry as main lists it: kept on revision 5 with three unsaved edits, unless the patch says otherwise. */
  const entry = (value: unknown, patch: Partial<KeptMapEdit> = {}): KeptMapEdit => ({ baseRevision: 5, steps: 3, keptAt: 1700000000000, value, ...patch });
  // A to restore (2층 under another name), B as the library holds it (교실 안), C a map this version cannot hold (본관 with a key it does not know).
  const listed = { [FLOOR]: entry(KEPT_FLOOR), [ROOM]: entry(ROOM_MAP, { baseRevision: 1 }), [MAIN]: entry({ ...MAIN_MAP, glow: true }, { baseRevision: 2 }) };
  {
    const { time, signal, puts, make } = keeper({ listed, kept: Object.keys(listed) });
    const session = make();
    // Once per login: A comes back as a draft with the count it had, the map to show. B is removed, and that is the only call.
    assert.deepEqual(session.catchUp(LIBRARY), { count: 1, mapId: FLOOR });
    assert.equal(session.catchUp(LIBRARY), null);
    assert.deepEqual(mapDraft(session.store.getState(), FLOOR), { value: KEPT_FLOOR, baseRevision: 5, past: [], future: [], dropped: 3 });
    assert.deepEqual(puts, [[ROOM, null]]);
    // A is in the file already: nothing is written of it, a second on either. The file holds A and C as far as this PC knows, and A is changed.
    assert.equal(time.pending(), 0);
    time.advance(1000); await settle();
    assert.deepEqual(puts, [[ROOM, null]]);
    assert.deepEqual([signal().kept, signal().changed], [[FLOOR, MAIN], [FLOOR]]);
    // C stays in the file, told in the console, and gets no call: not even when it is opened and discarded.
    assert.deepEqual(warn.mock.calls.map(call => call.arguments), [['[background] kept map edit not restored:', MAIN, 'invalid']]);
    session.store.dispatch({ type: 'begin-editing', map: MAIN_MAP });
    session.store.dispatch({ type: 'discard', mapId: MAIN });
    time.advance(1000); await settle();
    assert.deepEqual(puts, [[ROOM, null]]);
    // A discarded: its entry goes.
    session.store.dispatch({ type: 'discard', mapId: FLOOR });
    assert.deepEqual(puts, [[ROOM, null], [FLOOR, null]]);
  }
  // The list not read, or the signal another account's: nothing comes back and nothing is called. Once it is read, the next catch-up restores.
  const unread: Partial<KeptSignal>[] = [{ status: 'unavailable' }, { userId: 'v' }];
  for (const patch of unread) {
    const { setSignal, puts, make } = keeper({ listed, kept: Object.keys(listed), ...patch });
    const session = make();
    assert.equal(session.catchUp(LIBRARY), null);
    assert.deepEqual([puts, session.store.getState().drafts], [[], {}]);
    setSignal({ userId: 'u', status: 'ready' });
    assert.deepEqual(session.catchUp(LIBRARY), { count: 1, mapId: FLOOR });
  }
  {
    // A save of this PC whose answer was lost: the library holds what the draft holds, on revision 6. Put back on it: clean, its entry removed, the dot off.
    const { time, signal, puts, make } = keeper();
    const session = make();
    rename(session, FLOOR_MAP, '2층 (저장 중에 떠남)');
    time.advance(300); await settle();
    const value = mapDraft(session.store.getState(), FLOOR)!.value;
    session.catchUp(at({ ...value, revision: 6 }));
    assert.deepEqual(mapDraft(session.store.getState(), FLOOR), { value: { ...value, revision: 6 }, baseRevision: 6, past: [], future: [], dropped: 0 });
    assert.deepEqual([sends(puts), signal().changed], [[[FLOOR, 'write'], [FLOOR, 'remove']], []]);
  }
  {
    // Other content on revision 6: nothing at all.
    const { time, puts, make } = keeper();
    const session = make();
    rename(session, FLOOR_MAP, '2층 (이 PC)');
    time.advance(300); await settle();
    const before = session.store.getState();
    session.catchUp(at({ ...FLOOR_MAP, revision: 6, name: '2층 (다른 곳)' }));
    assert.equal(session.store.getState(), before);
    assert.deepEqual(sends(puts), [[FLOOR, 'write']]);
  }
  {
    // A restored, D (본관) written in this run, E (교실 안) edited within 0.3 seconds: every draft goes, A and D are removed once each, E has nothing to remove.
    const { time, signal, puts, make } = keeper({ listed: { [FLOOR]: entry(KEPT_FLOOR) }, kept: [FLOOR] });
    const session = make();
    assert.deepEqual(session.catchUp(LIBRARY), { count: 1, mapId: FLOOR });
    rename(session, MAIN_MAP, '본관 (이번에)');
    time.advance(300); await settle();
    rename(session, ROOM_MAP, '교실 안 (이번에)');
    time.advance(100);
    session.discardAll();
    assert.deepEqual(session.store.getState().drafts, {});
    assert.deepEqual(sends(puts), [[MAIN, 'write'], [FLOOR, 'remove'], [MAIN, 'remove']]);
    time.advance(1000); await settle();
    assert.equal(puts.length, 3);
    assert.deepEqual(signal().changed, []);
    // What this PC kept comes back once per login: not again.
    assert.equal(session.catchUp(LIBRARY), null);
    assert.deepEqual(session.store.getState().drafts, {});
  }
});
