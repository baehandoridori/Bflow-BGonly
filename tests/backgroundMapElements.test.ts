import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSymbolPreset, symbolCatalog } from '../src/features/backgrounds/symbolCatalog.ts';
import { isRoadSpace, nodeVolumeHeight, roadCentreLine, roadCentrePlanLine, spaceWallHeight } from '../src/features/backgrounds/mapSpatial.ts';
import { containsPoint } from '../src/features/backgrounds/mapGeometry.ts';
import { MAP3D_DARK_PALETTE } from '../src/features/backgrounds/map3dScene.ts';
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
  // One leg nearly five times the other. The corner rung is square to the way the line turns there, though only 57 degrees from
  // the chord between the middles on either side of it, which leans toward the long leg.
  ['L with one leg much longer than the other', strip(400, 100, [0, 0], [1, 0], [1, 1], [0.9, 1], [0.9, 0.4], [0, 0.4]), [[-200, -30], [180, -30], [180, 50]]],
  ['six-point strip', strip(300, 100, [0, 0], [0.5, 0], [1, 0], [1, 1], [0.5, 1], [0, 1]), [[-150, 0], [0, 0], [150, 0]]],
  ['six-point strip listed from its next point', strip(300, 100, [0.5, 0], [1, 0], [1, 1], [0.5, 1], [0, 1], [0, 0]), [[150, 0], [0, 0], [-150, 0]]],
  // Parts of 160, 120 and 240: both inner rungs are mitres, square to the turn of the line (82 and 72 degrees to the chords).
  ['road with two bends', strip(400, 200, [0, 0], [0.5, 0], [0.5, 0.6], [1, 0.6], [1, 1], [0.3, 1], [0.3, 0.4], [0, 0.4]), [[-200, -60], [-40, -60], [-40, 60], [200, 60]]],
  // The end rungs are at 56 degrees to the road, and the ends are not measured.
  ['chevron cut upright at both ends', strip(300, 200, [0, 0.5], [0.5, 0], [1, 0.5], [1, 1], [0.5, 0.5], [0, 1]), [[-150, 50], [0, -50], [150, 50]]],
  // Its ends are 80 apart and its rungs are 100: the length is measured along the line (215), not from end to end.
  ['narrow chevron', strip(80, 200, [0, 0.5], [0.5, 0], [1, 0.5], [1, 1], [0.5, 0.5], [0, 1]), [[-40, 50], [0, -50], [40, 50]]],
  ['slanted road', strip(200, 100, [0, 0], [0.5, 0], [1, 1], [0.5, 1]), [[-50, -50], [50, 50]]],
  // 68 degrees.
  ['facing points a little apart', strip(400, 100, [0, 0], [0.25, 0], [1, 0], [1, 1], [0.35, 1], [0, 1]), [[-200, 0], [-80, 0], [200, 0]]],
  // 60.75 degrees. The same road at 59.04 is the first of the shapes without a line.
  ['facing points apart, just over 60 degrees', strip(400, 100, [0, 0], [0.25, 0], [1, 0], [1, 1], [0.39, 1], [0, 1]), [[-200, 0], [-72, 0], [200, 0]]],
  // As long as it is wide: read as a strip, like the square.
  ['hexagon as long as it is wide', strip(200, 200, ...HEXAGON), [[0, -100], [0, 0], [0, 100]]],
];
const NO_LINE: [string, BackgroundSpace][] = [
  // 59.04 degrees.
  ['facing points apart, just under 60 degrees', strip(400, 100, [0, 0], [0.25, 0], [1, 0], [1, 1], [0.4, 1], [0, 1])],
  ['facing points far apart, 51 degrees', strip(400, 100, [0, 0], [0.25, 0], [1, 0], [1, 1], [0.45, 1], [0, 1])],
  ['facing points far apart, 27 degrees', strip(400, 100, [0, 0], [0.25, 0], [1, 0], [1, 1], [0.75, 1], [0, 1])],
  // At a bend the angle is taken from the way the line turns there. The end piece is turned 63 degrees and the rung before it is
  // square to the long part: 58 degrees from that way, though 79 from the chord between the middles on either side of it.
  ['square joint before an end piece turned 63 degrees', strip(400, 120, [0, 0], [0.9, 0], [1, 2 / 3], [1, 1], [0.9, 1 / 3], [0, 1 / 3])],
  ['two points on one side only', strip(400, 100, [0, 0], [0.25, 0], [0.75, 0], [1, 0], [1, 1], [0, 1])],
  ['L with only its outer corner rounded', strip(200, 200, [0, 0], [0.75, 0], [0.925, 0.075], [1, 0.25], [1, 1], [0.75, 1], [0.75, 0.2], [0, 0.2])],
  ['pointed ends', strip(400, 100, [0, 0.5], [0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1])],
  ['bow tie', strip(300, 100, [0, 0], [1, 1], [1, 0], [0, 1])],
  ['cross', strip(300, 300, [0.3, 0], [0.7, 0], [0.7, 0.3], [1, 0.3], [1, 0.7], [0.7, 0.7], [0.7, 1], [0.3, 1], [0.3, 0.7], [0, 0.7], [0, 0.3], [0.3, 0.3])],
  ['T', strip(300, 250, [0, 0], [1, 0], [1, 0.32], [0.6, 0.32], [0.6, 1], [0.4, 1], [0.4, 0.32], [0, 0.32])],
  ['points added on the two ends', strip(300, 100, [0, 0], [1, 0], [1, 0.5], [1, 1], [0, 1], [0, 0.5])],
  ['hexagon wider than it is long', strip(200, 160, ...HEXAGON)],
  // Wider than it is long at one end only: every rung is measured, the first and the last as well.
  ['wedge that is widest at its far end', strip(100, 200, [0, 0.4], [1, 0], [1, 1], [0, 0.6])],
  ['wedge that is widest at its near end', strip(100, 200, [0, 0], [1, 0.4], [1, 0.6], [0, 1])],
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

/** A stylesheet of the map editor, line by line: a fresh checkout has CRLF line ends. */
const sheet = (name: string): string[] => readFileSync(new URL(`../src/features/backgrounds/${name}`, import.meta.url), 'utf8').split(/\r?\n/);
/** A colour as the stylesheets hold it: three numbers. */
const triple = (hex: number): string => `${hex >> 16} ${(hex >> 8) & 255} ${hex & 255}`;

test('the road colours are variables of the map editor: the dark values are those of the 3D palette, and the light ones are in the stylesheet alone', () => {
  const lines = sheet('backgrounds-map.css');
  // The declarations are looked up as text inside their rule: the camera colours join the same block.
  const dark = lines.filter(line => line.startsWith('.bmap-layout {') && line.includes('--bmap-road'));
  const light = lines.filter(line => line.startsWith('[data-color-mode="light"] .bmap-layout') && line.includes('--bmap-road'));
  assert.equal(dark.length, 1, 'one rule sets the road colours on the editor');
  assert.equal(light.length, 1, 'and one sets them for the light theme');
  assert.ok(dark[0].includes('--bmap-road:154 161 173;') && dark[0].includes('--bmap-road-mark:227 230 236;'), dark[0]);
  assert.ok(light[0].includes('--bmap-road:93 100 112;') && light[0].includes('--bmap-road-mark:58 63 71;'), light[0]);
  // Where a variable is not set the 3D view paints with its dark palette: the two are one colour.
  assert.deepEqual([MAP3D_DARK_PALETTE.road, MAP3D_DARK_PALETTE.roadMark], [0x9aa1ad, 0xe3e6ec]);
  assert.ok(dark[0].includes(`--bmap-road:${triple(MAP3D_DARK_PALETTE.road)};`) && dark[0].includes(`--bmap-road-mark:${triple(MAP3D_DARK_PALETTE.roadMark)};`));
});

/** The one rule of a stylesheet that starts with this selector and its opening brace. */
const rule = (name: string, opening: string): string => {
  const found = sheet(name).filter(line => line.startsWith(opening));
  assert.equal(found.length, 1, `${name}: one rule starts with "${opening}"`);
  return found[0];
};

test('the centre line of a road is a line in both stylesheets: never filled, and as thick on screen at any zoom', () => {
  // A bent polyline is filled black by default: without the rule the inside of a bent road would be painted over.
  for (const [name, opening] of [['backgrounds-map.css', '.bmap-road-line {'], ['backgrounds-map-plan.css', '.bmap-plan-road-line {']]) {
    const line = rule(name, opening);
    assert.ok(line.includes('fill:none'), line);
    assert.ok(line.includes('vector-effect:non-scaling-stroke'), line);
  }
});

test('the outline behind the name of a road is as thick as the name is large, so the centre line never strikes it through', () => {
  // A fixed width is in map units: on a zoomed-out plan it thins away under a name that keeps its size on screen.
  const name = rule('backgrounds-map.css', '.bmap-space.is-road text {');
  assert.ok(name.includes('stroke-width:calc(4px * var(--bmap-label-scale,1))'), name);
});

test('on the companion plan the colours of a road give way to the keyboard focus', () => {
  const plan = sheet('backgrounds-map-plan.css').join('\n');
  const roadRule = plan.indexOf('.bmap-plan-space.is-road>polygon'), focusRule = plan.indexOf('.bmap-plan-node:focus-visible>polygon');
  assert.ok(roadRule > -1, 'the road has a rule of its own');
  assert.ok(focusRule > -1, 'the focus rule is there');
  // The two are as specific as each other: the later one wins, and that must be the focus.
  assert.ok(roadRule < focusRule, 'the road rule comes before the focus rule');
  // A plain hover rule of the road would be more specific than the focus rule and take its outline away.
  assert.ok(plan.includes('.bmap-plan-space.is-road:hover:not(:focus-visible)>polygon'), 'the hover rule of a road steps back from a focused one');
  assert.ok(!plan.includes('.bmap-plan-space.is-road:hover>polygon'), 'no hover rule of a road without that exception');
  // A focused road under the pointer has no hover rule of its own, so the hover rule of a room reaches it. That one is as
  // specific as the road rule: the road rule comes after it, or such a road would be filled like a room.
  const roomHover = plan.indexOf('.bmap-plan-space:hover>polygon');
  assert.ok(roomHover > -1 && roomHover < roadRule, 'the road rule comes after the hover rule of a room');
});

test('on the plan a selected road keeps the selection colour under the pointer', () => {
  const map = sheet('backgrounds-map.css').join('\n');
  // Right after a road is picked the pointer is still over it. The two rules are as specific as each other: the later one wins.
  const hover = map.indexOf('.bmap-space.is-road:hover>rect'), selected = map.indexOf('.bmap-space.is-road.is-selected>rect');
  assert.ok(hover > -1 && selected > -1, 'a road has a hover rule and a selected rule of its own');
  assert.ok(hover < selected, 'the selected rule comes after the hover rule');
});
