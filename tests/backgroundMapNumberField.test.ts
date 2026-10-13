import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';
import {
  MAP_NUMBER_FIELDS, MAP_NUMBER_SCRUB, mapNodeNumber, pressNumberTrack, scrubSteps, setMapNodeNumber, settleNumber, slideNumber, stepNumber, trackFraction, trackNumber,
} from '../src/features/backgrounds/mapNumberField.ts';
import type { MapNumberKey, MapNumberSlide } from '../src/features/backgrounds/mapNumberField.ts';
import { validateBackgroundEntity } from '../src/features/backgrounds/domain.ts';
import { moveMapNode, transformMapSpace } from '../src/features/backgrounds/mapGeometry.ts';
import { createMapDocument, gestureStartMap, mapDraft, mapDraftChanged, mapDraftSteps, reduceMapDocument } from '../src/features/backgrounds/mapDocument.ts';
import type { MapDocumentAction, MapDocumentState } from '../src/features/backgrounds/mapDocument.ts';

// The numbers of the inspector: the table of their limits and steps, one number read from a node and written to it, and the
// arithmetic of a slide and of the bar. `assert.equal` is Object.is here (node:assert/strict), so it tells -0 from 0.

const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const MAP = '00000000-0000-4000-8000-0000000000a1';
const room: BackgroundSpace = { id: '00000000-0000-4000-8000-0000000000b1', type: 'space', name: '교실', placeId: null, childMapId: null, x: 100, y: 120, width: 300, height: 200, rotation: 30, shape: 'rect', points: [], locked: false };
const road: BackgroundSpace = { id: '00000000-0000-4000-8000-0000000000b2', type: 'space', name: '도로', placeId: null, childMapId: null, x: 520, y: 410, width: 400, height: 80, rotation: 10, shape: 'rect', points: [], locked: false, surface: 'road' };
/** In the room, with none of the optional keys: its height reads as the default. */
const camera: BackgroundCamera = { id: '00000000-0000-4000-8000-0000000000c1', type: 'camera', name: '카메라 1', x: 200, y: 180, spaceId: room.id, angle: 40, fov: 60, viewIds: [], locked: false };
/** In the room, standing off the whole numbers. */
const chair: BackgroundSymbol = { id: '00000000-0000-4000-8000-0000000000d1', type: 'symbol', name: '의자', symbol: 'chair', spaceId: room.id, x: 220.5, y: 200, width: 60, height: 50, rotation: 15, locked: false, hinge: 'left', swing: 'inward' };
/** In the room and locked: nothing moves it, by itself or along with the room. */
const lockedCamera: BackgroundCamera = { id: '00000000-0000-4000-8000-0000000000c2', type: 'camera', name: '카메라 2', x: 260, y: 240, spaceId: room.id, angle: 90, fov: 50, viewIds: [], locked: true };
/** Frozen through and through: a function that wrote into the map it was handed would throw. */
const base: BackgroundMap = freeze({ id: MAP, revision: 1, name: '교실 도면', parentId: null, placeId: null, imageUrl: '', nodes: [room, road, camera, chair, lockedCamera] });

const KEYS: readonly MapNumberKey[] = ['elevation', 'volumeHeight', 'angle', 'pitch', 'roll', 'fov', 'x', 'y', 'width', 'height', 'rotation'];
/** The numbers each kind of node has a field for in the inspector: seven for a room, six for a road, seven for a camera, nine for an object. */
const FIELDS: readonly (readonly [BackgroundNode, readonly MapNumberKey[]])[] = [
  [room, ['elevation', 'volumeHeight', 'x', 'y', 'width', 'height', 'rotation']],
  [road, ['elevation', 'x', 'y', 'width', 'height', 'rotation']],
  [camera, ['elevation', 'angle', 'pitch', 'roll', 'fov', 'x', 'y']],
  [chair, ['elevation', 'volumeHeight', 'pitch', 'roll', 'x', 'y', 'width', 'height', 'rotation']],
];
const { stepPx, bigStepPx, grabPx, thumbPx } = MAP_NUMBER_SCRUB;

