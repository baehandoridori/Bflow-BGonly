import test from 'node:test';
import assert from 'node:assert/strict';
import { getSymbolPreset, symbolCatalog } from '../src/features/backgrounds/symbolCatalog.ts';
import { isRoadSpace, nodeVolumeHeight, roadCentreLine, roadCentrePlanLine, spaceWallHeight } from '../src/features/backgrounds/mapSpatial.ts';
import { containsPoint } from '../src/features/backgrounds/mapGeometry.ts';
import type { BackgroundPoint, BackgroundSpace, BackgroundSpaceSurface, BackgroundSymbolKind } from '../src/features/backgrounds/types.ts';

test('the symbol list has stairs before the generic object, and a kind that is not listed reads as the generic object', () => {
  // Removed presets stay the generic object: they never become whatever is listed next to it.
  for (const kind of ['desk', 'sofa', 'cabinet', 'plant'] as const) assert.equal(getSymbolPreset(kind).id, 'custom', kind);
  assert.deepEqual(getSymbolPreset('stairs'), { id: 'stairs', label: '계단', width: 120, height: 240 });
  assert.equal(getSymbolPreset('piano' as BackgroundSymbolKind).id, 'custom');
  assert.deepEqual(symbolCatalog.map(item => item.id), ['door', 'chair', 'table', 'bed', 'stairs', 'custom']);
});

type Pair = [number, number];
const TURNS = [0, 37, 90, 250];
const space = (width: number, height: number, extra: Partial<BackgroundSpace> = {}): BackgroundSpace =>
  ({ id: 'space', type: 'space', name: '공간', placeId: null, childMapId: null, x: 0, y: 0, width, height, rotation: 0, shape: 'rect', points: [], locked: false, ...extra });
const road = (width: number, height: number, extra: Partial<BackgroundSpace> = {}): BackgroundSpace => space(width, height, { surface: 'road', ...extra });
/** A polygon road from its stored points: (share of the width, share of the height). */
const strip = (width: number, height: number, ...points: Pair[]): BackgroundSpace =>
  road(width, height, { shape: 'polygon', points: points.map(([x, y]) => ({ x, y })) });
/** The same shape as a room: the key is gone, not empty. */
const asRoom = (source: BackgroundSpace): BackgroundSpace => { const room = { ...source }; delete room.surface; return room; };
const sameLine = (actual: BackgroundPoint[] | null, expected: Pair[], label: string) => {
  assert.ok(actual, `${label}: no line`);
  assert.equal(actual.length, expected.length, `${label}: number of points`);
  expected.forEach(([x, y], index) => assert.ok(Math.abs(actual[index].x - x) < 1e-9 && Math.abs(actual[index].y - y) < 1e-9,
    `${label}: point ${index} is (${actual[index].x}, ${actual[index].y}), not (${x}, ${y})`));
};

