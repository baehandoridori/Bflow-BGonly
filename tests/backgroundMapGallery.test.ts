import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMapBackgroundViews } from '../src/features/backgrounds/mapGallery.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundSnapshot, BackgroundSpace, BackgroundSymbol, BackgroundView } from '../src/features/backgrounds/types.ts';

const map = (id: string, patch: Partial<BackgroundMap> = {}): BackgroundMap => ({
  id, revision: 1, name: id, parentId: null, placeId: null, imageUrl: '', nodes: [], ...patch,
});
const space = (id: string, patch: Partial<BackgroundSpace> = {}): BackgroundSpace => ({
  id, type: 'space', name: id, placeId: null, childMapId: null, x: 0, y: 0, width: 100, height: 100,
  rotation: 0, shape: 'rect', points: [], locked: false, ...patch,
});
const camera = (id: string, viewIds: string[], spaceId: string | null = null): BackgroundCamera => ({
  id, type: 'camera', name: id, x: 0, y: 0, angle: 0, fov: 60, viewIds, spaceId, locked: false,
});
const symbol = (spaceId: string | null): BackgroundSymbol => ({
  id: 'chair', type: 'symbol', name: '의자', symbol: 'chair', spaceId, x: 0, y: 0, width: 50, height: 50,
  rotation: 0, locked: false, hinge: 'left', swing: 'inward',
});
const view = (id: string, placeId: string, patch: Partial<BackgroundView> = {}): BackgroundView => ({
  id, revision: 1, name: id, placeId, cameraPlaceId: null, visiblePlaceIds: [], relatedPlaceIds: [],
  shot: 'wide', tags: [], memo: '', variants: [], ...patch,
});
const snapshot = (views: BackgroundView[], maps: BackgroundMap[] = []): BackgroundSnapshot => ({
  places: [], maps, views, groups: [], usages: [], canManage: true,
});
const ids = (views: BackgroundView[]): string[] => views.map(item => item.id);

test('map scope combines its place, spaces, explicit cameras and all descendant maps in snapshot order', () => {
  const current = map('school', { placeId: 'school-place', nodes: [
    space('classroom', { placeId: 'classroom-place' }), camera('exterior-camera', ['outside']),
  ] });
  const floor = map('floor', { parentId: current.id, placeId: 'floor-place' });
  const detail = map('detail', { parentId: floor.id, nodes: [camera('detail-camera', ['detail-image'])] });
  const unrelated = map('unrelated', { placeId: 'unrelated-place' });
  const data = snapshot([
    view('detail-image', 'other'), view('classroom-image', 'classroom-place'), view('outside', 'outside-place'),
    view('school-image', 'school-place'), view('floor-image', 'floor-place'), view('unrelated-image', 'unrelated-place'),
  ]);
  assert.deepEqual(ids(selectMapBackgroundViews(data, [current, floor, detail, unrelated], current)), [
    'detail-image', 'classroom-image', 'outside', 'school-image', 'floor-image',
  ]);
});

test('space scope includes home, camera origin, visible destination and related-place images', () => {
  const room = space('room', { placeId: 'classroom' });
  const current = map('school', { placeId: 'school', nodes: [room, space('hall', { placeId: 'hallway' })] });
  const data = snapshot([
    view('home', 'classroom'), view('looking-out', 'hallway', { cameraPlaceId: 'classroom' }),
    view('looking-in', 'hallway', { cameraPlaceId: 'hallway', visiblePlaceIds: ['classroom'] }),
    view('closeup', 'prop', { relatedPlaceIds: ['classroom'] }), view('school-wide', 'school'), view('hall-only', 'hallway'),
  ]);
  assert.deepEqual(ids(selectMapBackgroundViews(data, [current], current, room)), ['home', 'looking-out', 'looking-in', 'closeup']);
});