const nodeOf = <T extends BackgroundNode>(map: BackgroundMap, node: T) => map.nodes.find(item => item.id === node.id) as T;
/** The map with one of its nodes in another state. */
const withNode = (node: BackgroundNode): BackgroundMap => ({ ...base, nodes: base.nodes.map(item => item.id === node.id ? node : item) });
const close = (actual: number, expected: number, label = '') => assert.ok(Math.abs(actual - expected) <= 1e-9, `${label}: ${actual} != ${expected}`);
/** The same keys throughout, every number within 1e-9 and everything else the same. */
function alike(actual: unknown, expected: unknown, label: string): void {
  if (typeof actual === 'number' && typeof expected === 'number') return close(actual, expected, label);
  if (typeof actual !== 'object' || typeof expected !== 'object' || actual === null || expected === null) return assert.equal(actual, expected, label);
  assert.equal(Array.isArray(actual), Array.isArray(expected), label);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${label}: keys`);
  for (const [key, value] of Object.entries(expected)) alike((actual as Record<string, unknown>)[key], value, `${label}.${key}`);
}
/** The map the editor makes of a typed value: its patchNode, and its moveSelected for the two positions. */
function typed(map: BackgroundMap, node: BackgroundNode, key: MapNumberKey, value: number): BackgroundMap {
  if (key === 'x' || key === 'y') return moveMapNode(map, node.id, key === 'x' ? { x: value - node.x, y: 0 } : { x: 0, y: value - node.y });
  // The two directions go through the editor's normalizeAngle.
  const next = { ...node, [key]: key === 'angle' || key === 'rotation' ? ((value % 360) + 360) % 360 : value } as BackgroundNode;
  return next.type === 'space' ? transformMapSpace(map, next) : { ...map, nodes: map.nodes.map(item => item.id === next.id ? next : item) };
}
/** A plan point in the frame of a space: from its centre, with its turn taken out. */
function inSpace(space: BackgroundSpace, point: BackgroundPoint): BackgroundPoint {
  const turn = -space.rotation * Math.PI / 180, x = point.x - space.x - space.width / 2, y = point.y - space.y - space.height / 2;
  return { x: x * Math.cos(turn) - y * Math.sin(turn), y: x * Math.sin(turn) + y * Math.cos(turn) };
}
const run = (state: MapDocumentState, ...actions: MapDocumentAction[]) => actions.reduce(reduceMapDocument, state);
const draftOf = (state: MapDocumentState) => mapDraft(state, MAP)!;

test('N-1: the table of the fields is inside what a map may store', () => {
  // The limits the fields have today, row by row. A direction has no ends: it is wrapped, not held.
  assert.deepEqual(MAP_NUMBER_FIELDS, {
    elevation: { min: -100000, max: 100000, step: 1, big: 10, wrap: false, track: null },
    volumeHeight: { min: 1, max: 100000, step: 1, big: 10, wrap: false, track: null },
    x: { min: -100000, max: 100000, step: 1, big: 10, wrap: false, track: null },
    y: { min: -100000, max: 100000, step: 1, big: 10, wrap: false, track: null },
    width: { min: 10, max: 100000, step: 1, big: 10, wrap: false, track: null },
    height: { min: 10, max: 100000, step: 1, big: 10, wrap: false, track: null },
    angle: { min: -Infinity, max: Infinity, step: 1, big: 15, wrap: true, track: { min: 0, max: 359 } },
    rotation: { min: -Infinity, max: Infinity, step: 1, big: 15, wrap: true, track: { min: 0, max: 359 } },
    pitch: { min: -90, max: 90, step: 1, big: 15, wrap: false, track: { min: -90, max: 90 } },
    roll: { min: -180, max: 180, step: 1, big: 15, wrap: false, track: { min: -180, max: 180 } },
    fov: { min: 10, max: 170, step: 1, big: 10, wrap: false, track: { min: 10, max: 170 } },
  });
  // The check a save runs: it takes the map of this file, and refuses a number outside what is stored.
  assert.doesNotThrow(() => validateBackgroundEntity('map', base));
  assert.throws(() => validateBackgroundEntity('map', withNode({ ...camera, fov: 180 })), /카메라 시야/);
  // Each end of each field, written straight onto its node in a map of that node alone. Carried there by its room, a member
  // would leave the plan, and the map would be refused for a reason the table has no part in.
  let written = 0;
  for (const [node, keys] of FIELDS) for (const key of keys) {
    const { min, max, wrap } = MAP_NUMBER_FIELDS[key];
    // A direction is kept at 0 or more and under 360: the least of it, its last whole degree, and a value just under the turn.
    for (const value of wrap ? [0, 359, 359.9] : [min, max]) {
      const alone: BackgroundMap = { ...base, nodes: [{ ...node, [key]: value } as BackgroundNode] };
      assert.doesNotThrow(() => validateBackgroundEntity('map', alone), `${node.name} ${key} ${value}`);
      written++;
    }
  }
  // Twenty-nine fields with two ends each, and a third value for the four directions among them.
  assert.equal(written, 29 * 2 + 4);
});

test('N-2: mapNodeNumber reads what the inspector shows, and null where a kind has no such number', () => {
  const read = (node: BackgroundNode) => Object.fromEntries(KEYS.map(key => [key, mapNodeNumber(node, key)]));
  // A missing optional key reads as its default: a floor at 0, a room 180 high, a lens at 120, a chair 70 high, no tilt.
  assert.deepEqual(read(room), { elevation: 0, volumeHeight: 180, angle: null, pitch: null, roll: null, fov: null, x: 100, y: 120, width: 300, height: 200, rotation: 30 });
  assert.deepEqual(read(road), { elevation: 0, volumeHeight: null, angle: null, pitch: null, roll: null, fov: null, x: 520, y: 410, width: 400, height: 80, rotation: 10 });
  assert.deepEqual(read(camera), { elevation: 120, volumeHeight: null, angle: 40, pitch: 0, roll: 0, fov: 60, x: 200, y: 180, width: null, height: null, rotation: null });
  assert.deepEqual(read(chair), { elevation: 0, volumeHeight: 70, angle: null, pitch: 0, roll: 0, fov: null, x: 220.5, y: 200, width: 60, height: 50, rotation: 15 });
  // A key that is there reads as it is stored. A room stays upright: it has no tilt to read.
  assert.deepEqual(read({ ...room, elevation: 50, volumeHeight: 240 }), { elevation: 50, volumeHeight: 240, angle: null, pitch: null, roll: null, fov: null, x: 100, y: 120, width: 300, height: 200, rotation: 30 });
  assert.deepEqual(read({ ...camera, elevation: 300, pitch: -35, roll: 10 }), { elevation: 300, volumeHeight: null, angle: 40, pitch: -35, roll: 10, fov: 60, x: 200, y: 180, width: null, height: null, rotation: null });
  assert.deepEqual(read({ ...chair, elevation: 30, volumeHeight: 90, pitch: 20, roll: -15 }), { elevation: 30, volumeHeight: 90, angle: null, pitch: 20, roll: -15, fov: null, x: 220.5, y: 200, width: 60, height: 50, rotation: 15 });
  // A road has no height of its own, even one stored while it was a room.
  assert.equal(mapNodeNumber({ ...road, volumeHeight: 240 }, 'volumeHeight'), null);
  // The lists the other tests go by are the numbers that are read.
  for (const [node, keys] of FIELDS) assert.deepEqual(KEYS.filter(key => mapNodeNumber(node, key) !== null), KEYS.filter(key => keys.includes(key)), node.name);
  assert.deepEqual(FIELDS.map(([, keys]) => keys.length), [7, 6, 7, 9]);
});

test('N-3: a value slid is the value typed', () => {
  let cases = 0;
  for (const [node, keys] of FIELDS) for (const key of keys) {
    const now = mapNodeNumber(node, key);
    assert.ok(now !== null, `${node.name} has no ${key}`);
    for (const value of [now + 7, now - 3, 45, 12]) {
      const label = `${node.name} ${key} ${value}`, slid = setMapNodeNumber(base, node.id, key, value), keyed = typed(base, node, key, value);
      assert.notEqual(slid, base, label);
      if (key === 'x' || key === 'y') {
        // Typing adds the difference to where the node stands, so the last digit may differ. The slid node stands on the value itself.
        alike(slid, keyed, label);
        assert.equal(nodeOf(slid, node)[key], value, label);
      } else assert.deepEqual(slid, keyed, label);
      assert.doesNotThrow(() => validateBackgroundEntity('map', slid), label);
      cases++;
    }
  }
  assert.equal(cases, 29 * 4);
});

test('N-4: with nothing to write the same map object comes back', () => {
  // A node that is not there, and a locked one.
  assert.equal(setMapNodeNumber(base, '00000000-0000-4000-8000-0000000000ff', 'x', 5), base);
  for (const key of ['elevation', 'angle', 'fov', 'x', 'y'] as const) assert.equal(setMapNodeNumber(base, lockedCamera.id, key, 77), base, key);
  // A number that kind of node has no field for.
  assert.equal(setMapNodeNumber(base, room.id, 'fov', 70), base);
  assert.equal(setMapNodeNumber(base, road.id, 'volumeHeight', 240), base);
  // A value that is no number.
  for (const value of [Number.NaN, Infinity, -Infinity]) assert.equal(setMapNodeNumber(base, camera.id, 'fov', value), base, String(value));
  // The value the node reads as already: the default of a key that is not there.
  assert.equal(setMapNodeNumber(base, camera.id, 'elevation', 120), base);
  // A number stored outside the limits is not rewritten by a slide that never moved. It comes inside them once it does.
  const wide = withNode({ ...camera, fov: 175 });
  assert.equal(setMapNodeNumber(wide, camera.id, 'fov', 175), wide);
  assert.equal(nodeOf(setMapNodeNumber(wide, camera.id, 'fov', 174), camera).fov, 170);
  // A value that settles onto the one the node has: past a limit it stands on, or a whole turn further round.
  const widest = withNode({ ...camera, fov: 170 });
  assert.equal(setMapNodeNumber(widest, camera.id, 'fov', 171), widest);
  assert.equal(setMapNodeNumber(base, room.id, 'rotation', 390), base);
  // What is written is that one key: no optional key is invented beside it, and the other nodes are the objects they were.
  const narrowed = setMapNodeNumber(base, camera.id, 'fov', 61);
  assert.deepEqual(nodeOf(narrowed, camera), { ...camera, fov: 61 });
  assert.equal('elevation' in nodeOf(narrowed, camera), false);
  for (const node of [room, road, chair, lockedCamera]) assert.equal(nodeOf(narrowed, node), node, node.name);
});

test('N-5: the members of a space are carried once', () => {
  const before = inSpace(room, camera);
  // Twice as wide: the camera stands twice as far along the room and as far across it as before, and the chair is twice as wide.
  const wider = setMapNodeNumber(base, room.id, 'width', 600), along = inSpace(nodeOf(wider, room), nodeOf(wider, camera));
  close(along.x, 2 * before.x, 'along the room'); close(along.y, before.y, 'across the room');
  assert.ok(Math.hypot(nodeOf(wider, camera).x - camera.x, nodeOf(wider, camera).y - camera.y) > 1, 'the camera stayed where it was');
  assert.equal(nodeOf(wider, chair).width, 120); assert.equal(nodeOf(wider, chair).height, 50);
  assert.equal(nodeOf(wider, lockedCamera), lockedCamera);
  // The floor 50 higher: the members rise as much, the lens from the 120 it read as, and none of them moves on the plan.
  const raised = setMapNodeNumber(base, room.id, 'elevation', 50);
  assert.equal(nodeOf(raised, camera).elevation, 170); assert.equal(nodeOf(raised, chair).elevation, 50);
  assert.deepEqual(nodeOf(raised, camera), { ...camera, elevation: 170 });
  assert.equal(nodeOf(raised, lockedCamera), lockedCamera);
  // Turned 45 degrees further: the camera keeps its place in the room and looks 45 degrees further round, as the chair is turned.
  const turned = setMapNodeNumber(base, room.id, 'rotation', 75), within = inSpace(nodeOf(turned, room), nodeOf(turned, camera));
  close(within.x, before.x, 'along the turned room'); close(within.y, before.y, 'across the turned room');
  assert.ok(Math.hypot(nodeOf(turned, camera).x - camera.x, nodeOf(turned, camera).y - camera.y) > 1, 'the camera stayed where it was');
  assert.equal(nodeOf(turned, camera).angle, 85); assert.equal(nodeOf(turned, chair).rotation, 60);
  assert.equal(nodeOf(turned, lockedCamera), lockedCamera);
  // The height of the walls carries nobody.
  const taller = setMapNodeNumber(base, room.id, 'volumeHeight', 240);
  for (const node of [road, camera, chair, lockedCamera]) assert.equal(nodeOf(taller, node), node, node.name);
});

test('N-6: steps, settling and a slide are a matter of where the pointer is', () => {
  // No step: the value itself, decimals and all.
  assert.equal(stepNumber(244.65, 0, 'x', false), 244.65);
  assert.equal(stepNumber(244.65, 0, 'x', true), 244.65);
  // Off the grid, the first step lands on the next grid value on the way.
  assert.deepEqual([1, 2, -1].map(steps => stepNumber(244.65, steps, 'x', false)), [245, 246, 244]);
  assert.deepEqual([1, -1].map(steps => stepNumber(244.65, steps, 'x', true)), [250, 240]);
  assert.deepEqual([1, -1].map(steps => stepNumber(240, steps, 'x', true)), [250, 230]);
  // Below zero that is still the next one up or down, not the one nearer zero. The 0 it reaches is not -0.
  assert.deepEqual([1, -1].map(steps => stepNumber(-3.5, steps, 'elevation', false)), [-3, -4]);
  assert.deepEqual([1, -1].map(steps => stepNumber(-3.5, steps, 'elevation', true)), [0, -10]);
  // A limit stops it.
  assert.equal(stepNumber(170, 1, 'fov', false), 170);
  assert.equal(stepNumber(3, -5, 'volumeHeight', false), 1);
  assert.equal(stepNumber(12, -5, 'width', false), 10);
  assert.equal(stepNumber(99999, 5, 'elevation', false), 100000);
  // A direction goes round, from a value stored outside the turn too, and any number of times.
  assert.equal(stepNumber(359, 1, 'angle', false), 0);
  assert.equal(stepNumber(0, -1, 'angle', false), 359);
  assert.equal(stepNumber(350, 1, 'angle', true), 0);
  assert.equal(stepNumber(0, -1, 'angle', true), 345);
  assert.equal(stepNumber(-90, 1, 'rotation', false), 271);
  assert.deepEqual([725, -725].map(steps => stepNumber(0, steps, 'angle', false)), [5, 355]);
  // A value stored outside the limits comes inside them with its first step, whichever way that goes.
  assert.deepEqual([-1, 1].map(steps => stepNumber(175, steps, 'fov', false)), [170, 170]);
  // A start or a count that is no number leaves the start as it is.
  assert.equal(stepNumber(Number.NaN, 1, 'x', false), Number.NaN);
  assert.deepEqual([Number.NaN, Infinity].map(steps => stepNumber(5, steps, 'x', false)), [5, 5]);

  // Whole steps of a drag, towards zero: under one step of travel either way is no step, and not -0.
  assert.deepEqual([1.5, 0.9, -0.9, -1.5].map(steps => scrubSteps(steps * stepPx, false)), [1, 0, 0, -1]);
  assert.equal(scrubSteps(2 * bigStepPx, true), 2);
  assert.equal(scrubSteps(Number.NaN, false), 0);

  // As it may be stored: held inside the limits, or wrapped (a direction inside the turn is left as it is, decimals and all).
  assert.deepEqual([175, 5, 60.5].map(value => settleNumber(value, 'fov')), [170, 10, 60.5]);
  assert.deepEqual([-90, 360, 725, 94.3].map(value => settleNumber(value, 'rotation')), [270, 0, 5, 94.3]);
  assert.equal(settleNumber(-0, 'x'), 0);
  assert.deepEqual([Number.NaN, Infinity].map(value => settleNumber(value, 'angle')), [Number.NaN, Number.NaN]);

  // A slide that started at A. The places below are made of the names of MAP_NUMBER_SCRUB, never written as pixels.
  const A = 104, begun = (value: number): MapNumberSlide => ({ anchorX: A, anchorValue: value, big: false, value });
  /** The height 120 slid to `to` in moves of `stride` pixels, the last move being `to` itself. */
  const slideTo = (to: number, stride: number) => {
    const slide = begun(120);
    for (let x = A + stride; x < to; x += stride) slideNumber(slide, x, false, 'elevation');
    return slideNumber(slide, to, false, 'elevation');
  };
  // Five and a half steps away, reached pixel by pixel, three pixels at a time and in one move: the same value.
  const there = A + 5.5 * stepPx;
  assert.deepEqual([1, 3, there - A].map(stride => slideTo(there, stride)), [125, 125, 125]);
  // One step on, back where it started (the value it started with, decimals and all), one step back.
  const fine = begun(244.65);
  assert.deepEqual([A + stepPx, A, A - stepPx].map(x => slideNumber(fine, x, false, 'x')), [245, 244.65, 244]);
  // The slide is brought up to date in place.
  assert.deepEqual(fine, { anchorX: A, anchorValue: 244.65, big: false, value: 244 });
  // Dragged on past a limit, that much has to be retraced before the value moves again.
  const held = begun(168);
  assert.deepEqual([10, 5, 1, 0].map(steps => slideNumber(held, A + steps * stepPx, false, 'fov')), [170, 170, 169, 168]);
  // Shift goes down three steps on: the value does not jump, and the big steps are counted from it.
  const shifted = begun(123), down = A + 3 * stepPx, up = down + 2 * bigStepPx + 1;
  assert.equal(slideNumber(shifted, down, false, 'elevation'), 126);
  assert.equal(slideNumber(shifted, down, true, 'elevation'), 126);
  assert.deepEqual([1, 2].map(steps => slideNumber(shifted, down + steps * bigStepPx, true, 'elevation')), [130, 140]);
  // It comes up a pixel further on: no jump again, and single steps from there.
  assert.equal(slideNumber(shifted, up, false, 'elevation'), 140);
  assert.equal(slideNumber(shifted, up + stepPx, false, 'elevation'), 141);
});

test('N-7: the bar: where its dot stands, the value at a place on it, and a press on it', () => {
  // The two ends, the middle, and a place beyond either end.
  assert.deepEqual([0, 1, 0.5, -0.5, 1.5].map(fraction => trackNumber(fraction, 'fov', false, 60)), [10, 170, 90, 10, 170]);
  // A place beyond an end is that end: a value stored past it is not nearer to the place than the end is.
  assert.equal(trackNumber(1.5, 'fov', false, 175), 170);
  // The end of a direction is not on the grid of Shift: the last grid value inside the bar stands for it.
  assert.equal(trackNumber(1, 'angle', false, 40), 359);
  assert.equal(trackNumber(1, 'angle', true, 40), 345);
  // The start itself where it is as near as the grid value or nearer.
  const pitchAt = (degrees: number) => (degrees + 90) / 180;
  assert.equal(trackNumber(pitchAt(47.2), 'pitch', true, 47), 47);
  assert.equal(trackNumber(pitchAt(55), 'pitch', true, 47), 60);
  // A place a hair under level rounds to 0, not to -0.
  assert.equal(trackNumber(pitchAt(-0.2), 'pitch', false, 47), 0);
  // A rotation stored outside the turn is compared as the bar shows it, at 270, and comes back as it is stored.
  assert.equal(trackNumber(270.2 / 359, 'rotation', false, -90), -90);
  // A field without a bar, and a place that is no number: the start.
  assert.equal(trackNumber(0.5, 'elevation', false, 244.65), 244.65);
  assert.equal(trackNumber(Number.NaN, 'fov', false, 60), 60);

  // Where the dot stands: cut off at both ends, a direction as the bar shows it, and 0 without a bar or a number.
  assert.deepEqual([175, 5, 90].map(value => trackFraction(value, 'fov')), [1, 0, 0.5]);
  assert.equal(trackFraction(-90, 'rotation'), 270 / 359);
  assert.equal(trackFraction(50, 'elevation'), 0);
  assert.equal(trackFraction(Number.NaN, 'fov'), 0);
  // Every whole value of a bar is where its own place leads back to. The start is no number here: nearer to no place than anything.
  let whole = 0;
  for (const key of KEYS) {
    const track = MAP_NUMBER_FIELDS[key].track;
    if (!track) continue;
    for (let value = track.min; value <= track.max; value++, whole++) assert.equal(trackNumber(trackFraction(value, key), key, false, Number.NaN), value, `${key} ${value}`);
  }
  assert.equal(whole, 360 + 360 + 181 + 361 + 161);

  // A bar 160 pixels longer than its dot: one degree of the field of view is one pixel, and the dot of 90 has its centre at dot(90).
  const width = 160 + thumbPx, dot = (value: number) => thumbPx / 2 + (value - 10);
  const valueAt = (bar: { fraction(x: number): number }, x: number) => trackNumber(bar.fraction(x), 'fov', false, 90);
  // Grabbed on the dot, a little off its centre: nothing changes before it is dragged, and the offset of the grab is kept.
  const off = Math.min(4, grabPx), grabbed = pressNumberTrack(90, 'fov', dot(90) + off, 0, width);
  assert.ok(grabbed); assert.equal(grabbed.immediate, false);
  assert.deepEqual([0, 1, 10].map(moved => valueAt(grabbed, dot(90) + off + moved)), [90, 91, 100]);
  // Pressed beside the dot: the value goes to the press at once.
  const far = Math.max(30, grabPx + 1), jumped = pressNumberTrack(90, 'fov', dot(90) + far, 0, width);
  assert.ok(jumped); assert.equal(jumped.immediate, true);
  assert.equal(valueAt(jumped, dot(90) + far), 90 + far);
  // The dot reaches grabPx from its centre on either side, and no further.
  for (const side of [1, -1]) {
    assert.equal(pressNumberTrack(90, 'fov', dot(90) + side * grabPx, 0, width)?.immediate, false, `${side * grabPx}px off the centre`);
    assert.equal(pressNumberTrack(90, 'fov', dot(90) + side * (grabPx + 1), 0, width)?.immediate, true, `${side * (grabPx + 1)}px off the centre`);
  }
  // Where the bar stands on screen moves all of it along.
  const placed = pressNumberTrack(90, 'fov', 300 + dot(90) + off, 300, width);
  assert.ok(placed); assert.equal(placed.immediate, false);
  assert.deepEqual([0, 10].map(moved => valueAt(placed, 300 + dot(90) + off + moved)), [90, 100]);
  // A bar no wider than its dot, or of no width that is a number, has nowhere for the dot to go.
  for (const narrow of [thumbPx, thumbPx - 1, 0, Number.NaN]) assert.equal(pressNumberTrack(90, 'fov', 0, 0, narrow), null, String(narrow));
  assert.notEqual(pressNumberTrack(90, 'fov', 0, 0, thumbPx + 1), null);
});

test('N-8: one slide is one undo step of the document, and none when it ends where it started', () => {
  const opened = run(createMapDocument(), { type: 'begin-editing', map: base }), start = draftOf(opened).value;
  /** A slide begun and left running: every preview is made from the map the slide started on, and none of them is a step. */
  const slide = (state: MapDocumentState, id: string, key: MapNumberKey, values: number[]) => {
    const begun = run(state, { type: 'gesture-begin', mapId: MAP }), from = gestureStartMap(begun, MAP);
    assert.equal(from, draftOf(state).value);
    return values.reduce((running, value) => {
      const next = run(running, { type: 'gesture-preview', map: setMapNodeNumber(from!, id, key, value) });
      assert.equal(mapDraftSteps(draftOf(next)), mapDraftSteps(draftOf(state)), `a step while ${key} is slid to ${value}`);
      return next;
    }, begun);
  };
  // The room narrowed to 12, where the chair is as narrow as an object may be, and then widened to 600: the chair is twice
  // as wide as it was, carried once from the map of the start.
  const dragging = slide(opened, room.id, 'width', [12, 150, 600]);
  assert.equal(mapDraftSteps(draftOf(dragging)), 0);
  assert.deepEqual(draftOf(dragging).value, setMapNodeNumber(start, room.id, 'width', 600));
  assert.equal(nodeOf(draftOf(dragging).value, chair).width, 120);
  const finished = run(dragging, { type: 'gesture-finish' });
  assert.equal(finished.gesture, null);
  assert.equal(mapDraftSteps(draftOf(finished)), 1);
  assert.equal(draftOf(finished).value, draftOf(dragging).value);
  assert.equal(draftOf(run(finished, { type: 'undo', mapId: MAP })).value, start);
  // Back at the value it started from: the map of the start itself, nothing to undo and nothing to save.
  const returned = run(slide(opened, room.id, 'width', [12, 150, 300]), { type: 'gesture-finish' });
  assert.equal(mapDraftSteps(draftOf(returned)), 0);
  assert.equal(draftOf(returned).value, start);
  assert.equal(mapDraftChanged(draftOf(returned)), false);
  // The same for a number the node has no key for: the height of the camera slid off its default and back writes no key.
  assert.equal(draftOf(run(slide(opened, camera.id, 'elevation', [121, 130, 120]), { type: 'gesture-finish' })).value, start);
  // Cancelled: the map of the start.
  const cancelled = run(slide(opened, room.id, 'width', [12, 150]), { type: 'gesture-cancel' });
  assert.equal(cancelled.gesture, null);
  assert.equal(draftOf(cancelled).value, start);
  assert.equal(mapDraftSteps(draftOf(cancelled)), 0);
  // A second slide starts on the map the first one left, and is a second step.
  const twice = run(slide(finished, camera.id, 'fov', [61, 70]), { type: 'gesture-finish' });
  assert.equal(mapDraftSteps(draftOf(twice)), 2);
  assert.deepEqual(draftOf(twice).past, [start, draftOf(finished).value]);
  assert.equal(nodeOf(draftOf(twice).value, camera).fov, 70); assert.equal(nodeOf(draftOf(twice).value, room).width, 600);
  assert.equal(draftOf(run(twice, { type: 'undo', mapId: MAP }, { type: 'undo', mapId: MAP })).value, start);
  // While a slide runs it is the only writer of the map: an edit that comes another way changes nothing.
  const other = setMapNodeNumber(start, camera.id, 'fov', 99);
  assert.equal(run(dragging, { type: 'update', map: other }), dragging);
  assert.equal(run(dragging, { type: 'update', map: other, coalesceKey: `${camera.id}:fov` }), dragging);
});