const HEXAGON: Pair[] = [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]];
/** Shapes with a centre line, in the frame of spaceOutline: the origin is the centre of the box. */
const LINES: [string, BackgroundSpace, Pair[]][] = [
  ['wide rectangle', road(300, 100), [[-150, 0], [150, 0]]],
  ['tall rectangle', road(100, 300), [[0, -150], [0, 150]]],
  ['square rectangle', road(200, 200), [[-100, 0], [100, 0]]],
  ['wide four points', strip(300, 100, [0, 0], [1, 0], [1, 1], [0, 1]), [[-150, 0], [150, 0]]],
  ['wide four points listed the other way round', strip(300, 100, [0, 1], [1, 1], [1, 0], [0, 0]), [[-150, 0], [150, 0]]],
  // Pairing from the first point runs across the road and is shorter than the road is wide: the next start is used.
  ['tall four points', strip(100, 300, [0, 0], [1, 0], [1, 1], [0, 1]), [[0, -150], [0, 150]]],
  // Both pairings hold: the smaller start wins.
  ['square four points', strip(200, 200, [0, 0], [1, 0], [1, 1], [0, 1]), [[-100, 0], [100, 0]]],
  ['L', strip(200, 200, [0, 0], [1, 0], [1, 1], [0.6, 1], [0.6, 0.4], [0, 0.4]), [[-100, -60], [60, -60], [60, 100]]],
  ['L listed from its next point', strip(200, 200, [1, 0], [1, 1], [0.6, 1], [0.6, 0.4], [0, 0.4], [0, 0]), [[60, 100], [60, -60], [-100, -60]]],
  ['six-point strip', strip(300, 100, [0, 0], [0.5, 0], [1, 0], [1, 1], [0.5, 1], [0, 1]), [[-150, 0], [0, 0], [150, 0]]],
  ['six-point strip listed from its next point', strip(300, 100, [0.5, 0], [1, 0], [1, 1], [0.5, 1], [0, 1], [0, 0]), [[150, 0], [0, 0], [-150, 0]]],
  // Inner rungs at 82 and 72 degrees to the road.
  ['road with two bends', strip(400, 200, [0, 0], [0.5, 0], [0.5, 0.6], [1, 0.6], [1, 1], [0.3, 1], [0.3, 0.4], [0, 0.4]), [[-200, -60], [-40, -60], [-40, 60], [200, 60]]],
  // The end rungs are at 56 degrees to the road, and the ends are not measured.
  ['chevron cut upright at both ends', strip(300, 200, [0, 0.5], [0.5, 0], [1, 0.5], [1, 1], [0.5, 0.5], [0, 1]), [[-150, 50], [0, -50], [150, 50]]],
  ['slanted road', strip(200, 100, [0, 0], [0.5, 0], [1, 1], [0.5, 1]), [[-50, -50], [50, 50]]],
  // 68 degrees.
  ['facing points a little apart', strip(400, 100, [0, 0], [0.25, 0], [1, 0], [1, 1], [0.35, 1], [0, 1]), [[-200, 0], [-80, 0], [200, 0]]],
  // As long as it is wide: read as a strip, like the square.
  ['hexagon as long as it is wide', strip(200, 200, ...HEXAGON), [[0, -100], [0, 0], [0, 100]]],
];
const NO_LINE: [string, BackgroundSpace][] = [
  ['facing points far apart, 51 degrees', strip(400, 100, [0, 0], [0.25, 0], [1, 0], [1, 1], [0.45, 1], [0, 1])],
  ['facing points far apart, 27 degrees', strip(400, 100, [0, 0], [0.25, 0], [1, 0], [1, 1], [0.75, 1], [0, 1])],
  ['two points on one side only', strip(400, 100, [0, 0], [0.25, 0], [0.75, 0], [1, 0], [1, 1], [0, 1])],
  ['L with only its outer corner rounded', strip(200, 200, [0, 0], [0.75, 0], [0.925, 0.075], [1, 0.25], [1, 1], [0.75, 1], [0.75, 0.2], [0, 0.2])],
  ['pointed ends', strip(400, 100, [0, 0.5], [0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1])],
  ['bow tie', strip(300, 100, [0, 0], [1, 1], [1, 0], [0, 1])],
  ['cross', strip(300, 300, [0.3, 0], [0.7, 0], [0.7, 0.3], [1, 0.3], [1, 0.7], [0.7, 0.7], [0.7, 1], [0.3, 1], [0.3, 0.7], [0, 0.7], [0, 0.3], [0.3, 0.3])],
  ['T', strip(300, 250, [0, 0], [1, 0], [1, 0.32], [0.6, 0.32], [0.6, 1], [0.4, 1], [0.4, 0.32], [0, 0.32])],
  ['points added on the two ends', strip(300, 100, [0, 0], [1, 0], [1, 0.5], [1, 1], [0, 1], [0, 0.5])],
  ['hexagon wider than it is long', strip(200, 160, ...HEXAGON)],
  ['tangled eight points', strip(300, 300, [0.8, 0.7], [0.2, 0.7], [0, 0.3], [0.7, 0], [0.3, 0.6], [0.6, 0.6], [0, 0.2], [0.7, 0.2])],
  // The same line the other way round: now its first part is inside the road and a later one is not.
  ['tangled eight points listed from the fifth', strip(300, 300, [0.3, 0.6], [0.6, 0.6], [0, 0.2], [0.7, 0.2], [0.8, 0.7], [0.2, 0.7], [0, 0.3], [0.7, 0])],
  // One cell that does not cross itself but is not convex: its line would be long enough and inside.
  ['dart', strip(200, 100, [0, 0], [1, 0], [0.4, 0.4], [0, 1])],
  ['triangle', strip(300, 100, [0, 0], [1, 0], [0.5, 1])],
  ['one point added on one side', strip(300, 100, [0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1])],
  ['concave four points', strip(200, 200, [0, 0], [0.5, 0.4], [1, 0], [0.5, 1])],
  ['ellipse', road(300, 100, { shape: 'ellipse' })],
];

