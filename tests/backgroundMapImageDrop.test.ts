import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPlace, BackgroundSnapshot, BackgroundSpace, BackgroundSymbol, BackgroundView } from '../src/features/backgrounds/types.ts';
import { validateBackgroundEntity, validateBackgroundSnapshot } from '../src/features/backgrounds/domain.ts';
import { spacesAt } from '../src/features/backgrounds/mapStack.ts';
import { MAP_IMAGE_REFUSAL_TEXT, dropMissingViews, linkMapImages, mapImageBaseName, mapImageDragRefused, mapImageLinkNow, mapImageLinkWanted, mapImageOutcomeNow, mapImagePasteWanted,
  mapImagePathFacts, mapImagePlaceWords, mapImageRefusedList, mapImageSourceFacts, mapImageTargetWords, mapLinksAdded, resolveMapImageTarget, sortMapImageFiles, uniqueMapImageName } from '../src/features/backgrounds/mapImageDrop.ts';
import type { MapImageLink, MapImageOutcome, MapImageTarget } from '../src/features/backgrounds/mapImageDrop.ts';

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
  // A locked one as well, and by what it belongs to, not by where it is drawn: this chair stands in 창고 and belongs to 잠긴 창고.
  const lockedChair = withNode(floor, CHAIR, { spaceId: LOCKED_STORE });
  assert.deepEqual(resolve(lockedChair, CHAIR, library, over(library.maps, lockedChair)), { status: 'blocked', reason: 'locked-space', name: '잠긴 창고' });
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
  // Its own place tied in the draft alone, a map says so as a space does.
  const tiedAnnex: BackgroundMap = { ...annex, placeId: SCHOOL };
  assert.deepEqual(words(resolve(tiedAnnex, undefined, library, over(library.maps, tiedAnnex))), { title: '‘별관’ 도면의 배경으로 추가', detail: "그림은 바로 저장되고, 배경 장소를 이어 둔 것은 '도면 저장' 때 저장돼요.", blocked: false });
  // A camera names the place its pictures go to, that of the map where it stands in a room without one.
  assert.deepEqual(words(named(floor, STORE_CAMERA, '카메라 2')), { title: '‘카메라 2’의 시점으로 추가', detail: '놓으면 ‘학교’ 장소에 바로 저장돼요.', blocked: false });
  // Its rows come before those of placeKept: standing in a room whose place the draft alone ties, it still names that place.
  assert.deepEqual(words(named(tied, STORE_CAMERA, '카메라 2'), { editing: true }), wordsOf('ready, a camera, editing'));
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

/** When a file of the page was last changed, unless a test says otherwise. */
const CHANGED = 1_700_000_000_000;
/** A file as the rules read it, made the way the editor makes it: a file of the page (of a File the four fields are all that is
 *  read), with the path of the disk ('' for none) and whether it came in a paste. */
const pageFile = (name: string, type: string, more: { size?: number; lastModified?: number; path?: string; pasted?: boolean } = {}) =>
  mapImageSourceFacts({ kind: 'file', file: { name, type, size: more.size ?? 1000, lastModified: more.lastModified ?? CHANGED }, path: more.path ?? '', pasted: more.pasted ?? false });
/** A file copied in Explorer that the paste did not carry: known by the path the main process reads. */
const copied = (path: string) => mapImageSourceFacts({ kind: 'path', path });

