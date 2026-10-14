import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_VIEW_PREFS_KEY, MAP_VIEW_PREFS_LIMITS, NO_MAP_VIEW_PREFS, hiddenNodeCount, mapRoomIds, mapViewPrefsKey, mapViewPrefsOf, parseMapViewPrefs,
  readMapViewPrefs, selectionWithout, serializeMapViewPrefs, shownMap, storeMapViewPrefs, withHiddenNodes, withSolidSpaces,
} from '../src/features/backgrounds/mapViewPrefs.ts';
import type { MapViewPrefsByMap, MapViewStorage } from '../src/features/backgrounds/mapViewPrefs.ts';
import { validateBackgroundEntity } from '../src/features/backgrounds/domain.ts';
import { createMapDocumentStore, mapSelection, mapViewport, pickAction, singleViewId } from '../src/features/backgrounds/mapDocument.ts';
import type { MapDocumentState, MapDocumentStore } from '../src/features/backgrounds/mapDocument.ts';
import { planGestureCandidates, previewPlanGesture } from '../src/features/backgrounds/mapPlanGesture.ts';
import type { PlanGesture, PlanGestureSnap } from '../src/features/backgrounds/mapPlanGesture.ts';
import { nextPlanSelection, planPileAt } from '../src/features/backgrounds/mapPlanPreview.ts';
import { planMarkCovers, planMarqueeIds, planRect, resolvePlanPress } from '../src/features/backgrounds/mapPlanSelect.ts';
import { nodeElevation } from '../src/features/backgrounds/mapSpatial.ts';
import { spacesAt } from '../src/features/backgrounds/mapStack.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';

const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
/** Ids as a saved map has them: a map and each of its nodes are named by a UUID. */
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const KEY_U1 = 'bflow.background-map.view.v1:u1';

/** The storage of this PC, kept in memory: what the module asks of one and no more. `writes` counts the calls to setItem. */
function memoryStorage(entries: Iterable<readonly [string, string]> = []) {
  const items = new Map<string, string>(entries);
  let writes = 0;
  const storage: MapViewStorage = {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { writes += 1; items.set(key, value); },
  };
  return { storage, items, writes: () => writes };
}

const space = (id: string, x: number, y: number, width: number, height: number, extra: Partial<BackgroundSpace> = {}): BackgroundSpace =>
  ({ id, type: 'space', name: '공간', placeId: null, childMapId: null, x, y, width, height, rotation: 0, shape: 'rect', points: [], locked: false, ...extra });
const symbol = (id: string, x: number, y: number, extra: Partial<BackgroundSymbol> = {}): BackgroundSymbol =>
  ({ id, type: 'symbol', name: '의자', symbol: 'chair', spaceId: null, x, y, width: 40, height: 30, rotation: 0, locked: false, hinge: 'left', swing: 'inward', ...extra });
const camera = (id: string, x: number, y: number, extra: Partial<BackgroundCamera> = {}): BackgroundCamera =>
  ({ id, type: 'camera', name: '카메라', x, y, spaceId: null, angle: 0, fov: 60, viewIds: [], locked: false, ...extra });
const mapOf = (id: string, nodes: BackgroundNode[]): BackgroundMap => ({ id, revision: 3, name: '학교', parentId: null, placeId: null, imageUrl: '', nodes });

// A classroom: a camera and a chair belong to it, a hall and a road lie beside it, and a door stands on its own.
const LENS = camera(uid(1), 250, 200, { spaceId: uid(2) });
const ROOM = space(uid(2), 100, 100, 400, 300, { name: '교실' });
const CHAIR = symbol(uid(3), 200, 250, { spaceId: uid(2) });
const ROAD = space(uid(4), 0, 450, 1000, 80, { name: '도로', surface: 'road' });
const HALL = space(uid(5), 550, 100, 300, 300, { name: '복도' });
const DOOR = symbol(uid(6), 600, 250, { name: '문', symbol: 'door' });
const CLASS = freeze(mapOf(uid(100), [LENS, ROOM, CHAIR, ROAD, HALL, DOOR]));
const OTHER = freeze(mapOf(uid(200), [space(uid(201), 0, 0, 200, 200), symbol(uid(202), 50, 50)]));

test('V-1: settings are written under one key per account and read back the same', () => {
  assert.equal(MAP_VIEW_PREFS_KEY, 'bflow.background-map.view.v1');
  assert.equal(mapViewPrefsKey('u1'), KEY_U1);
  // Two nodes hidden and one room closed, on one map.
  const prefs = withSolidSpaces(withHiddenNodes(new Map(), CLASS, [CHAIR.id, LENS.id], true), CLASS, [ROOM.id], true);
  const { storage, items } = memoryStorage();
  storeMapViewPrefs('u1', prefs, storage);
  assert.deepEqual([...items.keys()], [KEY_U1]);
  const text = `{"maps":[{"id":"${CLASS.id}","hidden":["${CHAIR.id}","${LENS.id}"],"solid":["${ROOM.id}"]}]}`;
  assert.equal(items.get(KEY_U1), text);
  const read = readMapViewPrefs('u1', storage);
  assert.deepEqual(read, prefs);
  assert.deepEqual([...read.keys()], [CLASS.id]);
  assert.deepEqual([...mapViewPrefsOf(read, CLASS.id).hidden], [CHAIR.id, LENS.id]);
  assert.deepEqual([...mapViewPrefsOf(read, CLASS.id).solid], [ROOM.id]);
  // What was read is written as the same text again.
  assert.equal(serializeMapViewPrefs(read), text);
  assert.deepEqual(parseMapViewPrefs(text), read);
});

