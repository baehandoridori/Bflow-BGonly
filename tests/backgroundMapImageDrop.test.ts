import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPlace, BackgroundSnapshot, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';
import { validateBackgroundSnapshot } from '../src/features/backgrounds/domain.ts';
import { spacesAt } from '../src/features/backgrounds/mapStack.ts';
import { mapImagePlaceWords, mapImageTargetWords, resolveMapImageTarget } from '../src/features/backgrounds/mapImageDrop.ts';
import type { MapImageTarget } from '../src/features/backgrounds/mapImageDrop.ts';

// Pictures added to a map by a drop, a paste or the picker: the rules and the words of the pure module, asked of the real
// modules of the library. One base library: the places 학교 > 2-1 교실, and two maps with the same objects, 2층 with a place of
// its own (학교) and 별관 without. What a saved map may not hold (the id of a place that is gone, a camera whose property
// names a space the map does not have) is only ever in a map handed in as a draft, and in the maps the editor shows.

const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const [SCHOOL, CLASS] = [0x11, 0x12].map(uid);
const [FLOOR, ANNEX] = [0x21, 0x22].map(uid);
const [CLASSROOM, CLOSET, STORE, LOCKED_STORE, LOCKED_ROOM, ROAD] = [0x31, 0x32, 0x33, 0x34, 0x35, 0x36].map(uid);
const [CLASS_CAMERA, STORE_CAMERA, OUT_CAMERA, FLOATING_CAMERA, LOCKED_CAMERA, LOCKED_STORE_CAMERA, CLOSET_CAMERA, LOCKED_ROOM_CAMERA] = [0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48].map(uid);
const [CHAIR, CHAIR_2] = [0x51, 0x52].map(uid);
/** A place no library has: deleted since a draft took its id. */
const GONE = uid(0x99);

const place = (id: string, name: string, parentId: string | null): BackgroundPlace => ({ id, revision: 1, name, parentId, folderPath: '' });
/** A rectangle that is not turned: `x`, `y` is its top left corner. */
const room = (id: string, name: string, x: number, y: number, width: number, height: number, patch: Partial<BackgroundSpace> = {}): BackgroundSpace =>
  ({ id, type: 'space', name, placeId: null, childMapId: null, x, y, width, height, rotation: 0, shape: 'rect', points: [], locked: false, ...patch });
/** A camera standing at `x`, `y`. Its property `spaceId` (카메라가 있는 공간) is given apart from where it stands. */
const lens = (id: string, name: string, x: number, y: number, patch: Partial<BackgroundCamera> = {}): BackgroundCamera =>
  ({ id, type: 'camera', name, spaceId: null, x, y, angle: 0, fov: 60, viewIds: [], locked: false, ...patch });
const chair = (id: string, name: string, x: number, y: number, spaceId: string | null): BackgroundSymbol =>
  ({ id, type: 'symbol', name, symbol: 'chair', spaceId, x, y, width: 40, height: 40, rotation: 0, locked: false, hinge: 'left', swing: 'inward' });

/**
 * The objects both maps have. No two spaces overlap but 벽장, drawn small inside 2-1 교실: of the spaces that hold a point
 * the topmost is not the first found, nor the first with a place. 2-1 교실 comes first in the list for that reason.
 */
const nodes: BackgroundNode[] = [
  room(CLASSROOM, '2-1 교실', 0, 0, 400, 300, { placeId: CLASS }),
  room(CLOSET, '벽장', 300, 200, 80, 80),
  room(STORE, '창고', 500, 0, 200, 200),
  room(LOCKED_STORE, '잠긴 창고', 800, 0, 200, 200, { locked: true }),
  room(LOCKED_ROOM, '잠긴 방', 0, 400, 200, 200, { placeId: CLASS, locked: true }),
  room(ROAD, '도로', 0, 700, 600, 60, { surface: 'road' }),
  lens(CLASS_CAMERA, '교실 카메라', 100, 100),
  lens(STORE_CAMERA, '창고 카메라', 600, 100, { spaceId: CLASSROOM }),
  lens(OUT_CAMERA, '밖 카메라', 1200, 1200, { spaceId: CLASSROOM }),
  lens(FLOATING_CAMERA, '떠 있는 카메라', 1300, 1300),
  lens(LOCKED_CAMERA, '잠긴 카메라', 100, 150, { locked: true }),
  lens(LOCKED_STORE_CAMERA, '잠긴 창고 카메라', 900, 100),
  lens(CLOSET_CAMERA, '벽장 카메라', 340, 240),
  lens(LOCKED_ROOM_CAMERA, '잠긴 방 카메라', 100, 500),
  chair(CHAIR, '의자', 550, 50, STORE),
  chair(CHAIR_2, '의자 2', 1250, 50, null),
];
/** Frozen through and through: a function that wrote into what it was handed would throw. */
const library: BackgroundSnapshot = freeze({
  places: [place(SCHOOL, '학교', null), place(CLASS, '2-1 교실', SCHOOL)],
  maps: [
    { id: FLOOR, revision: 1, name: '2층', parentId: null, placeId: SCHOOL, imageUrl: '', nodes },
    { id: ANNEX, revision: 1, name: '별관', parentId: null, placeId: null, imageUrl: '', nodes },
  ],
  views: [], groups: [], usages: [], canManage: true,
});
const [floor, annex] = library.maps;