test('M-3: which files are taken, refused or over the count, and whether a drag says so before the drop', () => {
  // A file of the page is its own four fields and what it came with; a path is what the path says, read by the main process.
  assert.deepEqual(pageFile('교실.png', 'image/png', { size: 2048, path: 'C:\\art\\교실.png' }),
    { name: '교실.png', type: 'image/png', size: 2048, path: 'C:\\art\\교실.png', lastModified: CHANGED, byPath: false, pasted: false });
  assert.deepEqual(pageFile('image.png', 'image/png', { pasted: true }), { name: 'image.png', type: 'image/png', size: 1000, path: '', lastModified: CHANGED, byPath: false, pasted: true });
  // A real File reads the same: its four fields are getters of its own kind, which a copy of the object would not carry.
  assert.deepEqual(mapImageSourceFacts({ kind: 'file', file: new File(['picture'], '복도.jpg', { type: 'image/jpeg', lastModified: CHANGED }), path: '', pasted: false }),
    { name: '복도.jpg', type: 'image/jpeg', size: 7, path: '', lastModified: CHANGED, byPath: false, pasted: false });
  assert.deepEqual(copied('  C:\\art\\사진.PNG  '), { name: '사진.PNG', type: 'image/png', size: 0, path: 'C:\\art\\사진.PNG', lastModified: 0, byPath: true, pasted: true });
  assert.deepEqual(copied('C:/art/사진.PNG'), mapImagePathFacts('C:/art/사진.PNG'));
  assert.equal(copied('C:/art/사진.PNG').name, '사진.PNG');
  // The type of a path is that of its last extension, in any case: 사진.PNG is a PNG. Anything else has none.
  const typed: [string, string][] = [['C:\\x\\사진.PNG', 'image/png'], ['C:\\x\\그림.WEBP', 'image/webp'], ['C:\\x\\a.jpg', 'image/jpeg'], ['C:\\x\\a.JPEG', 'image/jpeg'],
    ['C:\\x\\a.gif', 'image/gif'], ['C:\\x\\a.bmp', 'image/bmp'], ['C:\\x\\a.png.psd', ''], ['C:\\x\\README', ''], ['C:/x/교실.png', 'image/png']];
  for (const [path, type] of typed) assert.equal(mapImagePathFacts(path).type, type, path);

  // One file given twice is taken once. By the path where both have one: its spaces aside, either slash, any case.
  assert.deepEqual(sortMapImageFiles([pageFile('e.JPG', 'image/jpeg', { path: 'C:\\x\\e.JPG' }), pageFile('E.jpg', 'image/jpeg', { path: 'c:/x/E.jpg' })]), { accepted: [0], refused: [], over: 0 });
  assert.deepEqual(sortMapImageFiles([pageFile('e.JPG', 'image/jpeg', { path: 'C:\\x\\e.JPG' }), pageFile('E.jpg', 'image/jpeg', { path: ' c:/x/E.jpg ' })]), { accepted: [0], refused: [], over: 0 });
  assert.deepEqual(sortMapImageFiles([pageFile('e.JPG', 'image/jpeg', { path: 'C:\\x\\e.JPG' }), copied(' c:/x/E.jpg ')]), { accepted: [0], refused: [], over: 0 });
  // Where neither has one: by name, size and time of change together. The same name alone is not the same file.
  assert.deepEqual(sortMapImageFiles([pageFile('a.png', 'image/png'), pageFile('a.png', 'image/png')]), { accepted: [0], refused: [], over: 0 });
  assert.deepEqual(sortMapImageFiles([pageFile('a.png', 'image/png', { size: 100 }), pageFile('a.png', 'image/png', { size: 200 })]).accepted, [0, 1]);
  assert.deepEqual(sortMapImageFiles([pageFile('a.png', 'image/png', { lastModified: 1 }), pageFile('a.png', 'image/png', { lastModified: 2 })]).accepted, [0, 1]);
  // A path on one side alone: two files.
  assert.deepEqual(sortMapImageFiles([pageFile('a.png', 'image/png', { path: 'C:\\x\\a.png' }), pageFile('a.png', 'image/png')]).accepted, [0, 1]);
  // Pasted data is never the same as another: two pictures pasted alike in all are two, and so is one pasted beside one dropped.
  assert.deepEqual(sortMapImageFiles([pageFile('image.png', 'image/png', { pasted: true }), pageFile('image.png', 'image/png', { pasted: true })]).accepted, [0, 1]);
  assert.deepEqual(sortMapImageFiles([pageFile('image.png', 'image/png'), pageFile('image.png', 'image/png', { pasted: true })]).accepted, [0, 1]);
  // A file refused, given twice, is in the list once.
  const twice = [pageFile('스케치.psd', ''), pageFile('교실.png', 'image/png'), pageFile('스케치.psd', '')];
  assert.deepEqual(sortMapImageFiles(twice), { accepted: [1], refused: [{ index: 0, reason: 'type' }], over: 0 });
  assert.deepEqual(mapImageRefusedList(twice, sortMapImageFiles(twice).refused), [{ name: '스케치.psd', reason: 'PNG·JPG·WebP 그림만 넣을 수 있어요.' }]);

  // 20MB exactly is taken, a byte more is not.
  const MB = 1024 * 1024;
  assert.deepEqual(sortMapImageFiles([pageFile('a.png', 'image/png', { size: 20 * MB }), pageFile('b.png', 'image/png', { size: 20 * MB + 1 })]),
    { accepted: [0], refused: [{ index: 1, reason: 'size' }], over: 0 });
  // The type is asked before the size, in the order of 4.6: a GIF over 20MB is refused for its type, as a smaller GIF would be too.
  assert.deepEqual(sortMapImageFiles([pageFile('큰.gif', 'image/gif', { size: 20 * MB + 1 })]), { accepted: [], refused: [{ index: 0, reason: 'type' }], over: 0 });
  // PNG, JPEG and WebP go in. No type (.psd), GIF and BMP do not, nor a WebP the main process would read by its path.
  const kinds = [pageFile('a.png', 'image/png'), pageFile('b.jpg', 'image/jpeg'), pageFile('c.webp', 'image/webp'), pageFile('d.psd', ''), pageFile('e.gif', 'image/gif'),
    copied('C:\\x\\그림.WEBP'), copied('C:\\x\\사진.PNG'), copied('C:\\x\\f.bmp'), copied('C:\\x\\g.jpeg')];
  assert.deepEqual(sortMapImageFiles(kinds), { accepted: [0, 1, 2, 6, 8],
    refused: [{ index: 3, reason: 'type' }, { index: 4, reason: 'type' }, { index: 5, reason: 'webp-path' }, { index: 7, reason: 'type' }], over: 0 });
  // A WebP the paste carries goes in as it is (K6), with the path of the disk or without one: being pasted refuses nothing, a path the main process reads does.
  assert.deepEqual(sortMapImageFiles([pageFile('그림.webp', 'image/webp', { path: 'C:\\x\\그림.webp', pasted: true }), pageFile('image.webp', 'image/webp', { pasted: true })]),
    { accepted: [0, 1], refused: [], over: 0 });

  // Ten at a time. What is over is counted, named nowhere, and counted once however often it is given.
  const ten = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const photos = (count: number, from = 0) => Array.from({ length: count }, (_, n) => pageFile(`사진 ${from + n}.png`, 'image/png'));
  assert.deepEqual(sortMapImageFiles(photos(12)), { accepted: ten, refused: [], over: 2 });
  assert.deepEqual(sortMapImageFiles([...photos(12), pageFile('사진 11.png', 'image/png')]), { accepted: ten, refused: [], over: 2 });
  // Asked last: a .psd after ten good ones is refused for its type, not over.
  assert.deepEqual(sortMapImageFiles([...photos(10), pageFile('스케치.psd', '')]), { accepted: ten, refused: [{ index: 10, reason: 'type' }], over: 0 });
  // Eleven photos with a .psd among them, twelve in all: ten taken, one refused, one over, each by its place in the list handed in.
  assert.deepEqual(sortMapImageFiles([...photos(5), pageFile('스케치.psd', ''), ...photos(6, 5)]), { accepted: [0, 1, 2, 3, 4, 6, 7, 8, 9, 10], refused: [{ index: 5, reason: 'type' }], over: 1 });

  // The three reasons, letter for letter, and the list of what was refused: each file by its name, in the order it came.
  assert.deepEqual(MAP_IMAGE_REFUSAL_TEXT, {
    'webp-path': "WebP 파일은 복사해서 붙여 넣을 수 없어요. 끌어다 놓거나 '＋ 이미지 추가'로 넣어 주세요.",
    type: 'PNG·JPG·WebP 그림만 넣을 수 있어요.',
    size: '20MB보다 큰 그림은 넣을 수 없어요.',
  });
  const refusals = [pageFile('b.gif', 'image/gif'), pageFile('교실.png', 'image/png'), pageFile('a.png', 'image/png', { size: 30 * MB }), copied('C:\\x\\c.webp')];
  assert.deepEqual(mapImageRefusedList(refusals, sortMapImageFiles(refusals).refused), [
    { name: 'b.gif', reason: 'PNG·JPG·WebP 그림만 넣을 수 있어요.' },
    { name: 'a.png', reason: '20MB보다 큰 그림은 넣을 수 없어요.' },
    { name: 'c.webp', reason: "WebP 파일은 복사해서 붙여 넣을 수 없어요. 끌어다 놓거나 '＋ 이미지 추가'로 넣어 주세요." },
  ]);

  // While it is dragged: refused only when there is a file, every file says its type, and none of them can go in. What is not
  // a file is not counted, so text alone says nothing; one file that can go in, or one that does not say, lets it be dropped.
  const item = (kind: string, type: string) => ({ kind, type });
  assert.equal(mapImageDragRefused([item('file', 'image/gif'), item('file', 'image/bmp')]), true);
  assert.equal(mapImageDragRefused([item('string', 'text/uri-list'), item('file', 'image/gif')]), true);
  assert.equal(mapImageDragRefused([item('file', 'image/png'), item('file', 'image/gif')]), false);
  assert.equal(mapImageDragRefused([item('file', 'image/gif'), item('file', '')]), false);
  assert.equal(mapImageDragRefused([item('string', 'text/plain'), item('string', 'text/html')]), false);
  assert.equal(mapImageDragRefused([]), false);
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) assert.equal(mapImageDragRefused([item('file', type)]), false, type);
});

