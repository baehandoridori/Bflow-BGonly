import test from 'node:test';
import assert from 'node:assert/strict';
import { nodesHeldBy, spaceHoldsNode, spacePlanArea, spaceStackRanks, spacesAt, spacesOverlap, stackedSpaces } from '../src/features/backgrounds/mapStack.ts';
import { containsPoint, rectToPolygon } from '../src/features/backgrounds/mapGeometry.ts';
import { nodePlanOutline } from '../src/features/backgrounds/mapSpatial.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';

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

// --- Holding -----------------------------------------------------------------------------------
/** A camera standing at a plan point. Without a height of its own its lens is at the default 120. */
const lens = (id: string, point: BackgroundPoint, extra: Partial<BackgroundCamera> = {}): BackgroundCamera =>
  ({ id, type: 'camera', name: id, x: point.x, y: point.y, spaceId: null, angle: 0, fov: 60, viewIds: [], locked: false, ...extra });
/** A table, unless told otherwise: 60 high. */
const thing = (id: string, x: number, y: number, width: number, height: number, extra: Partial<BackgroundSymbol> = {}): BackgroundSymbol =>
  ({ id, type: 'symbol', name: id, symbol: 'table', spaceId: null, x, y, width, height, rotation: 0, locked: false, hinge: 'left', swing: 'inward', ...extra });