test('V-2: an account never reads another account, and without an account nothing is read or written', () => {
  const mine = withHiddenNodes(new Map(), CLASS, [CHAIR.id], true), theirs = withSolidSpaces(new Map(), CLASS, [HALL.id], true);
  const { storage, items, writes } = memoryStorage();
  storeMapViewPrefs('u1', mine, storage);
  assert.equal(readMapViewPrefs('u2', storage).size, 0);
  // Another account writes under a key of its own, and each reads what it wrote.
  storeMapViewPrefs('u2', theirs, storage);
  assert.deepEqual([...items.keys()], [KEY_U1, 'bflow.background-map.view.v1:u2']);
  assert.deepEqual(readMapViewPrefs('u1', storage), mine);
  assert.deepEqual(readMapViewPrefs('u2', storage), theirs);
  // Signed out, the account id is empty: nothing is read, not even under the key such an id would make, and nothing is written.
  items.set('bflow.background-map.view.v1:', items.get(KEY_U1)!);
  items.set('bflow.background-map.view.v1', items.get(KEY_U1)!);
  const before = [...items], count = writes();
  assert.equal(readMapViewPrefs('', storage).size, 0);
  storeMapViewPrefs('', theirs, storage);
  assert.equal(writes(), count);
  assert.deepEqual([...items], before);
});

test('V-3: anything of another shape reads as nothing, entry by entry, and the two lists are read apart', () => {
  const entries = ['1', 'null', '"a"', '["m"]', '{"id":3}', '{"id":""}', '{"id":"m"}', '{"id":"m","hidden":"a","solid":"b"}',
    '{"id":"m","hidden":[1,null,{},["a"],true],"solid":[2,false]}', '{"id":"m","hidden":[""],"solid":[]}',
    // A map id that is not a string of one to sixty-four letters throws its entry away, lists it could use and all.
    '{"id":3,"hidden":["a"]}', '{"id":"","solid":["s"]}', '{"id":["m"],"hidden":["a"]}', '{"id":{"length":1},"solid":["a"]}'];
  const texts = [null, undefined, '', 'x', '[]', '{}', '{"maps":{}}', '{"maps":"a"}', 'null', '3', '"maps"', '{"maps":[]}',
    ...entries.map(entry => `{"maps":[${entry}]}`)];
  for (const text of texts) {
    assert.equal(parseMapViewPrefs(text).size, 0, String(text));
    const { storage } = memoryStorage(typeof text === 'string' ? [[KEY_U1, text]] : []);
    assert.equal(readMapViewPrefs('u1', storage).size, 0, `stored: ${text}`);
  }
  // Mixed: what can be used is kept, an id listed twice once. A map listed twice is the later one, in the later place.
  const mixed = parseMapViewPrefs('{"maps":[1,{"id":"a","hidden":["x"]},{"id":""},null,{"id":"b","solid":["y"]},"c",{"id":"a","hidden":["z","z","w"]}]}');
  assert.deepEqual([...mixed.keys()], ['b', 'a']);
  assert.deepEqual([...mapViewPrefsOf(mixed, 'a').hidden], ['z', 'w']);
  assert.equal(mapViewPrefsOf(mixed, 'a').solid.size, 0);
  assert.deepEqual([...mapViewPrefsOf(mixed, 'b').solid], ['y']);
  assert.equal(mapViewPrefsOf(mixed, 'b').hidden.size, 0);
  // The later one with nothing in it is still the later one.
  assert.equal(parseMapViewPrefs('{"maps":[{"id":"a","hidden":["x"]},{"id":"a"}]}').size, 0);
  // The two lists are read apart: one that is no list does not throw the other away.
  const apart = parseMapViewPrefs('{"maps":[{"id":"m","hidden":["a"],"solid":"x"},{"id":"n","hidden":7,"solid":["s"]}]}');
  assert.deepEqual([...apart.keys()], ['m', 'n']);
  assert.deepEqual([...mapViewPrefsOf(apart, 'm').hidden], ['a']);
  assert.equal(mapViewPrefsOf(apart, 'm').solid.size, 0);
  assert.equal(mapViewPrefsOf(apart, 'n').hidden.size, 0);
  assert.deepEqual([...mapViewPrefsOf(apart, 'n').solid], ['s']);
  // A list with nothing in it that can be used reads as the one empty set, as an empty list does.
  const unusable = mapViewPrefsOf(parseMapViewPrefs('{"maps":[{"id":"k","hidden":["q"],"solid":[3,""]}]}'), 'k');
  assert.deepEqual([...unusable.hidden], ['q']);
  assert.equal(unusable.solid, NO_MAP_VIEW_PREFS.solid);
});

