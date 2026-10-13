import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundCamera, BackgroundCommand, BackgroundMap, BackgroundNode, BackgroundSnapshot, BackgroundSpace } from '../src/features/backgrounds/types.ts';
import { applyBackgroundCommand, emptyBackgroundSnapshot, validateBackgroundRequest, validateBackgroundSnapshot } from '../src/features/backgrounds/domain.ts';
import { createMapDocument, reduceMapDocument } from '../src/features/backgrounds/mapDocument.ts';
import type { MapDraft } from '../src/features/backgrounds/mapDocument.ts';
import { MAP_DELETE_SAVE_LIMIT, mapDeleteCauseText, mapDeleteStopText, mapDeleteText, planMapDelete } from '../src/features/backgrounds/mapDelete.ts';
import type { MapDeleteMode, MapDeletePlan } from '../src/features/backgrounds/mapDelete.ts';

// The delete of a map: its plan (at most one save, then one delete for each map, the lowest first) and the words the dialog
// says of it. Every command of a plan is run here through the two checks of the library itself, the check of a request and
// the command applied to the snapshot: they are what tells whether each state on the way is a whole library.

const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
let made = 0x1000;
/** A space, which opens the map `childMapId` when one is given. */
const space = (name: string, childMapId: string | null = null): BackgroundSpace => ({ id: uid(made++), type: 'space', name, placeId: null, childMapId, x: 100, y: 100, width: 300, height: 200, rotation: 0, shape: 'rect', points: [], locked: false });
const newMap = (id: string, name: string, parentId: string | null, nodes: BackgroundNode[] = []): BackgroundMap => ({ id, revision: 1, name, parentId, placeId: null, imageUrl: '', nodes });

const [SCHOOL, MAIN, FLOOR, ROOM_1, ROOM_2, CELLAR, ANNEX, STORE] = [1, 2, 3, 4, 5, 6, 7, 8].map(uid);
const [PLACE, VIEW, VARIANT, REVISION, GROUP, USAGE] = [0x21, 0x22, 0x23, 0x24, 0x25, 0x26].map(uid);
const lens: BackgroundCamera = { id: uid(made++), type: 'camera', name: '교실 전경', spaceId: null, x: 240, y: 180, angle: 90, fov: 55, viewIds: [VIEW], locked: false };
/**
 * 학교 > 본관 > { 2층 > { 2-1 교실, 2-2 교실 }, 지하 } and, at the top beside it, 별관 > 창고. Every map on revision 1, in this
 * order. Three links: a space of 학교 opens 본관, one of 본관 opens 2층, one of 2층 opens 2-1 교실. 2-2 교실, 지하 and 창고 hang by
 * `parentId` alone (what ＋ 하위 도면 만들기 makes). One place, one view (the camera of 2-1 교실 points at it), one group and one
 * usage. Frozen through and through: a function that wrote into the library it was handed would throw.
 */
const library: BackgroundSnapshot = freeze({
  places: [{ id: PLACE, revision: 1, name: '2-1 교실', parentId: null, folderPath: '' }],
  maps: [
    newMap(SCHOOL, '학교', null, [space('본관', MAIN)]), newMap(MAIN, '본관', SCHOOL, [space('2층', FLOOR)]), newMap(FLOOR, '2층', MAIN, [space('2-1 교실', ROOM_1)]),
    newMap(ROOM_1, '2-1 교실', FLOOR, [lens]), newMap(ROOM_2, '2-2 교실', FLOOR), newMap(CELLAR, '지하', MAIN), newMap(ANNEX, '별관', null), newMap(STORE, '창고', ANNEX),
  ],
  views: [{ id: VIEW, revision: 1, name: '교실 전경', placeId: PLACE, cameraPlaceId: null, visiblePlaceIds: [], relatedPlaceIds: [], shot: 'wide', tags: [], memo: '',
    variants: [{ id: VARIANT, name: '낮', time: 'day', revisions: [{ id: REVISION, imageUrl: '', filePath: '', createdAt: '2026-10-13T00:00:00.000Z' }], activeRevisionId: REVISION }] }],
  groups: [{ id: GROUP, revision: 1, name: '교실 기본 시점', placeId: PLACE, variantIds: [VARIANT] }],
  usages: [{ id: USAGE, revision: 1, episodeNumber: 1, placeId: PLACE, variantIds: [VARIANT], memo: '' }],
  canManage: true,
});
const MODES: readonly MapDeleteMode[] = ['keep-children', 'with-children'];
/** Every map of the library, each way. */
const COMBOS = library.maps.flatMap(map => MODES.map(mode => [map, mode] as const));
/** The plan for a map that the library does not have. */
const NONE: MapDeletePlan = { target: null, parent: null, entrances: [], children: [], nested: 0, descendants: [], save: null, links: 0, removed: [], steps: [], savedAlong: [], lostEdits: { own: false, below: [] }, outdated: [], unsavable: [], refusal: null };

function at(snapshot: BackgroundSnapshot, id: string): BackgroundMap {
  const map = snapshot.maps.find(item => item.id === id);
  assert.ok(map, `the library has no map ${id}`);
  return map;
}
const names = (maps: readonly BackgroundMap[]) => maps.map(map => map.name);
/** The maps in the order of the library, each as `name<name of the map above` (a top map: its name alone). */
const tree = (snapshot: BackgroundSnapshot) => snapshot.maps.map(map => map.parentId ? `${map.name}<${at(snapshot, map.parentId).name}` : map.name);
/** What each space of a map opens. */
const links = (map: BackgroundMap) => map.nodes.flatMap(node => node.type === 'space' ? [node.childMapId] : []);
/** The map with no space of it opening anything. */
const unlinked = (map: BackgroundMap): BackgroundMap => ({ ...map, nodes: map.nodes.map(node => node.type === 'space' ? { ...node, childMapId: null } : node) });
/** The maps the save of a plan writes, by the names the library has for them, in the order they are written. */
const written = (plan: MapDeletePlan, snapshot: BackgroundSnapshot = library) => (plan.save?.maps ?? []).map(item => at(snapshot, item.entity.id).name);
/** The library with one of its maps in another state. */
const withMap = (map: BackgroundMap, snapshot: BackgroundSnapshot = library): BackgroundSnapshot => ({ ...snapshot, maps: snapshot.maps.map(item => item.id === map.id ? map : item) });