const nodeOf = (map: BackgroundMap, id: string): BackgroundNode => {
  const found = map.nodes.find(item => item.id === id);
  assert.ok(found, `${map.name} has no node ${id}`);
  return found;
};
/** The map with one node changed: a draft, or the map of another library. */
const withNode = (map: BackgroundMap, id: string, patch: Partial<BackgroundNode>): BackgroundMap =>
  ({ ...map, nodes: map.nodes.map(item => item.id === id ? { ...item, ...patch } as BackgroundNode : item) });
/** The maps as the editor shows them: each draft in place of its saved map. */
const over = (maps: readonly BackgroundMap[], ...drafts: BackgroundMap[]) => maps.map(map => drafts.find(draft => draft.id === map.id) ?? map);
/** Another library, checked as the library checks itself: whatever it holds, a saved map may hold. */
const lib = (patch: Partial<BackgroundSnapshot>): BackgroundSnapshot => {
  const next = freeze({ ...library, ...patch });
  validateBackgroundSnapshot(next);
  return next;
};
/** What the pictures go to, asked the way the editor asks: the library, the maps it shows (the saved ones unless given), the map on show and the node in hand. */
const resolve = (map: BackgroundMap | undefined, id?: string, snapshot: BackgroundSnapshot = library, maps: readonly BackgroundMap[] = snapshot.maps): MapImageTarget =>
  resolveMapImageTarget(snapshot, maps, map, map && id ? nodeOf(map, id) : undefined);
/** The first five fields of a target that is open: what the pictures are added to. */
const toMap = (mapId: string, name: string) => ({ mapId, scope: 'map', nodeId: null, name, cameraId: null });
const toSpace = (mapId: string, nodeId: string, name: string) => ({ mapId, scope: 'space', nodeId, name, cameraId: null });
const toCamera = (mapId: string, nodeId: string, name: string) => ({ mapId, scope: 'camera', nodeId, name, cameraId: nodeId });

// The base is what the tests take it for: a whole library, and of the two rooms that hold the point of 벽장 카메라 the
// small one is on top.
validateBackgroundSnapshot(library);
assert.equal(spacesAt(floor, nodeOf(floor, CLOSET_CAMERA))[0]?.id, CLOSET);

test('M-1a: the target is what the image list names — no map, a read-only account, the map, a space, a road and a symbol', () => {
  // No map, or an account that may not change the library: nothing, whatever is in hand.
  assert.deepEqual(resolve(undefined), { status: 'blocked', reason: 'no-map', name: '' });
  const reader = lib({ canManage: false });
  assert.deepEqual(resolve(floor, undefined, reader), { status: 'blocked', reason: 'read-only', name: '' });
  assert.deepEqual(resolve(floor, CLASSROOM, reader), { status: 'blocked', reason: 'read-only', name: '' });
  assert.deepEqual(resolve(annex, LOCKED_CAMERA, reader), { status: 'blocked', reason: 'read-only', name: '' });
  // Nothing in hand (or several on the plan): the map, by its own place, or asked for one where it has none.
  assert.deepEqual(resolve(floor), { ...toMap(FLOOR, '2층'), status: 'ready', placeId: SCHOOL, placeName: '학교', cameraPlaceId: null, placeNodeId: null, placeKept: true });
  assert.deepEqual(resolve(annex), { ...toMap(ANNEX, '별관'), status: 'needs-place', placeNodeId: null, placeWas: null, ownerKind: 'map', ownerName: '별관', suggestedName: '별관', parentPlaceId: null, sameNamePlaceId: null });
  // A space by its own place, a locked one too: nothing of the map changes.
  assert.deepEqual(resolve(floor, CLASSROOM), { ...toSpace(FLOOR, CLASSROOM, '2-1 교실'), status: 'ready', placeId: CLASS, placeName: '2-1 교실', cameraPlaceId: null, placeNodeId: CLASSROOM, placeKept: true });
  assert.deepEqual(resolve(annex, CLASSROOM), { ...toSpace(ANNEX, CLASSROOM, '2-1 교실'), status: 'ready', placeId: CLASS, placeName: '2-1 교실', cameraPlaceId: null, placeNodeId: CLASSROOM, placeKept: true });
  assert.deepEqual(resolve(floor, LOCKED_ROOM), { ...toSpace(FLOOR, LOCKED_ROOM, '잠긴 방'), status: 'ready', placeId: CLASS, placeName: '2-1 교실', cameraPlaceId: null, placeNodeId: LOCKED_ROOM, placeKept: true });
  // A space without one is asked for its own, under the place of the map: never handed the place of the map, whose
  // backgrounds its list does not show. Locked, nothing can be tied to it.
  assert.deepEqual(resolve(floor, STORE), { ...toSpace(FLOOR, STORE, '창고'), status: 'needs-place', placeNodeId: STORE, placeWas: null, ownerKind: 'space', ownerName: '창고', suggestedName: '창고', parentPlaceId: SCHOOL, sameNamePlaceId: null });
  assert.deepEqual(resolve(annex, STORE), { ...toSpace(ANNEX, STORE, '창고'), status: 'needs-place', placeNodeId: STORE, placeWas: null, ownerKind: 'space', ownerName: '창고', suggestedName: '창고', parentPlaceId: null, sameNamePlaceId: null });
  assert.deepEqual(resolve(floor, LOCKED_STORE), { status: 'blocked', reason: 'locked-space', name: '잠긴 창고' });
  // A road is a space like any other.
  assert.deepEqual(resolve(floor, ROAD), { ...toSpace(FLOOR, ROAD, '도로'), status: 'needs-place', placeNodeId: ROAD, placeWas: null, ownerKind: 'space', ownerName: '도로', suggestedName: '도로', parentPlaceId: SCHOOL, sameNamePlaceId: null });
  // A symbol goes to the space it belongs to, with or without a place, and to the map when it belongs to none.
  assert.deepEqual(resolve(floor, CHAIR), resolve(floor, STORE));
  assert.deepEqual(resolve(annex, CHAIR), resolve(annex, STORE));
  assert.deepEqual(resolve(floor, CHAIR_2), resolve(floor));
  assert.deepEqual(resolve(annex, CHAIR_2), resolve(annex));
});