test('M-4: the name of a background made from a file', () => {
  const at = new Date(2026, 9, 13, 14, 5), early = new Date(2026, 9, 13, 9, 7);
  const named = (name: string, more: { path?: string; pasted?: boolean } = {}, when = at) => mapImageBaseName(pageFile(name, 'image/png', more), when);
  // Pasted data, named by the engine: by the time on this PC, two digits each.
  assert.equal(named('image.png', { pasted: true }), '붙여 넣은 그림 14:05');
  assert.equal(named('image.png', { pasted: true }, early), '붙여 넣은 그림 09:07');
  for (const name of ['image.jpg', 'image.jpeg', 'image.webp']) assert.equal(named(name, { pasted: true }), '붙여 넣은 그림 14:05', name);
  // Dropped, it is a file like any other.
  assert.equal(named('image.png'), 'image');
  // Pasted with a name of its own, or with a path: the name of the file. The engine's names are lower case as they are.
  assert.equal(named('교실.png', { pasted: true }), '교실');
  assert.equal(named('IMAGE.PNG', { pasted: true }), 'IMAGE');
  assert.equal(named('image.png', { pasted: true, path: 'C:\\shots\\image.png' }), 'image');
  assert.equal(mapImageBaseName(copied('C:\\shots\\image.png'), at), 'image');
  // The last dot and what follows go, then the spaces around what is left. With no dot the name stays; with nothing left, a name all the same.
  assert.equal(named('교실_낮.v2.png'), '교실_낮.v2');
  assert.equal(named(' 교실 .png'), '교실');
  assert.equal(named('교실'), '교실');
  assert.equal(named('화면 14.05.33'), '화면 14.05');
  assert.equal(named('.png'), '이름 없는 그림');
  // A file with no name is named by the last part of its path.
  assert.equal(named('', { path: 'C:\\art\\복도.jpg' }), '복도');
  // 160 units at most, never half a character, and no space left at the end.
  assert.equal(named(`${'가'.repeat(159)}🏫.png`), '가'.repeat(159));
  assert.equal(named(`${'가'.repeat(170)}.png`), '가'.repeat(160));
  assert.equal(named(`${'가'.repeat(159)} 나다.png`), '가'.repeat(159));

  // A name taken already gets a number, from 2 on.
  assert.equal(uniqueMapImageName('교실', new Set()), '교실');
  assert.equal(uniqueMapImageName('교실', new Set(['교실'])), '교실 (2)');
  assert.equal(uniqueMapImageName('교실', new Set(['교실', '교실 (2)'])), '교실 (3)');
  assert.equal(uniqueMapImageName('교실', new Set(['교실 (2)'])), '교실');
  // Within 160 units still: room is made by cutting the name, never through a character, and with no space left before the number.
  const full = '가'.repeat(160), numbered = uniqueMapImageName(full, new Set([full]));
  assert.equal(numbered, `${'가'.repeat(156)} (2)`);
  assert.equal(numbered.length, 160);
  // A number of two digits takes a unit more, and the name makes room for it: the tenth is within 160 units as well.
  const tenth = uniqueMapImageName(full, new Set([full, ...[2, 3, 4, 5, 6, 7, 8, 9].map(count => `${'가'.repeat(156)} (${count})`)]));
  assert.equal(tenth, `${'가'.repeat(155)} (10)`);
  assert.equal(tenth.length, 160);
  const parted = `${'가'.repeat(155)}🏫${'가'.repeat(3)}`;
  assert.equal(parted.length, 160);
  assert.equal(uniqueMapImageName(parted, new Set([parted])), `${'가'.repeat(155)} (2)`);
  const spaced = `${'가'.repeat(155)} 나다`;
  assert.equal(uniqueMapImageName(spaced, new Set([spaced])), `${'가'.repeat(155)} (2)`);
});