/** One command as the library takes it: the request is checked, then the command is applied for someone who may manage. It throws what the library throws. */
function run(snapshot: BackgroundSnapshot, command: BackgroundCommand): BackgroundSnapshot {
  validateBackgroundRequest({ requestId: '00000000-0000-4000-8000-000000000000', command });
  return applyBackgroundCommand(snapshot, command, { canManage: true });
}
const runAll = (snapshot: BackgroundSnapshot, commands: readonly BackgroundCommand[]) => commands.reduce(run, snapshot);
const remove = (id: string, expectedRevision = 1): BackgroundCommand => ({ type: 'delete', kind: 'map', id, expectedRevision });

/** Real drafts, made by the reducer of the document: each map is opened for editing as given and, where a second value comes with it, edited once to that. */
function draftsOf(...edits: (readonly [BackgroundMap, BackgroundMap?])[]): Record<string, MapDraft> {
  return edits.reduce((state, [opened, changed]) => {
    const begun = reduceMapDocument(state, { type: 'begin-editing', map: opened });
    return changed ? reduceMapDocument(begun, { type: 'update', map: changed }) : begun;
  }, createMapDocument()).drafts;
}
/** The map with one more space on it. */
const grown = (map: BackgroundMap): BackgroundMap => ({ ...map, nodes: [...map.nodes, space('새 공간')] });
/** The map with an object whose name was emptied: the name box of the inspector puts that into a draft, and no save takes it. */
const nameless = (map: BackgroundMap): BackgroundMap => ({ ...map, nodes: [...map.nodes, space('')] });
/** The map as it was one revision before the library's. */
const older = (map: BackgroundMap): BackgroundMap => ({ ...map, revision: map.revision - 1 });
/** Unsaved edits to a map, on the revision of the library. */
const edited = (...maps: BackgroundMap[]) => draftsOf(...maps.map(map => [map, grown(map)] as const));
/** Unsaved edits to a map, on a revision the library has left since. */
const outdated = (...maps: BackgroundMap[]) => draftsOf(...maps.map(map => [older(map), grown(older(map))] as const));

const [school, main, floor, room1, room2, cellar, annex, store] = library.maps;

test('D-1: what the library refuses today', () => {
  // The baseline. The fixture is a whole library, and the two rules that stood in the way of a delete are as they were.
  validateBackgroundSnapshot(library);
  // A map that a space of the map above opens, though nothing hangs under it.
  assert.throws(() => run(library, remove(ROOM_1)), /상세 도면은 현재 도면의 하위 도면이어야 합니다/);
  // A map with maps under it.
  assert.throws(() => run(library, remove(MAIN)), /참조한 상위 항목이 없습니다/);
  // Neither: it goes at once.
  assert.deepEqual(tree(run(library, remove(CELLAR))), ['학교', '본관<학교', '2층<본관', '2-1 교실<2층', '2-2 교실<2층', '별관', '창고<별관']);
});

test('D-2: a map with children and a link, keeping the children', () => {
  const plan = planMapDelete(library, {}, MAIN, 'keep-children');
  assert.deepEqual(plan.target, main); assert.deepEqual(plan.parent, school);
  assert.deepEqual(plan.entrances, ['본관']);
  assert.deepEqual(names(plan.children), ['2층', '지하']); assert.equal(plan.nested, 1);
  assert.deepEqual(names(plan.descendants), ['2-1 교실', '2-2 교실', '2층', '지하']);
  // The save, in this order: the map above lets go of the map, the map lets go of its child, and both children move up.
  assert.deepEqual(plan.save, { type: 'save-maps', maps: [
    { entity: unlinked(school), expectedRevision: 1 }, { entity: unlinked(main), expectedRevision: 1 },
    { entity: { ...floor, parentId: SCHOOL }, expectedRevision: 1 }, { entity: { ...cellar, parentId: SCHOOL }, expectedRevision: 1 }] });
  // Counted is the link that opened the map. The one from the map to its child is not: that it is gone is told as the child moving up.
  assert.equal(plan.links, 1);
  assert.deepEqual(plan.removed, [MAIN]);
  // The save wrote the map, so it is deleted on the revision after the library's.
  assert.deepEqual(plan.steps, [plan.save, remove(MAIN, 2)]);
  assert.deepEqual([plan.savedAlong, plan.lostEdits, plan.outdated, plan.unsavable, plan.refusal], [[], { own: false, below: [] }, [], [], null]);
  const end = runAll(library, plan.steps);
  assert.deepEqual(tree(end), ['학교', '2층<학교', '2-1 교실<2층', '2-2 교실<2층', '지하<학교', '별관', '창고<별관']);
  // A map that moved up still opens its own child: only the links to the deleted map, and from it, are gone.
  assert.deepEqual(links(at(end, FLOOR)), [ROOM_1]); assert.deepEqual(links(at(end, SCHOOL)), [null]);
});

test('D-3: the same map with everything under it', () => {
  const plan = planMapDelete(library, {}, MAIN, 'with-children');
  // Written are the maps that hold a link to a map that goes, and no other: no map moves.
  assert.deepEqual(plan.save, { type: 'save-maps', maps: [school, main, floor].map(map => ({ entity: unlinked(map), expectedRevision: 1 })) });
  assert.equal(plan.links, 3);
  // The lowest first and the map itself last: no map is deleted while one still hangs under it.
  assert.deepEqual(plan.removed.map(id => at(library, id).name), ['2-1 교실', '2-2 교실', '2층', '지하', '본관']);
  assert.deepEqual(plan.steps, [plan.save, remove(ROOM_1, 1), remove(ROOM_2, 1), remove(FLOOR, 2), remove(CELLAR, 1), remove(MAIN, 2)]);
  assert.deepEqual([plan.entrances, names(plan.children), plan.nested, names(plan.descendants)], [['본관'], ['2층', '지하'], 1, ['2-1 교실', '2-2 교실', '2층', '지하']]);
  assert.deepEqual([plan.savedAlong, plan.lostEdits, plan.outdated, plan.unsavable, plan.refusal], [[], { own: false, below: [] }, [], [], null]);
  const end = runAll(library, plan.steps);
  assert.deepEqual(tree(end), ['학교', '별관', '창고<별관']); assert.deepEqual(links(at(end, SCHOOL)), [null]);
  // After the map above and the map itself the save writes in the order of the library, not in the order of deletion.
  const top = planMapDelete(library, {}, SCHOOL, 'with-children');
  assert.deepEqual(written(top), ['학교', '본관', '2층']); assert.deepEqual(names(top.descendants), ['2-1 교실', '2-2 교실', '2층', '지하', '본관']);
  // No id is stepped on twice, not even in a library that is broken: two maps, each under the other.
  const [A, B] = [0x41, 0x42].map(uid), loop: BackgroundSnapshot = { ...emptyBackgroundSnapshot(true), maps: [newMap(A, '가', B), newMap(B, '나', A)] };
  assert.deepEqual(planMapDelete(loop, {}, A, 'with-children').removed, [B, A]);
});