test('V-4: a hundred maps, a thousand ids and sixty-four letters at most, and a full list makes room with ids that are gone', () => {
  assert.deepEqual(MAP_VIEW_PREFS_LIMITS, { maps: 100, ids: 1000, idLength: 64 });
  // A hundred and thirty maps stored: the newest hundred are read, the thirty-first first.
  const stored = Array.from({ length: 130 }, (_, index) => ({ id: uid(index), hidden: ['a'] }));
  const maps = parseMapViewPrefs(JSON.stringify({ maps: stored }));
  assert.equal(maps.size, 100);
  assert.deepEqual([...maps.keys()], stored.slice(30).map(entry => entry.id));
  // A thousand five hundred ids in each list: the first thousand of each.
  const ids = Array.from({ length: 1500 }, (_, index) => uid(index)), backwards = [...ids].reverse();
  const long = mapViewPrefsOf(parseMapViewPrefs(JSON.stringify({ maps: [{ id: 'm', hidden: ids, solid: backwards }] })), 'm');
  assert.deepEqual([...long.hidden], ids.slice(0, 1000));
  assert.deepEqual([...long.solid], backwards.slice(0, 1000));
  // Sixty-four letters at most: a longer map id takes its entry with it, a longer node id goes alone.
  const sized = parseMapViewPrefs(JSON.stringify({ maps: [
    { id: 'm'.repeat(64), hidden: ['a'.repeat(64), 'b'.repeat(65)], solid: ['c'.repeat(65)] },
    { id: 'n'.repeat(65), hidden: ['a'] },
  ] }));
  assert.deepEqual([...sized.keys()], ['m'.repeat(64)]);
  assert.deepEqual([...mapViewPrefsOf(sized, 'm'.repeat(64)).hidden], ['a'.repeat(64)]);
  assert.equal(mapViewPrefsOf(sized, 'm'.repeat(64)).solid.size, 0);

  // A full list, three of its ids of nodes that are gone: hiding one more node lets those three go and takes it in.
  const nodes = Array.from({ length: 998 }, (_, index) => symbol(uid(1000 + index), index, 0));
  const crowded = mapOf(uid(300), nodes), dead = [uid(9001), uid(9002), uid(9003)], listed = nodes.slice(0, 997).map(node => node.id);
  const full = parseMapViewPrefs(JSON.stringify({ maps: [{ id: crowded.id, hidden: [...listed.slice(0, 500), ...dead, ...listed.slice(500)] }] }));
  assert.equal(mapViewPrefsOf(full, crowded.id).hidden.size, 1000);
  const roomy = mapViewPrefsOf(withHiddenNodes(full, crowded, [nodes[997].id], true), crowded.id).hidden;
  assert.equal(roomy.size, 998);
  assert.deepEqual([...roomy], [...listed, nodes[997].id]);
  // A full list with one id of a node that is gone: that one goes and the new node comes in. The list is as long as
  // before and still another list, so the settings that come back are new.
  const tight = Array.from({ length: 1000 }, (_, index) => symbol(uid(2000 + index), index, 0)), snug = mapOf(uid(302), tight);
  const onList = tight.slice(0, 999).map(node => node.id);
  const brim = parseMapViewPrefs(JSON.stringify({ maps: [{ id: snug.id, hidden: [...onList.slice(0, 500), dead[0], ...onList.slice(500)] }] }));
  assert.equal(mapViewPrefsOf(brim, snug.id).hidden.size, 1000);
  const swapped = withHiddenNodes(brim, snug, [tight[999].id], true);
  assert.notEqual(swapped, brim);
  assert.equal(mapViewPrefsOf(swapped, snug.id).hidden.size, 1000);
  assert.deepEqual([...mapViewPrefsOf(swapped, snug.id).hidden], [...onList, tight[999].id]);
  // A list that is not full keeps the ids of nodes that are gone.
  const few = parseMapViewPrefs(JSON.stringify({ maps: [{ id: crowded.id, hidden: [...dead, listed[0]] }] }));
  assert.deepEqual([...mapViewPrefsOf(withHiddenNodes(few, crowded, [listed[1]], true), crowded.id).hidden], [...dead, listed[0], listed[1]]);
  // A list full of nodes that are on the map takes no more: the same settings come back.
  const crammed = Array.from({ length: 1001 }, (_, index) => symbol(uid(3000 + index), index, 0)), packed = mapOf(uid(301), crammed);
  const thousand = withHiddenNodes(new Map(), packed, crammed.slice(0, 1000).map(node => node.id), true);
  assert.equal(mapViewPrefsOf(thousand, packed.id).hidden.size, 1000);
  assert.equal(withHiddenNodes(thousand, packed, [crammed[1000].id], true), thousand);
});

test('V-5: a storage that is missing or throws is no error', () => {
  const prefs = withHiddenNodes(new Map(), CLASS, [CHAIR.id], true);
  assert.equal(readMapViewPrefs('u1', null).size, 0);
  assert.doesNotThrow(() => storeMapViewPrefs('u1', prefs, null));
  // Blocked, or full: reading and writing both throw.
  const blocked: MapViewStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } };
  assert.equal(readMapViewPrefs('u1', blocked).size, 0);
  assert.doesNotThrow(() => storeMapViewPrefs('u1', prefs, blocked));
  // Without a storage handed in, the one of this PC. Reading it is no error either (what it holds is not asked here).
  assert.doesNotThrow(() => readMapViewPrefs('u1'));
});