/** Backgrounds a batch put in under 2-1 교실, whole: a library that holds them checks as the library checks itself. */
const [SHOT_A, SHOT_B, SHOT_C] = [0x81, 0x82, 0x83].map(uid);
const background = (id: string, n: number): BackgroundView => ({ id, revision: 1, name: `교실 전경 ${n + 1}`, placeId: CLASS, cameraPlaceId: null, visiblePlaceIds: [], relatedPlaceIds: [],
  shot: 'wide', tags: [], memo: '', variants: [{ id: uid(0x1000 + n), name: '낮', time: 'day', activeRevisionId: uid(0x2000 + n),
    revisions: [{ id: uid(0x2000 + n), imageUrl: '', filePath: '', createdAt: '2026-10-13T05:05:00.000Z' }] }] });
/** The library with the three in it. The base library has none of them: there they have all been deleted. */
const shots = lib({ views: [SHOT_A, SHOT_B, SHOT_C].map(background) });
/** A background no library has: deleted while the batch went on. */
const MISSING = uid(0x8f);
/** What a batch asks to tie, as the controller hands it on: by default the place 2-1 교실, which the room 2-1 교실 held when the
 *  target was read (a camera standing there), and two of the backgrounds for 교실 카메라. */
const tie = (patch: Partial<MapImageLink> = {}): MapImageLink => ({ place: { nodeId: CLASSROOM, was: CLASS }, placeId: CLASS, cameraId: CLASS_CAMERA, viewIds: [SHOT_A, SHOT_B], ...patch });
const viewsOf = (map: BackgroundMap, id: string) => (nodeOf(map, id) as BackgroundCamera).viewIds;
/** The ids of the nodes of `after` that are not the very objects of `before`. */
const touched = (before: BackgroundMap, after: BackgroundMap) => after.nodes.filter((node, index) => node !== before.nodes[index]).map(node => node.id);
/** Nothing changed: the very map handed in, done or not. */
const unchanged = (result: { map: BackgroundMap; complete: boolean }, map: BackgroundMap, complete: boolean, message?: string) => {
  assert.equal(result.map, map, message);
  assert.equal(result.complete, complete, message);
};