test('space scope includes only its assigned cameras and linked detail branch', () => {
  const room = space('room', { childMapId: 'inside' });
  const current = map('school', { nodes: [room, camera('room-camera', ['explicit'], room.id), camera('hall-camera', ['hall'], 'hall')] });
  const inside = map('inside', { parentId: current.id, placeId: 'inside-place' });
  const closeup = map('closeup', { parentId: inside.id, nodes: [camera('closeup-camera', ['closeup'])] });
  const sibling = map('sibling', { parentId: current.id, placeId: 'sibling-place' });
  const data = snapshot([view('explicit', 'elsewhere'), view('inside', 'inside-place'), view('closeup', 'elsewhere'), view('hall', 'hall-place'), view('sibling', 'sibling-place')]);
  assert.deepEqual(ids(selectMapBackgroundViews(data, [current, inside, closeup, sibling], current, room)), ['explicit', 'inside', 'closeup']);
});

test('camera scope uses explicit view IDs only and ignores missing or duplicate IDs', () => {
  const selected = camera('camera', ['second', 'missing', 'second', 'first'], 'room');
  const current = map('school', { placeId: 'school-place', nodes: [space('room', { placeId: 'room-place' }), selected] });
  const data = snapshot([view('first', 'unrelated'), view('room-image', 'room-place'), view('second', 'unrelated'), view('school-image', 'school-place')]);
  assert.deepEqual(ids(selectMapBackgroundViews(data, [current], current, selected)), ['first', 'second']);
  assert.deepEqual(selectMapBackgroundViews(data, [current], current, { ...selected, viewIds: [] }), []);
});

test('a symbol follows its containing space or falls back to the whole map if unattached', () => {
  const room = space('room', { placeId: 'room-place' });
  const current = map('school', { placeId: 'school-place', nodes: [room, symbol(room.id)] });
  const data = snapshot([view('room-image', 'room-place'), view('school-image', 'school-place')]);
  assert.deepEqual(ids(selectMapBackgroundViews(data, [current], current, symbol(room.id))), ['room-image']);
  for (const spaceId of [null, 'missing-space']) {
    assert.deepEqual(ids(selectMapBackgroundViews(data, [current], current, symbol(spaceId))), ['room-image', 'school-image']);
  }
});

test('unlinked maps and spaces stay empty rather than falling back to every background', () => {
  const room = space('room');
  const current = map('empty', { nodes: [room, symbol(null), camera('unlinked', [])] });
  const data = snapshot([view('unrelated', 'elsewhere')]);
  assert.deepEqual(selectMapBackgroundViews(data, [current], current), []);
  assert.deepEqual(selectMapBackgroundViews(data, [current], current, room), []);
  assert.deepEqual(selectMapBackgroundViews(data, [current], current, { ...room, childMapId: 'missing-map' }), []);
});

test('duplicate links and cyclic map hierarchies terminate without duplicate views', () => {
  const room = space('room', { placeId: 'same-place', childMapId: 'child' });
  const current = map('root', { parentId: 'child', placeId: 'same-place', nodes: [room, camera('camera', ['same'])] });
  const child = map('child', { parentId: current.id, placeId: 'same-place', nodes: [camera('child-camera', ['same', 'other'])] });
  const data = snapshot([view('same', 'same-place'), view('other', 'elsewhere'), view('unrelated', 'nowhere')]);
  assert.deepEqual(ids(selectMapBackgroundViews(data, [current, child], current)), ['same', 'other']);
  assert.deepEqual(ids(selectMapBackgroundViews(data, [current, child], current, room)), ['same', 'other']);
});

test('draft maps and current map override saved nodes and topology without mutating inputs', () => {
  const saved = map('root', { placeId: 'old-place' });
  const savedChild = map('child', { parentId: null, placeId: 'old-child-place' });
  const draft = { ...saved, placeId: null, nodes: [space('room', { placeId: 'new-place' })] };
  const childDraft = { ...savedChild, parentId: draft.id, placeId: 'new-child-place' };
  const data = snapshot([view('old', 'old-place'), view('new', 'new-place'), view('old-child', 'old-child-place'), view('new-child', 'new-child-place')], [saved, savedChild]);
  const before = structuredClone({ data, saved, draft, childDraft });
  assert.deepEqual(ids(selectMapBackgroundViews(data, [saved, childDraft], draft)), ['new', 'new-child']);
  assert.deepEqual({ data, saved, draft, childDraft }, before);
});