test('V-6: a change that changes nothing gives the same object back, and each list leaves the other as it was', () => {
  const start = withSolidSpaces(withHiddenNodes(new Map(), CLASS, [CHAIR.id], true), CLASS, [ROOM.id], true);
  const was = mapViewPrefsOf(start, CLASS.id);
  assert.equal(withHiddenNodes(start, CLASS, [CHAIR.id], true), start, 'hidden again');
  assert.equal(withHiddenNodes(start, CLASS, [LENS.id], false), start, 'shown while it is shown');
  assert.equal(withHiddenNodes(start, CLASS, [uid(999)], true), start, 'a node the map does not have');
  assert.equal(withSolidSpaces(start, CLASS, [DOOR.id], true), start, 'a symbol is no box');
  assert.equal(withSolidSpaces(start, CLASS, [ROOM.id], true), start, 'closed again');
  assert.equal(withHiddenNodes(start, CLASS, [], true), start, 'no id at all');
  // A box changes: the hidden list is the same set, with the same ids.
  const boxed = withSolidSpaces(start, CLASS, [HALL.id], true), afterBox = mapViewPrefsOf(boxed, CLASS.id);
  assert.notEqual(boxed, start);
  assert.equal(afterBox.hidden, was.hidden);
  assert.deepEqual([...afterBox.hidden], [CHAIR.id]);
  assert.deepEqual([...afterBox.solid], [ROOM.id, HALL.id]);
  // The eye changes: the closed rooms are the same set, with the same ids.
  const eyed = withHiddenNodes(boxed, CLASS, [LENS.id], true), afterEye = mapViewPrefsOf(eyed, CLASS.id);
  assert.notEqual(eyed, boxed);
  assert.equal(afterEye.solid, afterBox.solid);
  assert.deepEqual([...afterEye.solid], [ROOM.id, HALL.id]);
  assert.deepEqual([...afterEye.hidden], [CHAIR.id, LENS.id]);
  // Every eye open again: the boxes stay.
  const open = mapViewPrefsOf(withHiddenNodes(eyed, CLASS, [CHAIR.id, LENS.id], false), CLASS.id);
  assert.equal(open.hidden, NO_MAP_VIEW_PREFS.hidden, 'a list emptied is the one empty set');
  assert.equal(open.solid, afterBox.solid);
  // What was handed in is left as it was.
  assert.equal(mapViewPrefsOf(start, CLASS.id), was);
  assert.deepEqual([...was.hidden], [CHAIR.id]);
  assert.deepEqual([...was.solid], [ROOM.id]);
});

test('V-7: the id of a node that is gone stays listed, so the node comes back as it was', () => {
  const prefs = withSolidSpaces(withHiddenNodes(new Map(), CLASS, [LENS.id], true), CLASS, [ROOM.id], true);
  // An undo took the hidden camera and the closed room off the map.
  const gone = mapOf(CLASS.id, CLASS.nodes.filter(node => node !== LENS && node !== ROOM));
  const listed = mapViewPrefsOf(prefs, CLASS.id);
  assert.equal(hiddenNodeCount(gone, listed.hidden), 0);
  assert.equal(shownMap(gone, listed.hidden), gone);
  // Other eyes and boxes, on and off again: the two ids stay where they are.
  const eye = withHiddenNodes(withHiddenNodes(prefs, gone, [CHAIR.id], true), gone, [CHAIR.id], false);
  assert.deepEqual([...mapViewPrefsOf(eye, CLASS.id).hidden], [LENS.id]);
  const box = withSolidSpaces(withSolidSpaces(eye, gone, [HALL.id], true), gone, [HALL.id], false), kept = mapViewPrefsOf(box, CLASS.id);
  assert.deepEqual([...kept.hidden], [LENS.id]);
  assert.deepEqual([...kept.solid], [ROOM.id]);
  // A redo brings the two back: hidden and closed, as they were.
  assert.equal(hiddenNodeCount(CLASS, kept.hidden), 1);
  assert.equal(shownMap(CLASS, kept.hidden).nodes.some(node => node.id === LENS.id), false);
  assert.ok(kept.solid.has(ROOM.id));
  // A change that changes nothing does not tidy up on its way.
  assert.equal(withHiddenNodes(box, gone, [uid(999)], true), box, 'a node the map does not have');
  assert.equal(withSolidSpaces(box, gone, [DOOR.id], true), box, 'a symbol is no box');
  assert.equal(withHiddenNodes(box, gone, [LENS.id], true), box, 'the camera that is gone, hidden again');
  // Every id of a list taken out, as showing everything or opening every box does: the ids of nodes that are gone go with them.
  const noEyes = withHiddenNodes(box, gone, [...kept.hidden], false);
  assert.equal(mapViewPrefsOf(noEyes, CLASS.id).hidden.size, 0);
  assert.deepEqual([...mapViewPrefsOf(noEyes, CLASS.id).solid], [ROOM.id]);
  // With both lists empty the map has no entry.
  const nothing = withSolidSpaces(noEyes, gone, [...kept.solid], false);
  assert.equal(nothing.has(CLASS.id), false);
  assert.equal(nothing.size, 0);
  assert.equal(mapViewPrefsOf(nothing, CLASS.id), NO_MAP_VIEW_PREFS);
});

test('V-8: the map changed last is the newest, and the oldest go first', () => {
  const maps = Array.from({ length: 105 }, (_, index) => mapOf(uid(5000 + index), [space(uid(6000 + index), 0, 0, 200, 200), symbol(uid(7000 + index), 50, 50)]));
  let prefs: MapViewPrefsByMap = new Map();
  for (const map of maps) prefs = withHiddenNodes(prefs, map, [map.nodes[1].id], true);
  assert.equal(prefs.size, 100);
  assert.deepEqual([...prefs.keys()], maps.slice(5).map(map => map.id));
  // The sixth changed again: now it is the newest.
  const sixth = maps[5], again = withSolidSpaces(prefs, sixth, [sixth.nodes[0].id], true);
  assert.equal(again.size, 100);
  assert.deepEqual([...again.keys()], [...maps.slice(6), sixth].map(map => map.id));
  // Written oldest first, and read back in that order.
  const text = serializeMapViewPrefs(again);
  assert.deepEqual((JSON.parse(text) as { maps: { id: string }[] }).maps.map(entry => entry.id), [...again.keys()]);
  assert.deepEqual([...parseMapViewPrefs(text).keys()], [...again.keys()]);
});