test('M-7a: linkMapImages ties what is asked for and is there, and nothing else', () => {
  // A camera that is not there, or is locked: nothing changes, and it is not done.
  unchanged(linkMapImages(floor, tie({ cameraId: uid(0x8e) }), shots), floor, false);
  unchanged(linkMapImages(floor, tie({ cameraId: LOCKED_CAMERA }), shots), floor, false);
  // Tied: the views of the batch, every other node and key as it was, a map the library takes as it is. Asked again: the same
  // map, done.
  const once = linkMapImages(floor, tie(), shots);
  assert.equal(once.complete, true);
  assert.deepEqual(touched(floor, once.map), [CLASS_CAMERA]);
  assert.deepEqual(nodeOf(once.map, CLASS_CAMERA), { ...nodeOf(floor, CLASS_CAMERA), viewIds: [SHOT_A, SHOT_B] });
  assert.deepEqual({ ...once.map, nodes: [] }, { ...floor, nodes: [] });
  lib({ views: shots.views, maps: [once.map, annex] });
  unchanged(linkMapImages(once.map, tie(), shots), once.map, true);
  // Locked with all of it there already: done. With one more to tie: not, and nothing changes.
  const locked = freeze(withNode(once.map, CLASS_CAMERA, { locked: true }));
  unchanged(linkMapImages(locked, tie(), shots), locked, true);
  unchanged(linkMapImages(locked, tie({ viewIds: [SHOT_A, SHOT_C] }), shots), locked, false);
  // After the views it has, in the order given, each once: one it has already, or one given twice, is not added again.
  const holding = freeze(withNode(floor, CLASS_CAMERA, { viewIds: [SHOT_C] }));
  assert.deepEqual(linkMapImages(holding, tie({ viewIds: [SHOT_B, SHOT_A] }), shots), { map: withNode(holding, CLASS_CAMERA, { viewIds: [SHOT_C, SHOT_B, SHOT_A] }), complete: true });
  assert.deepEqual(linkMapImages(holding, tie({ viewIds: [SHOT_A, SHOT_C, SHOT_A, SHOT_B] }), shots), { map: withNode(holding, CLASS_CAMERA, { viewIds: [SHOT_C, SHOT_A, SHOT_B] }), complete: true });
  // A camera holds 1000 views at most, as the library takes no more: of two, one goes on to a camera that holds 999, and it is
  // not done; to one that holds 1000, none.
  const many = Array.from({ length: 999 }, (_, n) => uid(0x10000 + n));
  const brim = linkMapImages(freeze(withNode(floor, CLASS_CAMERA, { viewIds: many })), tie(), shots);
  assert.equal(brim.complete, false);
  assert.deepEqual(viewsOf(brim.map, CLASS_CAMERA), [...many, SHOT_A]);
  validateBackgroundEntity('map', brim.map);
  assert.throws(() => validateBackgroundEntity('map', withNode(brim.map, CLASS_CAMERA, { viewIds: [...many, SHOT_A, SHOT_B] })));
  const full = freeze(withNode(floor, CLASS_CAMERA, { viewIds: [...many, SHOT_C] }));
  unchanged(linkMapImages(full, tie(), shots), full, false);
  // With no camera asked for the views are not read, nor is the camera with no view to tie.
  unchanged(linkMapImages(floor, tie({ cameraId: null, viewIds: [MISSING] }), shots), floor, true);
  unchanged(linkMapImages(floor, tie({ cameraId: uid(0x8e), viewIds: [] }), shots), floor, true);

  // The place of a space: set where the space holds what it held when the target was read (none), that node alone new.
  const intoStore = (was: string | null, patch: Partial<MapImageLink> = {}) => tie({ place: { nodeId: STORE, was }, cameraId: null, ...patch });
  const placed = linkMapImages(floor, intoStore(null), shots);
  assert.equal(placed.complete, true);
  assert.deepEqual(touched(floor, placed.map), [STORE]);
  assert.deepEqual(nodeOf(placed.map, STORE), { ...nodeOf(floor, STORE), placeId: CLASS });
  assert.deepEqual({ ...placed.map, nodes: [] }, { ...floor, nodes: [] });
  // Not over another place tied there since, and not to a locked space. A locked one that holds it already is done.
  const retied = freeze(withNode(floor, STORE, { placeId: SCHOOL }));
  unchanged(linkMapImages(retied, intoStore(null), shots), retied, false);
  unchanged(linkMapImages(floor, tie({ place: { nodeId: LOCKED_STORE, was: null }, cameraId: null }), shots), floor, false);
  for (const was of [CLASS, null]) unchanged(linkMapImages(floor, tie({ place: { nodeId: LOCKED_ROOM, was }, cameraId: null }), shots), floor, true, String(was));
  // The place of the map: set where it has none, never over the one it has.
  const ownPlace = (was: string | null, placeId: string) => tie({ place: { nodeId: null, was }, placeId, cameraId: null });
  const named = linkMapImages(annex, ownPlace(null, SCHOOL), shots);
  assert.deepEqual(named, { map: { ...annex, placeId: SCHOOL }, complete: true });
  assert.equal(named.map.nodes, annex.nodes);
  unchanged(linkMapImages(floor, ownPlace(null, CLASS), shots), floor, false);
  // `was`: an owner that holds the id of a place gone since, as it did when the target was read, is set. Asked of one that held
  // none, it is not.
  const goneStore = freeze(withNode(floor, STORE, { placeId: GONE }));
  assert.deepEqual(linkMapImages(goneStore, intoStore(GONE), shots), { map: withNode(floor, STORE, { placeId: CLASS }), complete: true });
  unchanged(linkMapImages(goneStore, intoStore(null), shots), goneStore, false);
  const goneAnnex: BackgroundMap = freeze({ ...annex, placeId: GONE });
  assert.deepEqual(linkMapImages(goneAnnex, ownPlace(GONE, SCHOOL), shots), { map: { ...annex, placeId: SCHOOL }, complete: true });
  unchanged(linkMapImages(goneAnnex, ownPlace(null, SCHOOL), shots), goneAnnex, false);
  // A target that had its place carries that tie too (`was`: the place itself). Held still: the same map, done. Another place
  // tied there since, or none, or the owner gone: the same map, not done.
  unchanged(linkMapImages(floor, tie({ cameraId: null }), shots), floor, true);
  unchanged(linkMapImages(floor, ownPlace(SCHOOL, SCHOOL), shots), floor, true);
  for (const changed of [withNode(floor, CLASSROOM, { placeId: SCHOOL }), withNode(floor, CLASSROOM, { placeId: null }), { ...floor, nodes: floor.nodes.filter(node => node.id !== CLASSROOM) }])
    unchanged(linkMapImages(freeze(changed), tie({ cameraId: null }), shots), changed, false);
  const otherOwn: BackgroundMap = freeze({ ...floor, placeId: CLASS });
  unchanged(linkMapImages(otherOwn, ownPlace(SCHOOL, SCHOOL), shots), otherOwn, false);
  // The place not set, the views tied all the same: the map changed, and it is not done.
  const viewsAlone = linkMapImages(retied, intoStore(null, { cameraId: STORE_CAMERA }), shots);
  assert.equal(viewsAlone.complete, false);
  assert.deepEqual(touched(retied, viewsAlone.map), [STORE_CAMERA]);
  assert.deepEqual(viewsOf(viewsAlone.map, STORE_CAMERA), [SHOT_A, SHOT_B]);
  // What the library does not have is not tied: a background deleted meanwhile is left out and the rest go on; a place that is
  // gone is not set, and is not taken for tied where the owner holds its id.
  const some = linkMapImages(floor, tie({ viewIds: [SHOT_A, MISSING, SHOT_B] }), shots);
  assert.equal(some.complete, false);
  assert.deepEqual(viewsOf(some.map, CLASS_CAMERA), [SHOT_A, SHOT_B]);
  unchanged(linkMapImages(floor, tie({ viewIds: [MISSING] }), shots), floor, false);
  unchanged(linkMapImages(floor, intoStore(null, { placeId: GONE }), shots), floor, false);
  unchanged(linkMapImages(annex, ownPlace(null, GONE), shots), annex, false);
  unchanged(linkMapImages(goneStore, intoStore(GONE, { placeId: GONE }), shots), goneStore, false);
});

