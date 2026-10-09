import test from 'node:test';
import assert from 'node:assert/strict';
import { planMarkCovers, planMarqueeIds, planRect, planRectTouches, resolvePlanPress, sameSpotAgain } from '../src/features/backgrounds/mapPlanSelect.ts';
import type { PlanPressClick, PlanPressPlan, PlanRect, PlanSpot } from '../src/features/backgrounds/mapPlanSelect.ts';
import type { MapSelection } from '../src/features/backgrounds/mapDocument.ts';
import { containsPoint } from '../src/features/backgrounds/mapGeometry.ts';
import { planNodeCovers, planPileAt } from '../src/features/backgrounds/mapPlanPreview.ts';
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
  // The corner of this box is 7.2 from the centre of a 4 wide symbol and 4 clear of it.
  assert.equal(touches(symbol('dot', 498, 338, 4, 4), 506, 336, 520, 344), false, 'no hit circle around a small symbol');
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
  // Rolled, it casts its outline to the side instead.
  const rolled = { ...chair, roll: 60, volumeHeight: 200 };
  near(Math.min(...nodePlanOutline(rolled).map(point => point.x)), 136.8, 0.01, 'the outline of the rolled symbol reaches left to');
  assert.equal(touches(rolled, 130, 310, 140, 330), false, 'across the far edge of the outline a rolled symbol casts');
  assert.equal(touches(rolled, 310, 310, 330, 330), true);
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
  // The body reaches as far on the other sides: boxes that end to the left of the camera and above it.
  assert.equal(touches(cam, 480, 330, 488, 350), true, 'exactly 12 to its left');
  assert.equal(touches(cam, 480, 330, 487, 350), false, '13 to its left');
  assert.equal(touches(cam, 490, 320, 510, 328), true, 'exactly 12 above it');
  assert.equal(touches(cam, 490, 320, 510, 327), false, '13 above it');
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
  // An ellipse of no width or height has no outline to touch: in its own frame the box has no finite corners.
  for (const key of ['width', 'height'] as const) assert.equal(planRectTouches({ ...E, [key]: 0 }, all), false, `an ellipse of no ${key}`);
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

/** A selection as `mapSelection` reads it: the last picked id is the primary. */
const picked = (...ids: string[]): MapSelection => freeze({ ids, primaryId: ids.length ? ids[ids.length - 1] : null });

test('a spot is pressed again when the remembered press was on this topmost node and the node it left selected is still the one selection', () => {
  const spot: PlanSpot = freeze({ mapId: 'm', hitId: 'I', pickedId: 'O' });
  assert.equal(sameSpotAgain(spot, 'm', 'I', picked('O')), true);
  assert.equal(sameSpotAgain(spot, 'm', 'I', picked('I')), false, 'not what that press left selected');
  assert.equal(sameSpotAgain(spot, 'm', 'I', picked('O', 'c')), false, 'several are selected');
  assert.equal(sameSpotAgain(spot, 'm', 'I', picked('c', 'O')), false, 'several are selected, the remembered one last');
  assert.equal(sameSpotAgain(spot, 'm', 'I', picked()), false, 'nothing is selected');
  assert.equal(sameSpotAgain(spot, 'm', 'J', picked('O')), false, 'another topmost node');
  assert.equal(sameSpotAgain(spot, 'm', null, picked('O')), false, 'empty canvas');
  assert.equal(sameSpotAgain(spot, 'n', 'I', picked('O')), false, 'another map');
  assert.equal(sameSpotAgain(null, 'm', 'I', picked('O')), false, 'nothing is remembered');
  assert.equal(sameSpotAgain(null, 'm', null, picked()), false);
  // A press that ended with a group selected left no single node behind.
  const group: PlanSpot = freeze({ mapId: 'm', hitId: 'I', pickedId: null });
  for (const selection of [picked(), picked('I'), picked('O'), picked('I', 'O')])
    assert.equal(sameSpotAgain(group, 'm', 'I', selection), false, `selected: ${selection.ids.join(', ') || 'nothing'}`);
});