test('V-9: only spaces are closed, roads included', () => {
  const start: MapViewPrefsByMap = new Map();
  assert.equal(withSolidSpaces(start, CLASS, [DOOR.id], true), start, 'a symbol');
  assert.equal(withSolidSpaces(start, CLASS, [LENS.id], true), start, 'a camera');
  assert.equal(withSolidSpaces(start, CLASS, [uid(999)], true), start, 'no node of the map');
  assert.deepEqual([...mapViewPrefsOf(withSolidSpaces(start, CLASS, [DOOR.id, ROOM.id, LENS.id], true), CLASS.id).solid], [ROOM.id]);
  // A road is a space: it is taken in, and 3D draws it flat as it is.
  assert.deepEqual([...mapViewPrefsOf(withSolidSpaces(start, CLASS, [ROAD.id], true), CLASS.id).solid], [ROAD.id]);
  // The rooms that every box of the inspector closes leave the road out.
  assert.deepEqual(mapRoomIds(CLASS), [ROOM.id, HALL.id]);
  // Any node can be hidden.
  assert.deepEqual([...mapViewPrefsOf(withHiddenNodes(start, CLASS, [DOOR.id, LENS.id, ROAD.id, ROOM.id], true), CLASS.id).hidden],
    [DOOR.id, LENS.id, ROAD.id, ROOM.id]);
});

test('V-10: shownMap is the map itself unless something of it is hidden, and a hidden room leaves its members in', () => {
  assert.equal(shownMap(CLASS, new Set()), CLASS);
  assert.equal(shownMap(CLASS, undefined), CLASS);
  assert.equal(shownMap(CLASS, NO_MAP_VIEW_PREFS.hidden), CLASS);
  assert.equal(shownMap(CLASS, new Set([uid(998), uid(999)])), CLASS, 'only nodes that are gone');
  const shown = shownMap(CLASS, new Set([DOOR.id, uid(999)]));
  assert.notEqual(shown, CLASS);
  assert.deepEqual(shown.nodes.map(node => node.id), [LENS.id, ROOM.id, CHAIR.id, ROAD.id, HALL.id]);
  assert.ok(shown.nodes.every(node => CLASS.nodes.includes(node)), 'the same node objects');
  assert.equal(shown.id, CLASS.id);
  assert.equal(shown.revision, CLASS.revision);
  assert.equal(shown.name, CLASS.name);
  assert.equal(CLASS.nodes.length, 6, 'the map itself keeps every node');
  // The room alone is hidden: what belongs to it stays, the very same objects.
  const roomless = shownMap(CLASS, new Set([ROOM.id]));
  assert.deepEqual(roomless.nodes.map(node => node.id), [LENS.id, CHAIR.id, ROAD.id, HALL.id, DOOR.id]);
  assert.equal(roomless.nodes.find(node => node.id === CHAIR.id), CHAIR);
  assert.equal(roomless.nodes.find(node => node.id === LENS.id), LENS);
});

test('V-11: hiddenNodeCount counts the hidden nodes that are there, and mapRoomIds lists the rooms', () => {
  assert.equal(hiddenNodeCount(CLASS, new Set([DOOR.id, LENS.id, uid(999)])), 2);
  assert.equal(hiddenNodeCount(CLASS, new Set([uid(999)])), 0);
  assert.equal(hiddenNodeCount(CLASS, new Set()), 0);
  assert.equal(hiddenNodeCount(undefined, new Set([DOOR.id])), 0);
  assert.deepEqual(mapRoomIds(CLASS), [ROOM.id, HALL.id]);
  assert.deepEqual(mapRoomIds(mapOf(uid(101), [HALL, ROAD, ROOM])), [HALL.id, ROOM.id], 'in the order of the map');
  assert.deepEqual(mapRoomIds(mapOf(uid(102), [DOOR, LENS, ROAD])), []);
});