test('M-1b: a camera stands in the topmost space that holds its point, and only a camera standing nowhere goes by its property', () => {
  // In a room with a place: that place, held by that room, its property empty.
  assert.deepEqual(resolve(floor, CLASS_CAMERA), { ...toCamera(FLOOR, CLASS_CAMERA, '교실 카메라'), status: 'ready', placeId: CLASS, placeName: '2-1 교실', cameraPlaceId: CLASS, placeNodeId: CLASSROOM, placeKept: true });
  // In 창고, which has none: the place of the map, though its property names 2-1 교실. Not where it stands: no camera place.
  assert.deepEqual(resolve(floor, STORE_CAMERA), { ...toCamera(FLOOR, STORE_CAMERA, '창고 카메라'), status: 'ready', placeId: SCHOOL, placeName: '학교', cameraPlaceId: null, placeNodeId: null, placeKept: true });
  // In 벽장, inside 2-1 교실: it stands in the small room on top, and is never handed the place of the room around it.
  assert.deepEqual(resolve(floor, CLOSET_CAMERA), { ...toCamera(FLOOR, CLOSET_CAMERA, '벽장 카메라'), status: 'ready', placeId: SCHOOL, placeName: '학교', cameraPlaceId: null, placeNodeId: null, placeKept: true });
  assert.deepEqual(resolve(annex, CLOSET_CAMERA), { ...toCamera(ANNEX, CLOSET_CAMERA, '벽장 카메라'), status: 'needs-place', placeNodeId: CLOSET, placeWas: null, ownerKind: 'space', ownerName: '벽장', suggestedName: '벽장', parentPlaceId: null, sameNamePlaceId: null });
  // In a locked room with a place: that place, held by the locked room (nothing of the map changes), on either map.
  assert.deepEqual(resolve(floor, LOCKED_ROOM_CAMERA), { ...toCamera(FLOOR, LOCKED_ROOM_CAMERA, '잠긴 방 카메라'), status: 'ready', placeId: CLASS, placeName: '2-1 교실', cameraPlaceId: CLASS, placeNodeId: LOCKED_ROOM, placeKept: true });
  assert.deepEqual(resolve(annex, LOCKED_ROOM_CAMERA), { ...toCamera(ANNEX, LOCKED_ROOM_CAMERA, '잠긴 방 카메라'), status: 'ready', placeId: CLASS, placeName: '2-1 교실', cameraPlaceId: CLASS, placeNodeId: LOCKED_ROOM, placeKept: true });
  // Standing in no space: the room its property names.
  assert.deepEqual(resolve(floor, OUT_CAMERA), { ...toCamera(FLOOR, OUT_CAMERA, '밖 카메라'), status: 'ready', placeId: CLASS, placeName: '2-1 교실', cameraPlaceId: CLASS, placeNodeId: CLASSROOM, placeKept: true });
  assert.deepEqual(resolve(annex, OUT_CAMERA), { ...toCamera(ANNEX, OUT_CAMERA, '밖 카메라'), status: 'ready', placeId: CLASS, placeName: '2-1 교실', cameraPlaceId: CLASS, placeNodeId: CLASSROOM, placeKept: true });
  // Neither: the map.
  assert.deepEqual(resolve(floor, FLOATING_CAMERA), { ...toCamera(FLOOR, FLOATING_CAMERA, '떠 있는 카메라'), status: 'ready', placeId: SCHOOL, placeName: '학교', cameraPlaceId: null, placeNodeId: null, placeKept: true });
  // A property that names a space this map does not have (a value of a draft) names none.
  const astray = withNode(floor, OUT_CAMERA, { spaceId: uid(0x98) });
  assert.deepEqual(resolve(astray, OUT_CAMERA, library, over(library.maps, astray)), { ...toCamera(FLOOR, OUT_CAMERA, '밖 카메라'), status: 'ready', placeId: SCHOOL, placeName: '학교', cameraPlaceId: null, placeNodeId: null, placeKept: true });
  // A locked camera takes nothing: its views would change.
  assert.deepEqual(resolve(floor, LOCKED_CAMERA), { status: 'blocked', reason: 'locked-camera', name: '잠긴 카메라' });
  // On a map with no place of its own the place goes to the space it stands in; to the map where it stands in none, or in a locked one.
  assert.deepEqual(resolve(annex, STORE_CAMERA), { ...toCamera(ANNEX, STORE_CAMERA, '창고 카메라'), status: 'needs-place', placeNodeId: STORE, placeWas: null, ownerKind: 'space', ownerName: '창고', suggestedName: '창고', parentPlaceId: null, sameNamePlaceId: null });
  assert.deepEqual(resolve(annex, FLOATING_CAMERA), { ...toCamera(ANNEX, FLOATING_CAMERA, '떠 있는 카메라'), status: 'needs-place', placeNodeId: null, placeWas: null, ownerKind: 'map', ownerName: '별관', suggestedName: '별관', parentPlaceId: null, sameNamePlaceId: null });
  assert.deepEqual(resolve(annex, LOCKED_STORE_CAMERA), { ...toCamera(ANNEX, LOCKED_STORE_CAMERA, '잠긴 창고 카메라'), status: 'needs-place', placeNodeId: null, placeWas: null, ownerKind: 'map', ownerName: '별관', suggestedName: '별관', parentPlaceId: null, sameNamePlaceId: null });
  assert.deepEqual(resolve(floor, LOCKED_STORE_CAMERA), { ...toCamera(FLOOR, LOCKED_STORE_CAMERA, '잠긴 창고 카메라'), status: 'ready', placeId: SCHOOL, placeName: '학교', cameraPlaceId: null, placeNodeId: null, placeKept: true });
});