test('D-4: a top map, keeping the children', () => {
  const plan = planMapDelete(library, {}, SCHOOL, 'keep-children');
  assert.equal(plan.parent, null); assert.deepEqual(plan.entrances, []);
  // No map is above it: the child becomes a top map. It keeps the link to its own child.
  assert.deepEqual(plan.save, { type: 'save-maps', maps: [{ entity: unlinked(school), expectedRevision: 1 }, { entity: { ...main, parentId: null }, expectedRevision: 1 }] });
  // No space opens the map itself.
  assert.equal(plan.links, 0);
  assert.deepEqual(plan.steps, [plan.save, remove(SCHOOL, 2)]);
  const end = runAll(library, plan.steps);
  assert.deepEqual(tree(end), ['본관', '2층<본관', '2-1 교실<2층', '2-2 교실<2층', '지하<본관', '별관', '창고<별관']);
  assert.equal(at(end, MAIN).parentId, null); assert.deepEqual(links(at(end, MAIN)), [FLOOR]);
});

test('D-5: a map with nothing under it and no link is one command', () => {
  for (const mode of MODES) {
    const plain = planMapDelete(library, {}, CELLAR, mode);
    assert.equal(plain.save, null, mode); assert.equal(plain.links, 0, mode);
    assert.deepEqual(plain.steps, [remove(CELLAR, 1)], mode);
    // A map that a space of the map above opens: that map is written first, the map itself is not.
    const opened = planMapDelete(library, {}, ROOM_1, mode);
    assert.deepEqual(opened.steps, [{ type: 'save-maps', maps: [{ entity: unlinked(floor), expectedRevision: 1 }] }, remove(ROOM_1, 1)], mode);
    assert.equal(opened.links, 1, mode);
    assert.deepEqual(tree(runAll(library, opened.steps)), ['학교', '본관<학교', '2층<본관', '2-2 교실<2층', '지하<본관', '별관', '창고<별관'], mode);
  }
});

test('D-6: every prefix of every plan leaves a whole library', () => {
  let commands = 0;
  for (const [map, mode] of COMBOS) {
    const plan = planMapDelete(library, {}, map.id, mode);
    assert.equal(plan.refusal, null, `${map.name} ${mode}`);
    // One command after the other: each state on the way is the library after a prefix of the plan, and each passes both checks.
    plan.steps.reduce((snapshot, step, index) => {
      commands += 1;
      try { return run(snapshot, step); } catch (cause) { return assert.fail(`${map.name} ${mode}: command ${index + 1} of ${plan.steps.length} was refused (${String(cause)})`); }
    }, library);
    assert.ok(!runAll(library, plan.steps).maps.some(item => item.id === map.id), `${map.name} ${mode}: the map is still there`);
  }
  // Sixteen plans of thirty-seven commands: the number the design counted for this library.
  assert.equal(commands, 37);
  // A map is written by the save only when it holds a link. One that merely has maps under it is not, and is deleted on
  // the revision the library has for it: on the next one the delete would be told that someone else changed the map.
  assert.deepEqual(planMapDelete(library, {}, ANNEX, 'keep-children').steps, [{ type: 'save-maps', maps: [{ entity: { ...store, parentId: null }, expectedRevision: 1 }] }, remove(ANNEX, 1)]);
  assert.deepEqual(planMapDelete(library, {}, ANNEX, 'with-children').steps, [remove(STORE, 1), remove(ANNEX, 1)]);
});

test('D-7: a run that stopped and was planned again ends the same', () => {
  for (const [map, mode] of COMBOS) {
    const steps = planMapDelete(library, {}, map.id, mode).steps, end = runAll(library, steps);
    for (let done = 0; done <= steps.length; done++) {
      const label = `${map.name} ${mode}, stopped after ${done} of ${steps.length}`, stopped = runAll(library, steps.slice(0, done));
      // Planned anew from the library as the stop left it: a link that is off, a map that moved and a map that is gone are not asked for again.
      const again = planMapDelete(stopped, {}, map.id, mode);
      assert.equal(again.refusal, null, label);
      // The same library to the end: the parents, and the revisions too. No map was written twice.
      assert.deepEqual(runAll(stopped, again.steps), end, label);
      // Going on the other way from there is refused nowhere either.
      const turned = planMapDelete(stopped, {}, map.id, MODES.find(item => item !== mode)!);
      assert.ok(!runAll(stopped, turned.steps).maps.some(item => item.id === map.id), label);
    }
  }
});

test('D-8: nothing but maps is touched', () => {
  for (const [map, mode] of COMBOS) {
    const end = runAll(library, planMapDelete(library, {}, map.id, mode).steps), label = `${map.name} ${mode}`;
    // The view a camera of a deleted map pointed at stays, with everything else that is no map.
    for (const kind of ['places', 'views', 'groups', 'usages'] as const) assert.deepEqual(end[kind], library[kind], `${label}: ${kind}`);
    assert.equal(end.canManage, true, label);
    // The other branch is as it was, value and revision.
    const apart = [ANNEX, STORE].includes(map.id) ? [SCHOOL, MAIN, FLOOR, ROOM_1, ROOM_2, CELLAR] : [ANNEX, STORE];
    for (const id of apart) assert.deepEqual(at(end, id), at(library, id), `${label}: ${at(library, id).name}`);
  }
});