// The presses of the select tool: room `I` lies inside room `O`, `L` is a locked room of its own and two cameras stand on one spot.
const O = freeze(space('O', 100, 100, 400, 300)), I = freeze(space('I', 200, 200, 100, 100));
const L = freeze(space('L', 600, 100, 100, 100, { locked: true }));
const camA = freeze(cameraAt('camA')), camB = freeze(cameraAt('camB'));
const lockedO = freeze({ ...O, locked: true }), lockedI = freeze({ ...I, locked: true });
const pressMap = freeze(mapOf([O, I, chair, L, camA, camB]));
/** The nodes that take turns where each node is pressed. */
const PILES: Record<string, readonly string[]> = freeze({ I: ['I', 'O'], O: ['O'], c: ['c'], L: ['L'], camA: ['camA', 'camB'] });

type Press = Parameters<typeof resolvePlanPress>[0];
const among = (nodes: readonly BackgroundNode[]): Press['node'] => id => nodes.find(node => node.id === id);
/** A press while editing, without Shift, on a spot not pressed before, unless `extra` says otherwise. */
const press = (hit: BackgroundNode | null, selection: MapSelection, extra: Partial<Press> = {}): PlanPressPlan =>
  resolvePlanPress({ canEdit: true, shift: false, hit, pile: hit ? PILES[hit.id] : [], selection, again: false, node: among(pressMap.nodes), ...extra });
/** What a line does not name: no node to move, no group, and a press that is logged. */
const planned = (drag: PlanPressPlan['drag'], click: PlanPressClick, targetId: string | null, rest: Partial<PlanPressPlan> = {}): PlanPressPlan =>
  ({ drag, nodeId: null, groupIds: null, click, targetId, logged: true, ...rest });
const NONE: PlanPressClick = { kind: 'none' };
const pick = (id: string | null): PlanPressClick => ({ kind: 'select', id });
const toggle = (id: string): PlanPressClick => ({ kind: 'toggle', id });
const step = (ids: readonly string[], from: string, spaces: boolean): PlanPressClick => ({ kind: 'step', ids, from, spaces });
/** A drag that moves the pressed node, which the press itself selects. */
const grab = (id: string) => ({ nodeId: id, selectAtPress: id });

test('the piles of the press tests are the ones the plan gives where those nodes are pressed', () => {
  const pileAt = (hitId: string, x: number, y: number) => planPileAt(pressMap, hitId, { x, y }, undefined, node => planMarkCovers(node, { x, y }));
  assert.deepEqual(pileAt('I', 250, 250), PILES.I);
  assert.deepEqual(pileAt('O', 150, 150), PILES.O);
  assert.deepEqual(pileAt('c', 320, 320), PILES.c);
  assert.deepEqual(pileAt('L', 650, 150), PILES.L);
  assert.deepEqual(pileAt('camA', 500, 340), PILES.camA);
});

test('while viewing, a press picks on release and every drag moves the view', () => {
  const lines: [string, BackgroundNode | null, MapSelection, boolean, PlanPressPlan][] = [
    ['empty canvas', null, picked(), false, planned('pan', pick(null), null)],
    ['empty canvas, something selected', null, picked('I'), true, planned('pan', pick(null), null)],
    ['a room', I, picked(), false, planned('pan', pick('I'), 'I')],
    ['a locked room', L, picked(), false, planned('pan', pick('L'), 'L')],
    // The same spot again: on to the next of the pile, from the one that is picked.
    ['the picked room again', I, picked('I'), true, planned('pan', step(['I', 'O'], 'I', true), 'I')],
    ['the same spot again, the room below picked', I, picked('O'), true, planned('pan', step(['I', 'O'], 'O', true), 'O')],
    // A first press on a spot is after the room on top, whatever is selected.
    ['a first press on the picked room', I, picked('I'), false, planned('pan', pick('I'), 'I')],
    ['a first press, the room around it picked', I, picked('O'), false, planned('pan', pick('I'), 'I')],
    // Several selected (a group stays selected after saving): no stepping.
    ['a node of a group', chair, picked('I', 'c'), false, planned('pan', pick('c'), 'c')],
    ['a node of a group, the same spot again', chair, picked('I', 'c'), true, planned('pan', pick('c'), 'c')],
    ['a group whose last node lies below', I, picked('c', 'O'), true, planned('pan', pick('I'), 'I')],
    ['a group of the two cameras', camA, picked('camA', 'camB'), false, planned('pan', pick('camA'), 'camA')],
  ];
  for (const [label, hit, selection, again, expected] of lines) {
    const plan = press(hit, selection, { canEdit: false, again });
    assert.deepEqual(plan, expected, label);
    assert.equal('selectAtPress' in plan, false, `${label}: nothing is selected at the press`);
    assert.deepEqual(press(hit, selection, { canEdit: false, again, shift: true }), expected, `${label}, with Shift`);
  }
});