test('M-7b: where a link stands now, whether anything is to be tied, and how an ended batch reads now', () => {
  // Three backgrounds put in for 교실 카메라 and tied in a draft of 2층; the library once that draft is saved.
  const link = tie({ viewIds: [SHOT_A, SHOT_B, SHOT_C] }), drafted = linkMapImages(floor, link, shots).map;
  const saved = lib({ views: shots.views, maps: [drafted, annex] }), savedFloor = saved.maps[0];
  // Held by the map on show alone: the draft's. By the saved map: kept, whatever is on show. By neither (taken back, the draft
  // discarded, another map on show), or with no map at all: undone.
  assert.equal(mapImageLinkNow(floor, drafted, link, shots), 'draft');
  assert.equal(mapImageLinkNow(savedFloor, savedFloor, link, saved), 'kept');
  assert.equal(mapImageLinkNow(savedFloor, undefined, link, saved), 'kept');
  assert.equal(mapImageLinkNow(floor, floor, link, shots), 'undone');
  assert.equal(mapImageLinkNow(floor, undefined, link, shots), 'undone');
  assert.equal(mapImageLinkNow(undefined, undefined, link, shots), 'undone');
  // A picture deleted since is not counted: one of the three deleted, the draft holds the other two, whether it has let go of
  // the third yet or not.
  const two = lib({ views: shots.views.filter(item => item.id !== SHOT_C) });
  assert.equal(mapImageLinkNow(floor, drafted, link, two), 'draft');
  assert.equal(mapImageLinkNow(floor, dropMissingViews(drafted, new Set([SHOT_A, SHOT_B])), link, two), 'draft');
  // Put into a space whose place the saved map ties: kept. All three deleted: gone, wherever the link is — saved, in the
  // draft, taken back.
  const intoRoom = tie({ cameraId: null, viewIds: [SHOT_A, SHOT_B, SHOT_C] });
  assert.equal(mapImageLinkNow(floor, floor, intoRoom, shots), 'kept');
  assert.equal(mapImageLinkNow(floor, floor, intoRoom, library), 'gone');
  assert.equal(mapImageLinkNow(floor, drafted, link, library), 'gone');
  assert.equal(mapImageLinkNow(floor, floor, link, library), 'gone');
  // A link with no picture in it from the start, a place alone, is never gone.
  const placeOnly = tie({ place: { nodeId: STORE, was: null }, cameraId: null, viewIds: [] }), placed = linkMapImages(floor, placeOnly, library).map;
  assert.equal(mapImageLinkNow(floor, placed, placeOnly, library), 'draft');
  assert.equal(mapImageLinkNow(floor, floor, placeOnly, library), 'undone');
  // Put into a space whose place the draft alone ties, since the last save: the draft's. That draft saved: kept. Discarded:
  // undone.
  const tiedStore = withNode(floor, STORE, { placeId: CLASS }), intoStore = tie({ place: { nodeId: STORE, was: CLASS }, cameraId: null });
  assert.equal(mapImageLinkNow(floor, tiedStore, intoStore, shots), 'draft');
  const storeSaved = lib({ views: shots.views, maps: [tiedStore, annex] });
  assert.equal(mapImageLinkNow(storeSaved.maps[0], storeSaved.maps[0], intoStore, storeSaved), 'kept');
  assert.equal(mapImageLinkNow(floor, floor, intoStore, shots), 'undone');

  // Something to tie: a picture of the batch, or a place asked for that the library has. Not a new place that could not be
  // saved, nor a place that was there with no picture put in.
  assert.equal(mapImageLinkWanted(intoStore, library), true);
  assert.equal(mapImageLinkWanted(placeOnly, library), true);
  assert.equal(mapImageLinkWanted(tie({ place: { nodeId: STORE, was: GONE }, cameraId: null, viewIds: [] }), library), true);
  assert.equal(mapImageLinkWanted({ ...placeOnly, placeId: uid(0x8d) }, library), false);
  assert.equal(mapImageLinkWanted(tie({ cameraId: null, viewIds: [] }), library), false);
  assert.equal(mapImageLinkWanted(tie({ viewIds: [] }), library), false);

  // How a batch that ended reads now. Its link the draft's, whole: followed, to the draft, kept or undone.
  const ended = (how: MapImageOutcome['link'], more: Partial<MapImageOutcome> = {}): MapImageOutcome =>
    freeze({ scope: 'camera', targetName: '교실 카메라', placeName: '2-1 교실', added: 3, reused: 0, failed: 0, over: 0, link: how, ...more });
  const whole = ended('draft');
  assert.deepEqual(mapImageOutcomeNow(whole, link, floor, drafted, shots), whole);
  assert.deepEqual(mapImageOutcomeNow(whole, link, savedFloor, savedFloor, saved), { ...whole, link: 'kept' });
  assert.deepEqual(mapImageOutcomeNow(whole, link, floor, floor, shots), { ...whole, link: 'undone' });
  // Any other reads as it ended, the very object, wherever its link is now: tied to the draft in part, saved at once whole or
  // in part, nothing to tie, missed, failed.
  const others = [ended('draft', { partial: true }), ended('saved'), ended('saved', { partial: true }), ended('none'), ended('missed'),
    ended('failed', { linkCause: '서버에서 답을 받지 못했어요. 인터넷 연결을 확인해 주세요.' })];
  for (const outcome of others) for (const [before, shown, now] of [[floor, drafted, shots], [savedFloor, savedFloor, saved], [floor, floor, shots]] as const)
    assert.equal(mapImageOutcomeNow(outcome, link, before, shown, now), outcome, `${outcome.link}${outcome.partial ? ', partial' : ''}`);
  // Its pictures all deleted since: gone, whatever it was.
  for (const outcome of [whole, ...others]) assert.deepEqual(mapImageOutcomeNow(outcome, link, floor, drafted, library), { ...outcome, link: 'gone' }, outcome.link);
  // A place tied alone in the draft, no picture put in: followed as well.
  const placeAlone = ended('draft', { scope: 'space', targetName: '창고', added: 0, failed: 3 }), placeSaved = lib({ maps: [placed, annex] });
  assert.deepEqual(mapImageOutcomeNow(placeAlone, placeOnly, floor, placed, library), placeAlone);
  assert.deepEqual(mapImageOutcomeNow(placeAlone, placeOnly, placeSaved.maps[0], placeSaved.maps[0], placeSaved), { ...placeAlone, link: 'kept' });
  assert.deepEqual(mapImageOutcomeNow(placeAlone, placeOnly, floor, floor, library), { ...placeAlone, link: 'undone' });
});