test('D-9: the save step takes the value of a draft with unsaved edits, and the revision of the library', () => {
  // Unsaved edits to the map above, on the revision of the library: the save writes them along, with the link taken off.
  const wider = grown(school), along = planMapDelete(library, draftsOf([school, wider]), MAIN, 'with-children');
  assert.deepEqual(along.save?.maps[0], { entity: unlinked(wider), expectedRevision: 1 });
  assert.deepEqual(links(along.save!.maps[0].entity), [null, null]);
  assert.deepEqual(written(along), ['학교', '본관', '2층']); assert.deepEqual(along.savedAlong, ['학교']); assert.equal(along.refusal, null);
  assert.equal(at(runAll(library, along.steps), SCHOOL).nodes.length, 2);
  // A draft with nothing unsaved in it counts for nothing, whatever its value: the library's is written.
  const clean = planMapDelete(library, draftsOf([wider]), MAIN, 'with-children');
  assert.deepEqual(clean, planMapDelete(library, {}, MAIN, 'with-children'));
  assert.deepEqual(clean.save?.maps[0], { entity: unlinked(school), expectedRevision: 1 });
  // And so when it stands on a revision the library has left: the map was saved elsewhere while the draft, opened before
  // that, has nothing unsaved. Nothing is refused, the library's value goes out on the library's revision, and the run
  // passes to the end. Sent on the revision of the draft, the save would be told that someone else changed the map.
  const moved = run(library, { type: 'save', kind: 'map', entity: grown(school), expectedRevision: 1 }), ahead = at(moved, SCHOOL);
  assert.equal(ahead.revision, 2);
  for (const mode of MODES) {
    const late = planMapDelete(moved, draftsOf([school]), MAIN, mode);
    assert.deepEqual([late.refusal, late.outdated, late.savedAlong], [null, [], []], mode);
    assert.deepEqual(late.save?.maps[0], { entity: unlinked(ahead), expectedRevision: 2 }, mode);
    const end = runAll(moved, late.steps);
    assert.ok(!end.maps.some(map => map.id === MAIN), mode); assert.equal(at(end, SCHOOL).revision, 3, mode);
  }
  // The structure is the library's alone. A draft that deleted the space which opened the map changes nothing of who is
  // written: the map above is in the save all the same, with the value of the draft, where there is no link to take off.
  const bare = { ...school, nodes: [] };
  for (const mode of MODES) {
    const gone = planMapDelete(library, draftsOf([school, bare]), MAIN, mode);
    assert.deepEqual(gone.entrances, ['본관'], mode); assert.equal(written(gone)[0], '학교', mode);
    assert.deepEqual(gone.save?.maps[0], { entity: bare, expectedRevision: 1 }, mode);
    assert.deepEqual([gone.savedAlong, gone.refusal], [['학교'], null], mode);
    assert.deepEqual(at(runAll(library, gone.steps), SCHOOL).nodes, [], mode);
  }
  // And a link is taken off wherever the value that is written holds one: here the draft opens the map from another space
  // than the library does. Taken off by the space the library knows, the link would outlive the save and stop the delete.
  const door = space('뒷문', MAIN), other = { ...school, nodes: [door] };
  for (const mode of MODES) {
    const swapped = planMapDelete(library, draftsOf([school, other]), MAIN, mode);
    assert.deepEqual(swapped.save?.maps[0], { entity: { ...school, nodes: [{ ...door, childMapId: null }] }, expectedRevision: 1 }, mode);
    assert.deepEqual(at(runAll(library, swapped.steps), SCHOOL).nodes.map(node => node.name), ['뒷문'], mode);
  }
  // A map above that no space of which opens the map is not written: its unsaved edits are neither saved nor named.
  for (const mode of MODES) assert.deepEqual(planMapDelete(library, edited(main), CELLAR, mode), planMapDelete(library, {}, CELLAR, mode), mode);
});

test('D-10: unsaved edits on a revision the library has left refuse the plan, for a map of the save step only', () => {
  // The map above, which stays.
  for (const mode of MODES) {
    const plan = planMapDelete(library, outdated(school), MAIN, mode);
    assert.deepEqual([plan.refusal, plan.outdated, plan.savedAlong], ['outdated', ['학교'], []], mode);
    // Refused, and still whole. The value the library has is what the plan holds for that map, never the old draft's.
    assert.deepEqual({ ...plan, outdated: [], refusal: null }, planMapDelete(library, {}, MAIN, mode), mode);
  }
  // A map that is deleted, where the save has to write it first: the draft would be put back over what it held.
  const below = planMapDelete(library, outdated(floor), MAIN, 'with-children');
  assert.deepEqual([below.refusal, below.outdated, below.lostEdits], ['outdated', ['2층'], { own: false, below: ['2층'] }]);
  for (const mode of MODES) {
    const own = planMapDelete(library, outdated(floor), FLOOR, mode);
    assert.deepEqual([own.refusal, own.outdated, own.lostEdits], ['outdated', ['2층'], { own: true, below: [] }], mode);
  }
  // In the order of the save step, whatever the order of the drafts. And by the name the library has for the map: the draft may have another.
  assert.deepEqual(planMapDelete(library, outdated(floor, school), MAIN, 'with-children').outdated, ['학교', '2층']);
  assert.deepEqual(planMapDelete(library, draftsOf([older(school), { ...older(school), name: '학교 (옛 초안)' }]), MAIN, 'keep-children').outdated, ['학교']);
  // A map the save does not write is no reason to refuse. One that stays is named nowhere.
  for (const mode of MODES) assert.deepEqual(planMapDelete(library, outdated(annex), MAIN, mode), planMapDelete(library, {}, MAIN, mode), mode);
  // One that is deleted goes with its edits, old as they are, and the dialog says so.
  const lost = planMapDelete(library, outdated(room2), MAIN, 'with-children');
  assert.deepEqual([lost.refusal, lost.outdated, lost.lostEdits], [null, [], { own: false, below: ['2-2 교실'] }]);
  assert.deepEqual(tree(runAll(library, lost.steps)), ['학교', '별관', '창고<별관']);
});