test('a road is told by its surface alone, and it has no walls whatever height is stored', () => {
  assert.equal(isRoadSpace(road(300, 100)), true);
  assert.equal(isRoadSpace(space(300, 100)), false);
  assert.equal(Object.hasOwn(space(300, 100), 'surface'), false);
  // Only the one value: an empty key and a kind that is not a road are rooms.
  assert.equal(isRoadSpace(space(300, 100, { surface: undefined })), false);
  assert.equal(isRoadSpace(space(300, 100, { surface: 'river' as BackgroundSpaceSurface })), false);
  // A room: what is stored, or the default.
  assert.equal(spaceWallHeight(space(300, 100)), 180); assert.equal(spaceWallHeight(space(300, 100)), nodeVolumeHeight(space(300, 100)));
  assert.equal(spaceWallHeight(space(300, 100, { volumeHeight: 400 })), 400);
  assert.equal(spaceWallHeight(road(300, 100)), 0);
  const tall = road(300, 100, { volumeHeight: 400 });
  assert.equal(spaceWallHeight(tall), 0); assert.equal(nodeVolumeHeight(tall), 400);
});

test('the centre line of a road runs the long way of a rectangle and through the facing points of a strip', () => {
  for (const [label, shape, expected] of LINES) sameLine(roadCentreLine(shape), expected, label);
  // A polygon of fewer than three points is drawn as its box and has the line of the box, odd as its number of points is.
  sameLine(roadCentreLine(road(100, 300, { shape: 'polygon', points: [{ x: 0, y: 0 }] })), [[0, -150], [0, 150]], 'polygon drawn as its box');
});

test('a shape that is no strip has no centre line, and neither has a room or a road without a size', () => {
  for (const [label, shape] of NO_LINE) assert.equal(roadCentreLine(shape), null, label);
  for (const [label, shape] of LINES) assert.equal(roadCentreLine(asRoom(shape)), null, `${label} as a room`);
  for (const size of [NaN, 0, -300, Infinity]) {
    assert.equal(roadCentreLine(road(size, 100)), null, `width ${size}`);
    assert.equal(roadCentreLine(road(300, size)), null, `height ${size}`);
    assert.equal(roadCentreLine(strip(size, 100, [0, 0], [1, 0], [1, 1], [0, 1])), null, `four points, width ${size}`);
  }
});

test('the centre line stays inside the road however it is turned, and is the same line before the turn', () => {
  for (const [label, shape] of LINES) for (const rotation of TURNS) {
    const turned = { ...shape, x: 40, y: -30, rotation }, line = roadCentrePlanLine(turned);
    assert.ok(line, `${label} at ${rotation}`);
    for (let index = 0; index + 1 < line.length; index++) {
      const middle = { x: (line[index].x + line[index + 1].x) / 2, y: (line[index].y + line[index + 1].y) / 2 };
      assert.equal(containsPoint(turned, middle), true, `${label} at ${rotation}: part ${index}`);
    }
    // The line is in the frame of the outline: the turn is not read.
    assert.deepEqual(roadCentreLine(turned), roadCentreLine(shape), `${label} at ${rotation}`);
  }
});

test('the centre line in plan points is moved to the road and turned with it', () => {
  sameLine(roadCentrePlanLine(road(300, 100, { x: 100, y: 100 })), [[100, 150], [400, 150]], 'not turned');
  sameLine(roadCentrePlanLine(road(300, 100, { x: 100, y: 100, rotation: 90 })), [[250, 0], [250, 300]], 'a quarter turn');
  assert.equal(roadCentrePlanLine(space(300, 100, { x: 100, y: 100 })), null);
  assert.equal(roadCentrePlanLine(road(300, 100, { x: 100, y: 100, shape: 'ellipse' })), null);
});
