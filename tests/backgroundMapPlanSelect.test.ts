import test from 'node:test';
import assert from 'node:assert/strict';
import { planMarkCovers, planMarqueeIds, planRect, planRectTouches } from '../src/features/backgrounds/mapPlanSelect.ts';
import type { PlanRect } from '../src/features/backgrounds/mapPlanSelect.ts';
import { containsPoint } from '../src/features/backgrounds/mapGeometry.ts';
import { planNodeCovers } from '../src/features/backgrounds/mapPlanPreview.ts';
import { createMapCamera, nodePlanOutline, projectCameraToPlan } from '../src/features/backgrounds/mapSpatial.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';

const near = (actual: number, expected: number, tolerance: number, label = '') =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${label} ${actual} != ${expected}`);
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

const space = (id: string, x: number, y: number, width: number, height: number, extra: Partial<BackgroundSpace> = {}): BackgroundSpace =>
  ({ id, type: 'space', name: id, placeId: null, childMapId: null, x, y, width, height, rotation: 0, shape: 'rect', points: [], locked: false, ...extra });
const symbol = (id: string, x: number, y: number, width: number, height: number, extra: Partial<BackgroundSymbol> = {}): BackgroundSymbol =>
  ({ id, type: 'symbol', name: id, symbol: 'chair', spaceId: null, x, y, width, height, rotation: 0, locked: false, hinge: 'left', swing: 'inward', ...extra });
/** A new camera stands on (500, 340), level, and faces +x with a 60 degree fan. */
const cameraAt = (id: string, extra: Partial<BackgroundCamera> = {}): BackgroundCamera => ({ ...createMapCamera(id, id), ...extra });
const mapOf = (nodes: BackgroundNode[]): BackgroundMap => ({ id: 'map', revision: 1, name: '학교', parentId: null, placeId: null, imageUrl: '', nodes });

const box = (left: number, top: number, right: number, bottom: number): PlanRect => ({ left, top, right, bottom });
const touches = (node: BackgroundNode, left: number, top: number, right: number, bottom: number) => planRectTouches(node, box(left, top, right, bottom));
const corners = (rect: PlanRect): BackgroundPoint[] =>
  [{ x: rect.left, y: rect.top }, { x: rect.right, y: rect.top }, { x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom }];

const R = freeze(space('R', 100, 100, 200, 100));
const E = freeze(space('E', 100, 100, 200, 100, { shape: 'ellipse' }));
/** A square with a slot cut into the middle of its bottom side: absolute x 180..220, y 200..300. */
const U = freeze(space('U', 100, 100, 200, 200, { shape: 'polygon',
  points: [[0, 0], [1, 0], [1, 1], [0.6, 1], [0.6, 0.5], [0.4, 0.5], [0.4, 1], [0, 1]].map(([x, y]) => ({ x, y })) }));
const chair = freeze(symbol('c', 300, 300, 40, 40));
const cam = freeze(cameraAt('cam'));

test('the box between two points is the same whichever way it was dragged', () => {
  const expected = { left: 90, top: 90, right: 310, bottom: 210 };
  const a = freeze({ x: 310, y: 210 }), b = freeze({ x: 90, y: 90 });
  assert.deepEqual(planRect(a, b), expected);
  assert.deepEqual(planRect(b, a), expected);
  assert.deepEqual(planRect({ x: 90, y: 210 }, { x: 310, y: 90 }), expected);
  assert.deepEqual(planRect({ x: 310, y: 90 }, { x: 90, y: 210 }), expected);
  assert.deepEqual(planRect(a, a), { left: 310, top: 210, right: 310, bottom: 210 });
});

test('a room is caught by its walls: a box drawn inside it does not touch it', () => {
  assert.equal(touches(R, 150, 120, 250, 180), false, 'inside');
  assert.equal(touches(R, 280, 120, 320, 180), true, 'across the right wall');
  assert.equal(touches(R, 90, 90, 310, 210), true, 'around the whole room');
  assert.equal(touches(R, 310, 90, 400, 210), false, 'outside');
});

test('the box is closed: a wall on its very edge is touched', () => {
  assert.equal(touches(R, 300, 120, 340, 160), true);
  assert.equal(touches(R, 300.5, 120, 340, 160), false);
  // A box of no size is a point: inside the room it touches nothing, on a wall it touches the room.
  assert.equal(touches(R, 150, 150, 150, 150), false);
  assert.equal(touches(R, 300, 150, 300, 150), true);
});

test('a turned room is caught by the walls where the plan draws them', () => {
  const turned = { ...R, rotation: 30 }, outline = nodePlanOutline(turned);
  [[138.397, 56.699], [311.603, 156.699], [261.603, 243.301], [88.397, 143.301]].forEach(([x, y], index) => {
    near(outline[index].x, x, 1e-3, `corner ${index} x`); near(outline[index].y, y, 1e-3, `corner ${index} y`);
  });
  assert.equal(touches(turned, 100, 100, 110, 110), true, 'across the turned left wall');
  assert.equal(touches(turned, 190, 140, 210, 160), false, 'inside');
  assert.equal(touches(turned, 130, 50, 145, 60), true, 'around a turned corner');
  // On the top right corner of the room as it was before the turn, and outside the turned room.
  assert.equal(touches(R, 286, 100, 300, 108), true);
  assert.equal(touches(turned, 286, 100, 300, 108), false);
});

test('an ellipse is measured exactly, not by the box around it', () => {
  assert.equal(touches(E, 180, 130, 220, 170), false, 'inside');
  assert.equal(touches(E, 100, 100, 115, 108), false, 'a corner of the box around it, outside the ellipse');
  assert.equal(touches(E, 100, 140, 110, 160), true, 'across its left end');
  assert.equal(touches(E, 90, 90, 310, 210), true, 'around the whole ellipse');
  assert.equal(touches(E, 301, 140, 320, 160), false);
  assert.equal(touches(E, 300, 140, 320, 160), true, 'the edge of the box on its right end');
  // The outline is reached from inside as well: the right end is the far corner of these boxes of no height.
  assert.equal(touches(E, 250, 150, 300, 150), true);
  assert.equal(touches(E, 250, 150, 299, 150), false);
  assert.equal(touches(E, 300, 150, 300, 150), true, 'a point on the outline');
  // No 48-sided stand-in: halfway between two of its corners the real outline, at (299.786, 153.270), runs 0.2 outside
  // the side that joins them (x 299.55..299.58 at this height), and this box holds only the real one.
  assert.equal(touches(E, 299.7, 153.2, 299.9, 153.4), true);
});

test('a turned ellipse is measured in its own frame', () => {
  const turned = { ...E, rotation: 45 };
  assert.equal(touches(turned, 262, 212, 275, 225), true, 'the end of its long axis, at (270.7, 220.7)');
  assert.equal(touches(E, 262, 212, 275, 225), false, 'nothing of it was there before the turn');
  assert.equal(touches(turned, 195, 145, 205, 155), false, 'its middle');
});

test('a polygon is caught by its real walls, also by those of a part cut out of it', () => {
  // All four corners are inside the space, two in each arm: only the walls of the slot between them are crossed.
  assert.ok(corners(box(150, 220, 250, 280)).every(point => containsPoint(U, point)));
  assert.equal(touches(U, 150, 220, 250, 280), true);
  assert.equal(touches(U, 120, 220, 160, 280), false, 'inside the left arm');
  assert.equal(touches(U, 190, 220, 210, 280), false, 'inside the slot, which is outside the space');
  assert.ok(corners(box(190, 220, 210, 280)).every(point => !containsPoint(U, point)));
});

test('a symbol is caught by its area', () => {
  assert.equal(touches(chair, 310, 310, 320, 320), true, 'a box inside it');
  assert.equal(touches(chair, 335, 335, 360, 360), true, 'over a corner');
  assert.equal(touches(chair, 341, 300, 360, 320), false);
  assert.equal(touches(chair, 340, 300, 360, 320), true, 'the closed box on its edge');
});

test('a turned symbol is caught by its turned box', () => {
  // Turned by 45 degrees the square stands on a corner: (320, 291.7) (348.3, 320) (320, 348.3) (291.7, 320).
  const turned = { ...chair, rotation: 45 };
  assert.equal(touches(chair, 300, 300, 304, 304), true);
  assert.equal(touches(turned, 300, 300, 304, 304), false, 'a corner it had before the turn');
  assert.equal(touches(chair, 318, 290, 322, 293), false);
  assert.equal(touches(turned, 318, 290, 322, 293), true, 'a corner it has now');
  assert.equal(touches(turned, 316, 316, 324, 324), true, 'a box inside it crosses none of its edges');
});

test('a tilted symbol is caught by its own box, not by the outline it casts', () => {
  const tilted = { ...chair, pitch: 60, volumeHeight: 200 };
  near(Math.max(...nodePlanOutline(tilted).map(point => point.y)), 503.2, 0.01, 'the cast outline reaches down to');
  assert.equal(touches(tilted, 310, 400, 330, 420), false, 'inside the cast outline only');
  assert.equal(touches(tilted, 310, 495, 330, 510), false, 'across the far edge of the cast outline');
  assert.equal(touches(tilted, 310, 310, 330, 330), true);
  assert.equal(touches(tilted, 335, 335, 360, 360), true, 'over a corner of its own box');
});

test('a camera is caught by its body: the fan does not count', () => {
  assert.equal(touches(cam, 512, 330, 520, 350), true, 'exactly 12 away');
  assert.equal(touches(cam, 512.5, 330, 520, 350), false);
  // In the fan a press picks the camera, a box does not.
  assert.equal(planMarkCovers(cam, { x: 565, y: 340 }), true);
  assert.equal(touches(cam, 560, 335, 570, 345), false, 'the fan only');
  assert.equal(touches(cam, 490, 330, 510, 350), true, 'around the camera');
  assert.equal(touches(cam, 508, 348, 520, 360), true, '11.3 away on the diagonal');
  assert.equal(touches(cam, 509, 349, 520, 360), false, '12.7 away');
});

test('a camera that looks straight up or down is caught by its ring', () => {
  for (const pitch of [90, -90]) {
    const vertical = { ...cam, pitch };
    assert.equal(touches(vertical, 517, 330, 530, 350), true, `pitch ${pitch}, 17 away`);
    assert.equal(touches(vertical, 518, 330, 530, 350), true, `pitch ${pitch}, exactly 18 away`);
    assert.equal(touches(vertical, 519, 330, 530, 350), false, `pitch ${pitch}, 19 away`);
  }
  assert.equal(touches(cam, 517, 330, 530, 350), false, 'a level camera has no ring');
});

test('a box dragged straight along one axis has no width, and still touches what it crosses', () => {
  assert.equal(touches(R, 150, 90, 150, 110), true, 'down through the top wall');
  assert.equal(touches(R, 150, 110, 150, 190), false, 'inside the room');
  assert.equal(touches(E, 200, 90, 200, 120), true, 'down through the top of the ellipse');
  assert.equal(touches(E, 200, 120, 200, 180), false, 'inside the ellipse');
  assert.equal(touches(E, 90, 150, 120, 150), true, 'along its long axis, through its left end');
  assert.equal(touches(chair, 320, 310, 320, 330), true, 'inside the symbol');
  assert.equal(touches(chair, 350, 310, 350, 330), false);
  assert.equal(touches(cam, 512, 330, 512, 350), true);
  assert.equal(touches(cam, 513, 330, 513, 350), false);
});

test('a box or a node with a value that is no finite number touches nothing', () => {
  const all = box(-10, -10, 1010, 690), nodes: BackgroundNode[] = [R, E, U, chair, cam];
  for (const node of nodes) assert.equal(planRectTouches(node, all), true, node.id);
  assert.equal(planRectTouches(R, { ...box(90, 90, 310, 210), right: NaN }), false);
  for (const key of ['left', 'top', 'right', 'bottom'] as const) for (const value of [NaN, Infinity, -Infinity])
    for (const node of nodes) assert.equal(planRectTouches(node, { ...all, [key]: value }), false, `${node.id}, ${key} ${value}`);
  const broken: BackgroundNode[] = [
    { ...R, x: NaN }, { ...R, height: Infinity }, { ...R, rotation: NaN },
    { ...E, y: NaN }, { ...E, width: Infinity }, { ...E, rotation: NaN },
    { ...U, points: U.points.map((point, index) => index === 2 ? { x: NaN, y: 1 } : point) },
    { ...chair, x: Infinity }, { ...chair, width: NaN }, { ...chair, rotation: NaN },
    { ...cam, x: NaN }, { ...cam, y: -Infinity },
  ];
  broken.forEach((node, index) => assert.equal(planRectTouches(node, all), false, `${node.id} ${index}`));
});

test('the nodes a box touches come in map order, locked ones too', () => {
  const site = space('site', 0, 0, 1000, 680), locked = space('locked', 600, 100, 100, 100, { locked: true });
  const map = freeze(mapOf([site, R, locked, chair, cam])), before = JSON.stringify(map);
  // Drawn inside the site: its walls are not touched.
  assert.deepEqual(planMarqueeIds(map, box(90, 90, 310, 210)), ['R']);
  assert.deepEqual(planMarqueeIds(map, box(150, 120, 250, 180)), []);
  assert.deepEqual(planMarqueeIds(map, box(-10, -10, 1010, 690)), ['site', 'R', 'locked', 'c', 'cam']);
  assert.deepEqual(planMarqueeIds(map, box(590, 150, 610, 160)), ['locked']);
  assert.deepEqual(planMarqueeIds(mapOf([cam, chair, locked, R, site]), box(-10, -10, 1010, 690)), ['cam', 'c', 'locked', 'R', 'site']);
  assert.deepEqual(planMarqueeIds(mapOf([]), box(-10, -10, 1010, 690)), []);
  assert.equal(JSON.stringify(map), before);
});

test('a small space under a camera, which no press reaches, is picked with a box', () => {
  // `tiny` lies under the fan, 40 from the camera; `under` lies under its body.
  const site = space('site', 0, 0, 1000, 680), locked = space('locked', 600, 100, 100, 100, { locked: true });
  const tiny = space('tiny', 540, 335, 10, 10), under = space('under', 495, 335, 10, 10);
  const map = freeze(mapOf([site, R, locked, chair, cam, tiny, under]));
  assert.equal(planMarkCovers(cam, { x: 545, y: 340 }), true);
  assert.equal(planMarkCovers(cam, { x: 500, y: 340 }), true);
  assert.deepEqual(planMarqueeIds(map, box(535, 330, 555, 350)), ['tiny']);
  assert.deepEqual(planMarqueeIds(map, box(480, 320, 520, 360)), ['cam', 'under']);
});

test('what lies under a plan point: the body, ring and fan of a camera and the box of a symbol, as the main plan draws them', () => {
  // The same nodes and points as the stack test of the plan preview: a table with a top-down camera on its centre and a second camera next to it.
  const table = symbol('table', 440, 290, 120, 100, { symbol: 'table' });
  const top = cameraAt('top', { pitch: -90 }), side = cameraAt('side', { x: 505, y: 345 });
  const mainPlan = (node: BackgroundNode, point: BackgroundPoint) => planNodeCovers(node, point, node.type !== 'camera' ? 0 : projectCameraToPlan(node).vertical ? 18 : 12, 80);
  const nodes: BackgroundNode[] = [table, { ...table, rotation: 90 }, { ...table, width: 4, height: 4, x: 498, y: 338 }, top, side,
    { ...side, angle: 180 }, { ...side, pitch: 60 }, R];
  const points = [[450, 300], [501, 341], [445, 295], [500, 395], [445, 340], [506, 340], [515, 345], [560, 345], [590, 345], [450, 345], [540, 345], [540, 340], [515, 340], [150, 130], [NaN, 345]]
    .map(([x, y]) => ({ x, y }));
  for (const node of nodes) for (const point of points)
    assert.equal(planMarkCovers(node, point), mainPlan(node, point), `${node.id} at ${point.x}, ${point.y}`);

  // A symbol: its own box and nothing around it.
  assert.equal(planMarkCovers(table, { x: 445, y: 295 }), true);
  assert.equal(planMarkCovers(table, { x: 500, y: 395 }), false, 'below the 100 deep box');
  assert.equal(planMarkCovers({ ...table, rotation: 90 }, { x: 500, y: 395 }), true, 'the turned box reaches 60 down');
  assert.equal(planMarkCovers({ ...table, width: 4, height: 4, x: 498, y: 338 }, { x: 506, y: 340 }), false, 'no hit circle around a small symbol');
  // A level camera: a body of 12 and a fan of 80.
  assert.equal(planMarkCovers(side, { x: 493, y: 345 }), true, '12 behind it');
  assert.equal(planMarkCovers(side, { x: 492, y: 345 }), false, '13 behind it');
  assert.equal(planMarkCovers(side, { x: 585, y: 345 }), true, 'the end of the fan');
  assert.equal(planMarkCovers(side, { x: 586, y: 345 }), false, 'beyond it');
  assert.equal(planMarkCovers({ ...side, angle: 180 }, { x: 450, y: 345 }), true, 'the fan turns with the direction');
  // A vertical camera: a ring of 18 and no fan.
  assert.equal(planMarkCovers(top, { x: 518, y: 340 }), true);
  assert.equal(planMarkCovers(top, { x: 519, y: 340 }), false);
  assert.equal(planMarkCovers(top, { x: 540, y: 340 }), false);
  // Spaces never count, wherever the point is.
  assert.equal(planMarkCovers(R, { x: 150, y: 130 }), false);
  assert.equal(planMarkCovers(E, { x: 200, y: 150 }), false);
});