test('V-12: what is hidden is never selected, on the plan and in 3D, and moved tells when the properties change', () => {
  const [A, B, C, D] = [51, 52, 53, 54].map(uid);
  const room = freeze(mapOf(uid(120), [symbol(A, 100, 100), symbol(B, 200, 100), symbol(C, 300, 100), symbol(D, 400, 100)]));
  /** What the properties show, worked out from a state of the document alone: the plan shows a group as one, 3D the node in hand and a line for the group. */
  const shows = (state: MapDocumentState, map: BackgroundMap, plan: boolean) => {
    const view = mapViewport(state, map.id), selection = mapSelection(map, view.selectedIds), group = selection.ids.length > 1;
    if (plan) return group ? 'a group' : `node ${selection.primaryId}`;
    return `node ${singleViewId(map, selection, view.selectedId)}${group ? ' and the line of the group' : ''}`;
  };
  /**
   * The editor's way (4.5), with the selection as it was at the press: the selection without the hidden ones is written, and in
   * 3D, with two or more left, the node in hand is put back or let go, as the editor's select() picks one there.
   */
  const hide = (store: MapDocumentStore, map: BackgroundMap, ids: readonly string[], plan: boolean) => {
    const view = mapViewport(store.getState(), map.id), selection = mapSelection(map, view.selectedIds);
    const left = selectionWithout(map, selection, view.selectedId, ids, plan);
    if (left.changed) {
      store.dispatch({ type: 'select-many', mapId: map.id, ids: left.ids });
      if (!plan && left.ids.length > 1) store.dispatch(pickAction(map.id, left.inHand, true, selection));
    }
    return { left, selection };
  };
  let cases = 0;
  /**
   * One case: `group` is selected, then `hand` is picked in 3D (undefined: nothing is, so the primary is in hand), then `gone` are
   * hidden on the plan (`plan`) or in 3D, on the map as it is (`map`). Four things are checked: the group left, the node in hand,
   * changed and moved. And in every case: nothing hidden is selected, in hand or stored as the pick of the 3D view, and moved is
   * whether the properties show something else after than before.
   */
  const check = (label: string, plan: boolean, group: string[], hand: string | null | undefined, gone: string[],
    expected: { ids: string[]; inHand: string | null; changed: boolean; moved: boolean }, map: BackgroundMap = room) => {
    cases += 1;
    const store = createMapDocumentStore();
    if (group.length) store.dispatch({ type: 'select-many', mapId: map.id, ids: group });
    if (hand !== undefined) store.dispatch({ type: 'pick-one', mapId: map.id, id: hand });
    const before = store.getState(), { left, selection } = hide(store, map, gone, plan), after = store.getState();
    const view = mapViewport(after, map.id), now = mapSelection(map, view.selectedIds), inHand = singleViewId(map, now, view.selectedId);
    assert.deepEqual(now.ids, expected.ids, `${label}: the group left`);
    assert.equal(inHand, expected.inHand, `${label}: the node in hand`);
    assert.equal(left.changed, expected.changed, `${label}: changed`);
    assert.equal(left.moved, expected.moved, `${label}: moved`);
    for (const id of gone) {
      assert.equal(view.selectedIds.includes(id), false, `${label}: a hidden node is selected`);
      assert.notEqual(inHand, id, `${label}: a hidden node is in hand`);
      assert.notEqual(view.selectedId, id, `${label}: a hidden node is the stored pick`);
    }
    assert.equal(left.moved, shows(before, map, plan) !== shows(after, map, plan), `${label}: moved is not what the properties show`);
    // Nothing to write: the very array of the group comes back, and the document is as it was.
    if (!left.changed) {
      assert.equal(left.ids, selection.ids, `${label}: the same array`);
      assert.equal(after, before, `${label}: nothing written`);
    }
    return { before, after };
  };

  // On the plan.
  check('plan: the one selected', true, [A], undefined, [A], { ids: [], inHand: null, changed: true, moved: true });
  check('plan: one of three', true, [A, B, C], undefined, [B], { ids: [A, C], inHand: C, changed: true, moved: false });
  check('plan: the primary of three', true, [A, B, C], undefined, [C], { ids: [A, B], inHand: B, changed: true, moved: false });
  // D was picked in 3D, outside the group: the group stays and the node in hand goes back to its primary. That is written,
  // and nothing the plan shows changes.
  check('plan: D, picked in 3D', true, [A, B, C], D, [D], { ids: [A, B, C], inHand: C, changed: true, moved: false });
  check('plan: one of two', true, [A, B], undefined, [A], { ids: [B], inHand: B, changed: true, moved: true });
  // The plan keeps its group: what was in hand in 3D has no say here.
  check('plan: one of two, D picked in 3D', true, [A, B], D, [A], { ids: [B], inHand: B, changed: true, moved: true });
  check('plan: nothing selected', true, [], undefined, [A], { ids: [], inHand: null, changed: false, moved: false });
  check('plan: a node not selected', true, [A, B], undefined, [C], { ids: [A, B], inHand: B, changed: false, moved: false });

  // In 3D.
  check('3D: the one selected', false, [A], undefined, [A], { ids: [], inHand: null, changed: true, moved: true });
  check('3D: C of three, in hand', false, [A, B, C], C, [C], { ids: [A, B], inHand: null, changed: true, moved: true });
  check('3D: B of three, A in hand', false, [A, B, C], A, [B], { ids: [A, C], inHand: A, changed: true, moved: false });
  check('3D: D in hand, outside three', false, [A, B, C], D, [D], { ids: [A, B, C], inHand: null, changed: true, moved: true });
  check('3D: B of three, D in hand', false, [A, B, C], D, [B], { ids: [A, C], inHand: D, changed: true, moved: false });
  check('3D: B of three, nothing in hand', false, [A, B, C], null, [B], { ids: [A, C], inHand: null, changed: true, moved: false });
  check('3D: B of two, in hand', false, [A, B], B, [B], { ids: [A], inHand: A, changed: true, moved: true });
  // The one left is in hand already, but the line of the group goes.
  check('3D: B of two, A in hand', false, [A, B], A, [B], { ids: [A], inHand: A, changed: true, moved: true });
  // J13: the group shrinks to one while D, outside it, is in hand. D stays in hand and is the selection, and the stored pick as
  // well; the last of the group is let go. The same when the primary is hidden.
  for (const [name, one] of [['A', A], ['B', B]] as const) {
    const { after } = check(`3D: ${name} of two, D in hand`, false, [A, B], D, [one], { ids: [D], inHand: D, changed: true, moved: true });
    assert.equal(mapViewport(after, room.id).selectedId, D, `3D: ${name} of two, D in hand: the stored pick`);
  }
  check('3D: D itself, in hand outside two', false, [A, B], D, [D], { ids: [A, B], inHand: null, changed: true, moved: true });
  check('3D: A of two, nothing in hand', false, [A, B], null, [A], { ids: [B], inHand: B, changed: true, moved: true });
  check('3D: three at once', false, [A, B, C], undefined, [A, B, C], { ids: [], inHand: null, changed: true, moved: true });
  check('3D: two of three at once, D in hand', false, [A, B, C], D, [A, B], { ids: [D], inHand: D, changed: true, moved: true });
  check('3D: three at once, D in hand', false, [A, B, C], D, [A, B, C], { ids: [D], inHand: D, changed: true, moved: true });

  // A group that grows again. D was picked in 3D while A and B were selected, and an undo has taken B off the map since: the
  // group reads as A alone, A is in hand, and D is still the stored pick. Hiding D shows nothing else, and yet it is written.
  const withoutB = freeze(mapOf(room.id, room.nodes.filter(node => node.id !== B)));
  const { before, after } = check('3D: D, the stored pick, while B is gone', false, [A, B], D, [D], { ids: [A], inHand: A, changed: true, moved: false }, withoutB);
  // Asked the old way, about the node in hand alone, there is nothing to write here: the group loses none and A is in hand.
  // Then the redo that brings B back would put D in hand again, hidden.
  const stored = mapViewport(before, room.id), shrunk = mapSelection(withoutB, stored.selectedIds);
  assert.equal(shrunk.ids.includes(D) || singleViewId(withoutB, shrunk, stored.selectedId) === D, false);
  assert.equal(singleViewId(room, mapSelection(room, stored.selectedIds), stored.selectedId), D);
  // Written instead: the stored pick goes, and with it the id of B, which was not on the map. With B back, A is in hand, alone.
  const written = mapViewport(after, room.id);
  assert.deepEqual(written.selectedIds, [A]);
  assert.equal(singleViewId(room, mapSelection(room, written.selectedIds), written.selectedId), A);
  assert.equal(cases, 24, 'every case of the table');
});