test('while editing, empty canvas draws a box and Shift adds or removes the node on top', () => {
  assert.deepEqual(press(null, picked(), { shift: true }), planned('marquee', NONE, null, { logged: false }));
  assert.deepEqual(press(null, picked('I', 'c'), { shift: true }), planned('marquee', NONE, null, { logged: false }));
  assert.deepEqual(press(chair, picked(), { shift: true }), planned('marquee', toggle('c'), null, { logged: false }));
  assert.deepEqual(press(L, picked('c'), { shift: true }), planned('marquee', toggle('L'), null, { logged: false }), 'a locked node');
  assert.deepEqual(press(null, picked()), planned('marquee', pick(null), null));
  assert.deepEqual(press(null, picked('I', 'c'), { again: true }), planned('marquee', pick(null), null));
});

test('Shift comes before every other line', () => {
  // On a node of the group: out of the group, no group move.
  assert.deepEqual(press(chair, picked('I', 'c'), { shift: true }), planned('marquee', toggle('c'), null, { logged: false }));
  // On a pile whose lower member is picked: the node on top, no step from the picked one.
  assert.deepEqual(press(I, picked('O'), { shift: true, again: true }), planned('marquee', toggle('I'), null, { logged: false }));
  assert.deepEqual(press(camA, picked('camB'), { shift: true }), planned('marquee', toggle('camA'), null, { logged: false }));
});

test('a press on a node of the group moves the group when dragged and folds it to that node on release', () => {
  const group = picked('I', 'c'), plan = press(chair, group);
  assert.deepEqual(plan, planned('move', pick('c'), 'c', { nodeId: 'c', groupIds: ['I', 'c'] }));
  assert.equal(plan.groupIds, group.ids, 'the list it was given');
  assert.equal('selectAtPress' in plan, false, 'the group is kept at the press');
  assert.deepEqual(press(I, group), planned('move', pick('I'), 'I', { nodeId: 'I', groupIds: ['I', 'c'] }), 'not the last picked one');
  // A pile under the press changes nothing while several are selected.
  assert.deepEqual(press(I, picked('I', 'O'), { again: true }), planned('move', pick('I'), 'I', { nodeId: 'I', groupIds: ['I', 'O'] }));
  // A locked node of the group does not move: a box, and the node alone on release.
  assert.deepEqual(press(L, picked('I', 'L')), planned('marquee', pick('L'), 'L'));
  // A node outside the group is pressed like any other.
  assert.deepEqual(press(chair, picked('I', 'O')), planned('move', NONE, 'c', grab('c')));
  assert.deepEqual(press(L, picked('I', 'c')), planned('marquee', pick('L'), 'L'));
  // One selected node is no group.
  assert.deepEqual(press(chair, picked('c')), planned('move', NONE, 'c', grab('c')));
});

test('the same spot pressed again drags the room picked there and asks for the step to the next one', () => {
  const plan = press(I, picked('O'), { again: true });
  assert.deepEqual(plan, planned('move', step(['I', 'O'], 'O', true), 'O', { nodeId: 'O' }));
  assert.equal('selectAtPress' in plan, false);
  // A locked room on top does not hold the picked one below it.
  assert.deepEqual(press(lockedI, picked('O'), { again: true, node: among([O, lockedI]) }), planned('move', step(['I', 'O'], 'O', true), 'O', { nodeId: 'O' }));
});

test('a first press on a spot takes the room on top, whichever room of the pile is selected', () => {
  assert.deepEqual(press(I, picked('O')), planned('move', NONE, 'I', grab('I')));
  // Four deep, the third one picked elsewhere.
  const pile = ['closet', 'room', 'floor', 'site'], closet = space('closet', 300, 200, 80, 80);
  const node = among([space('site', 0, 0, 1000, 680), space('floor', 100, 50, 500, 400), space('room', 280, 180, 200, 150), closet]);
  assert.deepEqual(press(closet, picked('floor'), { pile, node }), planned('move', NONE, 'closet', grab('closet')));
  assert.deepEqual(press(closet, picked('floor'), { pile, node, again: true }), planned('move', step(pile, 'floor', true), 'floor', { nodeId: 'floor' }));
});

