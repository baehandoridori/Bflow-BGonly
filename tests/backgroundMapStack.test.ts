import test from 'node:test';
import assert from 'node:assert/strict';
import { spacePlanArea, spaceStackRanks, spacesAt, spacesOverlap, stackedSpaces } from '../src/features/backgrounds/mapStack.ts';
import { containsPoint } from '../src/features/backgrounds/mapGeometry.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';

const near = (actual: number, expected: number, label = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label} ${actual} != ${expected}`);

const space = (id: string, x: number, y: number, width: number, height: number, extra: Partial<BackgroundSpace> = {}): BackgroundSpace =>
  ({ id, type: 'space', name: id, placeId: null, childMapId: null, x, y, width, height, rotation: 0, shape: 'rect', points: [], locked: false, ...extra });
/** A polygon space from its stored 0..1 points. */
const polygon = (id: string, x: number, y: number, width: number, height: number, ...points: [number, number][]): BackgroundSpace =>
  space(id, x, y, width, height, { shape: 'polygon', points: points.map(([px, py]) => ({ x: px, y: py })) });
const mapOf = (nodes: BackgroundNode[]): BackgroundMap => ({ id: 'map', revision: 1, name: '학교', parentId: null, placeId: null, imageUrl: '', nodes });
const ids = (nodes: readonly BackgroundNode[]) => nodes.map(node => node.id);
const reversed = (source: BackgroundSpace): BackgroundSpace => ({ ...source, points: [...source.points].reverse() });

const triangle = polygon('triangle', 0, 0, 100, 50, [0, 0], [1, 0], [0.5, 1]);
/** An L: the box without its bottom-right part. */
const bent = polygon('bent', 0, 0, 200, 100, [0, 0], [1, 0], [1, 0.4], [0.4, 0.4], [0.4, 1], [0, 1]);
/** A triangle with no corner at the origin of its box: the edge that closes it counts, and its terms differ in sign. */
const peak = polygon('peak', 0, 0, 100, 50, [0.5, 0], [1, 1], [0, 1]);

/** A building site, the floor on it, a room on the floor and a closet in the room: listed in no order of size. */
const closet = space('closet', 320, 220, 60, 40), room = space('room', 300, 200, 200, 150);
const site = space('site', 0, 0, 1000, 680), floor = space('floor', 100, 80, 800, 520);
const chair: BackgroundSymbol = { id: 'chair', type: 'symbol', name: '의자', symbol: 'chair', spaceId: null, x: 330, y: 230, width: 40, height: 40, rotation: 0, locked: false, hinge: 'left', swing: 'inward' };
const camera: BackgroundCamera = { id: 'camera', type: 'camera', name: '카메라 1', x: 500, y: 340, spaceId: null, angle: 0, fov: 60, viewIds: [], locked: false };
const building = () => mapOf([closet, room, site, floor, chair, camera]);

test('the plan area of a space is the area of the shape the plan draws', () => {
  assert.equal(spacePlanArea(space('outer', 100, 80, 800, 520)), 416000);
  near(spacePlanArea(space('inner', 400, 260, 160, 140, { shape: 'ellipse' })), 17592.91886010284, 'ellipse');
  assert.equal(spacePlanArea(triangle), 2500);
  near(spacePlanArea(bent), 12800, 'bent');
  assert.equal(spacePlanArea(peak), 2500);
  // With fewer than three points the plan draws the box.
  assert.equal(spacePlanArea(polygon('line', 0, 0, 100, 50, [0, 0], [1, 1])), 5000);
  // Only a polygon is drawn from its points: a room or an ellipse that still carries some keeps its own shape.
  assert.equal(spacePlanArea(space('room with points', 0, 0, 100, 50, { points: triangle.points })), 5000);
  near(spacePlanArea(space('ellipse with points', 0, 0, 100, 50, { shape: 'ellipse', points: triangle.points })), 5000 * Math.PI / 4, 'ellipse with points');
});

test('turning a space does not change its area', () => {
  for (const source of [space('outer', 100, 80, 800, 520), space('inner', 400, 260, 160, 140, { shape: 'ellipse' }), triangle, bent])
    assert.equal(spacePlanArea({ ...source, rotation: 37 }), spacePlanArea(source), source.id);
});

test('a polygon whose points run the other way round has the same area, not a negative one', () => {
  assert.equal(spacePlanArea(reversed(triangle)), 2500);
  near(spacePlanArea(reversed(bent)), 12800, 'bent');
  assert.equal(spacePlanArea(reversed(peak)), 2500);
});

test('the smaller space is on top, whatever the order in the map', () => {
  const outer = space('outer', 100, 80, 800, 520), inner = space('inner', 400, 260, 160, 140, { shape: 'ellipse' });
  assert.deepEqual(ids(stackedSpaces(mapOf([inner, outer]))), ['outer', 'inner']);
  assert.deepEqual(ids(stackedSpaces(mapOf([outer, inner]))), ['outer', 'inner']);
});

test('a large polygon drawn the other way round stays below the room inside it', () => {
  const large = polygon('큰 다각형', 0, 0, 400, 400, [0, 0], [0, 1], [1, 1], [1, 0]), small = space('작은 사각형', 100, 100, 50, 50);
  for (const nodes of [[large, small], [small, large]]) {
    const map = mapOf(nodes);
    assert.deepEqual(ids(stackedSpaces(map)), ['큰 다각형', '작은 사각형']);
    assert.deepEqual(ids(spacesAt(map, { x: 120, y: 120 })), ['작은 사각형', '큰 다각형']);
  }
});

test('of two spaces of the same area the later in the map is on top', () => {
  const twinA = space('twinA', 0, 0, 100, 100), twinB = space('twinB', 50, 50, 100, 100);
  assert.deepEqual(ids(stackedSpaces(mapOf([twinA, twinB]))), ['twinA', 'twinB']);
  assert.deepEqual(ids(stackedSpaces(mapOf([twinB, twinA]))), ['twinB', 'twinA']);
});

test('only the spaces of a map are stacked, the largest at the bottom', () => {
  assert.deepEqual(ids(stackedSpaces(building())), ['site', 'floor', 'room', 'closet']);
});

test('a space whose width is no number lies at the bottom', () => {
  const broken = space('broken', 0, 0, NaN, 10);
  assert.deepEqual(ids(stackedSpaces(mapOf([closet, broken, site]))), ['broken', 'site', 'closet']);
  assert.deepEqual(ids(stackedSpaces(mapOf([site, closet, broken]))), ['broken', 'site', 'closet']);
});

test('so does a space whose area is minus infinity', () => {
  // A number, but not a finite one: kept as it is, it would be the smallest area and lie on top.
  const endless = space('endless', 0, 0, -Infinity, 10);
  assert.deepEqual(ids(stackedSpaces(mapOf([closet, endless, site]))), ['endless', 'site', 'closet']);
  assert.deepEqual(ids(stackedSpaces(mapOf([site, closet, endless]))), ['endless', 'site', 'closet']);
});

test('stacking hands back the nodes it was given and leaves the map as it was', () => {
  const map = building(), nodes = map.nodes, before = JSON.stringify(map);
  const stacked = stackedSpaces(map);
  [site, floor, room, closet].forEach((source, index) => assert.equal(stacked[index], source, source.id));
  spaceStackRanks(map); spacesAt(map, { x: 340, y: 240 });
  assert.equal(map.nodes, nodes);
  assert.deepEqual(ids(map.nodes), ['closet', 'room', 'site', 'floor', 'chair', 'camera']);
  assert.equal(JSON.stringify(map), before);
});

test('ranks number the spaces from the bottom and hold nothing that is not a space', () => {
  const ranks = spaceStackRanks(building());
  assert.deepEqual(['site', 'floor', 'room', 'closet'].map(id => ranks.get(id)), [0, 1, 2, 3]);
  assert.equal(ranks.size, 4);
  assert.equal(ranks.has(chair.id), false); assert.equal(ranks.has(camera.id), false);
});

test('the spaces that hold a plan point come topmost first', () => {
  const map = building(), at = (x: number, y: number) => spacesAt(map, { x, y });
  assert.deepEqual(ids(at(340, 240)), ['closet', 'room', 'floor', 'site']);
  assert.deepEqual(ids(at(450, 300)), ['room', 'floor', 'site']);
  assert.deepEqual(ids(at(150, 100)), ['floor', 'site']);
  assert.deepEqual(ids(at(50, 50)), ['site']);
  assert.deepEqual(ids(at(-5, -5)), []);
  // The nodes themselves, not copies.
  assert.equal(at(340, 240)[0], closet); assert.equal(at(50, 50)[0], site);
});

test('a turned room, an ellipse and a polygon hold the points containsPoint says they hold', () => {
  const turned = space('turned', 100, 100, 200, 60, { rotation: 90 }), oval = space('oval', 100, 100, 200, 60, { shape: 'ellipse', rotation: 20 });
  const at = (source: BackgroundSpace, x: number, y: number) => ids(spacesAt(mapOf([source]), { x, y }));
  // Turned a quarter the room stands upright around its centre (200, 130): it holds what the unturned box does not.
  assert.deepEqual(at(turned, 200, 40), ['turned']); assert.deepEqual(at(turned, 110, 130), []);
  assert.deepEqual(at({ ...turned, rotation: 0 }, 200, 40), []); assert.deepEqual(at({ ...turned, rotation: 0 }, 110, 130), ['turned']);
  // A corner of the box is outside the ellipse, the cut-out of the L is outside the polygon.
  assert.deepEqual(at({ ...oval, rotation: 0 }, 200, 130), ['oval']); assert.deepEqual(at({ ...oval, rotation: 0 }, 105, 105), []);
  assert.deepEqual(at(bent, 50, 80), ['bent']); assert.deepEqual(at(bent, 150, 20), ['bent']); assert.deepEqual(at(bent, 150, 80), []);
  for (const source of [turned, { ...turned, rotation: 37 }, oval, bent, { ...bent, x: 120, y: 90, rotation: 310 }]) {
    let inside = 0, outside = 0;
    for (let x = -40; x <= 360; x += 20) for (let y = -40; y <= 280; y += 20) {
      const held = containsPoint(source, { x, y });
      assert.deepEqual(at(source, x, y), held ? [source.id] : [], `${source.id} at ${x}, ${y}`);
      if (held) inside += 1; else outside += 1;
    }
    // The grid reaches both sides of every outline.
    assert.ok(inside > 0 && outside > 0, `${source.id}: ${inside} inside, ${outside} outside`);
  }
});

// --- Roads -------------------------------------------------------------------------------------
/** Two roads through the building: the street across the site, the lane down it. By area alone both would lie above the floor. */
const street = space('street', 0, 300, 1000, 80, { surface: 'road' }), lane = space('lane', 480, 0, 40, 680, { surface: 'road' });
const town = () => mapOf([closet, street, room, site, lane, floor, chair, camera]);

test('a road lies under every room whatever its size, and of two roads the larger lies below', () => {
  const stacked = ['street', 'lane', 'site', 'floor', 'room', 'closet'];
  assert.deepEqual(ids(stackedSpaces(town())), stacked);
  for (const nodes of [[street, lane, site, floor, room, closet], [closet, room, floor, site, lane, street], [lane, closet, street, floor, site, room], [site, street, floor, lane, room, closet]])
    assert.deepEqual(ids(stackedSpaces(mapOf(nodes))), stacked, ids(nodes).join(' '));
  // A small road under a large room: by area it would be on top.
  const patch = space('patch', 0, 0, 10, 10, { surface: 'road' });
  assert.deepEqual(ids(stackedSpaces(mapOf([patch, site]))), ['patch', 'site']);
  assert.deepEqual(ids(stackedSpaces(mapOf([site, patch]))), ['patch', 'site']);
});

test('the layer is asked before the area: a road and a room of one area, and two roads of one area', () => {
  // Equal areas fall back on the order in the map only inside one layer.
  const paved = space('paved', 0, 0, 100, 100, { surface: 'road' }), hut = space('hut', 50, 50, 100, 100);
  assert.deepEqual(ids(stackedSpaces(mapOf([paved, hut]))), ['paved', 'hut']);
  assert.deepEqual(ids(stackedSpaces(mapOf([hut, paved]))), ['paved', 'hut']);
  const other = space('other', 50, 50, 100, 100, { surface: 'road' });
  assert.deepEqual(ids(stackedSpaces(mapOf([paved, other]))), ['paved', 'other']);
  assert.deepEqual(ids(stackedSpaces(mapOf([other, paved]))), ['other', 'paved']);
});

test('ranks count the roads first', () => {
  const ranks = spaceStackRanks(town());
  assert.deepEqual(['street', 'lane', 'site', 'floor', 'room', 'closet'].map(id => ranks.get(id)), [0, 1, 2, 3, 4, 5]);
  assert.equal(ranks.size, 6);
});

test('at a plan point every room comes before the roads under it', () => {
  const map = town();
  assert.deepEqual(ids(spacesAt(map, { x: 490, y: 340 })), ['room', 'floor', 'site', 'lane', 'street']);
  // Off the floor, on the site and the lane.
  assert.deepEqual(ids(spacesAt(map, { x: 490, y: 20 })), ['site', 'lane']);
  // Roads alone: the smaller on top, as with rooms.
  assert.deepEqual(ids(spacesAt(mapOf([street, lane]), { x: 490, y: 340 })), ['lane', 'street']);
  assert.deepEqual(ids(spacesAt(mapOf([lane, street]), { x: 490, y: 340 })), ['lane', 'street']);
});

test('a road whose area is no number lies at the bottom of the roads and never above a room', () => {
  const broken = space('broken', 0, 0, NaN, 10, { surface: 'road' });
  for (const nodes of [[closet, broken, street, site], [site, street, closet, broken], [street, broken, site, closet]])
    assert.deepEqual(ids(stackedSpaces(mapOf(nodes))), ['broken', 'street', 'site', 'closet'], ids(nodes).join(' '));
  // A room broken the same way is at the bottom of its own layer: under the rooms, above every road.
  const shell = space('shell', 0, 0, NaN, 10);
  for (const nodes of [[closet, shell, street, site], [street, site, closet, shell]])
    assert.deepEqual(ids(stackedSpaces(mapOf(nodes))), ['street', 'shell', 'site', 'closet'], ids(nodes).join(' '));
});

test('stacking roads hands back the nodes it was given and leaves the map as it was', () => {
  const map = town(), nodes = map.nodes, before = JSON.stringify(map);
  const stacked = stackedSpaces(map);
  [street, lane, site, floor, room, closet].forEach((source, index) => assert.equal(stacked[index], source, source.id));
  spaceStackRanks(map);
  const held = spacesAt(map, { x: 490, y: 340 });
  assert.equal(held[0], room); assert.equal(held[3], lane); assert.equal(held[4], street);
  assert.equal(map.nodes, nodes);
  assert.deepEqual(ids(map.nodes), ['closet', 'street', 'room', 'site', 'lane', 'floor', 'chair', 'camera']);
  assert.equal(JSON.stringify(map), before);
});

// --- Overlap -----------------------------------------------------------------------------------
// The road of most lines is the street: (0, 300), 1000 by 80, so its lower edge runs along y 380.
const road = (id: string, x: number, y: number, width: number, height: number): BackgroundSpace => space(id, x, y, width, height, { surface: 'road' });
/** Asked both ways round: the order of the two spaces never changes the answer. */
const overlap = (a: BackgroundSpace, b: BackgroundSpace, expected: boolean, label: string) => {
  assert.equal(spacesOverlap(a, b), expected, label);
  assert.equal(spacesOverlap(b, a), expected, `${label}, the other way round`);
};

test('spaces that only share an edge or a corner, or lie apart, do not overlap', () => {
  // A building set against the street: its upper edge on the lower edge of the road.
  overlap(space('beside', 25, 380, 150, 150), street, false, 'an edge');
  overlap(space('corner', 1000, 380, 100, 100), street, false, 'a corner');
  overlap(space('apart', 25, 500, 150, 150), street, false, 'apart');
});

test('an overlap thinner than the slack is none, and a hundredth is one', () => {
  // One rounding step into the street.
  overlap(space('step', 25, 379.99999999999994, 150, 150), street, false, 'a rounding step deep');
  // A billionth into the side of a road: the strip the two share is thinner than the slack.
  overlap(space('sliver', 39.999999999, 100, 100, 100), road('alley', 0, 0, 40, 680), false, 'a billionth wide');
  overlap(space('over', 25, 379.99, 150, 150), street, true, 'a hundredth deep');
  // The slack is a millionth of a plan unit, in depth and in width: ten times that is an overlap, a tenth of it is none.
  overlap(space('fine', 25, 379.99999, 150, 150), street, true, 'a hundred-thousandth deep');
  overlap(space('finer', 25, 379.9999999, 150, 150), street, false, 'a ten-millionth deep');
  overlap(space('thin', 39.99999, 100, 100, 100), road('alley', 0, 0, 40, 680), true, 'a hundred-thousandth wide');
  overlap(space('thinner', 39.9999999, 100, 100, 100), road('alley', 0, 0, 40, 680), false, 'a ten-millionth wide');
});

test('a space inside another, on shared edges, with the same outline, half over it or across it overlaps it', () => {
  overlap(room, road('ground', 0, 0, 1000, 680), true, 'inside');
  // Three of its edges on the edges of the street.
  overlap(space('end', 0, 300, 100, 80), street, true, 'inside, on shared edges');
  overlap(space('twin', 0, 300, 1000, 80), street, true, 'the same outline');
  // Neither has a corner inside the other in these two: every corner is on an edge of the other, or outside it.
  overlap(space('left', 0, 0, 2, 2), road('right', 1, 0, 2, 2), true, 'half over');
  overlap(space('across', 400, 0, 200, 680), street, true, 'a cross');
});

test('the kind of the two spaces is not asked: two rooms overlap, and two roads', () => {
  overlap(space('one', 0, 0, 100, 100), space('other', 50, 50, 100, 100), true, 'two rooms');
  overlap(street, lane, true, 'two roads');
});

test('a polygon, an ellipse and a turned room overlap by the outline they are drawn with, not by their box', () => {
  const diamond = (y: number) => polygon('diamond', 100, y, 100, 100, [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]);
  overlap(diamond(380), street, false, 'a diamond with its point on the edge');
  overlap(diamond(370), street, true, 'a diamond with its point in the road');
  const oval = (y: number) => space('oval', 100, y, 200, 100, { shape: 'ellipse' });
  overlap(oval(380), street, false, 'an ellipse on the edge');
  overlap(oval(375), street, true, 'an ellipse in the road');
  // Turned an eighth the corner of the room reaches 106 above its centre.
  const turned = (y: number) => space('turned', 100, y, 150, 150, { rotation: 45 });
  overlap(turned(400), street, true, 'a turned room whose corner is in the road');
  overlap(turned(460), street, false, 'a turned room below the road');
  // An L round the end of a road: the boxes overlap, the shapes do not.
  overlap(polygon('hook', 900, 200, 300, 300, [0, 0], [1, 0], [1, 1], [0.4, 1], [0.4, 0.3], [0, 0.3]), road('stub', 0, 300, 1010, 80), false, 'an L round the end of the road');
  // A road that fills the slot of a U touches it on three sides.
  overlap(polygon('slot', 0, 0, 300, 300, [0, 0], [1, 0], [1, 1], [0.7, 1], [0.7, 0.3], [0.3, 0.3], [0.3, 1], [0, 1]), road('filling', 90, 90, 120, 210), false, 'a road in the slot of a U');
});

test('a vertical line is inside an outline between its 1st and 2nd crossing and between its 3rd and 4th, and it is read in the middle of a strip', () => {
  // A U on its side, open to the right: from x 90 to 300 a vertical line is inside it from y 0 to 90 and from 210 to 300.
  const open = polygon('open', 0, 0, 300, 300, [0, 0], [1, 0], [1, 0.3], [0.3, 0.3], [0.3, 0.7], [1, 0.7], [1, 1], [0, 1]);
  overlap(open, road('between', 90, 90, 210, 120), false, 'a road between the arms of a U on its side');
  overlap(open, road('under', 150, 220, 100, 60), true, 'a road on the lower arm of a U on its side');
  // A wedge with its point to the left: it spans one strip, and at either end of that strip a vertical line meets no area of it.
  overlap(polygon('wedge', 0, 0, 100, 100, [0, 0.5], [1, 0], [1, 1]), road('around', -100, -100, 500, 300), true, 'a wedge inside a road');
});

test('outlines that meet only between their corners overlap, and so does an outline that crosses itself', () => {
  // A slanted band through a long thin road: the outlines cross away from every corner, and of the strips between the xs of the corners alone none has its middle on the ground the two share.
  overlap(polygon('band', 500, -50, 220, 1000, [0, 0], [20 / 220, 0], [1, 1], [200 / 220, 1]), road('thin', -1000, 0, 2000, 10), true, 'a slanted band');
  // A bow tie inside a road: the middle of the one strip it spans is the point where it crosses itself.
  const bow = polygon('bow', 0, 0, 300, 100, [0, 0], [1, 1], [1, 0], [0, 1]);
  assert.equal(containsPoint(bow, { x: 75, y: 50 }), true); assert.equal(containsPoint(bow, { x: 225, y: 50 }), true);
  overlap(bow, road('around', -100, -100, 500, 300), true, 'a bow tie');
});

test('a space with a value that is no number overlaps nothing', () => {
  overlap(space('broken', 25, 300, NaN, 150), street, false, 'a width that is no number');
  // One corner is no number: the three that are left are a triangle inside the road.
  overlap(polygon('gap', 0, 0, 100, 200, [0, 0], [0.5, 0.5], [0, 1], [NaN, 0.5]), road('around', -100, -100, 500, 500), false, 'a polygon with a corner that is no number');
});