test('V-13: the plan asks what is under the pointer on the shown map, and what is written keeps every node', () => {
  // One outline, two floors: the upper floor is later in the map, so it is on top there. A new symbol takes the space on top, and its floor.
  const lower = space(uid(11), 100, 100, 300, 200), upper = space(uid(12), 100, 100, 300, 200, { elevation: 180 });
  const floors = freeze(mapOf(uid(110), [lower, upper])), spot = { x: 200, y: 150 };
  assert.equal(spacesAt(floors, spot)[0], upper);
  assert.equal(nodeElevation(spacesAt(floors, spot)[0]), 180);
  const below = spacesAt(shownMap(floors, new Set([upper.id])), spot)[0];
  assert.equal(below, lower);
  assert.equal(nodeElevation(below), 0);
  // A small room on a big one: hidden, the big one is on top there. With both hidden, none: the ground.
  const big = space(uid(13), 0, 0, 600, 400), small = space(uid(14), 100, 100, 100, 100), inSmall = { x: 150, y: 150 };
  const rooms = freeze(mapOf(uid(111), [big, small]));
  assert.equal(spacesAt(rooms, inSmall)[0], small);
  assert.equal(spacesAt(shownMap(rooms, new Set([small.id])), inSmall)[0], big);
  assert.equal(spacesAt(shownMap(rooms, new Set([small.id, big.id])), inSmall)[0], undefined);
  // Whatever map was asked, the maps themselves keep every node.
  assert.equal(floors.nodes.length, 2);
  assert.equal(rooms.nodes.length, 2);

  // A small room in a middle room in a big room, the middle one hidden: the pile at a press is the two that are shown, and a
  // press on the same spot steps between those two.
  const outer = space(uid(15), 0, 0, 800, 600), middle = space(uid(16), 100, 100, 400, 300), inner = space(uid(17), 200, 200, 100, 100);
  const nest = freeze(mapOf(uid(112), [outer, middle, inner])), press = { x: 250, y: 250 }, noMiddle = new Set([middle.id]);
  const onPress = (node: BackgroundNode) => planMarkCovers(node, press);
  assert.deepEqual(planPileAt(nest, inner.id, press, undefined, onPress), [inner.id, middle.id, outer.id]);
  const pile = planPileAt(shownMap(nest, noMiddle), inner.id, press, undefined, onPress);
  assert.deepEqual(pile, [inner.id, outer.id]);
  const step = resolvePlanPress({ canEdit: true, shift: false, hit: inner, pile, selection: { ids: [inner.id], primaryId: inner.id }, again: true,
    node: id => nest.nodes.find(node => node.id === id) }).click;
  assert.deepEqual(step, { kind: 'step', ids: [inner.id, outer.id], from: inner.id, spaces: true });
  // The companion plan steps on the shown map as well: past the hidden middle room to the big one. On the whole map it would be the middle one.
  assert.equal(nextPlanSelection(shownMap(nest, noMiddle), inner.id, inner.id, undefined, undefined, press, true), outer.id);
  assert.equal(nextPlanSelection(nest, inner.id, inner.id, undefined, undefined, press, true), middle.id);

  // Three cameras on one spot, the middle one hidden: two take turns there.
  const first = camera(uid(21), 500, 340), second = camera(uid(22), 500, 340), third = camera(uid(23), 500, 340);
  const cameras = freeze(mapOf(uid(113), [first, second, third])), lens = { x: 500, y: 340 };
  const onLens = (node: BackgroundNode) => planMarkCovers(node, lens);
  assert.deepEqual(planPileAt(cameras, first.id, lens, undefined, onLens), [first.id, second.id, third.id]);
  assert.deepEqual(planPileAt(shownMap(cameras, new Set([second.id])), first.id, lens, undefined, onLens), [first.id, third.id]);

  // A selection box over two symbols, one of them hidden: the shown one alone.
  const left = symbol(uid(31), 100, 100), right = symbol(uid(32), 200, 100), box = planRect({ x: 90, y: 90 }, { x: 260, y: 140 });
  const pair = freeze(mapOf(uid(114), [left, right]));
  assert.deepEqual(planMarqueeIds(pair, box), [left.id, right.id]);
  assert.deepEqual(planMarqueeIds(shownMap(pair, new Set([right.id])), box), [left.id]);

  // Snapping: a chair dragged up to a hidden table. The table's six lines, three on each axis, are no target.
  const hall = space(uid(41), 0, 0, 900, 600);
  const chair = symbol(uid(42), 100, 207, { spaceId: hall.id });
  const table = symbol(uid(43), 600, 200, { name: '탁자', symbol: 'table', width: 80, height: 60, spaceId: hall.id });
  const school = freeze(mapOf(uid(115), [hall, chair, table])), noTable = new Set([table.id]);
  const drag: PlanGesture = { mode: 'move', nodeId: chair.id };
  const everything = planGestureCandidates(drag, school), shown = planGestureCandidates(drag, shownMap(school, noTable));
  const tableLines = { x: [600, 640, 680], y: [200, 230, 260] };
  for (const axis of ['x', 'y'] as const) {
    assert.deepEqual(everything[axis].filter(line => tableLines[axis].includes(line.at)).map(line => line.at), tableLines[axis], `${axis}: the table's lines`);
    assert.deepEqual(shown[axis], everything[axis].filter(line => !tableLines[axis].includes(line.at)), `${axis}: every line but the table's`);
  }
  assert.deepEqual(shown.points, everything.points);
  // The chair is let go 3 short of the table's left line: with the table's lines it would stick there, with the shown ones it
  // lands where it was let go. Either way the preview is worked out on the whole map, so the table is in it and it can be saved.
  const start = { x: 120, y: 222 }, end = { x: 617, y: 222 };
  const snap = (candidates: PlanGestureSnap['candidates']): PlanGestureSnap => ({ candidates, tolerance: 6, reach: 48 });
  assert.equal(previewPlanGesture(drag, school, start, end, snap(everything))!.map.nodes.find(node => node.id === chair.id)!.x, 600);
  const free = previewPlanGesture(drag, school, start, end, snap(shown))!;
  assert.equal(free.map.nodes.find(node => node.id === chair.id)!.x, 597);
  assert.deepEqual(free.guides, []);
  assert.deepEqual(free.map.nodes.map(node => node.id), [hall.id, chair.id, table.id]);
  assert.ok(free.map.nodes.includes(table), 'the hidden table, as it was');
  assert.doesNotThrow(() => validateBackgroundEntity('map', free.map));
  // Worked out on the shown map instead, the drag would take the hidden table off the map.
  assert.equal(previewPlanGesture(drag, shownMap(school, noTable), start, end, snap(shown))!.map.nodes.some(node => node.id === table.id), false);
  // The hall dragged while its table is hidden: the table goes along, as a member does.
  const move: PlanGesture = { mode: 'move', nodeId: hall.id };
  const moved = previewPlanGesture(move, school, { x: 450, y: 300 }, { x: 470, y: 310 }, snap(planGestureCandidates(move, shownMap(school, noTable))))!;
  const carried = moved.map.nodes.find(node => node.id === table.id)!;
  assert.deepEqual([carried.x, carried.y], [620, 210]);
  assert.deepEqual(moved.map.nodes.map(node => node.id), [hall.id, chair.id, table.id]);
  assert.doesNotThrow(() => validateBackgroundEntity('map', moved.map));
  assert.equal(school.nodes.length, 3);
});