test('D-11: unsaved edits of a map that is deleted go with it', () => {
  // The map and a map under it, both edited, both deleted. Neither is a map whose edits are saved along: they are lost,
  // though the save writes the two with the values of their drafts on its way.
  const mainDraft = grown(main), floorDraft = grown(floor), both = planMapDelete(library, draftsOf([main, mainDraft], [floor, floorDraft]), MAIN, 'with-children');
  assert.deepEqual(both.lostEdits, { own: true, below: ['2층'] }); assert.deepEqual(both.savedAlong, []); assert.equal(both.refusal, null);
  assert.deepEqual(both.save, { type: 'save-maps', maps: [school, mainDraft, floorDraft].map(map => ({ entity: unlinked(map), expectedRevision: 1 })) });
  assert.deepEqual(both.save?.maps.map(item => item.entity.nodes.length), [1, 2, 2]);
  assert.deepEqual(tree(runAll(library, both.steps)), ['학교', '별관', '창고<별관']);
  // The same edits to a child that is kept: saved along, under the name the library has for the map.
  const renamed = { ...floor, name: '2층 (새 이름)' }, kept = planMapDelete(library, draftsOf([floor, renamed]), MAIN, 'keep-children');
  assert.deepEqual(kept.savedAlong, ['2층']); assert.deepEqual(kept.lostEdits, { own: false, below: [] }); assert.equal(kept.refusal, null);
  const end = at(runAll(library, kept.steps), FLOOR);
  assert.deepEqual([end.name, end.parentId, end.revision, links(end)], ['2층 (새 이름)', SCHOOL, 2, [ROOM_1]]);
  // The map itself or a map under it is told by its place, not by its name: here the child is called what the map is.
  const twin = withMap({ ...floor, name: '본관' }), same = planMapDelete(twin, edited(at(twin, FLOOR)), MAIN, 'with-children');
  assert.deepEqual(same.lostEdits, { own: false, below: ['본관'] });
  // In the order the maps are deleted in. And under the name of the library, here too.
  assert.deepEqual(planMapDelete(library, edited(cellar, floor, room1), MAIN, 'with-children').lostEdits, { own: false, below: ['2-1 교실', '2층', '지하'] });
  assert.deepEqual(planMapDelete(library, draftsOf([floor, renamed]), MAIN, 'with-children').lostEdits, { own: false, below: ['2층'] });
  // A map that is being edited with nothing unsaved loses nothing: the plan is the one without any draft.
  for (const mode of MODES) assert.deepEqual(planMapDelete(library, draftsOf([main], [floor], [room1], [cellar]), MAIN, mode), planMapDelete(library, {}, MAIN, mode), mode);
});

/** A top map with that many maps under it, each hung there without a link. */
function crowd(count: number): BackgroundSnapshot {
  const top = uid(0x9000);
  return { ...emptyBackgroundSnapshot(true), maps: [newMap(top, '큰 도면', null), ...Array.from({ length: count }, (_, index) => newMap(uid(0x9001 + index), `하위 ${index + 1}`, top))] };
}

test('D-12: the save step holds a hundred maps at most', () => {
  assert.equal(MAP_DELETE_SAVE_LIMIT, 100);
  const big = crowd(101), top = big.maps[0].id, kept = planMapDelete(big, {}, top, 'keep-children');
  assert.equal(kept.refusal, 'too-many');
  // Refused, and still whole: the save it would take, and the two commands.
  assert.equal(kept.save?.maps.length, 101); assert.equal(kept.steps.length, 2);
  // Sent as it is, the library would refuse that save before anything was written.
  assert.throws(() => run(big, kept.steps[0]), /배경 목록의 크기 또는 형식이 올바르지 않습니다/);
  // Deleted along with the map, none of them has to be written first: one delete each, and those have no limit.
  const all = planMapDelete(big, {}, top, 'with-children');
  assert.deepEqual([all.refusal, all.save, all.steps.length], [null, null, 102]);
  assert.deepEqual(runAll(big, all.steps).maps, []);
  // A hundred are one save still.
  const full = crowd(100), fits = planMapDelete(full, {}, full.maps[0].id, 'keep-children');
  assert.equal(fits.refusal, null); assert.equal(fits.save?.maps.length, 100);
  assert.deepEqual(runAll(full, fits.steps).maps.map(map => map.parentId), Array.from({ length: 100 }, () => null));
  // Counted is every map the save writes, the map above and the map itself among them: opened from above and opening a
  // child of its own, a map may have ninety-eight maps under it, and not ninety-nine.
  const hung = (count: number): BackgroundSnapshot => {
    const [top, first, ...others] = crowd(count).maps, above = uid(0x8fff);
    return { ...emptyBackgroundSnapshot(true), maps: [newMap(above, '위 도면', null, [space('큰 도면', top.id)]), { ...top, parentId: above, nodes: [space('하위 1', first.id)] }, first, ...others] };
  };
  const tight = hung(98), within = planMapDelete(tight, {}, tight.maps[1].id, 'keep-children');
  assert.deepEqual([within.refusal, within.save?.maps.length, within.links], [null, 100, 1]);
  assert.deepEqual(tree(runAll(tight, within.steps)), ['위 도면', ...Array.from({ length: 98 }, (_, index) => `하위 ${index + 1}<위 도면`)]);
  const loose = hung(99), beyond = planMapDelete(loose, {}, loose.maps[1].id, 'keep-children');
  assert.deepEqual([beyond.refusal, beyond.save?.maps.length], ['too-many', 101]);
  // What a draft holds is said before the count is: it names a map the user can go to.
  const child = big.maps[1], blocked = planMapDelete(big, draftsOf([child, nameless(child)]), top, 'keep-children');
  assert.deepEqual([blocked.refusal, blocked.unsavable, blocked.save?.maps.length], ['unsavable', ['하위 1'], 101]);
  // So is an old draft, and so are the rights: the count is asked last of the four, whichever of the others stands beside it.
  const stale = planMapDelete(big, outdated(child), top, 'keep-children');
  assert.deepEqual([stale.refusal, stale.outdated, stale.save?.maps.length], ['outdated', ['하위 1'], 101]);
  assert.equal(planMapDelete({ ...big, canManage: false }, {}, top, 'keep-children').refusal, 'rights');
});

test('D-13: no rights, and a map that is gone', () => {
  const viewer: BackgroundSnapshot = { ...library, canManage: false };
  for (const mode of MODES) {
    const plan = planMapDelete(viewer, {}, MAIN, mode);
    assert.equal(plan.refusal, 'rights', mode);
    // Refused, and still whole: the commands are those of someone who may manage.
    assert.ok(plan.steps.length > 1, mode);
    assert.deepEqual({ ...plan, refusal: null }, planMapDelete(library, {}, MAIN, mode), mode);
  }
  // The rights are asked first: of the other reasons the lists still tell.
  const both = planMapDelete(viewer, outdated(school), MAIN, 'keep-children');
  assert.deepEqual([both.refusal, both.outdated], ['rights', ['학교']]);
  // Before a draft that no save takes as well (and before the count: D-12).
  const held = planMapDelete(viewer, draftsOf([main, nameless(main)]), MAIN, 'keep-children');
  assert.deepEqual([held.refusal, held.unsavable], ['rights', ['본관']]);
  // A map the library does not have: nothing to do and nothing refused, with the rights and without.
  for (const snapshot of [library, viewer]) for (const mode of MODES) {
    const plan = planMapDelete(snapshot, {}, uid(0xdead), mode);
    assert.deepEqual(plan, NONE, mode); assert.equal(mapDeleteText(plan, mode), null, mode);
  }
  // Nor is a map there for the draft that is left of it once it was deleted.
  const after = runAll(library, planMapDelete(library, {}, CELLAR, 'keep-children').steps);
  for (const mode of MODES) assert.deepEqual(planMapDelete(after, edited(cellar), CELLAR, mode), NONE, mode);
});