/** A plan offset turned as the plan turns a node about its centre. */
const turn = (point: BackgroundPoint, degrees: number): BackgroundPoint => {
  const radians = degrees * Math.PI / 180;
  return { x: point.x * Math.cos(radians) - point.y * Math.sin(radians), y: point.x * Math.sin(radians) + point.y * Math.cos(radians) };
};
/** Where a camera stands on the wall line of a room: the four corners of the outline the 3D view draws, and the middle of each wall between two of them. */
const wallLine = (source: BackgroundSpace) => {
  const corners = nodePlanOutline(source);
  return { corners, middles: corners.map((point, index) => {
    const next = corners[(index + 1) % corners.length];
    return { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
  }) };
};
/** A point `by` further from the middle of a room: from the middle of a wall straight out through it, from a corner out along the diagonal. */
const away = (source: BackgroundSpace, point: BackgroundPoint, by: number): BackgroundPoint => {
  const dx = point.x - (source.x + source.width / 2), dy = point.y - (source.y + source.height / 2), length = Math.hypot(dx, dy);
  return { x: point.x + dx / length * by, y: point.y + dy / length * by };
};
/** A 400 by 300 room with the top left of its box at a point: a rectangle and the polygon of it, unturned and turned four ways. */
const tenRooms = (x: number, y: number) => [0, 17, 45, 90, 213].flatMap(rotation => {
  const rect = space('room', x, y, 400, 300, { rotation });
  return [rect, rectToPolygon(rect)!];
});
/** A building of the default height, 900 by 600, and the 200 by 200 room in the middle of it. */
const house = space('house', 0, 0, 900, 600), middle = space('middle', 350, 200, 200, 200);

test('K-1: a room holds a node only whole, a camera on its wall line or at the level of its lid included', () => {
  // A camera stands at its lens: held from the floor up to the top of the walls, both included.
  const raised = space('raised', 0, 0, 400, 300, { elevation: 40, volumeHeight: 100 }), centre = { x: 200, y: 150 };
  const at = (elevation: number) => spaceHoldsNode(raised, lens('lens', centre, { elevation }));
  assert.equal(at(40), true, 'on the floor'); assert.equal(at(139.9), true, 'just under the lid'); assert.equal(at(140), true, 'at the level of the lid');
  assert.equal(at(141), false, 'over the lid'); assert.equal(at(39), false, 'under the floor');
  assert.equal(spaceHoldsNode(raised, lens('lens', centre)), true, 'no height of its own: 120');
  assert.equal(spaceHoldsNode(raised, lens('lens', { x: 420, y: 150 }, { elevation: 90 })), false, 'off the outline');
  assert.equal(at(NaN), false, 'a height that is no number');
  // The slack is a millionth: a ten-millionth over the lid or off the wall line is still on it, a hundred-thousandth is not.
  assert.equal(at(140 + 1e-7), true, 'a ten-millionth over the lid'); assert.equal(at(140 + 1e-5), false, 'a hundred-thousandth over the lid');
  assert.equal(spaceHoldsNode(raised, lens('lens', { x: 400 + 1e-7, y: 150 }, { elevation: 90 })), true, 'a ten-millionth off the wall line');
  assert.equal(spaceHoldsNode(raised, lens('lens', { x: 400 + 1e-5, y: 150 }, { elevation: 90 })), false, 'a hundred-thousandth off the wall line');
  // A road has no volume, though the camera stands on its floor. A room does not hold itself.
  assert.equal(spaceHoldsNode({ ...raised, surface: 'road' }, lens('lens', centre, { elevation: 40 })), false, 'a road');
  assert.equal(spaceHoldsNode(raised, raised), false, 'itself');

  // On the wall line. The box stays at (0, 0): there one corner of the polygon turned 45 degrees is missed by the four diagonals alone.
  for (const source of tenRooms(0, 0)) {
    const label = `${source.shape} turned ${source.rotation}`, { corners, middles } = wallLine(source);
    assert.equal(corners.length, 4, label);
    for (const [index, spot] of [...corners, ...middles].entries()) assert.equal(spaceHoldsNode(source, lens('lens', spot)), true, `${label}: on the wall line, spot ${index}`);
    for (const [index, spot] of middles.entries()) assert.equal(spaceHoldsNode(source, lens('lens', away(source, spot, 0.5))), false, `${label}: half a unit off wall ${index}`);
    for (const [index, spot] of corners.entries()) assert.equal(spaceHoldsNode(source, lens('lens', away(source, spot, 0.4))), false, `${label}: 0.4 off corner ${index}`);
  }
  // An L: on the two walls of its cut-out and on the corner between them it holds, in the cut-out it does not. Its middle, (100, 50), is in the cut-out.
  for (const spot of [{ x: 140, y: 40 }, { x: 80, y: 70 }, { x: 80, y: 40 }]) assert.equal(spaceHoldsNode(bent, lens('lens', spot)), true, `on the cut-out at ${spot.x}, ${spot.y}`);
  assert.equal(spaceHoldsNode(bent, lens('lens', { x: 140, y: 70 })), false, 'in the cut-out');
  // A round room: on its rim it holds, at a corner of its box it does not.
  const round = space('round', 0, 0, 400, 300, { shape: 'ellipse' });
  for (const degrees of [0, 30, 90, 200, 270]) {
    const spot = { x: 200 + 200 * Math.cos(degrees * Math.PI / 180), y: 150 + 150 * Math.sin(degrees * Math.PI / 180) };
    assert.equal(spaceHoldsNode(round, lens('lens', spot)), true, `on the rim at ${degrees} degrees`);
  }
  assert.equal(spaceHoldsNode(round, lens('lens', { x: 0, y: 0 })), false, 'a corner of the box');
  // Far from the origin the same: on the wall line held, a hundredth off it not.
  for (const source of tenRooms(99000, 0)) {
    const label = `far, ${source.shape} turned ${source.rotation}`, { corners, middles } = wallLine(source);
    for (const [index, spot] of [...corners, ...middles].entries()) {
      assert.equal(spaceHoldsNode(source, lens('lens', spot)), true, `${label}: on the wall line, spot ${index}`);
      assert.equal(spaceHoldsNode(source, lens('lens', away(source, spot, 0.01))), false, `${label}: a hundredth off spot ${index}`);
    }
  }

  // A space or a symbol is held whole or not at all.
  assert.equal(spaceHoldsNode(house, middle), true, 'the room in the middle');
  // The middle of the building is in the room, its corners are not.
  assert.equal(spaceHoldsNode(middle, house), false, 'the building around the room');
  const corridor = space('corridor', -100, 250, 1100, 100);
  assert.equal(spaceHoldsNode(house, corridor), false, 'a corridor across the building'); assert.equal(spaceHoldsNode(corridor, house), false, 'the building across the corridor');
  for (const [x, y] of [[0, 0], [700, 0], [700, 450], [0, 450]]) assert.equal(spaceHoldsNode(house, space('nook', x, y, 200, 150)), true, `flush in the corner at ${x}, ${y}`);
  const left = space('left', 100, 100, 300, 200), right = space('right', 300, 150, 300, 200);
  assert.equal(spaceHoldsNode(left, right), false, 'half over'); assert.equal(spaceHoldsNode(right, left), false, 'half over, the other way round');
  assert.equal(spaceHoldsNode(house, space('beyond', 700.5, 450, 200, 150)), false, 'half a unit through a wall');
  assert.equal(spaceHoldsNode(house, space('taller', 350, 200, 200, 200, { volumeHeight: 181 })), false, 'a unit taller');
  assert.equal(spaceHoldsNode(house, space('sunk', 350, 200, 200, 200, { elevation: -1 })), false, 'a unit lower');
  assert.equal(spaceHoldsNode(house, space('level', 350, 200, 200, 200, { volumeHeight: 180 })), true, 'as tall');
  assert.equal(spaceHoldsNode(house, space('loft', 350, 200, 200, 200, { elevation: 80, volumeHeight: 100 })), true, 'up to the lid');
  assert.equal(spaceHoldsNode(house, space('path', 100, 100, 600, 60, { surface: 'road' })), true, 'a road on the floor');
  // A road keeps the height it had as a room, but it has no walls.
  assert.equal(spaceHoldsNode(house, space('paved', 100, 100, 600, 60, { surface: 'road', volumeHeight: 300 })), true, 'a road on the floor that was a room taller than the building');
  // Stairs climb one storey: their top step is at the lid.
  assert.equal(spaceHoldsNode(house, thing('stairs', 100, 300, 80, 160, { symbol: 'stairs' })), true, 'stairs of the default height');
  assert.equal(spaceHoldsNode(house, thing('across, middle in', 840, 300, 100, 60)), false, 'a table across a wall, its middle inside');
  assert.equal(spaceHoldsNode(house, thing('across, middle out', 870, 300, 100, 60)), false, 'a table across a wall, its middle outside');
  assert.equal(spaceHoldsNode(house, thing('on the roof', 400, 300, 60, 60, { elevation: 180 })), false, 'on the roof');
  assert.equal(spaceHoldsNode(house, thing('through the lid', 400, 300, 60, 60, { elevation: 150 })), false, 'through the lid');
  // A tilted table is asked by the outline it casts: tilted 30 degrees towards the right wall it reaches past it.
  const upright = thing('upright', 810, 270, 80, 60), outwards = { ...upright, roll: -30 }, inwards = { ...upright, roll: 30 };
  const reach = (node: BackgroundSymbol) => Math.max(...nodePlanOutline(node).map(point => point.x));
  assert.ok(reach(outwards) > 900 && reach(upright) < 900 && reach(inwards) < 900, 'the cast outlines');
  assert.equal(spaceHoldsNode(house, upright), true, 'upright');
  assert.equal(spaceHoldsNode(house, outwards), false, 'tilted towards the wall');
  assert.equal(spaceHoldsNode(house, inwards), true, 'tilted inwards');
  assert.equal(spaceHoldsNode(house, thing('broken', 400, 300, 60, 60, { volumeHeight: NaN })), false, 'a height that is no number');

  // The shape of the box: a room flush in each corner of a rectangle, of the polygon of it, and of both turned.
  for (const box of tenRooms(0, 0)) {
    const outline = nodePlanOutline(box);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      // A 200 by 150 room in that corner, turned with the box about its own centre.
      const offset = turn({ x: sx * 100, y: sy * 75 }, box.rotation), label = `${box.shape} turned ${box.rotation}, corner ${sx}, ${sy}`;
      const nook = space('nook', 200 + offset.x - 100, 150 + offset.y - 75, 200, 150, { rotation: box.rotation });
      assert.ok(nodePlanOutline(nook).some(point => outline.some(corner => Math.hypot(point.x - corner.x, point.y - corner.y) < 1e-9)), `${label}: a corner of the box`);
      assert.equal(spaceHoldsNode(box, nook), true, label);
    }
  }
  // A round box holds the room in its middle, not the one in a corner of its box.
  assert.equal(spaceHoldsNode(round, space('core', 150, 100, 100, 100)), true, 'in the middle of a round box');
  assert.equal(spaceHoldsNode(round, space('nook', 0, 0, 200, 150)), false, 'in a corner of the box of a round box');
  // An L: a room in the cut-out is outside it, a room in an arm inside.
  const bentBox = polygon('bentBox', 0, 0, 400, 300, [0, 0], [1, 0], [1, 0.4], [0.4, 0.4], [0.4, 1], [0, 1]);
  assert.equal(spaceHoldsNode(bentBox, space('notched', 220, 160, 120, 100)), false, 'in the cut-out');
  assert.equal(spaceHoldsNode(bentBox, space('arm', 200, 20, 150, 80)), true, 'in an arm');
});