test('V-14: a map without settings reads the one empty value', () => {
  const prefs = withHiddenNodes(withSolidSpaces(new Map(), OTHER, [OTHER.nodes[0].id], true), CLASS, [DOOR.id], true);
  assert.equal(mapViewPrefsOf(prefs, uid(777)), NO_MAP_VIEW_PREFS);
  assert.equal(mapViewPrefsOf(prefs, null), NO_MAP_VIEW_PREFS);
  assert.equal(mapViewPrefsOf(prefs, undefined), NO_MAP_VIEW_PREFS);
  assert.equal(mapViewPrefsOf(new Map(), CLASS.id), NO_MAP_VIEW_PREFS);
  assert.equal(NO_MAP_VIEW_PREFS.hidden, NO_MAP_VIEW_PREFS.solid);
  assert.equal(NO_MAP_VIEW_PREFS.hidden.size, 0);
  // Two maps, each with an entry of its own. One map read twice is the same object.
  const classroom = mapViewPrefsOf(prefs, CLASS.id), other = mapViewPrefsOf(prefs, OTHER.id);
  assert.notEqual(classroom, other);
  assert.deepEqual([...classroom.hidden], [DOOR.id]);
  assert.equal(classroom.solid, NO_MAP_VIEW_PREFS.solid);
  assert.deepEqual([...other.solid], [OTHER.nodes[0].id]);
  assert.equal(other.hidden, NO_MAP_VIEW_PREFS.hidden);
  assert.equal(mapViewPrefsOf(prefs, CLASS.id), classroom);
  assert.equal(mapViewPrefsOf(prefs, OTHER.id), other);
});