const GOES = '도면에 놓은 공간·카메라·기호가 함께 없어져요. 장소와 배경 이미지, 에피소드별 사용 기록은 그대로 남아요.';
const KEEP = '하위 도면은 남기기', ALL = '하위 도면도 함께 삭제';

test('D-14: the words of the dialog', () => {
  const words = (snapshot: BackgroundSnapshot, id: string, mode: MapDeleteMode, drafts: Record<string, MapDraft> = {}) => {
    const text = mapDeleteText(planMapDelete(snapshot, drafts, id, mode), mode);
    assert.ok(text, `no words for ${id}`);
    return text;
  };
  // Nothing under it and no link: two paragraphs, no choice, and the button that names what it does.
  for (const mode of MODES) assert.deepEqual(words(library, CELLAR, mode), { lead: ['‘지하’ 도면을 지워요. 지운 도면은 되돌릴 수 없어요.', GOES], keep: null, all: null, notes: [], refusal: null, confirm: '도면 삭제' }, mode);
  // A link from the map above, and nothing under it.
  for (const mode of MODES) assert.deepEqual(words(library, ROOM_1, mode), { lead: ['‘2-1 교실’ 도면을 지워요. 지운 도면은 되돌릴 수 없어요.', GOES, '‘2층’ 도면의 ‘2-1 교실’ 공간에서 이 도면을 열던 연결은 함께 풀려요.'],
    keep: null, all: null, notes: [], refusal: null, confirm: '도면 삭제' }, mode);
  // The library as the preview has it, one map under each: 학교 > 본관 > 2층 > 2-1 교실.
  const slim: BackgroundSnapshot = { ...library, maps: library.maps.filter(map => map.id !== ROOM_2 && map.id !== CELLAR) };
  validateBackgroundSnapshot(slim);
  const oneChild = { lead: ['‘2층’ 도면을 지워요. 지운 도면은 되돌릴 수 없어요.', GOES, '‘본관’ 도면의 ‘2층’ 공간에서 이 도면을 열던 연결은 함께 풀려요.', '이 도면 아래에 하위 도면이 1개 있어요.'],
    keep: [KEEP, '하위 도면 1개가 ‘본관’ 바로 아래로 올라가요. 이 도면의 공간에서 하위 도면을 열던 연결은 없어져요.'], all: [ALL, '이 도면과 아래 도면 1개를 모두 지워요.'], notes: [], refusal: null };
  assert.deepEqual(words(slim, FLOOR, 'keep-children'), { ...oneChild, confirm: '이 도면 1개만 삭제' });
  assert.deepEqual(words(slim, FLOOR, 'with-children'), { ...oneChild, confirm: '도면 2개 모두 삭제' });
  const deeper = { lead: ['‘본관’ 도면을 지워요. 지운 도면은 되돌릴 수 없어요.', GOES, '‘학교’ 도면의 ‘본관’ 공간에서 이 도면을 열던 연결은 함께 풀려요.',
    '이 도면 아래에 하위 도면이 1개 있어요. 그중 1개는 그 아래에 도면이 더 있어서, 아래 도면은 모두 2개예요.'],
    keep: [KEEP, '하위 도면 1개가 ‘학교’ 바로 아래로 올라가요. 그 아래 도면들은 그대로 따라가요. 이 도면의 공간에서 하위 도면을 열던 연결은 없어져요.'], all: [ALL, '이 도면과 아래 도면 2개를 모두 지워요.'], notes: [], refusal: null };
  assert.deepEqual(words(slim, MAIN, 'keep-children'), { ...deeper, confirm: '이 도면 1개만 삭제' });
  assert.deepEqual(words(slim, MAIN, 'with-children'), { ...deeper, confirm: '도면 3개 모두 삭제' });
  // The library of these tests: the same words with its numbers.
  const twoChildren = { ...oneChild, lead: [...oneChild.lead.slice(0, 3), '이 도면 아래에 하위 도면이 2개 있어요.'],
    keep: [KEEP, '하위 도면 2개가 ‘본관’ 바로 아래로 올라가요. 이 도면의 공간에서 하위 도면을 열던 연결은 없어져요.'], all: [ALL, '이 도면과 아래 도면 2개를 모두 지워요.'] };
  assert.deepEqual(words(library, FLOOR, 'keep-children'), { ...twoChildren, confirm: '이 도면 1개만 삭제' });
  assert.deepEqual(words(library, FLOOR, 'with-children'), { ...twoChildren, confirm: '도면 3개 모두 삭제' });
  const fourBelow = { ...deeper, lead: [...deeper.lead.slice(0, 3), '이 도면 아래에 하위 도면이 2개 있어요. 그중 1개는 그 아래에 도면이 더 있어서, 아래 도면은 모두 4개예요.'],
    keep: [KEEP, '하위 도면 2개가 ‘학교’ 바로 아래로 올라가요. 그 아래 도면들은 그대로 따라가요. 이 도면의 공간에서 하위 도면을 열던 연결은 없어져요.'], all: [ALL, '이 도면과 아래 도면 4개를 모두 지워요.'] };
  assert.deepEqual(words(library, MAIN, 'keep-children'), { ...fourBelow, confirm: '이 도면 1개만 삭제' });
  assert.deepEqual(words(library, MAIN, 'with-children'), { ...fourBelow, confirm: '도면 5개 모두 삭제' });
  // A top map: no map above to name, and no link to it to speak of.
  const top = words(library, SCHOOL, 'keep-children');
  assert.deepEqual(top.lead, ['‘학교’ 도면을 지워요. 지운 도면은 되돌릴 수 없어요.', GOES, '이 도면 아래에 하위 도면이 1개 있어요. 그중 1개는 그 아래에 도면이 더 있어서, 아래 도면은 모두 5개예요.']);
  assert.deepEqual(top.keep, [KEEP, '하위 도면 1개가 최상위 도면이 돼요. 그 아래 도면들은 그대로 따라가요. 이 도면의 공간에서 하위 도면을 열던 연결은 없어져요.']);
  assert.deepEqual([top.all, top.confirm, words(library, SCHOOL, 'with-children').confirm], [[ALL, '이 도면과 아래 도면 5개를 모두 지워요.'], '이 도면 1개만 삭제', '도면 6개 모두 삭제']);
  // Its child hangs there without a link: the sentence ends, and no link that never was is said to go.
  assert.deepEqual(words(library, ANNEX, 'keep-children').keep, [KEEP, '하위 도면 1개가 최상위 도면이 돼요.']);
  assert.deepEqual(words(library, ANNEX, 'keep-children').lead, ['‘별관’ 도면을 지워요. 지운 도면은 되돌릴 수 없어요.', GOES, '이 도면 아래에 하위 도면이 1개 있어요.']);
  // Two spaces of the map above open the map: both names, in one sentence.
  const backDoor = withMap({ ...school, nodes: [...school.nodes, space('뒷문', MAIN)] });
  validateBackgroundSnapshot(backDoor);
  assert.equal(words(backDoor, MAIN, 'keep-children').lead[2], '‘학교’ 도면의 ‘본관’, ‘뒷문’ 공간에서 이 도면을 열던 연결은 함께 풀려요.');
  assert.deepEqual([planMapDelete(backDoor, {}, MAIN, 'keep-children').links, planMapDelete(backDoor, {}, MAIN, 'with-children').links], [2, 4]);
  // A map with a picture under it: the picture goes with the map, and the words must not read as if it stayed.
  const underlay = withMap({ ...cellar, imageUrl: 'https://example.test/plan.png' });
  assert.deepEqual(words(underlay, CELLAR, 'keep-children').lead, ['‘지하’ 도면을 지워요. 지운 도면은 되돌릴 수 없어요.', '도면에 놓은 공간·카메라·기호와 도면 밑그림이 함께 없어져요. 장소와 배경 이미지, 에피소드별 사용 기록은 그대로 남아요.']);
  // What becomes of unsaved edits, in this order: saved along (two names, one sentence), the map's own, those of maps under it.
  assert.deepEqual(words(library, MAIN, 'keep-children', edited(school, floor)).notes, ['‘학교’, ‘2층’ 도면의 저장 안 한 변경은 이번에 함께 저장돼요.']);
  assert.deepEqual(words(library, MAIN, 'with-children', edited(school, main, floor, room1)).notes,
    ['‘학교’ 도면의 저장 안 한 변경은 이번에 함께 저장돼요.', '이 도면의 저장 안 한 변경은 함께 사라져요.', '아래 도면 ‘2-1 교실’, ‘2층’의 저장 안 한 변경도 함께 사라져요.']);
  // A map two levels down is a map under this one all the same: "하위 도면" is the word for the one level right below.
  assert.deepEqual(words(library, MAIN, 'with-children', edited(room1)).notes, ['아래 도면 ‘2-1 교실’의 저장 안 한 변경도 함께 사라져요.']);
  // And a child that is called what the map is called is still told as a map under it.
  const twin = withMap({ ...floor, name: '본관' });
  assert.deepEqual(words(twin, MAIN, 'with-children', edited(at(twin, FLOOR))).notes, ['아래 도면 ‘본관’의 저장 안 한 변경도 함께 사라져요.']);
  // The four refusals. Everything else the dialog says is as without one.
  const refused = (text: ReturnType<typeof words>) => ({ ...text, refusal: null });
  const viewer = words({ ...library, canManage: false }, MAIN, 'keep-children');
  assert.equal(viewer.refusal, '이 계정으로는 도면을 지울 수 없어요.'); assert.deepEqual(refused(viewer), words(library, MAIN, 'keep-children'));
  assert.equal(words(library, MAIN, 'keep-children', outdated(school)).refusal, '‘학교’ 도면이 다른 곳에서 먼저 바뀌었어요. 그 도면의 편집을 끝낸 뒤 다시 삭제해 주세요.');
  assert.equal(words(library, MAIN, 'keep-children', outdated(school, floor)).refusal, '‘학교’, ‘2층’ 도면이 다른 곳에서 먼저 바뀌었어요. 그 도면의 편집을 끝낸 뒤 다시 삭제해 주세요.');
  const unsavable = words(library, MAIN, 'keep-children', draftsOf([main, nameless(main)]));
  assert.equal(unsavable.refusal, '‘본관’ 도면에 저장할 수 없는 변경이 있어요. 그 도면에서 고치거나 편집을 끝낸 뒤 다시 삭제해 주세요.');
  assert.deepEqual(unsavable.notes, ['이 도면의 저장 안 한 변경은 함께 사라져요.']);
  const big = crowd(101), tooMany = words(big, big.maps[0].id, 'keep-children');
  assert.equal(tooMany.refusal, '함께 저장해야 하는 도면이 100개를 넘어서 한 번에 처리할 수 없어요. 하위 도면을 먼저 나누어 정리해 주세요.');
  assert.deepEqual([tooMany.keep, tooMany.confirm], [[KEEP, '하위 도면 101개가 최상위 도면이 돼요.'], '이 도면 1개만 삭제']);
});

