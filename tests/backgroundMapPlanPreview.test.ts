import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_FALLBACK_SIZE, PLAN_KIND_LABELS, PLAN_MARK, PLAN_PREVIEW_HINT, PLAN_SIDE_VIEW,
  nextPlanSelection, planArrowTip, planCameraGlyph, planCameraReadout, planDegrees, planNodeCovers, planNodeLabel, planNodeReadout, planNodeSummary,
  planNumber, planOutlinePoints, planPileAt, planReadoutText, planSelectedNode, planSideView, planSightMark, planStackUnder, planUnitsPerPixel, planViewBox, planVolumeReadout,
} from '../src/features/backgrounds/mapPlanPreview.ts';
import { addMapCamera } from '../src/features/backgrounds/mapGeometry.ts';
import { cameraPitchLabel, createMapCamera, projectCameraToPlan } from '../src/features/backgrounds/mapSpatial.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';

const RADIANS = Math.PI / 180;
const near = (actual: number, expected: number, label = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label} ${actual} != ${expected}`);
const nearPoint = (actual: BackgroundPoint, expected: BackgroundPoint, label = '') =>
  assert.ok(Math.abs(actual.x - expected.x) < 1e-6 && Math.abs(actual.y - expected.y) < 1e-6, `${label} (${actual.x}, ${actual.y}) != (${expected.x}, ${expected.y})`);
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

const mapOf = (nodes: BackgroundNode[] = []): BackgroundMap => ({ id: 'map', revision: 1, name: '학교', parentId: null, placeId: null, imageUrl: '', nodes });
const legacySpace: BackgroundSpace = { id: 'space', type: 'space', name: '교실', placeId: null, childMapId: null, x: 100, y: 100, width: 100, height: 60, rotation: 0, shape: 'rect', points: [], locked: false };
const legacyCamera: BackgroundCamera = { id: 'camera', type: 'camera', name: '전경', x: 130, y: 140, spaceId: 'space', angle: 30, fov: 60, viewIds: ['view'], locked: false };
const legacySymbol: BackgroundSymbol = { id: 'door', type: 'symbol', name: '출입문', symbol: 'door', spaceId: 'space', x: 130, y: 145, width: 20, height: 10, rotation: 0, locked: false, hinge: 'right', swing: 'outward' };
const cameraAt = (extra: Partial<BackgroundCamera> = {}): BackgroundCamera => ({ ...createMapCamera('cam', '카메라 1'), x: 100, y: 200, ...extra });
const texts = (node: BackgroundNode) => planNodeReadout(node).items.map(planReadoutText);
const inside = (box: { x: number; y: number; width: number; height: number }, point: BackgroundPoint) =>
  point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;

test('the view box is the plan bounds plus a margin that is the same on screen for any stage', () => {
  const empty = mapOf();
  // 1000 x 680 into 240 x 160 with a 12px pad: the height is the tight side, 680 / 136 = 5 units per pixel.
  const box = planViewBox(empty, { width: 240, height: 160 });
  assert.deepEqual(box, { x: -60, y: -60, width: 1120, height: 800 });
  near(planUnitsPerPixel(box, { width: 240, height: 160 }), 5);
  assert.deepEqual(planViewBox(empty), planViewBox(empty, PLAN_FALLBACK_SIZE));
  for (const size of [{ width: 200, height: 130 }, { width: 640, height: 150 }, { width: 260, height: 480 }, { width: 1200, height: 900 }]) {
    const fitted = planViewBox(empty, size), scale = planUnitsPerPixel(fitted, size);
    near(-fitted.x / scale, PLAN_MARK.pad, `pad ${size.width}x${size.height}`);
    near(fitted.width, 1000 - fitted.x * 2); near(fitted.height, 680 - fitted.y * 2);
    assert.ok(inside(fitted, { x: 0, y: 0 }) && inside(fitted, { x: 1000, y: 680 }));
  }
  // A stage that has not been laid out yet falls back to the assumed size instead of a broken box.
  for (const size of [{ width: 0, height: 0 }, { width: Number.NaN, height: -5 }, { width: Number.POSITIVE_INFINITY, height: 160 }]) {
    const fallback = planViewBox(empty, size);
    for (const value of Object.values(fallback)) assert.ok(Number.isFinite(value), JSON.stringify(size));
    assert.ok(fallback.width >= 1000 && fallback.height >= 680);
    assert.ok(Number.isFinite(planUnitsPerPixel(fallback, size)) && planUnitsPerPixel(fallback, size) > 0);
  }
  assert.deepEqual(planViewBox(empty, { width: 0, height: 0 }), planViewBox(empty, PLAN_FALLBACK_SIZE));
  // A tiny stage keeps a positive drawing area: the pad never eats more than half of it.
  const tiny = planViewBox(empty, { width: 30, height: 20 });
  assert.ok(tiny.width > 1000 && tiny.width < 2000 && tiny.height > 680 && tiny.height < 1400);
});

test('an empty map draws the base extent and has nothing to select', () => {
  const empty = freeze(mapOf());
  assert.equal(planSelectedNode(empty, null), null);
  assert.equal(planSelectedNode(empty, 'missing'), null);
  assert.equal(nextPlanSelection(empty, 'missing', null), 'missing');
  const box = planViewBox(empty, { width: 320, height: 200 });
  assert.ok(box.x < 0 && box.y < 0 && box.x + box.width > 1000 && box.y + box.height > 680);
  // A camera can still be described against a map without spaces.
  const side = planSideView(empty, cameraAt());
  assert.equal(side.room, null); assert.equal(side.floorY, PLAN_SIDE_VIEW.bottom);
  assert.equal(PLAN_PREVIEW_HINT, '3D에서 고른 항목이 여기에도 표시돼요');
});

test('nodes far outside the base extent stay in view and markers keep their screen size', () => {
  const farSpace: BackgroundSpace = { ...legacySpace, id: 'far-space', x: -40000, y: 25000, width: 300, height: 200, rotation: 30 };
  const farSymbol: BackgroundSymbol = { ...legacySymbol, id: 'far-symbol', x: 5000, y: 5000, pitch: 40, roll: -20 };
  const farCamera = cameraAt({ id: 'far-camera', x: 90000, y: -70000, angle: 200, pitch: -30 });
  const far = freeze(mapOf([farSpace, farSymbol, farCamera])), size = { width: 260, height: 180 };
  const box = planViewBox(far, size), scale = planUnitsPerPixel(box, size);
  for (const value of Object.values(box)) assert.ok(Number.isFinite(value));
  assert.ok(inside(box, { x: 0, y: 0 }) && inside(box, { x: 1000, y: 680 }) && inside(box, farCamera));
  for (const node of [farSpace, farSymbol]) {
    const points = planOutlinePoints(node);
    assert.ok(points);
    for (const pair of points.split(' ')) { const [x, y] = pair.split(',').map(Number); assert.ok(inside(box, { x, y }), pair); }
  }
  // The same camera on a small map: every marker length differs only by the scale.
  const small = planUnitsPerPixel(planViewBox(mapOf(), size), size);
  assert.ok(scale > small * 50);
  const big = planCameraGlyph(farCamera, scale), normal = planCameraGlyph({ ...farCamera, x: 500, y: 340 }, small);
  assert.ok(big?.arrow && normal?.arrow && big.fan && normal.fan);
  const pixels = (glyph: NonNullable<typeof big>, unitsPerPixel: number) => ({
    shaft: Math.hypot(glyph.arrow!.tip.x - glyph.position.x, glyph.arrow!.tip.y - glyph.position.y) / unitsPerPixel,
    head: Math.hypot(glyph.arrow!.head[0].x - glyph.arrow!.tip.x, glyph.arrow!.head[0].y - glyph.arrow!.tip.y) / unitsPerPixel,
    fan: glyph.fan!.radius / unitsPerPixel,
  });
  const onFar = pixels(big, scale), onSmall = pixels(normal, small);
  near(onFar.shaft, onSmall.shaft); near(onFar.head, onSmall.head); near(onFar.fan, onSmall.fan);
  near(onFar.shaft, PLAN_MARK.dot + PLAN_MARK.arrow * Math.cos(30 * RADIANS)); near(onFar.head, PLAN_MARK.head);
  near(onFar.fan, PLAN_MARK.fan * Math.cos(30 * RADIANS));

  // A broken coordinate is skipped: it neither stretches the frame nor reaches the drawing.
  const broken = cameraAt({ id: 'broken', x: Number.NaN, y: 2000 });
  assert.deepEqual(planViewBox(mapOf([legacySpace, broken]), size), planViewBox(mapOf([legacySpace]), size));
  assert.equal(planCameraGlyph(broken, small), null);
  assert.equal(planCameraGlyph(cameraAt(), Number.NaN), null);
  assert.equal(planOutlinePoints({ ...legacySymbol, width: Number.NaN }), null);
  assert.equal(planOutlinePoints({ ...legacySpace, x: Number.POSITIVE_INFINITY }), null);
});

test('the arrow shortens with the pitch and ends at the edge of the dot before vertical', () => {
  const scale = 2;
  for (const pitch of [0, 45, -45, 89.999, -89.999]) {
    const projection = projectCameraToPlan(cameraAt({ angle: 0, pitch }));
    assert.equal(planSightMark(projection), 'arrow', `pitch ${pitch}`);
    const tip = planArrowTip(projection, scale);
    assert.ok(tip);
    nearPoint(tip, { x: 100 + (PLAN_MARK.dot + PLAN_MARK.arrow * Math.cos(pitch * RADIANS)) * scale, y: 200 }, `pitch ${pitch}`);
  }
  const level = planArrowTip(projectCameraToPlan(cameraAt({ pitch: 0 })), 1)!, tilted = planArrowTip(projectCameraToPlan(cameraAt({ pitch: 45 })), 1)!;
  near(level.x - 100, PLAN_MARK.dot + PLAN_MARK.arrow); near(tilted.x - 100, PLAN_MARK.dot + PLAN_MARK.arrow * Math.SQRT1_2);
  // Looking up or down by the same amount draws the same arrow: the plan cannot tell them apart, the labels do.
  nearPoint(planArrowTip(projectCameraToPlan(cameraAt({ pitch: -45 })), 1)!, tilted);
  // A hair from vertical the shaft has no length left, but the head still shows which way it leans.
  const steep = planCameraGlyph(cameraAt({ angle: 0, pitch: 89.999 }), 1);
  assert.ok(steep?.arrow && steep.vertical === null && steep.tick === null);
  near(steep.arrow.tip.x - steep.arrow.start.x, PLAN_MARK.arrow * Math.cos(89.999 * RADIANS)); assert.ok(steep.arrow.tip.x - steep.arrow.start.x < 0.001);
  near(steep.arrow.head[0].x - steep.arrow.tip.x, PLAN_MARK.head); assert.ok(steep.reach > 0 && steep.reach < 0.0001);

  for (const pitch of [90, -90]) {
    const projection = projectCameraToPlan(cameraAt({ angle: 0, pitch }));
    assert.equal(planSightMark(projection), pitch > 0 ? 'up' : 'down');
    assert.equal(planArrowTip(projection, scale), null);
  }
  // A projection without any horizontal part and without a vertical flag gets no arrow either.
  assert.equal(planSightMark({ position: { x: 0, y: 0 }, direction: { x: 0, y: 0 }, elevation: 0, pitch: 0, vertical: null }), 'none');
  assert.equal(planSightMark({ position: { x: 0, y: 0 }, direction: { x: Number.NaN, y: 0 }, elevation: 0, pitch: 0, vertical: null }), 'none');
  assert.equal(planArrowTip({ position: { x: 0, y: 0 }, direction: { x: 0, y: 0 }, elevation: 0, pitch: 0, vertical: null }, 1), null);
  assert.equal(planArrowTip({ position: { x: Number.NaN, y: 0 }, direction: { x: 1, y: 0 }, elevation: 0, pitch: 0, vertical: null }, 1), null);
  assert.deepEqual(planArrowTip({ position: { x: 3, y: 4 }, direction: { x: 0, y: 0.5 }, elevation: 0, pitch: 60, vertical: null }, 2), { x: 3, y: 4 + (PLAN_MARK.dot + PLAN_MARK.arrow / 2) * 2 });
  const plain = planCameraGlyph(cameraAt({ pitch: Number.NaN }), 1);
  assert.deepEqual(plain, { position: { x: 100, y: 200 }, vertical: null, reach: 0, arrow: null, fan: null, tick: null });
});

test('the four plan directions point the same way as on the main plan', () => {
  const expected: Array<[number, BackgroundPoint]> = [[0, { x: 1, y: 0 }], [90, { x: 0, y: 1 }], [180, { x: -1, y: 0 }], [270, { x: 0, y: -1 }]];
  for (const [angle, unit] of expected) for (const pitch of [0, 45, -45, 89.999, -89.999]) {
    const label = `${angle}/${pitch}`, glyph = planCameraGlyph(cameraAt({ angle, pitch, fov: 60 }), 3), reach = Math.cos(pitch * RADIANS);
    assert.ok(glyph?.arrow, label);
    near(glyph.reach, reach, label);
    nearPoint(glyph.arrow.start, { x: 100 + unit.x * PLAN_MARK.dot * 3, y: 200 + unit.y * PLAN_MARK.dot * 3 }, `${label} start`);
    const length = (PLAN_MARK.dot + PLAN_MARK.arrow * reach) * 3;
    nearPoint(glyph.arrow.tip, { x: 100 + unit.x * length, y: 200 + unit.y * length }, `${label} tip`);
    nearPoint(glyph.arrow.tip, planArrowTip(projectCameraToPlan(cameraAt({ angle, pitch })), 3)!, `${label} same tip`);
    // The head continues the shaft and its base straddles it.
    nearPoint(glyph.arrow.head[0], { x: glyph.arrow.tip.x + unit.x * PLAN_MARK.head * 3, y: glyph.arrow.tip.y + unit.y * PLAN_MARK.head * 3 }, `${label} apex`);
    nearPoint({ x: (glyph.arrow.head[1].x + glyph.arrow.head[2].x) / 2, y: (glyph.arrow.head[1].y + glyph.arrow.head[2].y) / 2 }, glyph.arrow.tip, `${label} base`);
    const base = { x: glyph.arrow.head[1].x - glyph.arrow.head[2].x, y: glyph.arrow.head[1].y - glyph.arrow.head[2].y };
    near(base.x * unit.x + base.y * unit.y, 0, `${label} base is square to the shaft`); near(Math.hypot(base.x, base.y), PLAN_MARK.head * 1.1 * 3, `${label} base width`);
    assert.equal(glyph.arrow.head.length, 3);
    // A hair from vertical the fan would hide under the dot, so it is left out.
    if (Math.abs(pitch) > 45) { assert.equal(glyph.fan, null, label); continue; }
    // The fan opens half the field of view to each side, clockwise on screen from `from` to `to`.
    assert.ok(glyph.fan, label);
    const radius = PLAN_MARK.fan * reach * 3, edge = (turn: number) => ({ x: 100 + Math.cos((angle + turn) * RADIANS) * radius, y: 200 + Math.sin((angle + turn) * RADIANS) * radius });
    near(glyph.fan.radius, radius, label); nearPoint(glyph.fan.from, edge(-30), `${label} from`); nearPoint(glyph.fan.to, edge(30), `${label} to`);
    assert.equal(glyph.fan.largeArc, false);
  }
  assert.equal(planCameraGlyph(cameraAt({ fov: 200 }), 1)?.fan?.largeArc, true);
  assert.equal(planCameraGlyph(cameraAt({ fov: Number.NaN }), 1)?.fan, null);
  // The fan is only drawn while it reaches past the camera dot: about 81 degrees of tilt either way.
  for (const pitch of [80, -80]) assert.ok(planCameraGlyph(cameraAt({ pitch }), 7)?.fan, `pitch ${pitch}`);
  for (const pitch of [82, -82, 89.999]) { const steep = planCameraGlyph(cameraAt({ pitch }), 7); assert.ok(steep?.arrow); assert.equal(steep.fan, null, `pitch ${pitch}`); }
  assert.ok(PLAN_MARK.fan * Math.cos(80 * RADIANS) > PLAN_MARK.dot * 1.5 && PLAN_MARK.fan * Math.cos(82 * RADIANS) < PLAN_MARK.dot * 1.5);
  // 359.999 is next to 0, not a mirror of it.
  const wrapped = planCameraGlyph(cameraAt({ angle: 359.999 }), 1)!.arrow!.tip;
  assert.ok(Math.abs(wrapped.x - (100 + PLAN_MARK.dot + PLAN_MARK.arrow)) < 1e-6 && wrapped.y < 200 && wrapped.y > 199.999);
});

test('a vertical camera gets a vertical mark and a tick at its stored yaw, never an arrow', () => {
  for (const [pitch, vertical] of [[90, 'up'], [-90, 'down']] as Array<[number, 'up' | 'down']>) for (const angle of [0, 90, 137, 270, 359.999]) {
    const camera = freeze(cameraAt({ angle, pitch })), glyph = planCameraGlyph(camera, 4), unit = { x: Math.cos(angle * RADIANS), y: Math.sin(angle * RADIANS) };
    assert.ok(glyph?.tick, `${angle}/${pitch}`);
    assert.equal(glyph.vertical, vertical); assert.equal(glyph.arrow, null); assert.equal(glyph.fan, null); assert.equal(glyph.reach, 0);
    assert.deepEqual(glyph.position, { x: 100, y: 200 });
    // The tick starts outside the circle of the mark, so it does not read as a line leaving the camera.
    const start = (PLAN_MARK.glyph + PLAN_MARK.tickGap) * 4, end = start + PLAN_MARK.tick * 4;
    nearPoint(glyph.tick.from, { x: 100 + unit.x * start, y: 200 + unit.y * start }, `${angle}/${pitch} from`);
    nearPoint(glyph.tick.to, { x: 100 + unit.x * end, y: 200 + unit.y * end }, `${angle}/${pitch} to`);
    assert.ok(start > PLAN_MARK.glyph * 4);
    assert.equal(camera.angle, angle);
  }
  assert.equal(planCameraGlyph(cameraAt({ pitch: 30 }), 1)?.tick, null);
  // A broken stored direction leaves the vertical mark without a tick rather than with a broken line.
  assert.deepEqual(planCameraGlyph(cameraAt({ angle: Number.NaN, pitch: -90 }), 1), { position: { x: 100, y: 200 }, vertical: 'down', reach: 0, arrow: null, fan: null, tick: null });
  // The mark, the label and the readout switch to vertical at the same pitch.
  for (const pitch of [-90, -89.99999, -89.9999, -89.999, -89.5, -45, -0.4, 0, 0.4, 45, 89.5, 89.999, 89.9999, 89.99999, 90]) {
    const camera = cameraAt({ angle: 137, pitch }), glyph = planCameraGlyph(camera, 1)!, readout = planCameraReadout(camera);
    const named = readout.items[1].value.startsWith('수직');
    assert.equal(glyph.vertical !== null, named, `pitch ${pitch}`);
    assert.equal(glyph.arrow === null, named, `pitch ${pitch}`);
    assert.equal(readout.vertical, glyph.vertical);
    assert.equal(readout.items[1].value, cameraPitchLabel(pitch));
  }
});

test('a roll-only change leaves the arrow, the labels and the side view as they were', () => {
  const room = freeze(mapOf([legacySpace]));
  for (const base of [cameraAt({ angle: 137, pitch: 20, roll: 0 }), cameraAt({ angle: 300, pitch: -45, roll: 0 }), cameraAt({ angle: 40, pitch: -90, roll: 0 }), cameraAt({ angle: 222, pitch: 90, roll: 0 })]) {
    for (const roll of [70, -150, 180]) {
      const rolled = { ...base, roll };
      assert.deepEqual(planCameraGlyph(rolled, 2.5), planCameraGlyph(base, 2.5));
      assert.deepEqual(planCameraReadout(rolled), planCameraReadout(base));
      assert.equal(planNodeSummary(rolled), planNodeSummary(base));
      assert.deepEqual(planSideView(room, rolled), planSideView(room, base));
      assert.deepEqual(planArrowTip(projectCameraToPlan(rolled), 2.5), planArrowTip(projectCameraToPlan(base), 2.5));
    }
  }
});

test('cameras saved before the 3D editor read as level at the default height without gaining keys', () => {
  const camera = { ...legacyCamera }, frozen = JSON.stringify(camera);
  assert.deepEqual(texts(camera), ['방향 30°', '수평', '높이 120', '화각 60°']);
  assert.equal(planNodeSummary(camera), '전경 · 방향 30° · 수평 · 높이 120');
  const glyph = planCameraGlyph(camera, 1);
  assert.ok(glyph?.arrow);
  assert.equal(glyph.vertical, null); near(glyph.reach, 1); assert.equal(glyph.tick, null);
  const length = PLAN_MARK.dot + PLAN_MARK.arrow;
  nearPoint(glyph.arrow.tip, { x: 130 + Math.cos(30 * RADIANS) * length, y: 140 + Math.sin(30 * RADIANS) * length });
  // 120 of the 180-high room it belongs to: two thirds of the way up.
  const side = planSideView(mapOf([legacySpace, camera]), camera), travel = PLAN_SIDE_VIEW.bottom - PLAN_SIDE_VIEW.top;
  near(side.camera.y, PLAN_SIDE_VIEW.bottom - travel * 120 / 180); near(side.tip.y, side.camera.y); assert.ok(side.tip.x > side.camera.x);
  assert.deepEqual(side.room, { top: PLAN_SIDE_VIEW.top, bottom: PLAN_SIDE_VIEW.bottom });
  assert.equal(JSON.stringify(camera), frozen);
  for (const key of ['elevation', 'pitch', 'roll', 'aspect']) assert.equal(key in camera, false);
  // Legacy spaces and symbols read their derived vertical values the same way.
  assert.deepEqual(texts({ ...legacySpace }), ['바닥 높이 0', '입체 높이 180']);
  assert.deepEqual(texts({ ...legacySymbol }), ['바닥 높이 0', '입체 높이 160']);
});

test('the side view puts the camera at a height proportional to its elevation', () => {
  const box = PLAN_SIDE_VIEW, travel = box.bottom - box.top, room = freeze(mapOf([legacySpace]));
  const member = (extra: Partial<BackgroundCamera>) => cameraAt({ spaceId: 'space', ...extra });
  const heights = [0, 60, 120, 180].map(elevation => planSideView(room, member({ elevation })));
  heights.forEach((side, index) => { near(side.camera.y, box.bottom - travel * index / 3, `step ${index}`); assert.equal(side.camera.x, box.cameraX); near(side.floorY, box.bottom); });
  near(heights[0].camera.y, heights[0].floorY);
  // Above the tallest space the camera is at the top and the room shrinks below it.
  const above = planSideView(room, member({ elevation: 720 }));
  near(above.camera.y, box.top); near(above.floorY, box.bottom); near(above.room!.top, box.bottom - travel * 180 / 720); near(above.room!.bottom, box.bottom);
  // Below level 0 the camera is under the floor line, which moves up to make room.
  const below = planSideView(room, member({ elevation: -90 }));
  near(below.camera.y, box.bottom); near(below.floorY, box.bottom - travel * 90 / 270); assert.ok(below.camera.y > below.floorY);
  // A raised room floats above the floor line.
  const upstairs = mapOf([{ ...legacySpace, elevation: 300, volumeHeight: 100 }]), second = planSideView(upstairs, member({ elevation: 350 }));
  near(second.floorY, box.bottom); near(second.room!.bottom, box.bottom - travel * 300 / 400); near(second.room!.top, box.top); near(second.camera.y, box.bottom - travel * 350 / 400);
  // Without any space the default room height is the yardstick, so lifting the camera still moves it.
  const alone = [90, 120, 180, 360].map(elevation => planSideView(mapOf(), cameraAt({ elevation })));
  near(alone[0].camera.y, box.bottom - travel / 2); near(alone[1].camera.y, box.bottom - travel * 2 / 3); near(alone[2].camera.y, box.top); near(alone[3].camera.y, box.top);
  alone.forEach(side => assert.equal(side.room, null));
  // The room is only drawn for the camera's own space.
  assert.equal(planSideView(room, cameraAt({ spaceId: null })).room, null);
  assert.equal(planSideView(room, cameraAt({ spaceId: 'gone' })).room, null);
  // Other spaces set the scale; other cameras and symbols do not.
  const tall = mapOf([legacySpace, { ...legacySpace, id: 'tower', volumeHeight: 360 }, cameraAt({ id: 'drone', elevation: 9000 }), { ...legacySymbol, elevation: 5000 }]);
  near(planSideView(tall, member({ elevation: 180 })).camera.y, box.bottom - travel / 2);
  for (const elevation of [Number.NaN, Number.POSITIVE_INFINITY]) near(planSideView(room, member({ elevation })).camera.y, box.bottom - travel * 120 / 180);
});

test('the side view arrow follows the pitch exactly, straight up and down included', () => {
  const box = PLAN_SIDE_VIEW, room = mapOf([legacySpace]);
  for (const elevation of [-90, 0, 60, 120, 180, 720]) for (const pitch of [0, 30, -30, 45, -45, 89.999, -89.999, 90, -90]) {
    const label = `${elevation}/${pitch}`, side = planSideView(room, cameraAt({ spaceId: 'space', angle: 211, elevation, pitch }));
    const dx = side.tip.x - side.camera.x, dy = side.tip.y - side.camera.y, length = Math.hypot(dx, dy);
    // Screen y grows downwards, so looking up is a negative dy.
    near(Math.atan2(-dy, dx) / RADIANS, pitch, label);
    // Full length unless the box is in the way; even at the top or bottom of the travel a vertical arrow keeps a shaft.
    assert.ok(length >= box.top - box.edge - box.head - 1e-9 && length <= box.arrow + 1e-9, `${label} length ${length}`);
    if (pitch === 0) near(length, box.arrow, label);
    if (Math.abs(pitch) === 90) { assert.equal(dx, 0, label); assert.equal(Math.sign(dy), pitch > 0 ? -1 : 1, label); }
    else assert.ok(dx > 0, label);
    if (pitch > 0) assert.ok(dy < 0, label);
    if (pitch < 0) assert.ok(dy > 0, label);
    if (pitch === 0) assert.equal(dy, 0, label);
    // Arrow and head stay inside the drawing box whatever the height.
    for (const point of [side.camera, side.tip, ...side.head]) assert.ok(point.x >= 0 && point.x <= box.width && point.y >= 0 && point.y <= box.height, `${label} (${point.x}, ${point.y})`);
    assert.equal(side.head.length, 3);
    near(Math.hypot(side.head[0].x - side.tip.x, side.head[0].y - side.tip.y), box.head, label);
    assert.ok(side.camera.y >= box.top - 1e-9 && side.camera.y <= box.bottom + 1e-9, label);
  }
  assert.ok(box.top - box.edge - box.head >= 10 && box.height - box.edge - box.bottom - box.head >= 10);
  assert.ok(box.cameraX + box.arrow + box.head <= box.width - box.edge, 'a level arrow fits beside the camera');
  near(Math.hypot(0, planSideView(room, cameraAt({ elevation: 720, pitch: 90 })).tip.y - box.top), box.top - box.edge - box.head);
  near(planSideView(room, cameraAt({ elevation: -90, pitch: -90 })).tip.y, box.height - box.edge - box.head);
  // The head is square to the arrow.
  const tilted = planSideView(room, cameraAt({ pitch: 30 })), across = { x: tilted.head[1].x - tilted.head[2].x, y: tilted.head[1].y - tilted.head[2].y };
  near(across.x * (tilted.tip.x - tilted.camera.x) + across.y * (tilted.tip.y - tilted.camera.y), 0); near(Math.hypot(across.x, across.y), box.head * 1.1);
  // A flat space on the floor with the camera on it has no vertical range: the picture still has finite numbers.
  const flat = planSideView(mapOf([{ ...legacySpace, volumeHeight: 0 }]), cameraAt({ spaceId: 'space', elevation: 0 }));
  for (const value of [flat.floorY, flat.camera.y, flat.tip.x, flat.tip.y, flat.room!.top, flat.room!.bottom]) assert.ok(Number.isFinite(value));
  near(flat.camera.y, box.bottom); near(flat.floorY, box.bottom);
  // The horizontal direction does not turn the side view: it is always drawn facing right.
  assert.deepEqual(planSideView(room, cameraAt({ angle: 10, pitch: -35 })), planSideView(room, cameraAt({ angle: 250, pitch: -35 })));
  assert.equal(planSideView(room, cameraAt({ pitch: Number.NaN })).tip.y, planSideView(room, cameraAt({ pitch: 0 })).tip.y);
});

test('readout strings name direction, up or down view, height and field of view', () => {
  assert.deepEqual(texts(cameraAt({ angle: 137, pitch: -45 })), ['방향 137°', '아래 45°', '높이 120', '화각 60°']);
  assert.deepEqual(texts(cameraAt({ angle: 137, pitch: 30, elevation: 80.4, fov: 34.6 })), ['방향 137°', '위 30°', '높이 80', '화각 35°']);
  assert.deepEqual(texts(cameraAt({ angle: 0, pitch: 0 })), ['방향 0°', '수평', '높이 120', '화각 60°']);
  assert.deepEqual(texts(cameraAt({ angle: 222, pitch: 90 })), ['방향 222°', '수직 위', '높이 120', '화각 60°']);
  assert.deepEqual(texts(cameraAt({ angle: 222, pitch: -90, elevation: -30 })), ['방향 222°', '수직 아래', '높이 -30', '화각 60°']);
  assert.deepEqual(texts(cameraAt({ angle: 10, pitch: 89.999 })), ['방향 10°', '위 89°', '높이 120', '화각 60°']);
  assert.deepEqual(planCameraReadout(cameraAt({ pitch: -45 })).items.map(item => item.key), ['direction', 'pitch', 'elevation', 'fov']);
  assert.equal(planCameraReadout(cameraAt()).name, '카메라 1'); assert.equal(planCameraReadout(cameraAt()).kind, '카메라');
  assert.equal(planNodeSummary(cameraAt({ angle: 137, pitch: -45 })), '카메라 1 · 방향 137° · 아래 45° · 높이 120');
  assert.equal(planNodeSummary(cameraAt({ angle: 137, pitch: 90 })), '카메라 1 · 방향 137° · 수직 위 · 높이 120');

  // Spaces and symbols show their floor level and vertical size, never the plan depth.
  const space = { ...legacySpace, height: 61, elevation: 25.4, volumeHeight: 90.6 };
  assert.deepEqual(texts(space), ['바닥 높이 25', '입체 높이 91']);
  assert.deepEqual(planVolumeReadout(space), { name: '교실', kind: '공간', vertical: null, items: [{ key: 'floor', label: '바닥 높이', value: '25' }, { key: 'volume', label: '입체 높이', value: '91' }] });
  assert.equal(planVolumeReadout(legacySymbol).kind, '기호');
  assert.equal(planNodeSummary(space), '교실 · 바닥 높이 25 · 입체 높이 91');
  assert.equal(planNodeSummary({ ...legacySymbol, symbol: 'table' }), '출입문 · 바닥 높이 0 · 입체 높이 60');

  // Rounding is for display only.
  assert.equal(planDegrees(137.4), '137°'); assert.equal(planDegrees(359.6), '0°'); assert.equal(planDegrees(-90), '270°'); assert.equal(planDegrees(720), '0°');
  assert.equal(planDegrees(Number.NaN), '–');
  assert.equal(planNumber(119.6), '120'); assert.equal(planNumber(-0.2), '0'); assert.equal(planNumber(-12.5), '-12'); assert.equal(planNumber(100000), '100000');
  assert.equal(planNumber(Number.POSITIVE_INFINITY), '–');
  const precise = freeze(cameraAt({ angle: 136.6, pitch: -44.6, elevation: 119.6, fov: 59.5 }));
  assert.deepEqual(texts(precise), ['방향 137°', '아래 45°', '높이 120', '화각 60°']);
  assert.deepEqual([precise.angle, precise.pitch, precise.elevation, precise.fov], [136.6, -44.6, 119.6, 59.5]);

  assert.deepEqual(PLAN_KIND_LABELS, { space: '공간', symbol: '기호', camera: '카메라' });
  assert.equal(planNodeLabel(legacyCamera), '전경, 카메라'); assert.equal(planNodeLabel(legacySpace), '교실, 공간'); assert.equal(planNodeLabel(legacySymbol), '출입문, 기호');
  assert.equal(planNodeLabel({ ...legacyCamera, name: '   ' }), '이름 없음, 카메라');
  assert.equal(planReadoutText({ key: 'pitch', label: '', value: '수평' }), '수평');
});

test('outlines keep the real shape of rectangles, ellipses, polygons and tilted objects', () => {
  assert.equal(planOutlinePoints(legacySpace), '100,100 200,100 200,160 100,160');
  const ellipse = planOutlinePoints({ ...legacySpace, shape: 'ellipse' })!.split(' ');
  assert.equal(ellipse.length, 48); assert.equal(ellipse[0], '200,130'); assert.equal(ellipse[12], '150,160'); assert.equal(ellipse[24], '100,130');
  assert.equal(planOutlinePoints({ ...legacySpace, shape: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] }), '100,100 200,100 150,160');
  assert.equal(planOutlinePoints({ ...legacySpace, rotation: 90 }), '180,80 180,180 120,180 120,80');
  assert.equal(planOutlinePoints({ ...legacySymbol, x: 0, y: 0 }), '0,0 20,0 20,10 0,10');
  // Coordinates are written with two decimals at most and never as -0.
  assert.equal(planOutlinePoints({ ...legacySpace, x: -50, y: -30, rotation: 30 }), '-28.3,-50.98 58.3,-0.98 28.3,50.98 -58.3,0.98');
  assert.equal(planOutlinePoints({ ...legacySpace, x: -50, y: -30, rotation: 180 }), '50,30 -50,30 -50,-30 50,-30');
  // A door lying on its side casts the outline of its whole 160-high box.
  const lying = planOutlinePoints({ ...legacySymbol, x: 0, y: 0, pitch: 90 })!.split(' ').map(pair => pair.split(',').map(Number));
  assert.equal(lying.length, 4);
  assert.deepEqual([Math.min(...lying.map(point => point[1])), Math.max(...lying.map(point => point[1]))], [5, 165]);
  // An object squashed to a line on the plan has no outline to fill; it is skipped instead of drawn as a broken shape.
  assert.equal(planOutlinePoints({ ...legacySymbol, x: 0, y: 0, volumeHeight: 0, pitch: 90 }), null);
  // The vertical placement never changes a plan outline.
  assert.equal(planOutlinePoints({ ...legacySpace, elevation: 300, volumeHeight: 20 }), planOutlinePoints(legacySpace));
});

test('clicking a stack moves on to the next item so every camera on one spot can be picked', () => {
  const three = freeze([1, 2, 3].reduce((current, index) => addMapCamera(current, `new-${index}`).map, mapOf([legacySpace])));
  assert.deepEqual(three.nodes.filter(node => node.type === 'camera').map(node => [node.x, node.y]), [[500, 340], [500, 340], [500, 340]]);
  // The last camera is drawn on top, so it is the one a click lands on.
  assert.equal(nextPlanSelection(three, 'new-3', null), 'new-3');
  assert.equal(nextPlanSelection(three, 'new-3', 'new-3'), 'new-1');
  assert.equal(nextPlanSelection(three, 'new-3', 'new-1'), 'new-2');
  assert.equal(nextPlanSelection(three, 'new-3', 'new-2'), 'new-3');
  // A selection somewhere else, or one that no longer exists, does not start the cycle.
  assert.equal(nextPlanSelection(three, 'new-3', 'space'), 'new-3');
  assert.equal(nextPlanSelection(three, 'new-3', 'missing'), 'new-3');
  assert.equal(nextPlanSelection(three, 'space', 'space'), 'space');
  assert.equal(nextPlanSelection(three, 'space', 'new-1'), 'space');
  // On a zoomed-out plan a wider tolerance treats visually overlapping items as one stack.
  const near30 = mapOf([cameraAt({ id: 'a', x: 500, y: 340 }), cameraAt({ id: 'b', x: 530, y: 340 })]);
  assert.equal(nextPlanSelection(near30, 'b', 'b'), 'b');
  assert.equal(nextPlanSelection(near30, 'b', 'b', 40), 'a');
  assert.equal(nextPlanSelection(near30, 'b', 'a', 40), 'b');
  assert.equal(planSelectedNode(three, 'new-2'), three.nodes[2]);
  assert.equal(planSelectedNode(three, 'space'), three.nodes[0]);
});

test('only what lies under the pointer takes part in a stack: a symbol pressed away from the camera on its centre is itself', () => {
  // A top-down shot: the camera stands on the centre of the table, a second camera right next to it.
  const table: BackgroundSymbol = { ...legacySymbol, id: 'table', symbol: 'table', spaceId: null, x: 440, y: 290, width: 120, height: 100 };
  const top = cameraAt({ id: 'top', x: 500, y: 340, pitch: -90 }), side = cameraAt({ id: 'side', x: 505, y: 345, angle: 0, fov: 60 });
  const map = freeze(mapOf([table, top, side]));
  const mainPlan = (point: BackgroundPoint) => (node: BackgroundNode) => planNodeCovers(node, point, node.type !== 'camera' ? 0 : projectCameraToPlan(node).vertical ? 18 : 12, 80);
  const corner = { x: 450, y: 300 }, centre = { x: 501, y: 341 };
  // By the anchors alone the three are one stack, wherever the table was pressed.
  assert.deepEqual(planStackUnder(map, 'table'), ['table', 'top', 'side']);
  assert.equal(nextPlanSelection(map, 'table', 'top'), 'side');
  // 64 units from the cameras only the table is under the pointer.
  assert.deepEqual(planStackUnder(map, 'table', undefined, mainPlan(corner)), ['table']);
  assert.equal(nextPlanSelection(map, 'table', 'top', undefined, mainPlan(corner)), 'table');
  assert.equal(nextPlanSelection(map, 'table', 'table', undefined, mainPlan(corner)), 'table');
  // On the pile itself all three take turns, in map order.
  assert.deepEqual(planStackUnder(map, 'side', undefined, mainPlan(centre)), ['table', 'top', 'side']);
  assert.deepEqual(['table', 'top', 'side'].map(selected => nextPlanSelection(map, 'side', selected, undefined, mainPlan(centre))), ['top', 'side', 'table']);
  // The pressed item always belongs to its own stack, also where its shape is not covered by the test.
  assert.deepEqual(planStackUnder(map, 'side', undefined, () => false), ['side']);

  // What counts as covered: a symbol's own box, turned with it.
  const turned: BackgroundSymbol = { ...table, rotation: 90 };
  assert.equal(planNodeCovers(table, { x: 445, y: 295 }, 0), true);
  assert.equal(planNodeCovers(table, { x: 500, y: 395 }, 0), false, 'below the 100 deep box');
  assert.equal(planNodeCovers(turned, { x: 500, y: 395 }, 0), true, 'the turned box reaches 60 down');
  assert.equal(planNodeCovers(turned, { x: 445, y: 340 }, 0), false, 'and only 50 to the side');
  assert.equal(planNodeCovers({ ...table, width: 4, height: 4, x: 498, y: 338 }, { x: 506, y: 340 }, 7.2), true, 'a small symbol keeps its hit circle');
  // A camera: its body, and its fan where the plan draws one.
  assert.equal(planNodeCovers(side, { x: 515, y: 345 }, 12), true);
  assert.equal(planNodeCovers(side, { x: 560, y: 345 }, 12), false, 'no fan on the companion plan');
  assert.equal(planNodeCovers(side, { x: 560, y: 345 }, 12, 80), true, 'inside the fan');
  assert.equal(planNodeCovers(side, { x: 560, y: 380 }, 12, 80), false, 'outside its 60 degree opening');
  assert.equal(planNodeCovers(side, { x: 590, y: 345 }, 12, 80), false, 'beyond its radius');
  assert.equal(planNodeCovers(side, { x: 450, y: 345 }, 12, 80), false, 'behind the camera');
  assert.equal(planNodeCovers({ ...side, angle: 180 }, { x: 450, y: 345 }, 12, 80), true, 'the fan turns with the direction');
  assert.equal(planNodeCovers({ ...side, pitch: 60 }, { x: 560, y: 345 }, 12, 80), false, 'a tilted camera has a shorter fan');
  assert.equal(planNodeCovers({ ...side, pitch: 60 }, { x: 540, y: 345 }, 12, 80), true);
  assert.equal(planNodeCovers(top, { x: 540, y: 340 }, 18, 80), false, 'a vertical camera has no fan');
  assert.equal(planNodeCovers(top, { x: 515, y: 340 }, 18, 80), true);
  assert.equal(planNodeCovers(legacySpace, { x: 150, y: 130 }, 1000, 1000), false, 'spaces never stack');
  assert.equal(planNodeCovers(side, { x: Number.NaN, y: 345 }, 12, 80), false);

  // Three cameras created on the same spot share one fan: a press on it still belongs to the whole pile.
  const three = freeze([1, 2, 3].reduce((current, index) => addMapCamera(current, `new-${index}`).map, mapOf()));
  assert.deepEqual(planStackUnder(three, 'new-3', undefined, mainPlan({ x: 540, y: 345 })), ['new-1', 'new-2', 'new-3']);
  // The companion plan: a click on the table's outline away from the cameras picks the table.
  const scale = 5, companion = (point: BackgroundPoint) => (node: BackgroundNode) => planNodeCovers(node, point, (node.type === 'camera' ? PLAN_MARK.hit : PLAN_MARK.dot * 1.6) * scale);
  assert.equal(nextPlanSelection(map, 'table', 'top', 45, companion({ x: 445, y: 380 })), 'table', '68 units from the cameras, 55 is their reach');
  assert.equal(nextPlanSelection(map, 'side', 'top', 45, companion(centre)), 'side');
  assert.equal(nextPlanSelection(map, 'side', 'side', 45, companion(centre)), 'table');
});

const spaceOf = (id: string, x: number, y: number, width: number, height: number): BackgroundSpace => ({ ...legacySpace, id, name: id, x, y, width, height });
/**
 * A building site, the floor on it, a room on the floor and a closet in the room, listed in no order of size, with a chair
 * on the closet, a camera on the edge of the room and three cameras on one spot in the room.
 */
const building = () => freeze(mapOf([spaceOf('closet', 320, 220, 60, 40), spaceOf('room', 300, 200, 200, 150), spaceOf('site', 0, 0, 1000, 680), spaceOf('floor', 100, 80, 800, 520),
  { ...legacySymbol, id: 'chair', symbol: 'chair', spaceId: null, x: 330, y: 230, width: 40, height: 40 }, cameraAt({ id: 'camera', x: 500, y: 340 }),
  ...[1, 2, 3].map(index => cameraAt({ id: `cam-${index}`, x: 450, y: 300 }))]));
/** What the main plan counts as under the pointer. */
const onMainPlan = (point: BackgroundPoint) => (node: BackgroundNode) => planNodeCovers(node, point, node.type !== 'camera' ? 0 : projectCameraToPlan(node).vertical ? 18 : 12, 80);

test('the pile on a space is every space that holds the point, the smallest first', () => {
  const map = building();
  assert.deepEqual(planPileAt(map, 'closet', { x: 340, y: 240 }), ['closet', 'room', 'floor', 'site']);
  assert.deepEqual(planPileAt(map, 'room', { x: 450, y: 300 }), ['room', 'floor', 'site']);
  assert.deepEqual(planPileAt(map, 'floor', { x: 150, y: 100 }), ['floor', 'site']);
  assert.deepEqual(planPileAt(map, 'site', { x: 50, y: 50 }), ['site']);
  // The point decides, not the pressed space: the pile starts at the top whichever of its spaces was pressed.
  assert.deepEqual(planPileAt(map, 'room', { x: 340, y: 240 }), ['closet', 'room', 'floor', 'site']);
  // The chair and the cameras that stand on these points are no part of it, whatever the tolerance and the cover test.
  assert.deepEqual(planPileAt(map, 'closet', { x: 340, y: 240 }, 1000, () => true), ['closet', 'room', 'floor', 'site']);
  assert.deepEqual(planPileAt(map, 'room', { x: 450, y: 300 }, 1000, () => true), ['room', 'floor', 'site']);
  // The cover test is about cameras and symbols. No space passes the one the plan uses, and every space that holds the point still takes its turn.
  assert.deepEqual(planPileAt(map, 'closet', { x: 340, y: 240 }, undefined, onMainPlan({ x: 340, y: 240 })), ['closet', 'room', 'floor', 'site']);
  assert.deepEqual(planPileAt(map, 'closet', { x: 340, y: 240 }, undefined, () => false), ['closet', 'room', 'floor', 'site']);
  // A locked space keeps its place, under the pressed one or pressed itself: it cannot be dragged, but a click still steps on from it.
  const locked = freeze(mapOf(map.nodes.map(node => node.id === 'room' ? { ...node, locked: true } : node)));
  assert.deepEqual(planPileAt(locked, 'closet', { x: 340, y: 240 }), ['closet', 'room', 'floor', 'site']);
  assert.deepEqual(planPileAt(locked, 'room', { x: 450, y: 300 }), ['room', 'floor', 'site']);
});

test('a pressed space that does not hold the point is a pile of its own', () => {
  const map = building();
  // The outer half of an outline is pressed, but the space does not hold that point: the spaces around it do.
  assert.deepEqual(planPileAt(map, 'closet', { x: 319.5, y: 240 }), ['closet']);
  assert.deepEqual(planPileAt(map, 'room', { x: 500.5, y: 300 }), ['room']);
  assert.deepEqual(planPileAt(map, 'site', { x: -0.5, y: 300 }), ['site']);
  // On the outline itself the space holds the point.
  assert.deepEqual(planPileAt(map, 'closet', { x: 320, y: 240 }), ['closet', 'room', 'floor', 'site']);
});

test('the pile on a camera or symbol is its stack: spaces are never mixed into it', () => {
  const map = building(), spot = { x: 450, y: 300 };
  // The three cameras stand on a point that three spaces hold: a press on a camera takes turns through the cameras only.
  assert.deepEqual(planPileAt(map, 'cam-3', spot), ['cam-1', 'cam-2', 'cam-3']);
  assert.deepEqual(planPileAt(map, 'cam-3', spot, undefined, onMainPlan(spot)), ['cam-1', 'cam-2', 'cam-3']);
  // The chair lies on the closet: pressed again and again it never goes down to the spaces under it.
  assert.deepEqual(planPileAt(map, 'chair', { x: 340, y: 240 }), ['chair']);
  assert.deepEqual(planPileAt(map, 'chair', { x: 340, y: 240 }, undefined, onMainPlan({ x: 340, y: 240 })), ['chair']);
  // The tolerance and the cover test reach the stack as they are: the camera 64 units away joins within 70, unless only what is under the pointer counts.
  assert.deepEqual(planPileAt(map, 'cam-3', spot, 70), ['camera', 'cam-1', 'cam-2', 'cam-3']);
  assert.deepEqual(planPileAt(map, 'cam-3', spot, 70, onMainPlan(spot)), ['cam-1', 'cam-2', 'cam-3']);
  assert.deepEqual(planPileAt(map, 'cam-3', spot, 70, () => false), ['cam-3']);
  // The same list as planStackUnder, whatever is passed on.
  for (const id of ['chair', 'camera', 'cam-1', 'cam-2', 'cam-3']) for (const tolerance of [undefined, 12, 70, 1000]) for (const covers of [undefined, onMainPlan(spot), () => false, () => true]) {
    const pile = planPileAt(map, id, spot, tolerance, covers);
    assert.deepEqual(pile, planStackUnder(map, id, tolerance, covers), `${id} within ${tolerance}`);
    assert.ok(pile.every(member => map.nodes.find(node => node.id === member)?.type !== 'space'), `${id} within ${tolerance}`);
  }
});

test('describing a map never writes to it', () => {
  const nodes: BackgroundNode[] = [legacySpace, { ...legacySpace, id: 'oval', shape: 'ellipse', elevation: 40 }, legacySymbol, { ...legacySymbol, id: 'tilted', pitch: 30, roll: 10 },
    legacyCamera, cameraAt({ id: 'up', pitch: 90 }), cameraAt({ id: 'down', pitch: -90, roll: 15 })];
  const source = freeze(mapOf(nodes)), before = JSON.stringify(source), size = { width: 300, height: 140 };
  const scale = planUnitsPerPixel(planViewBox(source, size), size);
  for (const node of source.nodes) {
    planNodeLabel(node); planNodeReadout(node); planNodeSummary(node); nextPlanSelection(source, node.id, node.id, 40);
    if (node.type === 'camera') { planCameraGlyph(node, scale); planSideView(source, node); }
    else planOutlinePoints(node);
  }
  assert.equal(JSON.stringify(source), before);
  // No derived vertical field appears on a node that did not store it.
  for (const key of ['elevation', 'volumeHeight', 'pitch', 'roll', 'aspect']) { assert.equal(key in source.nodes[0], false); assert.equal(key in source.nodes[4], false); }
});
