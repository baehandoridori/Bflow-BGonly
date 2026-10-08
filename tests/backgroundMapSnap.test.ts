import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_SNAP, collectSnapCandidates, isQuarterTurn, nodeSnapBox, nodeSnapSpan, sameSnapGuides, snapMove, snapPoint, snapResize, snapRotation,
  snapTravellingIds, withVertexNeighbours } from '../src/features/backgrounds/mapSnap.ts';
import type { SnapCandidates, SnapGuide, SnapLine } from '../src/features/backgrounds/mapSnap.ts';
import { nodeResizeCorner, resizeSpaceTo } from '../src/features/backgrounds/mapGeometry.ts';
import { nodePlanOutline } from '../src/features/backgrounds/mapSpatial.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';

const TOLERANCE = 6, REACH = 48;
const near = (actual: number, expected: number, label = '', epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${label} ${actual} != ${expected}`);

const space = (id: string, x: number, y: number, width: number, height: number, extra: Partial<BackgroundSpace> = {}): BackgroundSpace =>
  ({ id, type: 'space', name: id, placeId: null, childMapId: null, x, y, width, height, rotation: 0, shape: 'rect', points: [], locked: false, ...extra });
const symbol = (id: string, x: number, y: number, width: number, height: number, extra: Partial<BackgroundSymbol> = {}): BackgroundSymbol =>
  ({ id, type: 'symbol', name: id, symbol: 'chair', spaceId: null, x, y, width, height, rotation: 0, locked: false, hinge: 'left', swing: 'inward', ...extra });
const camera = (id: string, x: number, y: number, extra: Partial<BackgroundCamera> = {}): BackgroundCamera =>
  ({ id, type: 'camera', name: id, x, y, spaceId: null, angle: 0, fov: 60, viewIds: [], locked: false, ...extra });
const plan = (...nodes: BackgroundNode[]): BackgroundMap => ({ id: 'map', revision: 1, name: '학교', parentId: null, placeId: null, imageUrl: '', nodes });

/** Hand-made lines run over the whole base extent unless a stretch is given. */
const vertical = (at: number, from = 0, to = 680): SnapLine => ({ axis: 'x', at, from, to });
const horizontal = (at: number, from = 0, to = 1000): SnapLine => ({ axis: 'y', at, from, to });
const only = (x: SnapLine[] = [], y: SnapLine[] = [], points: BackgroundPoint[] = []): SnapCandidates => ({ x, y, points });

/** The room things stick to, and the room that is dragged. */
const A = space('a', 100, 100, 144.65, 80), B = space('b', 300.4, 120.3, 60, 40);
/** What a drag of `ids` may stick to: everything that does not travel with them. */
const around = (map: BackgroundMap, ...ids: string[]) => collectSnapCandidates(map, snapTravellingIds(map, ids));
/** One node of the map dragged by `delta`. */
const drag = (map: BackgroundMap, id: string, delta: BackgroundPoint, tolerance = TOLERANCE, reach = REACH) => {
  const result = snapMove(map, [id], id, delta, around(map, id), tolerance, reach);
  assert.ok(result, `${id} moved`);
  return result;
};
const lineAt = (guides: readonly SnapGuide[], axis: 'x' | 'y') => guides.filter(guide => guide.axis === axis);

test('the snap distances are screen pixels and the stops are the quarter turns', () => {
  assert.deepEqual(MAP_SNAP, { tolerancePx: 6, reachPx: 48, quarterTurn: 0.01, rotationStops: [0, 90, 180, 270], rotationCapture: 3 });
});

test('a quarter turn is any multiple of 90 within a hundredth of a degree', () => {
  for (const rotation of [0, 90, 180, 270, 360, -90, 89.995]) assert.equal(isQuarterTurn(rotation), true, `${rotation}`);
  for (const rotation of [30, 89.9, 45]) assert.equal(isQuarterTurn(rotation), false, `${rotation}`);
});

test('a node offers its box at quarter turns and one point otherwise', () => {
  // Unturned and half turned: the stored values themselves.
  assert.equal(nodeSnapBox(A).right, 244.65);
  assert.deepEqual(nodeSnapBox(A), { left: 100, right: 244.65, top: 100, bottom: 180 });
  const room = space('room', 100, 100, 60, 40);
  assert.deepEqual(nodeSnapBox({ ...room, rotation: 180 }), { left: 100, right: 160, top: 100, bottom: 140 });
  // A quarter and three quarters: width and height change places about the centre (130, 120).
  assert.deepEqual(nodeSnapBox({ ...room, rotation: 90 }), { left: 110, right: 150, top: 90, bottom: 150 });
  assert.deepEqual(nodeSnapBox({ ...room, rotation: 270 }), { left: 110, right: 150, top: 90, bottom: 150 });
  // Any other turn, and a tilted symbol whatever its turn: the centre alone.
  assert.deepEqual(nodeSnapBox({ ...room, rotation: 30 }), { left: 130, right: 130, top: 120, bottom: 120 });
  const chair = symbol('chair', 400, 300, 60, 40);
  assert.deepEqual(nodeSnapBox(chair), { left: 400, right: 460, top: 300, bottom: 340 });
  assert.deepEqual(nodeSnapBox({ ...chair, rotation: 90 }), { left: 410, right: 450, top: 290, bottom: 350 });
  for (const tilt of [{ pitch: 20 }, { roll: -15 }, { rotation: 90, pitch: 20 }])
    assert.deepEqual(nodeSnapBox({ ...chair, ...tilt }), { left: 430, right: 430, top: 320, bottom: 320 }, JSON.stringify(tilt));
  assert.deepEqual(nodeSnapBox({ ...chair, pitch: 0, roll: 0 }), nodeSnapBox(chair));
  assert.deepEqual(nodeSnapBox(camera('lens', 512.5, 340.25)), { left: 512.5, right: 512.5, top: 340.25, bottom: 340.25 });
});

test('a node covers its box at quarter turns and the bounds of its outline otherwise', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const room = space('room', 100, 100, 60, 40, { rotation }), box = nodeSnapBox(room), span = nodeSnapSpan(room);
    for (const side of ['left', 'right', 'top', 'bottom'] as const) assert.equal(span[side], box[side], `${rotation} ${side}`);
  }
  assert.deepEqual(nodeSnapSpan(camera('lens', 512.5, 340.25)), { left: 512.5, right: 512.5, top: 340.25, bottom: 340.25 });
  // A turned room is one point to stick to, but it covers the box around what is seen.
  const turned = nodeSnapSpan(space('turned', 500, 300, 80, 40, { rotation: 30 }));
  near(turned.left, 495.359, 'left', 1e-3); near(turned.right, 584.641, 'right', 1e-3); near(turned.top, 282.679, 'top', 1e-3); near(turned.bottom, 357.321, 'bottom', 1e-3);
  for (const tilted of [symbol('tilted', 400, 300, 60, 40, { pitch: 30 }), symbol('leaning', 400, 300, 60, 40, { rotation: 90, roll: 25 })]) {
    const outline = nodePlanOutline(tilted), xs = outline.map(point => point.x), ys = outline.map(point => point.y);
    assert.deepEqual(nodeSnapSpan(tilted), { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }, tilted.id);
    assert.ok(nodeSnapSpan(tilted).right - nodeSnapSpan(tilted).left > 30, tilted.id);
  }
});

test('what travels with a drag is the node itself and the unlocked members of an unlocked space', () => {
  const room = space('room', 100, 100, 300, 200), other = space('other', 500, 100, 200, 200);
  const map = plan(room, camera('lens', 200, 150, { spaceId: 'room' }), symbol('chair', 300, 220, 40, 30, { spaceId: 'room' }),
    symbol('bolted', 150, 250, 40, 30, { spaceId: 'room', locked: true }), camera('fixed', 180, 180, { spaceId: 'room', locked: true }),
    other, symbol('stool', 550, 150, 40, 30, { spaceId: 'other' }), camera('loose', 800, 500));
  const ids = (moving: string[], source = map) => [...snapTravellingIds(source, moving)].sort();
  assert.ok(snapTravellingIds(map, ['room']) instanceof Set);
  assert.deepEqual(ids(['room']), ['chair', 'lens', 'room']);
  assert.deepEqual(ids(['room', 'other']), ['chair', 'lens', 'other', 'room', 'stool']);
  // A locked space does not move, so it carries nothing.
  assert.deepEqual(ids(['room'], plan(...map.nodes.map(node => node.id === 'room' ? { ...node, locked: true } : node))), ['room']);
  assert.deepEqual(ids(['lens']), ['lens']); assert.deepEqual(ids(['chair']), ['chair']); assert.deepEqual(ids(['loose']), ['loose']);
  assert.deepEqual(ids([]), []);
});

test('candidates are the plan border and the lines of every node that is not excluded', () => {
  assert.deepEqual(collectSnapCandidates(plan(), new Set()), { x: [vertical(0), vertical(1000)], y: [horizontal(0), horizontal(680)], points: [] });

  // A room at a quarter turn: start, middle and end on each axis, each over the stretch the room covers on the other.
  const one = collectSnapCandidates(plan(A), new Set());
  assert.deepEqual(one.x.slice(0, 2), [vertical(0), vertical(1000)]); assert.deepEqual(one.y.slice(0, 2), [horizontal(0), horizontal(680)]);
  assert.equal(one.x.length, 5); assert.equal(one.y.length, 5);
  assert.equal(one.x[2].at, 100); near(one.x[3].at, 172.325, 'middle x'); assert.equal(one.x[4].at, 244.65);
  assert.deepEqual(one.y.slice(2).map(line => line.at), [100, 140, 180]);
  for (const line of one.x.slice(2)) assert.deepEqual({ ...line, at: 0 }, vertical(0, 100, 180));
  for (const line of one.y.slice(2)) assert.deepEqual({ ...line, at: 0 }, horizontal(0, 100, 244.65));

  // A turned room: its centre lines only, but over the box around its outline and not over one point.
  const turned = space('turned', 500, 300, 80, 40, { rotation: 30 }), span = nodeSnapSpan(turned);
  const loose = collectSnapCandidates(plan(turned), new Set());
  assert.deepEqual(loose.x.slice(2), [vertical(540, span.top, span.bottom)]); assert.deepEqual(loose.y.slice(2), [horizontal(320, span.left, span.right)]);
  assert.ok(span.bottom - span.top > 70 && span.right - span.left > 85);

  const lens = collectSnapCandidates(plan(camera('lens', 700, 500)), new Set());
  assert.deepEqual(lens.x.slice(2), [vertical(700, 500, 500)]); assert.deepEqual(lens.y.slice(2), [horizontal(500, 700, 700)]);

  // Nothing of an excluded node is left, and the order is the order of the map.
  assert.deepEqual(collectSnapCandidates(plan(A, B), new Set(['b'])), one);
  const swapped = collectSnapCandidates(plan(B, A), new Set());
  assert.equal(swapped.x.length, 8); assert.equal(swapped.x[2].at, 300.4); assert.equal(swapped.x[5].at, 100);
  assert.deepEqual(collectSnapCandidates(plan(A, B), new Set(['a', 'b'])), collectSnapCandidates(plan(), new Set()));
});

test('candidate points are the corners of rectangle and polygon spaces only', () => {
  const triangle = space('triangle', 400, 400, 100, 50, { shape: 'polygon', rotation: 37, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] });
  const map = plan(A, space('oval', 600, 100, 100, 60, { shape: 'ellipse' }), symbol('chair', 300, 500, 40, 30), triangle, camera('lens', 700, 500));
  const { points } = collectSnapCandidates(map, new Set());
  assert.equal(points.length, 7);
  assert.deepEqual(points, [...nodePlanOutline(A), ...nodePlanOutline(triangle)]);
  [[100, 100], [244.65, 100], [244.65, 180], [100, 180]].forEach(([x, y], index) => { near(points[index].x, x, `corner ${index} x`); near(points[index].y, y, `corner ${index} y`); });
  assert.deepEqual(collectSnapCandidates(map, new Set(['a'])).points, nodePlanOutline(triangle));
});

test('a move does not stick to what is far away on the other axis', () => {
  const map = plan(A, B);
  // The left edge of B is 3.75 from the right edge of A, but 240.7 below it.
  const far = drag(map, 'b', { x: -52, y: 300.4 });
  assert.deepEqual(far.position, { x: 248, y: 421 }); assert.deepEqual(far.guides, []);
  // The same drag with a reach that takes A in.
  assert.equal(drag(map, 'b', { x: -52, y: 300.4 }, TOLERANCE, 1000).position.x, 244.65);
  // Near is judged where the drag is before anything sticks. The left edge at 206 is 54 from the end of the level
  // line; stuck at 200 it is exactly 48 from it, and must still not take the line.
  const before = snapMove(plan(space('d', 300, 500, 20, 20)), ['d'], 'd', { x: -94, y: 2 }, only([vertical(200)], [horizontal(500, 100, 152)]), TOLERANCE, REACH);
  assert.deepEqual(before?.position, { x: 200, y: 502 }); assert.deepEqual(before?.guides, [{ axis: 'x', at: 200, from: 0, to: 680 }]);
});

test('the reach is measured from the stretch a line covers, the gap of exactly the reach included', () => {
  const C = space('c', 300, 300, 60, 40), map = plan(A, C);
  // The top of C at 228, the bottom of A at 180: a gap of exactly 48.
  const edge = drag(map, 'c', { x: -52, y: -72 });
  assert.equal(edge.position.x, 244.65); assert.equal(edge.position.y, 228);
  assert.equal(edge.guides.length, 1); assert.equal(edge.guides[0].axis, 'x');
  const past = drag(map, 'c', { x: -52, y: -71 });
  assert.deepEqual(past.position, { x: 248, y: 229 }); assert.deepEqual(past.guides, []);
  // No reach: what overlaps or touches is still a target. Anything that is not a distance counts as none.
  for (const reach of [0, NaN, -5, Infinity]) {
    assert.equal(drag(map, 'c', { x: -52, y: -120 }, TOLERANCE, reach).position.x, 244.65, `touching, reach ${reach}`);
    assert.equal(drag(map, 'c', { x: -52, y: -119 }, TOLERANCE, reach).position.x, 248, `a gap of 1, reach ${reach}`);
  }
});

test('the plan border is a line over the base extent only', () => {
  // 159.8 above the base extent: the left border stretched upward is not a target.
  const above = drag(plan(space('room', 3.4, -200, 60, 40)), 'room', { x: 0, y: 0.2 });
  assert.deepEqual(above.position, { x: 3, y: -200 }); assert.deepEqual(above.guides, []);
  // 39.8 above it.
  const close = drag(plan(space('room', 3.4, -80, 60, 40)), 'room', { x: 0, y: 0.2 });
  assert.deepEqual(close.position, { x: 0, y: -80 });
  // The guide runs from where the room landed to the far end of the border.
  assert.deepEqual(close.guides, [{ axis: 'x', at: 0, from: -80, to: 680 }]);
});

test('a guide does not run to a far line that happens to share the value', () => {
  // E has the same left edge as A, far below.
  const map = plan(A, B, space('e', 100, 500, 80, 60));
  const result = drag(map, 'b', { x: -198, y: 10.4 });
  assert.deepEqual(result.position, { x: 100, y: 131 });
  assert.deepEqual(result.guides, [{ axis: 'x', at: 100, from: 100, to: 180 }]);
});

test('a move sticks edge to edge, centre to centre and to the border; the other axis becomes a whole number', () => {
  const map = plan(A, B);
  const edge = drag(map, 'b', { x: -52, y: 10.4 });
  assert.equal(edge.position.x, 244.65); assert.equal(edge.position.y, 131);
  assert.deepEqual(edge.guides, [{ axis: 'x', at: 244.65, from: 100, to: 180 }]);
  // The result delta is what takes the stored position there.
  near(B.x + edge.delta.x, 244.65, 'delta x'); near(B.y + edge.delta.y, 131, 'delta y');

  const centres = drag(map, 'b', { x: -158, y: -1.9 });
  near(centres.position.x, 142.325, 'centre x'); near(centres.position.y, 120, 'centre y');
  assert.equal(centres.guides.length, 2);
  const [across] = lineAt(centres.guides, 'x'), [along] = lineAt(centres.guides, 'y');
  near(across.at, 172.325, 'guide x'); assert.equal(across.from, 100); assert.equal(across.to, 180);
  assert.equal(along.at, 140); assert.equal(along.from, 100); near(along.to, 244.65, 'guide y end');

  const nothing = drag(map, 'b', { x: 200.3, y: 300.3 });
  assert.deepEqual(nothing.position, { x: 501, y: 421 }); assert.deepEqual(nothing.guides, []);

  // The right edge on x = 1000 and the top edge on y = 0.
  const border = drag(map, 'b', { x: 637, y: -117 });
  near(border.position.x, 940, 'border x'); assert.equal(border.position.y, 0);
  assert.equal(border.guides.length, 2);

  const off = drag(map, 'b', { x: -52, y: 10.4 }, 0);
  assert.deepEqual(off.position, { x: 248, y: 131 }); assert.deepEqual(off.guides, []);
  // Just below zero is 0, not -0.
  assert.deepEqual(snapMove(map, ['b'], 'b', { x: -300.6, y: -120.7 }, only(), TOLERANCE, REACH)?.position, { x: 0, y: 0 });
});

test('a turned node sticks by its centre, and near is measured by its outline', () => {
  const turned = space('turned', 500, 300, 80, 40, { rotation: 30 });
  const centre = drag(plan(A, turned), 'turned', { x: -366, y: -182 });
  near(centre.position.x, 132.325, 'centre x'); near(centre.position.y, 120, 'centre y'); assert.equal(centre.guides.length, 2);

  // G: centre (380, 250), the box around its outline starts near x = 268.397.
  const G = space('g', 280, 200, 200, 100, { rotation: 30 });
  // Its centre is 131.6 from the right edge of A, its outline about 20.
  const close = drag(plan(A, G), 'g', { x: -3.75, y: -108.4 });
  near(close.position.x, 276, 'outline x'); near(close.position.y, 90, 'outline y');
  assert.equal(close.guides.length, 1); assert.equal(close.guides[0].axis, 'y'); assert.equal(close.guides[0].at, 140);
  // The outline about 73.75 away.
  const far = drag(plan(A, G), 'g', { x: 50, y: -108.4 });
  assert.deepEqual(far.position, { x: 330, y: 92 }); assert.deepEqual(far.guides, []);

  // The other way round: the left edge of H is 28 from the outline of G, and its centre sticks to the centre line of G.
  const beside = drag(plan(G, space('h', 600, 300, 60, 40)), 'h', { x: -80.4, y: -68.6 });
  near(beside.position.x, 520, 'beside x'); near(beside.position.y, 230, 'beside y');
  assert.equal(beside.guides.length, 1); assert.equal(beside.guides[0].axis, 'y'); assert.equal(beside.guides[0].at, 250);
});

test('a move sticks at exactly the tolerance, to the closer line, and to the earlier pair on a tie', () => {
  const D = space('d', 300, 500, 20, 20), map = plan(D);
  const move = (delta: BackgroundPoint, candidates: SnapCandidates) => {
    const result = snapMove(map, ['d'], 'd', delta, candidates, TOLERANCE, REACH);
    assert.ok(result);
    return result;
  };
  // The left edge 6 from the line, then 6.01.
  const at = move({ x: -94, y: 0 }, only([vertical(200)]));
  assert.equal(at.position.x, 200); assert.equal(at.guides.length, 1);
  const beyond = move({ x: -93.99, y: 0 }, only([vertical(200)]));
  assert.equal(beyond.position.x, 206); assert.deepEqual(beyond.guides, []);

  // The left edge at 201.5: 3.5 from one line and 1.5 from the other, in either order.
  assert.equal(move({ x: -98.5, y: 0 }, only([vertical(198), vertical(203)])).position.x, 203);
  assert.equal(move({ x: -98.5, y: 0 }, only([vertical(203), vertical(198)])).position.x, 203);

  // Left 95, centre 105, right 115: four pairs 5 apart. The first found, (left, 100), wins.
  const tie = move({ x: -205, y: 0 }, only([vertical(100), vertical(110)]));
  assert.equal(tie.position.x, 100); assert.equal(tie.position.y, 500);
  assert.deepEqual(tie.guides, [{ axis: 'x', at: 100, from: 0, to: 680 }]);
  // The moving lines are gone through first, start to end: the left edge (80) on the later line beats the centre (100) on the earlier one.
  const wide = snapMove(plan(space('w', 300, 500, 40, 20)), ['w'], 'w', { x: -220, y: 0 }, only([vertical(95), vertical(85)]), TOLERANCE, REACH);
  assert.equal(wide?.position.x, 85);
});

test('a tie stays a tie through the last digits of fractions: the start wins at every pointer position', () => {
  // Two chairs of one size: left to left, centre to centre and right to right are the same distance, apart in the last digit only.
  const map = plan(symbol('fixed', 244.65, 300, 60, 60), symbol('chair', 300.4, 380, 60, 60)), candidates = around(map, 'chair');
  // The left edge goes from 5.9 before the left edge of the other chair to 5.9 past it.
  for (let step = 0; step < 400; step++) {
    const result = snapMove(map, ['chair'], 'chair', { x: 244.65 - 5.9 + step * 0.0295 - 300.4, y: 0 }, candidates, TOLERANCE, REACH);
    // The stored x is the very number of the other chair, and the guide does not jump to its centre line.
    assert.deepEqual(result?.position, { x: 244.65, y: 380 }, `step ${step}`);
    assert.deepEqual(result?.guides, [{ axis: 'x', at: 244.65, from: 300, to: 440 }], `step ${step}`);
  }
  // Only the last digits are a tie: a line closer by a millionth still wins over an earlier one.
  assert.equal(snapPoint({ x: 200, y: 0 }, only([vertical(202.000001), vertical(198)]), TOLERANCE).point.x, 198);
});

test('a guide covers every near line at the value it stuck to', () => {
  // F starts where A ends, a little below: both are within reach of B.
  const map = plan(A, B, space('f', 244.65, 240, 50, 40));
  const result = drag(map, 'b', { x: -52, y: 72.4 });
  assert.equal(result.position.x, 244.65); assert.equal(result.position.y, 193);
  assert.deepEqual(result.guides, [{ axis: 'x', at: 244.65, from: 100, to: 280 }]);
});

test('several nodes move as one box and share the delta', () => {
  const P = space('p', 300, 120, 30, 40), Q = space('q', 340, 130, 30, 40), map = plan(A, P, Q);
  const candidates = around(map, 'p', 'q'), delta = { x: -52, y: -13.4 };
  const both = snapMove(map, ['p', 'q'], 'q', delta, candidates, TOLERANCE, REACH);
  assert.ok(both);
  // The left edge of the pair is the left edge of P: it lands on the right edge of A, and the anchor goes as far.
  near(both.position.x, 284.65, 'anchor x'); assert.equal(both.position.y, 117);
  near(P.x + both.delta.x, 244.65, 'left edge'); near(Q.x + both.delta.x, both.position.x, 'anchor delta x');
  assert.equal(both.delta.y, -13);
  assert.deepEqual(both.guides, [{ axis: 'x', at: 244.65, from: 100, to: 180 }]);
  // The same result whichever way the ids are listed.
  assert.deepEqual(snapMove(map, ['q', 'p'], 'q', delta, candidates, TOLERANCE, REACH), both);
  // Alone, the anchor is too far from that edge.
  const alone = snapMove(map, ['q'], 'q', delta, candidates, TOLERANCE, REACH);
  assert.ok(alone);
  assert.equal(alone.position.x, 288); assert.deepEqual(lineAt(alone.guides, 'x'), []);
});

test('a move without a usable anchor or distance is null, and the map is left as it was', () => {
  const map = plan(A, B), candidates = around(map, 'b'), frozen = JSON.stringify(map), lines = JSON.stringify(candidates);
  assert.equal(snapMove(map, ['b'], 'missing', { x: -52, y: 10.4 }, candidates, TOLERANCE, REACH), null);
  assert.equal(snapMove(map, ['b'], 'a', { x: -52, y: 10.4 }, candidates, TOLERANCE, REACH), null);
  assert.equal(snapMove(map, [], 'b', { x: -52, y: 10.4 }, candidates, TOLERANCE, REACH), null);
  for (const delta of [{ x: NaN, y: 0 }, { x: 0, y: NaN }, { x: Infinity, y: 0 }, { x: 0, y: -Infinity }])
    assert.equal(snapMove(map, ['b'], 'b', delta, candidates, TOLERANCE, REACH), null, JSON.stringify(delta));
  const first = drag(map, 'b', { x: -52, y: 10.4 });
  drag(map, 'b', { x: 637, y: -117 });
  assert.deepEqual(drag(map, 'b', { x: -52, y: 10.4 }), first);
  assert.equal(JSON.stringify(map), frozen); assert.equal(JSON.stringify(candidates), lines);
});

test('a point takes a near corner before any line', () => {
  const candidates = only([vertical(200)], [horizontal(100)], [{ x: 210, y: 110 }, { x: 203, y: 104 }, { x: 205, y: 105 }]);
  // (203, 104) is 3.6 away; the lines are closer on each axis, and still lose.
  assert.deepEqual(snapPoint({ x: 201, y: 101 }, candidates, TOLERANCE),
    { point: { x: 203, y: 104 }, guides: [{ axis: 'x', at: 203, from: 104, to: 104 }, { axis: 'y', at: 104, from: 203, to: 203 }] });
  // 5 away on each axis is more than 6 in a straight line: no corner, so the lines take it.
  assert.deepEqual(snapPoint({ x: 198, y: 99 }, candidates, TOLERANCE).point, { x: 200, y: 100 });
  // The closest corner, not the first one near enough: (205, 105) is 5.7 away and comes first.
  assert.deepEqual(snapPoint({ x: 201, y: 101 }, only([], [], [{ x: 205, y: 105 }, { x: 203, y: 104 }]), TOLERANCE).point, { x: 203, y: 104 });
  // A corner at exactly the tolerance.
  assert.deepEqual(snapPoint({ x: 216, y: 110 }, only([], [], [{ x: 210, y: 110 }]), TOLERANCE).point, { x: 210, y: 110 });
  assert.deepEqual(snapPoint({ x: 216.01, y: 110 }, only([], [], [{ x: 210, y: 110 }]), TOLERANCE).point, { x: 216, y: 110 });
});

test('a point sticks to a line on one axis and becomes a whole number on the other', () => {
  const mixed = snapPoint({ x: 203.2, y: 300.6 }, only([vertical(200, 50, 80), vertical(206.5, 0, 10)]), TOLERANCE);
  assert.deepEqual(mixed, { point: { x: 200, y: 301 }, guides: [{ axis: 'x', at: 200, from: 50, to: 301 }] });
  const level = snapPoint({ x: 203.2, y: 300.6 }, only([], [horizontal(302.5, 400, 450), horizontal(302.5, 90, 120)]), TOLERANCE);
  assert.deepEqual(level, { point: { x: 203, y: 302.5 }, guides: [{ axis: 'y', at: 302.5, from: 90, to: 450 }] });
  // Lines no more than a millionth apart are one line to a guide. Two millionths apart they are two.
  const guidesWith = (at: number) => snapPoint({ x: 197.2, y: 300.6 }, only([vertical(200, 50, 80), vertical(at, 400, 450)]), TOLERANCE).guides;
  assert.deepEqual(guidesWith(200.0000005), [{ axis: 'x', at: 200, from: 50, to: 450 }]);
  assert.deepEqual(guidesWith(200.000002), [{ axis: 'x', at: 200, from: 50, to: 301 }]);
  const both = snapPoint({ x: 203.2, y: 300.6 }, only([vertical(200.25, 50, 80)], [horizontal(302.5, 400, 450)]), TOLERANCE);
  assert.deepEqual(both.point, { x: 200.25, y: 302.5 });
  assert.deepEqual(both.guides, [{ axis: 'x', at: 200.25, from: 50, to: 302.5 }, { axis: 'y', at: 302.5, from: 200.25, to: 450 }]);
  assert.deepEqual(snapPoint({ x: 203.2, y: 300.6 }, only(), TOLERANCE), { point: { x: 203, y: 301 }, guides: [] });
  assert.deepEqual(snapPoint({ x: -0.3, y: -0.2 }, only(), TOLERANCE).point, { x: 0, y: 0 });
  // No tolerance: whole numbers only, even on a line or a corner.
  assert.deepEqual(snapPoint({ x: 200.4, y: 100.6 }, only([vertical(200.4)], [horizontal(100.6)], [{ x: 200.4, y: 100.6 }]), 0), { point: { x: 200, y: 101 }, guides: [] });
});

test('a point sticks to the x and y of a neighbouring point however far that point is', () => {
  const empty = only(), candidates = withVertexNeighbours(empty, [{ x: 100, y: 100 }]);
  assert.deepEqual(candidates, { x: [vertical(100, 100, 100)], y: [horizontal(100, 100, 100)], points: [] });
  assert.deepEqual(empty, { x: [], y: [], points: [] });
  // 500 below the neighbour, on its x.
  assert.deepEqual(snapPoint({ x: 102.4, y: 600.3 }, candidates, TOLERANCE), { point: { x: 100, y: 600 }, guides: [{ axis: 'x', at: 100, from: 100, to: 600 }] });
  // 200 to its right, on its y.
  assert.deepEqual(snapPoint({ x: 300.2, y: 102.4 }, candidates, TOLERANCE), { point: { x: 300, y: 100 }, guides: [{ axis: 'y', at: 100, from: 100, to: 300 }] });

  // Lines are added after the ones given, and the corners are kept.
  const corners = [{ x: 400, y: 400 }], given = only([vertical(0)], [horizontal(680)], corners);
  const added = withVertexNeighbours(given, [{ x: 100, y: 120 }, { x: 300, y: 320 }]);
  assert.deepEqual(added.x, [vertical(0), vertical(100, 120, 120), vertical(300, 320, 320)]);
  assert.deepEqual(added.y, [horizontal(680), horizontal(120, 100, 100), horizontal(320, 300, 300)]);
  assert.deepEqual(added.points, corners); assert.equal(given.x.length, 1); assert.equal(given.y.length, 1);
});

test('a resize of an unturned node sticks its right and bottom edges, and the other length becomes a whole number', () => {
  const room = space('room', 244.65, 120.3, 60, 40), map = plan(room, space('next', 351.1, 110, 80, 100));
  const candidates = around(map, 'room');
  const wide = snapResize(room, { x: 349, y: 171.9 }, candidates, TOLERANCE, REACH);
  near(wide.node.x + wide.node.width, 351.1, 'right edge'); assert.equal(wide.node.height, 52);
  assert.equal(wide.node.x, 244.65); assert.equal(wide.node.y, 120.3);
  assert.deepEqual(wide.node, { ...room, width: wide.node.width, height: 52 });
  assert.deepEqual(wide.guides, [{ axis: 'x', at: 351.1, from: 110, to: 210 }]);
  // The bottom edge on the bottom of the neighbour, 2.1 to the right of the dragged box.
  const tall = snapResize(room, { x: 349, y: 208.2 }, candidates, TOLERANCE, REACH);
  near(tall.node.y + tall.node.height, 210, 'bottom edge'); near(tall.node.x + tall.node.width, 351.1, 'right edge');
  assert.equal(tall.guides.length, 2);
  const [level] = lineAt(tall.guides, 'y');
  assert.equal(level.at, 210); assert.equal(level.from, 244.65); near(level.to, 431.1, 'guide end');
  // Nothing near: both lengths are whole numbers and nothing is shown.
  assert.deepEqual(snapResize(room, { x: 320.2, y: 150.9 }, candidates, TOLERANCE, REACH), { node: { ...room, width: 76, height: 31 }, guides: [] });
  assert.deepEqual(snapResize(room, { x: 349, y: 171.9 }, candidates, 0, REACH), { node: { ...room, width: 104, height: 52 }, guides: [] });
  // Corners are not used by a resize.
  assert.deepEqual(snapResize(room, { x: 320.2, y: 150.9 }, only([], [], [{ x: 321, y: 151 }]), TOLERANCE, REACH).node, { ...room, width: 76, height: 31 });
});

test('a resize keeps the stored position of an unturned node to the last digit', () => {
  const room = space('room', 244.65, 120.3, 144.65, 80), candidates = only([vertical(400.35)], [horizontal(250.15)]);
  for (const corner of [{ x: 398, y: 248 }, { x: 398, y: 190.4 }, { x: 310.7, y: 248 }, { x: 281.33, y: 163.27 }, { x: 100, y: 50 }, { x: 250000, y: 250000 }]) {
    const { node } = snapResize(room, corner, candidates, TOLERANCE, REACH), label = JSON.stringify(corner);
    assert.equal(node.x, 244.65, label); assert.equal(node.y, 120.3, label);
  }
});

test('a resize does not stick to a neighbour that is far away on the other axis', () => {
  const room = space('room', 100, 100, 60, 40), corner = { x: 198.4, y: 140.3 };
  const beside = snapResize(room, corner, only([vertical(200, 100, 180)]), TOLERANCE, REACH);
  assert.equal(beside.node.width, 100); assert.equal(beside.node.height, 40);
  assert.deepEqual(beside.guides, [{ axis: 'x', at: 200, from: 100, to: 180 }]);
  // 259.7 below the bottom of the dragged box.
  const far = snapResize(room, corner, only([vertical(200, 400, 480)]), TOLERANCE, REACH);
  assert.equal(far.node.width, 98); assert.equal(far.node.height, 40); assert.deepEqual(far.guides, []);
  // The reach is measured as for a move: a gap of exactly the reach counts, and no reach means touching.
  const flat = { x: 198.4, y: 140 };
  assert.equal(snapResize(room, flat, only([vertical(200, 188, 480)]), TOLERANCE, REACH).node.width, 100);
  assert.equal(snapResize(room, flat, only([vertical(200, 189, 480)]), TOLERANCE, REACH).node.width, 98);
  assert.equal(snapResize(room, flat, only([vertical(200, 0, 52)]), TOLERANCE, REACH).node.width, 100);
  assert.equal(snapResize(room, flat, only([vertical(200, 0, 51)]), TOLERANCE, REACH).node.width, 98);
  for (const reach of [0, NaN, -5, Infinity]) {
    assert.equal(snapResize(room, flat, only([vertical(200, 140, 480)]), TOLERANCE, reach).node.width, 100, `touching, reach ${reach}`);
    assert.equal(snapResize(room, flat, only([vertical(200, 141, 480)]), TOLERANCE, reach).node.width, 98, `a gap of 1, reach ${reach}`);
  }
  // Near is measured from the box between the fixed corner and the dragged one, not from the room as it was:
  // a line that starts 110 below the room is inside the box dragged down to 300.3,
  assert.equal(snapResize(room, { x: 198.4, y: 300.3 }, only([vertical(200, 250, 400)]), TOLERANCE, REACH).node.width, 100);
  // and one that starts 30 below the room is 58 from the box dragged up to 112.
  assert.equal(snapResize(room, { x: 198.4, y: 112 }, only([vertical(200, 170, 400)]), TOLERANCE, REACH).node.width, 98);
  // A guide covers the near lines at that value only.
  const pair = snapResize(room, corner, only([vertical(200, 150, 180), vertical(200, 400, 480), vertical(200, 60, 90)]), TOLERANCE, REACH);
  assert.deepEqual(pair.guides, [{ axis: 'x', at: 200, from: 60, to: 180 }]);
  // And the node as it is after the resize.
  const grown = snapResize(room, { x: 198.4, y: 300.3 }, only([vertical(200, 100, 180)]), TOLERANCE, REACH);
  assert.deepEqual(grown, { node: { ...room, width: 100, height: 200 }, guides: [{ axis: 'x', at: 200, from: 100, to: 300 }] });
});

test('at a quarter turn the screen axes change places and signs', () => {
  const room = space('room', 100, 100, 60, 40);
  // A quarter: the fixed corner is (150, 90), the dragged one (110, 150). Screen y sets the width.
  const quarter = { ...room, rotation: 90 };
  const down = snapResize(quarter, { x: 95.4, y: 178 }, only([], [horizontal(180)]), TOLERANCE, REACH);
  assert.equal(down.node.width, 90); assert.equal(down.node.height, 55);
  assert.deepEqual(down.node, resizeSpaceTo(quarter, 90, 55));
  const moved = nodeResizeCorner(down.node), kept = nodeSnapBox(down.node);
  near(moved.x, 95, 'dragged corner x'); near(moved.y, 180, 'dragged corner y'); near(kept.right, 150, 'fixed corner x'); near(kept.top, 90, 'fixed corner y');
  assert.equal(down.guides.length, 1); assert.equal(down.guides[0].axis, 'y'); assert.equal(down.guides[0].at, 180);
  // Screen x sets the height there, and it grows to the left.
  const left = snapResize(quarter, { x: 82.3, y: 151.4 }, only([vertical(80)]), TOLERANCE, REACH);
  assert.equal(left.node.height, 70); assert.equal(left.node.width, 61); assert.equal(left.guides.length, 1); assert.equal(left.guides[0].axis, 'x');

  // Half a turn: the fixed corner is (160, 140), the dragged one the screen top-left (100, 100).
  const half = snapResize({ ...room, rotation: 180 }, { x: 80.3, y: 90.4 }, only([vertical(75)]), TOLERANCE, REACH);
  assert.equal(half.node.width, 85); assert.equal(half.node.height, 50);
  near(half.node.x, 75, 'half x'); near(half.node.y, 90, 'half y');
  // Three quarters: the fixed corner is (110, 150), the dragged one (150, 90).
  const three = snapResize({ ...room, rotation: 270 }, { x: 170.2, y: 69.6 }, only([], [horizontal(65)]), TOLERANCE, REACH);
  assert.equal(three.node.width, 85); assert.equal(three.node.height, 60);
  assert.equal(three.guides.length, 1); assert.equal(three.guides[0].axis, 'y');
});

test('a node at any other turn does not stick when resized: both lengths become whole numbers', () => {
  const turned = space('turned', 100, 100, 60, 40, { rotation: 30 }), handle = nodeResizeCorner(turned);
  const corner = { x: handle.x + 20.3, y: handle.y + 10.2 };
  // Lines right under the dragged corner.
  const result = snapResize(turned, corner, only([vertical(corner.x)], [horizontal(corner.y)]), TOLERANCE, REACH);
  assert.equal(result.node.width, 83); assert.equal(result.node.height, 39); assert.deepEqual(result.guides, []);
  assert.deepEqual(result.node, resizeSpaceTo(turned, 83, 39));
});

test('a resize ignores a line that would leave less than the minimum, and stops at the limits', () => {
  const room = space('room', 100, 100, 60, 40);
  // Sticking to x = 108 would leave a width of 8: the axis counts as not stuck.
  const narrow = snapResize(room, { x: 113, y: 140 }, only([vertical(108)]), TOLERANCE, REACH);
  assert.equal(narrow.node.width, 13); assert.deepEqual(narrow.guides, []);
  assert.equal(snapResize(room, { x: 104.4, y: 140 }, only([vertical(108)]), TOLERANCE, REACH).node.width, 10);
  // Exactly the minimum sticks.
  const least = snapResize(room, { x: 113, y: 140 }, only([vertical(110)]), TOLERANCE, REACH);
  assert.equal(least.node.width, 10); assert.equal(least.guides.length, 1);
  // Dragged past the fixed corner.
  assert.deepEqual(snapResize(room, { x: 40.2, y: 20.7 }, only(), TOLERANCE, REACH).node, { ...room, width: 10, height: 10 });
  const huge = snapResize(room, { x: 250000.4, y: 140.2 }, only(), TOLERANCE, REACH);
  assert.equal(huge.node.width, 100000); assert.equal(huge.node.height, 40);
  // A stuck length past the maximum is kept and cut there. The edge is then short of the line, so no guide is shown.
  const long = space('long', 0, 0, 99990, 40);
  const cut = snapResize(long, { x: 99998, y: 40 }, only([vertical(100003, 0, 40)]), TOLERANCE, REACH);
  assert.equal(cut.node.width, 100000); assert.deepEqual(cut.guides, []);
  // Exactly the maximum sticks.
  const most = snapResize(long, { x: 99998, y: 40 }, only([vertical(100000, 0, 40)]), TOLERANCE, REACH);
  assert.equal(most.node.width, 100000); assert.deepEqual(most.guides, [{ axis: 'x', at: 100000, from: 0, to: 40 }]);
});

test('a symbol is resized by the same rules, and a tilted one does not stick', () => {
  const chair = symbol('chair', 100, 100, 60, 40), corner = { x: 198.4, y: 140.3 }, candidates = only([vertical(200, 100, 180)]);
  const stuck = snapResize(chair, corner, candidates, TOLERANCE, REACH);
  assert.deepEqual(stuck, { node: { ...chair, width: 100, height: 40 }, guides: [{ axis: 'x', at: 200, from: 100, to: 180 }] });
  const turned = snapResize({ ...chair, rotation: 270 }, { x: 170.2, y: 69.6 }, only([], [horizontal(65)]), TOLERANCE, REACH);
  assert.equal(turned.node.width, 85); assert.equal(turned.node.height, 60);
  const tilted = snapResize({ ...chair, pitch: 20 }, corner, candidates, TOLERANCE, REACH);
  assert.deepEqual(tilted, { node: { ...chair, pitch: 20, width: 98, height: 40 }, guides: [] });
});

test('a rotation is caught within 3 degrees of a quarter turn and is free elsewhere', () => {
  const cases: [number, number][] = [[357.5, 0], [2.9, 0], [3.1, 3.1], [92, 90], [-91, 270], [360, 0], [45.5, 45.5], [3, 0], [177, 180], [183, 180], [273.01, 273.01], [86.99, 86.99], [-45.5, 314.5]];
  for (const [degrees, expected] of cases) assert.equal(snapRotation(degrees), expected, `${degrees}`);
  assert.ok(Number.isNaN(snapRotation(NaN))); assert.equal(snapRotation(Infinity), Infinity);
  // Another capture width.
  assert.equal(snapRotation(92, 1), 92); assert.equal(snapRotation(99.5, 10), 90); assert.equal(snapRotation(91.5, 0), 91.5);
});

test('two lists of guides are the same when every line has the same four values', () => {
  const guides: SnapGuide[] = [{ axis: 'x', at: 244.65, from: 100, to: 180 }, { axis: 'y', at: 140, from: 100, to: 244.65 }];
  assert.equal(sameSnapGuides(guides, guides.map(guide => ({ ...guide }))), true);
  assert.equal(sameSnapGuides([], []), true);
  assert.equal(sameSnapGuides(guides, guides.slice(0, 1)), false); assert.equal(sameSnapGuides([], guides), false);
  assert.equal(sameSnapGuides(guides, [guides[1], guides[0]]), false);
  const changes: Partial<SnapGuide>[] = [{ axis: 'y' }, { at: 244.66 }, { from: 101 }, { to: 181 }];
  for (const change of changes) assert.equal(sameSnapGuides(guides, [{ ...guides[0], ...change }, guides[1]]), false, JSON.stringify(change));
});