test('K-2: nodesHeldBy lists what closed rooms hold, once, and of two identical boxes the earlier in the map holds the later', () => {
  // In the room in the middle of the building: a chair, a camera on its left wall line and one at the level of its lid.
  const seat = thing('seat', 420, 270, 60, 60, { symbol: 'chair' }), nook = space('nook', 0, 0, 200, 150);
  const onWall = lens('on the wall', { x: 350, y: 300 }), atLid = lens('at the lid', { x: 450, y: 300 }, { elevation: 180 });
  const offWall = lens('off the wall', { x: 340, y: 300 }), overLid = lens('over the lid', { x: 450, y: 300 }, { elevation: 200 });
  const map = mapOf([house, middle, nook, seat, onWall, atLid, offWall, overLid]);
  const held = (boxes: BackgroundSpace[], source = map) => [...nodesHeldBy(source, boxes)];
  // No box, or none that holds anything: the one empty set.
  const none = nodesHeldBy(map, []);
  assert.equal(none.size, 0);
  assert.equal(nodesHeldBy(map, []), none); assert.equal(nodesHeldBy(mapOf([]), []), none);
  assert.equal(nodesHeldBy(map, [nook]), none, 'a box with nothing in it');
  // The room in the middle alone: what stands in it, on its wall line and at the level of its lid. Not the building
  // around it, not the camera ten off its wall or the one twenty over its lid.
  assert.deepEqual(held([middle]), ['seat', 'on the wall', 'at the lid']);
  // Every room a box: all that is in the building, but the building itself. The camera over the lid is over its roof as well.
  const inside = ['middle', 'nook', 'seat', 'on the wall', 'at the lid', 'off the wall'];
  assert.deepEqual(held([house, middle, nook]), inside); assert.deepEqual(held([nook, middle, house]), inside);
  // Two boxes of one outline on the same levels hold each other: the later in the map is held, whatever the order of the boxes.
  const twin = space('twin', 350, 200, 200, 200);
  for (const order of [[middle, twin], [twin, middle]]) for (const boxes of [[middle, twin], [twin, middle]])
    assert.deepEqual(held(boxes, mapOf([...order, seat])), [order[1].id, 'seat'], `map ${ids(order).join(' ')}, boxes ${ids(boxes).join(' ')}`);
  // A room not drawn closed, in just the place of a box, is held by it in either order.
  const ghost = space('ghost', 350, 200, 200, 200);
  for (const order of [[middle, ghost], [ghost, middle]]) assert.deepEqual(held([middle], mapOf(order)), ['ghost'], ids(order).join(' '));
  // Two boxes half over each other hold nothing.
  const left = space('left', 100, 100, 300, 200), right = space('right', 300, 150, 300, 200);
  assert.equal(nodesHeldBy(mapOf([left, right]), [left, right]), none);
});