const NOTHING = '아직 바뀐 것이 보이지 않아요. 다시 눌러도 돼요. 인터넷이 끊겼던 거라면 잠시 뒤 이 창이 알아서 바뀔 수 있어요.';
const REST = ' 남은 것은 아래에 다시 적었어요. 다시 누르면 남은 것만 이어서 처리해요.';

test('D-15: what a run that stopped has done is read from the library as it is', () => {
  /** The words for a plan that was pressed and stopped after that many of its commands. */
  const stopped = (snapshot: BackgroundSnapshot, id: string, mode: MapDeleteMode, done: number) => {
    const pressed = planMapDelete(snapshot, {}, id, mode);
    assert.ok(done <= pressed.steps.length, `${id} ${mode} has no ${done} commands`);
    return mapDeleteStopText(pressed, runAll(snapshot, pressed.steps.slice(0, done)));
  };
  // Nothing has gone through: whatever the plan, nothing is said to be done. A top map that keeps its child is among
  // them: the save would take a link off, the one to the child, and that is not a link that opened the map.
  for (const [map, mode] of COMBOS) assert.equal(stopped(library, map.id, mode, 0), NOTHING, `${map.name} ${mode}`);
  // Keeping the children: the save took the link to the map off and moved both children.
  assert.equal(stopped(library, MAIN, 'keep-children', 1), `지울 도면을 열던 공간의 연결은 풀었어요. 하위 도면 2개는 위로 옮겼어요.${REST}`);
  // With the children the save moves none.
  assert.equal(stopped(library, MAIN, 'with-children', 1), `지울 도면을 열던 공간의 연결은 풀었어요.${REST}`);
  assert.equal(stopped(library, MAIN, 'with-children', 3), `지울 도면을 열던 공간의 연결은 풀었어요. 도면 5개 가운데 2개를 지웠어요.${REST}`);
  // A map nothing opened: the save has moved its child, and no link is spoken of.
  assert.equal(stopped(library, SCHOOL, 'keep-children', 1), `하위 도면 1개는 위로 옮겼어요.${REST}`);
  // The same for a map that hangs by `parentId` alone and opens a child of its own.
  const BOILER = uid(0x31), opening = withMap({ ...cellar, nodes: [space('보일러실', BOILER)] });
  const nested: BackgroundSnapshot = { ...opening, maps: [...opening.maps, newMap(BOILER, '보일러실', CELLAR)] };
  validateBackgroundSnapshot(nested);
  assert.deepEqual([written(planMapDelete(nested, {}, CELLAR, 'keep-children'), nested), planMapDelete(nested, {}, CELLAR, 'keep-children').links], [['지하', '보일러실'], 0]);
  assert.equal(stopped(nested, CELLAR, 'keep-children', 0), NOTHING);
  assert.equal(stopped(nested, CELLAR, 'keep-children', 1), `하위 도면 1개는 위로 옮겼어요.${REST}`);
  // A map that is deleted, read off the library like the rest.
  assert.equal(stopped(library, CELLAR, 'keep-children', 1), `도면 1개 가운데 1개를 지웠어요.${REST}`);
  // A child that moved up and was then deleted elsewhere is not counted: what is said is what the library shows.
  const pressed = planMapDelete(library, {}, MAIN, 'keep-children'), elsewhere = run(run(library, pressed.steps[0]), remove(CELLAR, 2));
  assert.equal(mapDeleteStopText(pressed, elsewhere), `지울 도면을 열던 공간의 연결은 풀었어요. 하위 도면 1개는 위로 옮겼어요.${REST}`);
  // One that was moved on from there elsewhere, under another map, is counted: it is there, and it is not under the map that is to go.
  const saved = run(library, pressed.steps[0]), onward = run(saved, { type: 'save', kind: 'map', entity: { ...at(saved, CELLAR), parentId: ANNEX }, expectedRevision: 2 });
  assert.equal(mapDeleteStopText(pressed, onward), `지울 도면을 열던 공간의 연결은 풀었어요. 하위 도면 2개는 위로 옮겼어요.${REST}`);
  // And the links are said to be off only once none is left: here two spaces opened the map, and one of them was closed elsewhere.
  const twoDoors = withMap({ ...school, nodes: [...school.nodes, space('뒷문', MAIN)] }), asked = planMapDelete(twoDoors, {}, MAIN, 'keep-children');
  const oneLeft = run(twoDoors, { type: 'save', kind: 'map', entity: { ...at(twoDoors, SCHOOL), nodes: [school.nodes[0], space('뒷문')] }, expectedRevision: 1 });
  assert.deepEqual([asked.links, links(at(oneLeft, SCHOOL))], [2, [MAIN, null]]);
  assert.equal(mapDeleteStopText(asked, oneLeft), NOTHING);
});

