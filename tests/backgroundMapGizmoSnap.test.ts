import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_GIZMO_SNAP, snapGizmoPose } from '../src/features/backgrounds/mapGizmoSnap.ts';
import { applyNodeWorldPose } from '../src/features/backgrounds/mapGeometry.ts';
import type { NodeWorldPoseInput } from '../src/features/backgrounds/mapGeometry.ts';
import { cameraAngles, cameraOrientation, nodeOrientation, nodeWorldPose } from '../src/features/backgrounds/mapSpatial.ts';
import type { Map3DGizmoMode, Map3DSnapRequest } from '../src/features/backgrounds/mapCanvas.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';

const near = (actual: number, expected: number, label = '', epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${label} ${actual} != ${expected}`);
const space = (id: string, x: number, y: number, width: number, height: number, extra: Partial<BackgroundSpace> = {}): BackgroundSpace =>
  ({ id, type: 'space', name: id, placeId: null, childMapId: null, x, y, width, height, rotation: 0, shape: 'rect', points: [], locked: false, ...extra });
const symbol = (id: string, kind: BackgroundSymbol['symbol'], x: number, y: number, width: number, height: number, extra: Partial<BackgroundSymbol> = {}): BackgroundSymbol =>
  ({ id, type: 'symbol', name: id, symbol: kind, spaceId: null, x, y, width, height, rotation: 0, locked: false, hinge: 'left', swing: 'inward', ...extra });
const camera = (id: string, x: number, y: number, extra: Partial<BackgroundCamera> = {}): BackgroundCamera =>
  ({ id, type: 'camera', name: id, x, y, spaceId: null, angle: 0, fov: 60, viewIds: [], locked: false, elevation: 120, ...extra });
const plan = (...nodes: BackgroundNode[]): BackgroundMap => ({ id: 'map', revision: 1, name: '학교', parentId: null, placeId: null, imageUrl: '', nodes });

/** A room 200 x 150 (180 high), a table (60 high) and a chair (70 high) beside it, and a camera at 120. */
const room = space('room', 100, 100, 200, 150), table = symbol('table', 'table', 400, 120, 60, 40), chair = symbol('chair', 'chair', 500, 150, 40, 40);
const lens = camera('lens', 700, 200, { angle: 30, pitch: -20 });
const map = plan(room, table, chair, lens);

/** The root of a node as the scene draws it. */
const rootOf = (node: BackgroundNode): NodeWorldPoseInput => {
  const { position, quaternion } = nodeWorldPose(node);
  return { position: { ...position }, quaternion: { ...quaternion }, scale: { x: 1, y: 1, z: 1 } };
};
/** One step of a drag of `node` with the handle `axis`: the root moved, turned or stretched as `change` says. */
const step = (node: BackgroundNode, mode: Map3DGizmoMode, axis: string, change: Partial<NodeWorldPoseInput>, extra: Partial<Map3DSnapRequest> = {}): Map3DSnapRequest => {
  const start = rootOf(node);
  return { map, id: node.id, mode, axis, start, pose: { ...start, ...change }, unitsPerPixel: 1, big: false, ...extra };
};
const moved = (node: BackgroundNode, by: { x?: number; y?: number; z?: number }) => {
  const at = rootOf(node).position;
  return { position: { x: at.x + (by.x ?? 0), y: at.y + (by.y ?? 0), z: at.z + (by.z ?? 0) } };
};
const snapped = (request: Map3DSnapRequest) => {
  const pose = snapGizmoPose(request);
  assert.ok(pose, 'snapped');
  return pose;
};
/** What the snapped pose stores, as the gizmo hands it on. */
const stored = <T extends BackgroundNode>(request: Map3DSnapRequest) => applyNodeWorldPose(map, request.id, snapped(request)).nodes.find(node => node.id === request.id) as T;

test('G-1: a move along the plan sticks to what is near as the plan does, else whole numbers, and Shift goes by tens', () => {
  assert.deepEqual(MAP_GIZMO_SNAP, { move: 10, turn: 15, size: 10, pitchStops: [-90, 0, 90], rollStops: [-90, 0, 90, 180] });
  // The chair slid left until its edge is 1.5 past the table's right edge (460): 6 pixels catch it there.
  const caught = step(chair, 'translate', 'X', moved(chair, { x: -38.5 }));
  assert.equal(stored<BackgroundSymbol>(caught).x, 460);
  near(snapped(caught).position.x, 480, 'the root is the middle of the chair');
  // Only the axis of the handle: the depth and the height stay as the handles had them.
  assert.equal(snapped(caught).position.z, rootOf(chair).position.z); assert.equal(snapped(caught).position.y, 0);
  assert.equal(stored<BackgroundSymbol>(caught).y, 150);
  // Twelve pixels away at a pixel a unit: nothing near enough, a whole number.
  assert.equal(stored<BackgroundSymbol>(step(chair, 'translate', 'X', moved(chair, { x: -32.6 }))).x, 467);
  // The same move where a pixel is a tenth of a unit: 1.5 units are 15 pixels, too far.
  assert.equal(stored<BackgroundSymbol>(step(chair, 'translate', 'X', moved(chair, { x: -38.5 }), { unitsPerPixel: 0.1 })).x, 462);
  // A pixel of no known size catches nothing.
  assert.equal(stored<BackgroundSymbol>(step(chair, 'translate', 'X', moved(chair, { x: -38.5 }), { unitsPerPixel: Number.NaN })).x, 462);
  // Shift: the stored corner goes by tens, whatever is near.
  assert.equal(stored<BackgroundSymbol>(step(chair, 'translate', 'X', moved(chair, { x: -38.5 }), { big: true })).x, 460);
  assert.equal(stored<BackgroundSymbol>(step(chair, 'translate', 'X', moved(chair, { x: 104.9 }), { big: true })).x, 600);
  // Both plan axes at once (the square of X and Z): each sticks or rounds on its own.
  const both = stored<BackgroundSymbol>(step(chair, 'translate', 'XZ', moved(chair, { x: -38.5, z: 20.4 })));
  assert.deepEqual([both.x, both.y], [460, 170]);
  // What is not in the map handed over is not there to stick to: the editor hands over what the eye shows.
  assert.equal(applyNodeWorldPose(map, chair.id, snapped({ ...step(chair, 'translate', 'X', moved(chair, { x: -38.5 })), map: plan(room, chair, lens) })).nodes[2].x, 462);
  // A camera is its own point.
  assert.deepEqual([stored<BackgroundCamera>(step(lens, 'translate', 'X', moved(lens, { x: 10.6 }))).x, stored<BackgroundCamera>(step(lens, 'translate', 'Z', moved(lens, { z: -0.4 }))).y], [711, 200]);
});

test('G-2: a lift sticks the floor or the top to the floors and tops of the map, else a whole number, and Shift goes by tens', () => {
  const lifted = (node: BackgroundNode, y: number, extra: Partial<Map3DSnapRequest> = {}) => snapped(step(node, 'translate', 'Y', moved(node, { y }), extra)).position.y;
  // The chair's floor 2.5 under the table's top (60): it stands on the table.
  assert.equal(lifted(chair, 57.5), 60);
  // Its top (70 higher) 3 over the room's top (180): the top lines up with it.
  assert.equal(lifted(chair, 113), 110);
  // Nothing within six: a whole number.
  assert.equal(lifted(chair, 33.4), 33);
  assert.equal(lifted(chair, 33.4, { big: true }), 30);
  // A camera is a point: its height sticks to the room's top.
  assert.equal(lifted(lens, 57.5), 180);
  assert.equal(lifted(lens, 41.2), 161);
  // A level 0 is always there, and the plan axes are not touched by a lift.
  const down = snapped(step(chair, 'translate', 'Y', moved(chair, { y: -4 })));
  assert.equal(down.position.y, 0); assert.deepEqual([down.position.x, down.position.z], [rootOf(chair).position.x, rootOf(chair).position.z]);
  // A road has no top to offer, and a road dragged has only its floor.
  const road = space('road', 0, 600, 1000, 60, { surface: 'road', elevation: 0 }), lane = plan(road, chair);
  assert.equal(snapped({ ...step(chair, 'translate', 'Y', moved(chair, { y: 178 })), map: lane }).position.y, 178);
});

test('G-3: a turn stops at the quarter turns, and at level and either vertical for a tilt, else whole degrees; Shift by fifteens', () => {
  const turned = (node: BackgroundSpace | BackgroundSymbol, rotation: number, axis = 'Y', big = false) =>
    stored<BackgroundSpace | BackgroundSymbol>(step(node, 'rotate', axis, { quaternion: nodeOrientation({ rotation, pitch: 0, roll: 0 }) }, { big })).rotation;
  assert.equal(turned(room, 88.2), 90); assert.equal(turned(room, 47.4), 47); assert.equal(turned(room, 52, 'Y', true), 45);
  assert.equal(turned(room, 358.4), 0); assert.equal(turned(chair, 2.5), 0); assert.equal(turned(chair, 183.4, 'Y'), 183);
  // A camera: the ring about its side tilts it, about its line of sight rolls it, about its up turns it.
  const aimed = (angles: Partial<{ angle: number; pitch: number; roll: number }>, axis: string, big = false) =>
    stored<BackgroundCamera>(step(lens, 'rotate', axis, { quaternion: cameraOrientation({ ...cameraAngles(lens), ...angles }) }, { big }));
  assert.equal(aimed({ pitch: -1.8 }, 'X').pitch, 0); assert.equal(aimed({ pitch: -31.6 }, 'X').pitch, -32); assert.equal(aimed({ pitch: -88 }, 'X').pitch, -90);
  assert.equal(aimed({ pitch: -38 }, 'X', true).pitch, -45);
  assert.equal(Math.abs(aimed({ roll: 178.5 }, 'Z').roll ?? 0), 180); assert.equal(aimed({ roll: 12.6 }, 'Z').roll, 13);
  assert.equal(aimed({ angle: 271.9 }, 'Y').angle, 270); assert.equal(aimed({ angle: 61.2 }, 'Y').angle, 61);
  // What the ring does not drive stays where the handles left it.
  const tilted = aimed({ pitch: -31.6 }, 'X');
  assert.equal(tilted.angle, 30); assert.ok(!('roll' in tilted) || tilted.roll === 0);
  // A camera looking straight down reads a turn about its line of sight as a change of heading: the heading is snapped.
  const down = camera('down', 300, 300, { pitch: -90, angle: 30 }), poles = plan(room, down);
  const atPole = (axis: string, angles: { angle: number; pitch: number; roll: number }) =>
    applyNodeWorldPose(poles, down.id, snapped({ ...step(down, 'rotate', axis, { quaternion: cameraOrientation(angles) }), map: poles })).nodes[1] as BackgroundCamera;
  const spun = atPole('Z', { angle: 30, pitch: -90, roll: 20.37 });
  assert.equal(spun.pitch, -90); assert.ok(Number.isInteger(spun.angle) && spun.angle !== 30, `heading ${spun.angle}`); assert.ok(!spun.roll, `roll ${spun.roll}`);
  // Tilted off the pole by the ring about its up: the tilt changed, and it is the tilt that is snapped.
  assert.equal(atPole('Y', { angle: 30, pitch: -81.6, roll: 0 }).pitch, -82);
  // A tilted camera turned about its own up: the heading moves most, and what the turn brings to the tilt and the roll is tidied as well.
  const half = (degrees: number) => degrees * Math.PI / 360, q = cameraOrientation(cameraAngles(lens)), r = { x: 0, y: Math.sin(half(17.3)), z: 0, w: Math.cos(half(17.3)) };
  const turnedUp = { x: q.w * r.x + q.x * r.w + q.y * r.z - q.z * r.y, y: q.w * r.y - q.x * r.z + q.y * r.w + q.z * r.x, z: q.w * r.z + q.x * r.y - q.y * r.x + q.z * r.w, w: q.w * r.w - q.x * r.x - q.y * r.y - q.z * r.z };
  const swung = stored<BackgroundCamera>(step(lens, 'rotate', 'Y', { quaternion: turnedUp }));
  for (const value of [swung.angle, swung.pitch ?? 0, swung.roll ?? 0]) assert.ok(Number.isInteger(value), `${swung.angle} / ${swung.pitch} / ${swung.roll}`);
  assert.notEqual(swung.angle, 30);
  // The free rings are off, so there is nothing to snap for them.
  assert.equal(snapGizmoPose(step(lens, 'rotate', 'E', {})), null);
});

test('G-4: a stretch is whole numbers, Shift by tens, never under the least a box may have; a road keeps its height', () => {
  const stretched = (node: BackgroundSpace | BackgroundSymbol, axis: string, scale: { x?: number; y?: number; z?: number }, big = false) =>
    stored<BackgroundSpace | BackgroundSymbol>(step(node, 'scale', axis, { scale: { x: scale.x ?? 1, y: scale.y ?? 1, z: scale.z ?? 1 } }, { big }));
  assert.equal(stretched(chair, 'X', { x: 1.234 }).width, 49); assert.equal(stretched(chair, 'X', { x: 1.234 }, true).width, 50);
  assert.equal(stretched(chair, 'X', { x: 0.1 }).width, 10);
  assert.equal(stretched(room, 'Z', { z: 1.0137 }).height, 152);
  assert.equal(stretched(room, 'Y', { y: 1.1037 }).volumeHeight, 199);
  // The other lengths stay as they were.
  const wide = stretched(room, 'X', { x: 1.0137 });
  assert.deepEqual([wide.width, wide.height, wide.volumeHeight ?? 180], [203, 150, 180]);
  // A road has no walls: its height is neither written nor snapped.
  const road = space('road', 0, 600, 1000, 60, { surface: 'road' });
  const flat = snapped({ ...step(road, 'scale', 'XY', { scale: { x: 1.0004, y: 1.3, z: 1 } }), map: plan(road) });
  assert.equal(flat.scale.y, 1.3); assert.equal(1000 * flat.scale.x, 1000);
  // A camera has no size.
  assert.equal(snapGizmoPose(step(lens, 'scale', 'X', { scale: { x: 2, y: 1, z: 1 } })), null);
});

test('G-5: nothing is snapped for a node that is not there, a locked one, or a step with no handle', () => {
  assert.equal(snapGizmoPose({ ...step(chair, 'translate', 'X', moved(chair, { x: 3 })), id: 'gone' }), null);
  const locked = { ...chair, locked: true };
  assert.equal(snapGizmoPose({ ...step(locked, 'translate', 'X', moved(locked, { x: 3 })), map: plan(room, table, locked) }), null);
  assert.equal(snapGizmoPose(step(chair, 'translate', '', moved(chair, { x: 3 }))), null);
  // A request is never changed.
  const request = step(chair, 'translate', 'X', moved(chair, { x: -38.5 })), before = JSON.stringify(request);
  snapGizmoPose(request);
  assert.equal(JSON.stringify(request), before);
});