test('M-1c: a place that is gone counts as none, and placeKept says whether the saved map holds the tie too', () => {
  // A draft may hold the id of a place deleted since: no place. The space is asked for one, and holds that id now.
  const goneStore = withNode(floor, STORE, { placeId: GONE });
  assert.deepEqual(resolve(goneStore, STORE, library, over(library.maps, goneStore)), { ...toSpace(FLOOR, STORE, '창고'), status: 'needs-place', placeNodeId: STORE, placeWas: GONE, ownerKind: 'space', ownerName: '창고', suggestedName: '창고', parentPlaceId: SCHOOL, sameNamePlaceId: null });
  // A camera standing there gets no place from it either: the place of the map, or on a map without one the space is asked.
  assert.deepEqual(resolve(goneStore, STORE_CAMERA, library, over(library.maps, goneStore)), { ...toCamera(FLOOR, STORE_CAMERA, '창고 카메라'), status: 'ready', placeId: SCHOOL, placeName: '학교', cameraPlaceId: null, placeNodeId: null, placeKept: true });
  const goneAnnex = withNode(annex, STORE, { placeId: GONE });
  assert.deepEqual(resolve(goneAnnex, STORE_CAMERA, library, over(library.maps, goneAnnex)), { ...toCamera(ANNEX, STORE_CAMERA, '창고 카메라'), status: 'needs-place', placeNodeId: STORE, placeWas: GONE, ownerKind: 'space', ownerName: '창고', suggestedName: '창고', parentPlaceId: null, sameNamePlaceId: null });
  // A map whose own place is gone: a new place of a space is made at the top, and the map is asked for one of its own.
  const goneFloor: BackgroundMap = { ...floor, placeId: GONE };
  assert.deepEqual(resolve(goneFloor, STORE, library, over(library.maps, goneFloor)), { ...toSpace(FLOOR, STORE, '창고'), status: 'needs-place', placeNodeId: STORE, placeWas: null, ownerKind: 'space', ownerName: '창고', suggestedName: '창고', parentPlaceId: null, sameNamePlaceId: null });
  assert.deepEqual(resolve(goneFloor, undefined, library, over(library.maps, goneFloor)), { ...toMap(FLOOR, '2층'), status: 'needs-place', placeNodeId: null, placeWas: GONE, ownerKind: 'map', ownerName: '2층', suggestedName: '2층', parentPlaceId: null, sameNamePlaceId: null });
  // A place tied by the draft alone, since the last save: taken, and not kept. The saved map ties 2-1 교실 to other rooms,
  // not to 창고: that is no tie of 창고.
  const tiedStore = withNode(floor, STORE, { placeId: CLASS });
  assert.deepEqual(resolve(tiedStore, STORE, library, over(library.maps, tiedStore)), { ...toSpace(FLOOR, STORE, '창고'), status: 'ready', placeId: CLASS, placeName: '2-1 교실', cameraPlaceId: null, placeNodeId: STORE, placeKept: false });
  assert.deepEqual(resolve(tiedStore, STORE_CAMERA, library, over(library.maps, tiedStore)), { ...toCamera(FLOOR, STORE_CAMERA, '창고 카메라'), status: 'ready', placeId: CLASS, placeName: '2-1 교실', cameraPlaceId: CLASS, placeNodeId: STORE, placeKept: false });
  const tiedAnnex: BackgroundMap = { ...annex, placeId: SCHOOL };
  assert.deepEqual(resolve(tiedAnnex, undefined, library, over(library.maps, tiedAnnex)), { ...toMap(ANNEX, '별관'), status: 'ready', placeId: SCHOOL, placeName: '학교', cameraPlaceId: null, placeNodeId: null, placeKept: false });
  // A map never saved has no saved tie at all.
  const fresh: BackgroundMap = { ...floor, id: uid(0x97), name: '새 도면' };
  assert.deepEqual(resolve(fresh, undefined, library, [...library.maps, fresh]), { ...toMap(fresh.id, '새 도면'), status: 'ready', placeId: SCHOOL, placeName: '학교', cameraPlaceId: null, placeNodeId: null, placeKept: false });
  // Tied in the saved map as well: kept.
  const saved = lib({ maps: [tiedStore, tiedAnnex] });
  assert.deepEqual(resolve(tiedStore, STORE, saved), { ...toSpace(FLOOR, STORE, '창고'), status: 'ready', placeId: CLASS, placeName: '2-1 교실', cameraPlaceId: null, placeNodeId: STORE, placeKept: true });
  assert.deepEqual(resolve(tiedStore, STORE_CAMERA, saved), { ...toCamera(FLOOR, STORE_CAMERA, '창고 카메라'), status: 'ready', placeId: CLASS, placeName: '2-1 교실', cameraPlaceId: CLASS, placeNodeId: STORE, placeKept: true });
  assert.deepEqual(resolve(tiedAnnex, undefined, saved), { ...toMap(ANNEX, '별관'), status: 'ready', placeId: SCHOOL, placeName: '학교', cameraPlaceId: null, placeNodeId: null, placeKept: true });
});

