import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_SNAP_PREFERENCE_KEY, doubleClickNodeId, planNodeHandles, planVertexHandles, readSnapPreference, storeSnapPreference } from '../src/features/backgrounds/mapPlanEdit.ts';
import type { PlanNodeHandles } from '../src/features/backgrounds/mapPlanEdit.ts';
import { nodePlanOutline } from '../src/features/backgrounds/mapSpatial.ts';
import type { BackgroundCamera, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';

const near = (actual: number, expected: number, label = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label} ${actual} != ${expected}`);

const room: BackgroundSpace = { id: 'room', type: 'space', name: '교실', placeId: null, childMapId: null, x: 100, y: 100, width: 200, height: 100, rotation: 0, shape: 'rect', points: [], locked: false };
const chair: BackgroundSymbol = { id: 'chair', type: 'symbol', name: '의자', symbol: 'chair', spaceId: null, x: 300, y: 300, width: 40, height: 40, rotation: 0, locked: false, hinge: 'left', swing: 'inward' };
const camera: BackgroundCamera = { id: 'camera', type: 'camera', name: '카메라 1', x: 500, y: 340, spaceId: null, angle: 0, fov: 60, viewIds: [], locked: false };
const polygonRoom = (...points: BackgroundPoint[]): BackgroundSpace => ({ ...room, shape: 'polygon', points });
/** The polygon a rectangle turns into: it keeps a point on the bottom-right corner. */
const squared = polygonRoom({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 });

const boxOf = (node: BackgroundNode, scale: number, vertexHandles = false) => {
  const handles = planNodeHandles(node, scale, vertexHandles);
  assert.equal(handles.kind, 'box');
  return handles as Extract<PlanNodeHandles, { kind: 'box' }>;
};
const cameraOf = (node: BackgroundNode, scale: number) => {
  const handles = planNodeHandles(node, scale, false);
  assert.equal(handles.kind, 'camera');
  return handles as Extract<PlanNodeHandles, { kind: 'camera' }>;
};

test('at scale 1 the handles stand where the editor drew them in map units', () => {
  assert.deepEqual(planNodeHandles(room, 1, false), { kind: 'box', radius: 7, lift: 28, resize: { x: 194, y: 94, size: 12, shifted: false } });
  assert.deepEqual(planNodeHandles(chair, 1, false), { kind: 'box', radius: 7, lift: 25, resize: { x: 34, y: 34, size: 12, shifted: false } });
  // A level fan reaches the handle, so there is nothing to bridge.
  assert.deepEqual(planNodeHandles(camera, 1, false), { kind: 'camera', distance: 80, radius: 7, guide: null });
  const tilted = cameraOf({ ...camera, pitch: 60 }, 1);
  assert.equal(tilted.distance, 80); assert.equal(tilted.radius, 7);
  near(tilted.guide!.from, 40, 'from'); assert.equal(tilted.guide!.to, 73);
  // A fan shorter than the camera body starts the guide at the body, a vertical one at its ring.
  const steep = cameraOf({ ...camera, pitch: 85 }, 1);
  assert.deepEqual(steep.guide, { from: 12, to: 73 });
  assert.deepEqual(planNodeHandles({ ...camera, pitch: 90 }, 1, false), { kind: 'camera', distance: 80, radius: 7, guide: { from: 18, to: 73 } });
  // The fan is as long wherever the camera points: its handles live in its own turned frame.
  for (const angle of [90, 180, 217]) {
    assert.deepEqual(planNodeHandles({ ...camera, angle }, 1, false), { kind: 'camera', distance: 80, radius: 7, guide: null });
    near(cameraOf({ ...camera, angle, pitch: 60 }, 1).guide!.from, 40, `from at ${angle}`);
  }
});

test('handles keep their size on screen at any zoom', () => {
  for (const scale of [0.25, 4]) {
    const handles = boxOf(room, scale);
    assert.equal(handles.radius / scale, 7); assert.equal(handles.lift / scale, 28);
    assert.equal(handles.resize!.size / scale, 12);
    assert.equal((room.width - handles.resize!.x) / scale, 6); assert.equal((room.height - handles.resize!.y) / scale, 6);
    assert.equal(handles.resize!.shifted, false);
    assert.equal(boxOf(chair, scale).lift / scale, 25);
    assert.equal(cameraOf(camera, scale).radius / scale, 7);
  }
});

test('the camera direction handle sits on the fan end but never closer than 40px on screen', () => {
  assert.equal(cameraOf(camera, 1).distance, 80);
  assert.equal(cameraOf(camera, 2).distance, 80);
  assert.equal(cameraOf(camera, 2).guide, null);
  // Zoomed far out the handle stands beyond the fan and the guide bridges the gap.
  assert.deepEqual(planNodeHandles(camera, 5, false), { kind: 'camera', distance: 200, radius: 35, guide: { from: 80, to: 165 } });
});

test('the camera guide is drawn only while the fan ends more than 8px short of the handle', () => {
  // Pitch 25 leaves a 72.5 fan, pitch 30 a 69.3 one.
  assert.equal(cameraOf({ ...camera, pitch: 25 }, 1).guide, null);
  const short = cameraOf({ ...camera, pitch: 30 }, 1).guide!;
  near(short.from, 80 * Math.cos(Math.PI / 6), 'from'); assert.equal(short.to, 73);
  // Pitch 26.5 leaves a 71.6 fan, 8.4px short: the threshold is 8px, not 9.
  const barely = cameraOf({ ...camera, pitch: 26.5 }, 1).guide!;
  near(barely.from, 80 * Math.cos(26.5 * Math.PI / 180), 'from'); assert.equal(barely.to, 73);
  // At scale 2 the same 8px are 16 map units.
  assert.equal(cameraOf({ ...camera, pitch: 30 }, 2).guide, null);
  // Exactly 8px short (handle at 100, level fan at 80, scale 2.5) still gets none.
  assert.deepEqual(planNodeHandles(camera, 2.5, false), { kind: 'camera', distance: 100, radius: 17.5, guide: null });
});

test('a node whose long side is under 12px on screen has no resize square', () => {
  const dot: BackgroundSymbol = { ...chair, width: 10, height: 10 };
  assert.deepEqual(planNodeHandles(dot, 1, false), { kind: 'box', radius: 7, lift: 25, resize: null });
  assert.deepEqual(boxOf(dot, 0.5).resize, { x: 7, y: 7, size: 6, shifted: false });
  assert.deepEqual(boxOf({ ...chair, width: 12, height: 12 }, 1).resize, { x: 6, y: 6, size: 12, shifted: false });
  // The limit is the square's own 12px: 11.5px is still under it.
  assert.equal(boxOf({ ...chair, width: 11.5, height: 11.5 }, 1).resize, null);
  const wall: BackgroundSpace = { ...room, width: 400, height: 12 };
  assert.deepEqual(boxOf(wall, 1).resize, { x: 394, y: 6, size: 12, shifted: false });
  // The long side decides: 200px by 6px keeps the square, 10px by 0.3px loses it.
  assert.deepEqual(boxOf(wall, 2).resize, { x: 388, y: 0, size: 24, shifted: false });
  assert.equal(boxOf(wall, 40).resize, null);
  // Either side can be the long one: a wall standing 6px wide and 200px tall keeps it too.
  assert.deepEqual(boxOf({ ...room, width: 12, height: 400 }, 2).resize, { x: 0, y: 388, size: 24, shifted: false });
});

test('the resize square steps outside the corner when a point handle sits on it', () => {
  assert.deepEqual(boxOf(squared, 1, true).resize, { x: 208, y: 108, size: 12, shifted: true });
  assert.deepEqual(boxOf(squared, 1, false).resize, { x: 194, y: 94, size: 12, shifted: false });
  // 20px across from the corner: the point's hit area no longer reaches the square.
  const cleared = polygonRoom({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.9, y: 1 }, { x: 0, y: 1 });
  assert.deepEqual(boxOf(cleared, 1, true).resize, { x: 194, y: 94, size: 12, shifted: false });
  // 14px across and 10px up: still within reach on both axes.
  const close = polygonRoom({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.93, y: 0.9 }, { x: 0, y: 1 });
  assert.equal(boxOf(close, 1, true).resize!.shifted, true);
  // The reach is 15px (half the square plus the point's hit area): 14.5px across is inside it, 15.5px is not.
  const across = (x: number) => polygonRoom({ x: 0, y: 0 }, { x: 1, y: 0 }, { x, y: 1 }, { x: 0, y: 1 });
  assert.equal(boxOf(across(0.9275), 1, true).resize!.shifted, true);
  assert.equal(boxOf(across(0.9225), 1, true).resize!.shifted, false);
  // Exactly 15px across or up (75 map units at scale 5) is out of reach as well.
  const edge = polygonRoom({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.25 }, { x: 0.625, y: 1 }, { x: 0, y: 1 });
  assert.equal(boxOf(edge, 5, true).resize!.shifted, false);
  assert.deepEqual(boxOf(squared, 2, true).resize, { x: 216, y: 116, size: 24, shifted: true });
  // The reach is a screen distance too: the same 20 map units are 10px at scale 2.
  assert.equal(boxOf(cleared, 2, true).resize!.shifted, true);
  // Only a polygon shows point handles, whatever a rectangle or an ellipse still carries in `points`.
  for (const vertexHandles of [false, true]) {
    assert.deepEqual(boxOf(room, 1, vertexHandles).resize, { x: 194, y: 94, size: 12, shifted: false });
    assert.equal(boxOf({ ...squared, shape: 'rect' }, 1, vertexHandles).resize!.shifted, false);
    assert.equal(boxOf({ ...squared, shape: 'ellipse' }, 1, vertexHandles).resize!.shifted, false);
    assert.deepEqual(boxOf(chair, 1, vertexHandles).resize, { x: 34, y: 34, size: 12, shifted: false });
  }
});

test('point handles show for an unlocked polygon whose long side is at least 32px on screen', () => {
  assert.ok(planVertexHandles(squared, 1));
  assert.equal(planVertexHandles(room, 1), null);
  // Only the shape counts, whatever a rectangle or an ellipse still carries in `points`.
  assert.equal(planVertexHandles({ ...squared, shape: 'rect' }, 1), null);
  assert.equal(planVertexHandles({ ...squared, shape: 'ellipse' }, 1), null);
  assert.equal(planVertexHandles({ ...squared, locked: true }, 1), null);
  assert.equal(planVertexHandles(polygonRoom({ x: 0, y: 0 }, { x: 1, y: 1 }), 1), null);
  // 200 map units are 32px at scale 6.25: under that the hit areas of the points would cover the body.
  assert.ok(planVertexHandles(squared, 6.25));
  assert.equal(planVertexHandles(squared, 6.5), null);
  assert.equal(planVertexHandles(squared, 40), null);
  // Either side can be the long one.
  assert.ok(planVertexHandles({ ...squared, width: 12, height: 400 }, 12.5));
  assert.equal(planVertexHandles({ ...squared, width: 12, height: 400 }, 13), null);
});

test('the point handles stand on the plan outline of the polygon, turned with it', () => {
  assert.deepEqual(planVertexHandles(squared, 1)!.vertices, [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }]);
  const bent = polygonRoom({ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, { x: 1, y: 1 }, { x: 0, y: 1 });
  for (const source of [squared, bent]) for (const rotation of [0, 37, 90, 270]) for (const scale of [0.25, 1, 4]) {
    const space = { ...source, rotation }, handles = planVertexHandles(space, scale)!, label = `${source.points.length} points at ${rotation}, scale ${scale}`;
    // Plan positions, in the stored order: they do not depend on the zoom.
    assert.deepEqual(handles.vertices, nodePlanOutline(space), label);
    assert.equal(handles.vertices.length, source.points.length, label);
  }
  // Turned a quarter about its centre (200, 150), the first point is the top-right corner on screen.
  const quarter = planVertexHandles({ ...squared, rotation: 90 }, 1)!.vertices;
  near(quarter[0].x, 250, 'x'); near(quarter[0].y, 50, 'y'); near(quarter[2].x, 150, 'x'); near(quarter[2].y, 250, 'y');
});

test('a + stands in the middle of every edge that is at least 28px long on screen', () => {
  // Edge `index` runs from point `index` to the next one, and the last edge back to the first point.
  assert.deepEqual(planVertexHandles(squared, 1)!.edges, [{ index: 0, point: { x: 200, y: 100 } }, { index: 1, point: { x: 300, y: 150 } },
    { index: 2, point: { x: 200, y: 200 } }, { index: 3, point: { x: 100, y: 150 } }]);
  const indexes = (space: BackgroundSpace, scale: number) => planVertexHandles(space, scale)!.edges.map(edge => edge.index);
  // At scale 4 the 200 sides are 50px and the 100 sides 25px.
  assert.deepEqual(indexes(squared, 4), [0, 2]);
  // 112 map units are exactly 28px there, 111 are not.
  assert.deepEqual(indexes({ ...squared, height: 112 }, 4), [0, 1, 2, 3]);
  assert.deepEqual(indexes({ ...squared, height: 111 }, 4), [0, 2]);
  // An edge is measured along itself: the slanted one is 141.4 long (35px), though only 100 across and 100 down.
  const slanted = polygonRoom({ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 });
  assert.deepEqual(indexes(slanted, 4), [0, 3]);
  // Turned, each + is midway between the two turned points.
  const turned = { ...squared, rotation: 37 }, handles = planVertexHandles(turned, 1)!, outline = nodePlanOutline(turned);
  assert.deepEqual(handles.edges, outline.map((point, index) => {
    const next = outline[(index + 1) % outline.length];
    return { index, point: { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 } };
  }));
});

test('a polygon that already has 200 points gets no +', () => {
  const ring = (count: number) => polygonRoom(...Array.from({ length: count }, (_, index) =>
    ({ x: 0.5 + Math.cos(index / count * Math.PI * 2) / 2, y: 0.5 + Math.sin(index / count * Math.PI * 2) / 2 })));
  const wide = (count: number) => ({ ...ring(count), width: 400, height: 400 });
  // Zoomed in to scale 0.1, each edge of about 6.3 map units is some 63px long.
  const full = planVertexHandles(wide(200), 0.1)!, almost = planVertexHandles(wide(199), 0.1)!;
  assert.equal(full.vertices.length, 200); assert.deepEqual(full.edges, []);
  assert.equal(almost.vertices.length, 199); assert.equal(almost.edges.length, 199);
  assert.deepEqual(almost.edges.map(edge => edge.index), almost.vertices.map((_, index) => index));
  // At scale 1 the same edges are under 28px: the points keep their handles, without a + between them.
  const packed = planVertexHandles(wide(199), 1)!;
  assert.equal(packed.vertices.length, 199); assert.deepEqual(packed.edges, []);
});

test('a double-click acts on the node its first press picked from the pile, else on the node under it', () => {
  // The first press was on the pile member already picked: the double-click is about that one, not the topmost.
  assert.equal(doubleClickNodeId('c', 'a', ['a', 'b', 'c']), 'c');
  assert.equal(doubleClickNodeId('b', 'a', ['a', 'b', 'c']), 'b');
  // The pressed node itself, piled or alone.
  assert.equal(doubleClickNodeId('a', 'a', ['a']), 'a');
  assert.equal(doubleClickNodeId('a', 'a', ['a', 'b', 'c']), 'a');
  assert.equal(doubleClickNodeId('a', 'a', []), 'a');
  // A first press that acted on something outside the pile says nothing about this spot.
  assert.equal(doubleClickNodeId('x', 'a', ['a', 'b']), 'a');
  assert.equal(doubleClickNodeId('x', 'a', []), 'a');
  // A first press on a handle or on nothing acted on no node.
  assert.equal(doubleClickNodeId(null, 'a', ['a', 'b']), 'a');
  assert.equal(doubleClickNodeId(null, 'a', []), 'a');
});

/** Runs `body` with `storage` in the place of the browser storage (with none at all for null), then puts back what was there. */
function withStorage(storage: object | null, body: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  if (storage) Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  else delete (globalThis as { localStorage?: unknown }).localStorage;
  try { body(); } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}
const memoryStorage = (entries: [string, string][] = []) => {
  const items = new Map(entries);
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
};

test('without a storage snapping is on, and storing the choice does not throw', () => {
  withStorage(null, () => {
    assert.equal(typeof (globalThis as { localStorage?: unknown }).localStorage, 'undefined');
    assert.equal(readSnapPreference(), true);
    assert.doesNotThrow(() => storeSnapPreference(false));
    assert.doesNotThrow(() => storeSnapPreference(true));
    assert.equal(readSnapPreference(), true);
  });
  // A storage that refuses to be read or written is the same as none.
  const refusing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  withStorage(refusing, () => {
    assert.equal(readSnapPreference(), true);
    assert.doesNotThrow(() => storeSnapPreference(false));
  });
});

test('snapping is off only when this device stored off', () => {
  assert.equal(MAP_SNAP_PREFERENCE_KEY, 'bflow.background-map.snap.v1');
  const key = 'bflow.background-map.snap.v1', before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  withStorage(memoryStorage(), () => assert.equal(readSnapPreference(), true));
  withStorage(memoryStorage([[key, 'off']]), () => assert.equal(readSnapPreference(), false));
  for (const stored of ['on', '', 'OFF', 'false', '0']) withStorage(memoryStorage([[key, stored]]), () => assert.equal(readSnapPreference(), true, `"${stored}"`));
  // Only its own key counts.
  withStorage(memoryStorage([['bflow.background-map.panel-height.v1', 'off']]), () => assert.equal(readSnapPreference(), true));

  const storage = memoryStorage();
  withStorage(storage, () => {
    storeSnapPreference(false);
    assert.deepEqual([...storage.items], [[key, 'off']]); assert.equal(readSnapPreference(), false);
    storeSnapPreference(true);
    assert.deepEqual([...storage.items], [[key, 'on']]); assert.equal(readSnapPreference(), true);
  });
  // The stand-in is gone again.
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), before);
});