test('D-16: a draft the library would refuse to save refuses the plan before anything is sent', () => {
  // The map itself, which the save writes either way: it holds a link.
  for (const mode of MODES) {
    const plan = planMapDelete(library, draftsOf([main, nameless(main)]), MAIN, mode);
    assert.deepEqual([plan.refusal, plan.unsavable, plan.savedAlong, plan.outdated], ['unsavable', ['본관'], [], []], mode);
    // Refused, and still whole: sent as it is, the library would turn the save down, in words that name no map.
    assert.throws(() => run(library, plan.steps[0]), /오브젝트 이름 형식 또는 길이를 확인해 주세요/, mode);
  }
  // The map above, which stays: its edits are not among those the dialog says it will save. It is named as the library names it.
  const above = planMapDelete(library, draftsOf([school, { ...nameless(school), name: '학교 (고침)' }]), MAIN, 'keep-children');
  assert.deepEqual([above.refusal, above.unsavable, above.savedAlong], ['unsavable', ['학교'], []]);
  // A map the save does not write is not looked at: it goes with its edits, whatever they are.
  const lost = planMapDelete(library, draftsOf([cellar, nameless(cellar)]), MAIN, 'with-children');
  assert.deepEqual([lost.refusal, lost.unsavable, lost.lostEdits], [null, [], { own: false, below: ['지하'] }]);
  assert.deepEqual(tree(runAll(library, lost.steps)), ['학교', '별관', '창고<별관']);
  // An old draft is said first; the other list is filled all the same.
  const both = planMapDelete(library, { ...outdated(school), ...draftsOf([main, nameless(main)]) }, MAIN, 'keep-children');
  assert.deepEqual([both.refusal, both.outdated, both.unsavable], ['outdated', ['학교'], ['본관']]);
});

test('D-17: why a run stopped, in plain words', () => {
  const PLAIN = '서버에서 답을 받지 못했어요. 인터넷 연결을 확인해 주세요.';
  // What the main process threw comes in the wrapper of Electron: the sentence it wrote is what is said.
  assert.equal(mapDeleteCauseText(new Error("Error invoking remote method 'background:execute': Error: 다른 사용자가 먼저 변경했습니다. 다시 불러와 주세요.")), '다른 사용자가 먼저 변경했습니다. 다시 불러와 주세요.');
  // A sentence without the wrapper (the store, the preview) is said as it is.
  assert.equal(mapDeleteCauseText(new Error('다른 사용자가 내용을 변경했습니다. 새로고침 후 다시 저장해 주세요.')), '다른 사용자가 내용을 변경했습니다. 새로고침 후 다시 저장해 주세요.');
  // A lost connection, nothing at all, and what is no Error: never an English sentence, never an empty line.
  assert.equal(mapDeleteCauseText(new Error("Error invoking remote method 'background:execute': TypeError: fetch failed")), PLAIN);
  assert.equal(mapDeleteCauseText(new Error('TypeError: fetch failed')), PLAIN);
  assert.equal(mapDeleteCauseText(new Error('')), PLAIN);
  for (const cause of [null, undefined, 'Failed to fetch', 0, { message: '다른 사용자가 먼저 변경했습니다.' }]) assert.equal(mapDeleteCauseText(cause), PLAIN, String(cause));
});