test('M-1d: sameNamePlaceId is a place of that name under that parent that no map uses, saved or drafted', () => {
  const [SPACED, STORE_PLACE, TOP_STORE, CLASS_STORE, ANNEX_PLACE, NEW_PLACE] = [0x61, 0x62, 0x63, 0x64, 0x65, 0x66].map(uid);
  const [THIRD, ANNEX_2, STORE_3, STORE_4, NEW_A, NEW_B] = [0x71, 0x72, 0x73, 0x74, 0x75, 0x76].map(uid);
  /** 창고 of 2층 (a new place under 학교) and of 별관 (at the top), asked for a place, with this one picked beforehand. */
  const floorStore = (sameNamePlaceId: string | null) => ({ ...toSpace(FLOOR, STORE, '창고'), status: 'needs-place', placeNodeId: STORE, placeWas: null, ownerKind: 'space', ownerName: '창고', suggestedName: '창고', parentPlaceId: SCHOOL, sameNamePlaceId });
  const annexStore = (sameNamePlaceId: string | null) => ({ ...toSpace(ANNEX, STORE, '창고'), status: 'needs-place', placeNodeId: STORE, placeWas: null, ownerKind: 'space', ownerName: '창고', suggestedName: '창고', parentPlaceId: null, sameNamePlaceId });

  // The name the prompt suggests: the owner's, its spaces aside, at most 160 units and never half a character, or 새 장소.
  const suggested = (name: string) => {
    const draft = withNode(floor, STORE, { name }), found = resolve(draft, STORE, library, over(library.maps, draft));
    return found.status === 'needs-place' ? found.suggestedName : assert.fail(`no place is asked for: ${found.status}`);
  };
  assert.equal(suggested('  창고  '), '창고');
  assert.equal(suggested('   '), '새 장소');
  assert.equal(suggested('가'.repeat(170)), '가'.repeat(160));
  assert.equal(suggested(`${'가'.repeat(159)}🏫`), '가'.repeat(159));

  // Of that name, its spaces aside, under the place the new one would hang from, used by no map: the first of the library.
  const spaced = lib({ places: [...library.places, place(SPACED, ' 창고 ', SCHOOL), place(STORE_PLACE, '창고', SCHOOL)] });
  assert.deepEqual(resolve(floor, STORE, spaced), floorStore(SPACED));
  const turned = lib({ places: [...library.places, place(STORE_PLACE, '창고', SCHOOL), place(SPACED, ' 창고 ', SCHOOL)] });
  assert.deepEqual(resolve(floor, STORE, turned), floorStore(STORE_PLACE));
  // Under another parent alone: none. At the top it is the one for a map with no place: for its spaces, for the space a
  // camera stands in, for the map itself.
  const elsewhere = lib({ places: [...library.places, place(CLASS_STORE, '창고', CLASS), place(TOP_STORE, '창고', null), place(ANNEX_PLACE, '별관', null)] });
  assert.deepEqual(resolve(floor, STORE, elsewhere), floorStore(null));
  assert.deepEqual(resolve(annex, STORE, elsewhere), annexStore(TOP_STORE));
  assert.deepEqual(resolve(annex, STORE_CAMERA, elsewhere), { ...toCamera(ANNEX, STORE_CAMERA, '창고 카메라'), status: 'needs-place', placeNodeId: STORE, placeWas: null, ownerKind: 'space', ownerName: '창고', suggestedName: '창고', parentPlaceId: null, sameNamePlaceId: TOP_STORE });
  assert.deepEqual(resolve(annex, undefined, elsewhere), { ...toMap(ANNEX, '별관'), status: 'needs-place', placeNodeId: null, placeWas: null, ownerKind: 'map', ownerName: '별관', suggestedName: '별관', parentPlaceId: null, sameNamePlaceId: ANNEX_PLACE });

  // Two rooms of this map both named 새 공간, the first tied to the place of that name: the second is not handed it, whether
  // the saved map ties it or the map handed in alone does (a draft, the maps of the editor still as saved).
  const twins = (placeId: string | null): BackgroundMap => ({ ...floor, nodes: [...floor.nodes, room(NEW_A, '새 공간', 1500, 0, 200, 200, { placeId }), room(NEW_B, '새 공간', 1800, 0, 200, 200)] });
  const second = (sameNamePlaceId: string | null) => ({ ...toSpace(FLOOR, NEW_B, '새 공간'), status: 'needs-place', placeNodeId: NEW_B, placeWas: null, ownerKind: 'space', ownerName: '새 공간', suggestedName: '새 공간', parentPlaceId: SCHOOL, sameNamePlaceId });
  const untiedTwins = lib({ places: [...library.places, place(NEW_PLACE, '새 공간', SCHOOL)], maps: [twins(null), annex] });
  const tiedTwins = lib({ places: untiedTwins.places, maps: [twins(NEW_PLACE), annex] });
  assert.deepEqual(resolve(untiedTwins.maps[0], NEW_B, untiedTwins), second(NEW_PLACE));
  assert.deepEqual(resolve(tiedTwins.maps[0], NEW_B, tiedTwins), second(null));
  assert.deepEqual(resolve(twins(NEW_PLACE), NEW_B, untiedTwins, untiedTwins.maps), second(null));

  // 창고 of another map tied to it: none, whether both maps hang from 학교 or neither has a place (a place at the top).
  const third = (placeId: string | null): BackgroundMap => ({ id: THIRD, revision: 1, name: '3층', parentId: null, placeId: SCHOOL, imageUrl: '', nodes: [room(STORE_3, '창고', 0, 0, 200, 200, { placeId })] });
  const annex2 = (placeId: string | null): BackgroundMap => ({ id: ANNEX_2, revision: 1, name: '별관 2', parentId: null, placeId: null, imageUrl: '', nodes: [room(STORE_4, '창고', 0, 0, 200, 200, { placeId })] });
  const stores = [...library.places, place(STORE_PLACE, '창고', SCHOOL), place(TOP_STORE, '창고', null)];
  const untied = lib({ places: stores, maps: [floor, annex, third(null), annex2(null)] });
  const tied = lib({ places: stores, maps: [floor, annex, third(STORE_PLACE), annex2(TOP_STORE)] });
  assert.deepEqual(resolve(floor, STORE, untied), floorStore(STORE_PLACE));
  assert.deepEqual(resolve(annex, STORE, untied), annexStore(TOP_STORE));
  assert.deepEqual(resolve(floor, STORE, tied), floorStore(null));
  assert.deepEqual(resolve(annex, STORE, tied), annexStore(null));
  // Tied in a draft of the other map alone, among the maps the editor shows: none.
  assert.deepEqual(resolve(floor, STORE, untied, over(untied.maps, third(STORE_PLACE))), floorStore(null));
  assert.deepEqual(resolve(annex, STORE, untied, over(untied.maps, annex2(TOP_STORE))), annexStore(null));
  // Tied in the saved map alone, a draft of it having untied it: none still, as that draft is not saved.
  assert.deepEqual(resolve(floor, STORE, tied, over(tied.maps, third(null))), floorStore(null));
  assert.deepEqual(resolve(annex, STORE, tied, over(tied.maps, annex2(null))), annexStore(null));
  // Untied everywhere: picked again.
  assert.deepEqual(resolve(floor, STORE, untied, over(untied.maps, third(null), annex2(null))), floorStore(STORE_PLACE));
  // A map that holds it as its own place uses it as well.
  const held = lib({ places: stores, maps: [floor, annex, { ...third(null), placeId: STORE_PLACE }] });
  assert.deepEqual(resolve(floor, STORE, held), floorStore(null));
});