test('M-9: mapLinksAdded, dropMissingViews and the six facts of a paste', () => {
  // The saved map: 2층 as it is, with two views of 교실 카메라.
  const before = freeze(withNode(floor, CLASS_CAMERA, { viewIds: [SHOT_A, SHOT_B] }));
  // Nothing added: the same map, a copy of it, or ties undone alone (the place of the map and of a room taken off, a view taken off).
  assert.equal(mapLinksAdded(before, before), false);
  assert.equal(mapLinksAdded(before, { ...before, nodes: before.nodes.map(node => ({ ...node })) }), false);
  assert.equal(mapLinksAdded(before, withNode(withNode({ ...before, placeId: null }, CLASSROOM, { placeId: null }), CLASS_CAMERA, { viewIds: [SHOT_B] })), false);
  // A view more, a place for a space, a place for the map: added. Another place than the saved one as well, and a view added
  // where another is taken off.
  assert.equal(mapLinksAdded(before, withNode(before, CLASS_CAMERA, { viewIds: [SHOT_A, SHOT_B, SHOT_C] })), true);
  assert.equal(mapLinksAdded(before, withNode(before, STORE, { placeId: CLASS })), true);
  assert.equal(mapLinksAdded(annex, { ...annex, placeId: SCHOOL }), true);
  assert.equal(mapLinksAdded(before, withNode(before, CLASSROOM, { placeId: SCHOOL })), true);
  assert.equal(mapLinksAdded(before, { ...before, placeId: CLASS }), true);
  assert.equal(mapLinksAdded(before, withNode(before, CLASS_CAMERA, { viewIds: [SHOT_C] })), true);
  // A space drawn since with a place, a camera placed since with a view: added, and so with no saved map. Drawn with none: not.
  const [NEW_ROOM, NEW_LENS] = [0x8a, 0x8b].map(uid);
  const drawn = (...added: BackgroundNode[]): BackgroundMap => ({ ...annex, nodes: [...annex.nodes, ...added] });
  for (const node of [room(NEW_ROOM, '새 공간', 1500, 0, 200, 200, { placeId: CLASS }), lens(NEW_LENS, '카메라 9', 1600, 100, { viewIds: [SHOT_A] })]) {
    assert.equal(mapLinksAdded(annex, drawn(node)), true, node.name);
    assert.equal(mapLinksAdded(undefined, { ...annex, nodes: [node] }), true, node.name);
  }
  const bare = [room(NEW_ROOM, '새 공간', 1500, 0, 200, 200), lens(NEW_LENS, '카메라 9', 1600, 100)];
  assert.equal(mapLinksAdded(annex, drawn(...bare)), false);
  assert.equal(mapLinksAdded(undefined, { ...annex, nodes: bare }), false);
  // With no saved map every tie the draft holds is added: the place of the map, the place of a room.
  assert.equal(mapLinksAdded(undefined, floor), true);
  assert.equal(mapLinksAdded(undefined, annex), true);

  // A draft lets go of a background that is gone: that id alone comes off, the rest stay in their order, every other node as
  // it was. With nothing to take off: the map itself.
  const loose = freeze(withNode(withNode(floor, CLASS_CAMERA, { viewIds: [SHOT_A, MISSING, SHOT_B] }), STORE_CAMERA, { viewIds: [MISSING] }));
  const there = new Set([SHOT_A, SHOT_B, SHOT_C]), dropped = dropMissingViews(loose, there);
  assert.deepEqual(dropped, withNode(withNode(floor, CLASS_CAMERA, { viewIds: [SHOT_A, SHOT_B] }), STORE_CAMERA, { viewIds: [] }));
  assert.deepEqual(touched(loose, dropped), [CLASS_CAMERA, STORE_CAMERA]);
  assert.equal(dropMissingViews(dropped, there), dropped);
  assert.equal(dropMissingViews(floor, new Set()), floor);

  // A paste goes to the pictures only when all six hold: the editor on show, an account that may change it, a map, no dialog,
  // the cursor in no field, nothing dragged. Any one turned, it does not.
  const wanted = { shown: true, canManage: true, hasMap: true, dialog: false, text: false, dragging: false };
  assert.equal(mapImagePasteWanted(wanted), true);
  for (const key of Object.keys(wanted) as (keyof typeof wanted)[]) assert.equal(mapImagePasteWanted({ ...wanted, [key]: !wanted[key] }), false, key);
  // The cursor in a field alone is in the way: asked again without it, it would go (the line of K18 tells why it did not).
  // With a dialog open, or another tab on show, as well: not even then.
  const inField = { ...wanted, text: true };
  assert.equal(mapImagePasteWanted(inField), false);
  assert.equal(mapImagePasteWanted({ ...inField, text: false }), true);
  for (const also of [{ dialog: true }, { shown: false }]) assert.equal(mapImagePasteWanted({ ...inField, ...also, text: false }), false, Object.keys(also)[0]);
});