test('a locked node picked from the pile is no drag target: the drag takes the node on top, or draws a box', () => {
  // The step still goes on from the picked one, and a double-click counts for the node on top.
  const outer = among([lockedO, I]);
  assert.deepEqual(press(I, picked('O'), { again: true, node: outer }), planned('move', step(['I', 'O'], 'O', true), 'I', grab('I')));
  assert.deepEqual(press(I, picked('O'), { node: outer }), planned('move', NONE, 'I', grab('I')), 'a first press');
  // Both locked.
  const both = among([lockedO, lockedI]), plan = press(lockedI, picked('O'), { again: true, node: both });
  assert.deepEqual(plan, planned('marquee', step(['I', 'O'], 'O', true), 'O'));
  assert.equal('selectAtPress' in plan, false);
  assert.deepEqual(press(lockedI, picked('O'), { node: both }), planned('marquee', pick('I'), 'I'), 'a first press');
});

test('any other press takes the node under it: an unlocked one is selected at the press, a locked one on release', () => {
  assert.deepEqual(press(I, picked()), planned('move', NONE, 'I', grab('I')));
  assert.deepEqual(press(O, picked('c')), planned('move', NONE, 'O', grab('O')));
  const plan = press(L, picked());
  assert.deepEqual(plan, planned('marquee', pick('L'), 'L'));
  assert.equal('selectAtPress' in plan, false);
});

test('a pile of cameras and symbols does not ask whether the spot was pressed before', () => {
  // The lower camera, picked in the object list, is what a drag on that spot moves.
  const cameras = step(['camA', 'camB'], 'camB', false);
  assert.deepEqual(press(camA, picked('camB')), planned('move', cameras, 'camB', { nodeId: 'camB' }));
  assert.deepEqual(press(camA, picked('camB'), { again: true }), planned('move', cameras, 'camB', { nodeId: 'camB' }));
  assert.deepEqual(press(camA, picked('camB'), { canEdit: false }), planned('pan', cameras, 'camB'));
  assert.deepEqual(press(camA, picked('camA')), planned('move', step(['camA', 'camB'], 'camA', false), 'camA', { nodeId: 'camA' }));
  // A symbol on top of the pile.
  const desk = symbol('desk', 480, 320, 40, 40), pile = ['desk', 'camB'];
  assert.deepEqual(press(desk, picked('camB'), { pile, node: among([desk, camB]) }), planned('move', step(pile, 'camB', false), 'camB', { nodeId: 'camB' }));
  // The lines of a locked picked node hold here as well.
  const lockedB = among([camA, { ...camB, locked: true }]);
  assert.deepEqual(press(camA, picked('camB'), { node: lockedB }), planned('move', cameras, 'camA', grab('camA')));
  assert.deepEqual(press({ ...camA, locked: true }, picked('camB'), { node: lockedB }), planned('marquee', cameras, 'camB'));
});

test('there is nothing to go on from with several selected, a selection outside the pile or a pile of one', () => {
  assert.deepEqual(press(I, picked('O', 'c'), { again: true }), planned('move', NONE, 'I', grab('I')), 'several selected');
  assert.deepEqual(press(I, picked('c', 'O'), { again: true }), planned('move', NONE, 'I', grab('I')), 'several selected, a pile member last');
  assert.deepEqual(press(camA, picked('c', 'camB')), planned('move', NONE, 'camA', grab('camA')), 'several selected, on the cameras');
  assert.deepEqual(press(I, picked('c'), { again: true }), planned('move', NONE, 'I', grab('I')), 'the selected node is not in the pile');
  assert.deepEqual(press(I, picked('I'), { again: true, pile: ['I'] }), planned('move', NONE, 'I', grab('I')), 'a pile of one');
  assert.deepEqual(press(I, picked(), { again: true }), planned('move', NONE, 'I', grab('I')), 'nothing selected');
});

test('a press is decided by its input alone, which is left as it was', () => {
  // The nodes, the selections and the piles above are frozen.
  const input: Press = freeze({ canEdit: true, shift: false, hit: I, pile: PILES.I, selection: picked('O'), again: true, node: among(pressMap.nodes) });
  const before = JSON.stringify(input), first = resolvePlanPress(input);
  resolvePlanPress({ ...input, again: false });
  resolvePlanPress({ ...input, canEdit: false, selection: picked('I') });
  assert.deepEqual(resolvePlanPress(input), first);
  assert.equal(JSON.stringify(input), before);
});