test('M-2: the words of the overlay and of the place prompt, letter for letter', () => {
  const said: string[] = [];
  type Facts = { editing: boolean; running: boolean; wrongType: boolean };
  const words = (target: MapImageTarget, facts: Partial<Facts> = {}) => {
    const result = mapImageTargetWords(target, { editing: false, running: false, wrongType: false, ...facts });
    said.push(result.title, result.detail);
    return result;
  };
  /** The target of a node whose name alone is changed, in a copy of the map handed in as a draft would be; the library as it is. */
  const named = (map: BackgroundMap, id: string, name: string) => {
    const draft = withNode(map, id, { name });
    return resolve(draft, id, library, over(library.maps, draft));
  };
  const reader = lib({ canManage: false }), tied = withNode(floor, STORE, { placeId: CLASS });

  // The table of 3.3, row by row in its order.
  const rows: [string, MapImageTarget, Partial<Facts>, { title: string; detail: string; blocked: boolean }][] = [
    ['no-map', resolve(undefined), {}, { title: '여기에는 넣을 수 없어요', detail: '도면을 먼저 만들어 주세요.', blocked: true }],
    ['read-only', resolve(floor, undefined, reader), {}, { title: '여기에는 넣을 수 없어요', detail: '이 계정으로는 그림을 넣을 수 없어요.', blocked: true }],
    ['running', resolve(floor, CLASSROOM), { running: true }, { title: '지금은 넣을 수 없어요', detail: '앞에 넣던 그림을 마치는 중이에요. 끝난 뒤에 다시 넣어 주세요.', blocked: true }],
    ['wrong type', resolve(floor, CLASSROOM), { wrongType: true }, { title: '넣을 수 없는 파일이에요', detail: 'PNG·JPG·WebP 그림만 넣을 수 있어요.', blocked: true }],
    ['locked-camera', named(floor, LOCKED_CAMERA, '카메라 2'), {}, { title: '‘카메라 2’에는 넣을 수 없어요', detail: '잠긴 카메라예요. 도면을 편집하면서 속성의 ‘위치·크기·잠금’에서 잠금을 해제하고 다시 넣어 주세요.', blocked: true }],
    ['locked-space', named(floor, LOCKED_STORE, '창고'), {}, { title: '‘창고’에는 넣을 수 없어요', detail: '잠겨 있어서 배경 장소를 이어 줄 수 없어요. 도면을 편집하면서 속성의 ‘위치·크기·잠금’에서 잠금을 해제하고 다시 넣어 주세요.', blocked: true }],
    ['needs-place', resolve(floor, STORE), {}, { title: '‘창고’의 배경으로 추가', detail: '놓으면 배경 장소부터 정해요.', blocked: false }],
    ['ready, a camera, editing', named(floor, CLASS_CAMERA, '카메라 2'), { editing: true }, { title: '‘카메라 2’의 시점으로 추가', detail: "그림은 ‘2-1 교실’ 장소에 바로 저장되고, 카메라에 이어 주는 것은 '도면 저장' 때 저장돼요.", blocked: false }],
    ['ready, a camera, viewing', named(floor, CLASS_CAMERA, '카메라 2'), {}, { title: '‘카메라 2’의 시점으로 추가', detail: '놓으면 ‘2-1 교실’ 장소에 바로 저장돼요.', blocked: false }],
    ['ready, placeKept', resolve(floor, CLASSROOM), {}, { title: '‘2-1 교실’의 배경으로 추가', detail: '놓으면 바로 저장돼요.', blocked: false }],
    ['ready, tied in the draft alone', resolve(tied, STORE, library, over(library.maps, tied)), {}, { title: '‘창고’의 배경으로 추가', detail: "그림은 바로 저장되고, 배경 장소를 이어 둔 것은 '도면 저장' 때 저장돼요.", blocked: false }],
  ];
  for (const [row, target, facts, expected] of rows) assert.deepEqual(words(target, facts), expected, row);
  // The first row that fits is the answer: no map and the account before all, a batch on its way before the files, both
  // before a lock.
  const wordsOf = (row: string) => rows.find(([name]) => name === row)![3];
  assert.deepEqual(words(resolve(undefined), { running: true, wrongType: true }), wordsOf('no-map'));
  assert.deepEqual(words(resolve(floor, LOCKED_CAMERA, reader), { running: true, wrongType: true }), wordsOf('read-only'));
  assert.deepEqual(words(named(floor, LOCKED_CAMERA, '카메라 2'), { running: true, wrongType: true }), wordsOf('running'));
  assert.deepEqual(words(named(floor, LOCKED_STORE, '창고'), { wrongType: true }), wordsOf('wrong type'));
  assert.deepEqual(words(resolve(annex), { running: true }), wordsOf('running'));
  // The three titles say what the pictures go in as: the map's own as well, whether it has a place or is asked for one.
  assert.deepEqual(words(resolve(floor)), { title: '‘2층’ 도면의 배경으로 추가', detail: '놓으면 바로 저장돼요.', blocked: false });
  assert.deepEqual(words(resolve(annex)), { title: '‘별관’ 도면의 배경으로 추가', detail: '놓으면 배경 장소부터 정해요.', blocked: false });
  // A camera names the place its pictures go to, that of the map where it stands in a room without one.
  assert.deepEqual(words(named(floor, STORE_CAMERA, '카메라 2')), { title: '‘카메라 2’의 시점으로 추가', detail: '놓으면 ‘학교’ 장소에 바로 저장돼요.', blocked: false });
  // Editing changes the words of a camera alone.
  assert.deepEqual(words(resolve(floor, CLASSROOM), { editing: true }), wordsOf('ready, placeKept'));
  assert.deepEqual(words(resolve(tied, STORE, library, over(library.maps, tied)), { editing: true }), wordsOf('ready, tied in the draft alone'));
  // A name that is empty is said as 이름 없음.
  assert.equal(words(named(floor, CLASSROOM, '')).title, '‘이름 없음’의 배경으로 추가');
  assert.equal(words(named(floor, LOCKED_CAMERA, '')).title, '‘이름 없음’에는 넣을 수 없어요');
  // Both locks say where they are undone: the field is there in edit mode alone, folded away.
  for (const row of ['locked-camera', 'locked-space']) assert.ok(wordsOf(row).detail.includes('속성의 ‘위치·크기·잠금’에서'), row);

  // The prompt of 6.2: what has no place, what the new one becomes, where it is made, and when the tie is saved.
  const prompt = (target: MapImageTarget, count: number, drafted: boolean) => {
    if (target.status !== 'needs-place') return assert.fail(`no place is asked for: ${target.status}`);
    const parent = library.places.find(item => item.id === target.parentPlaceId)?.name ?? null;
    const result = mapImagePlaceWords(target, count, drafted, parent);
    said.push(result.lead, result.ask, result.parent, result.note);
    return result;
  };
  assert.deepEqual(prompt(resolve(floor, STORE), 3, true), {
    lead: '‘창고’에는 아직 배경 장소가 없어요.',
    ask: '그림 3장을 넣을 장소를 정해 주세요. 정한 장소는 ‘창고’의 배경 장소가 돼요.',
    parent: '‘학교’ 아래에 만들어져요.',
    note: "장소와 그림은 바로 저장돼요. ‘창고’에 이어 주는 것은 다른 편집처럼 '도면 저장' 때 저장돼요.",
  });
  assert.equal(prompt(resolve(floor, STORE), 3, false).note, '장소와 그림, ‘창고’에 이어 주는 것까지 바로 저장돼요.');
  assert.equal(prompt(resolve(floor, STORE), 1, true).ask, '그림 1장을 넣을 장소를 정해 주세요. 정한 장소는 ‘창고’의 배경 장소가 돼요.');
  assert.deepEqual(prompt(resolve(annex), 3, true), {
    lead: '‘별관’ 도면에는 아직 대표 장소가 없어요.',
    ask: '그림 3장을 넣을 장소를 정해 주세요. 정한 장소는 이 도면의 대표 장소가 돼요.',
    parent: '맨 위 장소로 만들어져요.',
    note: "장소와 그림은 바로 저장돼요. 이 도면에 이어 주는 것은 다른 편집처럼 '도면 저장' 때 저장돼요.",
  });
  assert.equal(prompt(resolve(annex), 3, false).note, '장소와 그림, 이 도면에 이어 주는 것까지 바로 저장돼요.');
  // A camera says first that it stands there, whether the space it stands in or the map gets the place.
  assert.deepEqual(prompt(named(annex, STORE_CAMERA, '카메라 2'), 3, false), {
    lead: '‘카메라 2’ 카메라가 있는 ‘창고’에는 아직 배경 장소가 없어요.',
    ask: '그림 3장을 넣을 장소를 정해 주세요. 정한 장소는 ‘창고’의 배경 장소가 돼요.',
    parent: '맨 위 장소로 만들어져요.',
    note: '장소와 그림, ‘창고’에 이어 주는 것까지 바로 저장돼요.',
  });
  assert.deepEqual(prompt(named(annex, FLOATING_CAMERA, '카메라 2'), 3, true), {
    lead: '‘카메라 2’ 카메라가 있는 ‘별관’ 도면에는 아직 대표 장소가 없어요.',
    ask: '그림 3장을 넣을 장소를 정해 주세요. 정한 장소는 이 도면의 대표 장소가 돼요.',
    parent: '맨 위 장소로 만들어져요.',
    note: "장소와 그림은 바로 저장돼요. 이 도면에 이어 주는 것은 다른 편집처럼 '도면 저장' 때 저장돼요.",
  });
  // A road is named alone: no sentence calls it a space.
  for (const drafted of [true, false]) for (const line of Object.values(prompt(resolve(floor, ROAD), 3, drafted))) assert.ok(!line.includes('공간'), line);
  assert.equal(prompt(resolve(floor, ROAD), 3, false).lead, '‘도로’에는 아직 배경 장소가 없어요.');

  // Not one of these sentences speaks of edit mode by its words.
  assert.ok(said.length > 40);
  for (const line of said) assert.doesNotMatch(line, /편집 중|편집 시작/, line);
});
