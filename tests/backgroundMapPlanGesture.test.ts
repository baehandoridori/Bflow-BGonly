import test from 'node:test';
import assert from 'node:assert/strict';
import { planGestureCandidates, previewPlanGesture } from '../src/features/backgrounds/mapPlanGesture.ts';
import type { PlanGesture, PlanGestureSnap } from '../src/features/backgrounds/mapPlanGesture.ts';
import { moveMapNode, nodeResizeCorner, placeMapNode, replaceMapNode, resizeSpace, transformMapSpace } from '../src/features/backgrounds/mapGeometry.ts';
import { collectSnapCandidates, snapTravellingIds } from '../src/features/backgrounds/mapSnap.ts';
import { nodePlanOutline } from '../src/features/backgrounds/mapSpatial.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';

const near = (actual: number, expected: number, label = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label} ${actual} != ${expected}`);
const add = (a: BackgroundPoint, b: BackgroundPoint): BackgroundPoint => ({ x: a.x + b.x, y: a.y + b.y });
const between = (start: BackgroundPoint, point: BackgroundPoint): BackgroundPoint => ({ x: point.x - start.x, y: point.y - start.y });

const room: BackgroundSpace = { id: 'room', type: 'space', name: '교실', placeId: null, childMapId: null, x: 100, y: 100, width: 300, height: 200, rotation: 0, shape: 'rect', points: [], locked: false };
/** In the room, and carried by it. */
const lens: BackgroundCamera = { id: 'lens', type: 'camera', name: '카메라 1', x: 200, y: 150, spaceId: 'room', angle: 10, fov: 60, viewIds: ['view'], locked: false };
const chair: BackgroundSymbol = { id: 'chair', type: 'symbol', name: '의자', symbol: 'chair', spaceId: 'room', x: 300, y: 220, width: 40, height: 30, rotation: 0, locked: false, hinge: 'left', swing: 'inward' };
/** Belongs to no space. */
const lookout: BackgroundCamera = { ...lens, id: 'lookout', name: '카메라 2', x: 500, y: 340, spaceId: null, angle: 0 };
const plan: BackgroundMap = { id: 'map', revision: 1, name: '학교', parentId: null, placeId: null, imageUrl: '', nodes: [room, lens, chair, lookout] };
const [ROOM, LENS, CHAIR, LOOKOUT] = [0, 1, 2, 3];
/** The same map with one node turned. Members stay where they are: only the node itself is swapped. */
const turned = <T extends BackgroundSpace | BackgroundSymbol>(source: T, rotation: number) => {
  const node = { ...source, rotation };
  return { node, initial: replaceMapNode(plan, node) };
};

test('a free move is the node moved by as far as the pointer went', () => {
  const start = { x: 212.4, y: 163.7 }, point = { x: 251.15, y: 140.2 }, delta = between(start, point);
  for (const id of [room.id, lens.id, chair.id, lookout.id]) {
    assert.deepEqual(previewPlanGesture({ mode: 'move', nodeId: id }, plan, start, point, null), { map: moveMapNode(plan, id, delta), guides: [] }, id);
  }
  // A room takes its members along; anything else moves alone.
  const moved = previewPlanGesture({ mode: 'move', nodeId: room.id }, plan, { x: 150, y: 150 }, { x: 190, y: 140 }, null)!.map.nodes;
  assert.deepEqual(moved[ROOM], { ...room, x: 140, y: 90 }); assert.deepEqual(moved[LENS], { ...lens, x: 240, y: 140 });
  assert.deepEqual(moved[CHAIR], { ...chair, x: 340, y: 210 }); assert.equal(moved[LOOKOUT], lookout);
  const alone = previewPlanGesture({ mode: 'move', nodeId: chair.id }, plan, { x: 150, y: 150 }, { x: 190, y: 140 }, null)!.map.nodes;
  assert.deepEqual(alone[CHAIR], { ...chair, x: 340, y: 210 });
  for (const index of [ROOM, LENS, LOOKOUT]) assert.equal(alone[index], plan.nodes[index]);
});

test('a free resize moves the bottom-right corner by as far as the pointer went', () => {
  const start = { x: 396, y: 296 }, point = { x: 426.5, y: 306.25 }, delta = between(start, point);
  for (const rotation of [0, 90, 37]) {
    // A space carries its members by the same scale.
    const space = turned(room, rotation);
    assert.deepEqual(previewPlanGesture({ mode: 'resize', nodeId: room.id }, space.initial, start, point, null),
      { map: transformMapSpace(space.initial, resizeSpace(space.node, add(nodeResizeCorner(space.node), delta))), guides: [] }, `space at ${rotation}`);
    // A symbol is resized alone.
    const symbol = turned(chair, rotation);
    const resized = previewPlanGesture({ mode: 'resize', nodeId: chair.id }, symbol.initial, start, point, null)!;
    assert.deepEqual(resized, { map: replaceMapNode(symbol.initial, resizeSpace(symbol.node, add(nodeResizeCorner(symbol.node), delta))), guides: [] }, `symbol at ${rotation}`);
    for (const index of [ROOM, LENS, LOOKOUT]) assert.equal(resized.map.nodes[index], symbol.initial.nodes[index]);
  }
  const grown = previewPlanGesture({ mode: 'resize', nodeId: room.id }, plan, start, point, null)!.map.nodes;
  assert.deepEqual(grown[ROOM], { ...room, width: 330.5, height: 210.25 });
  near(grown[LENS].x, 100 + 100 * 330.5 / 300, 'member x'); near(grown[LENS].y, 100 + 50 * 210.25 / 200, 'member y'); assert.equal(grown[LOOKOUT], lookout);
  const seat = previewPlanGesture({ mode: 'resize', nodeId: chair.id }, plan, start, point, null)!.map.nodes[CHAIR];
  assert.deepEqual(seat, { ...chair, width: 70.5, height: 40.25 });
  // Lengths stop at the saved minimum.
  const shrunk = previewPlanGesture({ mode: 'resize', nodeId: room.id }, plan, start, { x: -500, y: 290 }, null)!.map.nodes[ROOM] as BackgroundSpace;
  assert.equal(shrunk.width, 10); assert.equal(shrunk.height, 194);

  // A camera has no size: the map comes back as it is.
  for (const id of [lens.id, lookout.id]) {
    const preview = previewPlanGesture({ mode: 'resize', nodeId: id }, plan, start, point, null)!;
    assert.equal(preview.map, plan); assert.deepEqual(preview.guides, []);
  }
});

test('a free resize of an unturned node adds the travel to its stored size, to the last digit', () => {
  // Decimal coordinates, where going through the corner does not come back: 120.3 + 80 - 120.3 is 80.00000000000001.
  const box = { x: 244.65, y: 120.3, width: 144.65, height: 80 }, press = { x: 400.2, y: 210.7 };
  for (const source of [{ ...room, ...box }, { ...chair, ...box }]) {
    const initial = replaceMapNode(plan, source), gesture: PlanGesture = { mode: 'resize', nodeId: source.id }, label = source.type;
    const sized = (point: BackgroundPoint) => previewPlanGesture(gesture, initial, press, point, null)!.map.nodes.find(node => node.id === source.id) as BackgroundSpace | BackgroundSymbol;
    // A drag that came back to where it was pressed is the map as it was: nothing is left to undo.
    assert.deepEqual(previewPlanGesture(gesture, initial, press, press, null), { map: initial, guides: [] }, label);
    // The length that was not dragged keeps every digit.
    const wide = sized({ x: 431.9, y: 210.7 }), tall = sized({ x: 400.2, y: 251.3 });
    assert.equal(wide.width, box.width + (431.9 - 400.2), label); assert.equal(wide.height, 80, label);
    assert.equal(tall.height, box.height + (251.3 - 210.7), label); assert.equal(tall.width, 144.65, label);
    for (const node of [wide, tall]) { assert.equal(node.x, 244.65, label); assert.equal(node.y, 120.3, label); }
  }
});

test('a free rotation points a camera at the pointer and turns a space or symbol by the swept angle', () => {
  // A camera looks from its own position toward the pointer, wherever the press was.
  for (const start of [{ x: 580, y: 340 }, { x: 12, y: 700 }]) {
    const down = previewPlanGesture({ mode: 'rotate', nodeId: lookout.id }, plan, start, { x: 500, y: 440 }, null)!;
    assert.deepEqual(down.map.nodes[LOOKOUT], { ...lookout, angle: 90 }); assert.deepEqual(down.guides, []);
    for (const index of [ROOM, LENS, CHAIR]) assert.equal(down.map.nodes[index], plan.nodes[index]);
    const upLeft = previewPlanGesture({ mode: 'rotate', nodeId: lookout.id }, plan, start, { x: 400, y: 240 }, null)!;
    assert.equal((upLeft.map.nodes[LOOKOUT] as BackgroundCamera).angle, 225);
  }
  // Only the direction of a camera changes.
  const tilted: BackgroundCamera = { ...lookout, elevation: 150, pitch: 30, roll: 5, aspect: 1 };
  const aimed = previewPlanGesture({ mode: 'rotate', nodeId: lookout.id }, replaceMapNode(plan, tilted), { x: 580, y: 340 }, { x: 500, y: 440 }, null)!;
  assert.deepEqual(aimed.map.nodes[LOOKOUT], { ...tilted, angle: 90 });

  // A space turns about its centre (250, 200) by the angle between the press and the pointer, and its members turn with it.
  const top = { x: 250, y: 72 }, right = { x: 378, y: 200 };
  const quarter = previewPlanGesture({ mode: 'rotate', nodeId: room.id }, plan, top, right, null)!;
  assert.deepEqual(quarter, { map: transformMapSpace(plan, { ...room, rotation: 90 }), guides: [] });
  const carried = quarter.map.nodes[LENS] as BackgroundCamera, seat = quarter.map.nodes[CHAIR] as BackgroundSymbol;
  assert.deepEqual(quarter.map.nodes[ROOM], { ...room, rotation: 90 });
  near(carried.angle, 100, 'member angle'); near(carried.x, 300, 'member x'); near(carried.y, 150, 'member y');
  near(seat.rotation, 90, 'member rotation'); assert.equal(quarter.map.nodes[LOOKOUT], lookout);
  // The turn is added to the stored rotation and wraps into 0..360.
  const wrapped = turned(room, 350);
  const past = previewPlanGesture({ mode: 'rotate', nodeId: room.id }, wrapped.initial, top, add({ x: 250, y: 200 }, { x: 100 * Math.sin(20 * Math.PI / 180), y: -100 * Math.cos(20 * Math.PI / 180) }), null)!;
  near((past.map.nodes[ROOM] as BackgroundSpace).rotation, 10, 'wrapped rotation');
  // Pressing beside the handle turns nothing until the pointer moves.
  const still = previewPlanGesture({ mode: 'rotate', nodeId: room.id }, wrapped.initial, { x: 263, y: 81 }, { x: 263, y: 81 }, null)!;
  near((still.map.nodes[ROOM] as BackgroundSpace).rotation, 350, 'pressed rotation');

  // A symbol turns alone, about its own centre (320, 235).
  const spun = previewPlanGesture({ mode: 'rotate', nodeId: chair.id }, plan, { x: 320, y: 210 }, { x: 345, y: 235 }, null)!;
  assert.deepEqual(spun.map.nodes[CHAIR], { ...chair, rotation: 90 }); assert.deepEqual(spun.guides, []);
  for (const index of [ROOM, LENS, LOOKOUT]) assert.equal(spun.map.nodes[index], plan.nodes[index]);
});

test('a free rotation keeps the angle as it was computed, also right beside a quarter turn', () => {
  const around = (centre: BackgroundPoint, radius: number, degrees: number): BackgroundPoint =>
    ({ x: centre.x + radius * Math.cos(degrees * Math.PI / 180), y: centre.y + radius * Math.sin(degrees * Math.PI / 180) });
  // 1.5 degrees off 90, 0 and 270: nothing is rounded and no stop catches the angle.
  const swept = previewPlanGesture({ mode: 'rotate', nodeId: room.id }, plan, { x: 250, y: 72 }, around({ x: 250, y: 200 }, 128, 1.5), null)!;
  near((swept.map.nodes[ROOM] as BackgroundSpace).rotation, 91.5, 'space'); near((swept.map.nodes[LENS] as BackgroundCamera).angle, 101.5, 'member angle');
  const spun = previewPlanGesture({ mode: 'rotate', nodeId: chair.id }, plan, { x: 320, y: 210 }, around({ x: 320, y: 235 }, 25, -91.5), null)!;
  near((spun.map.nodes[CHAIR] as BackgroundSymbol).rotation, 358.5, 'symbol');
  const aimed = previewPlanGesture({ mode: 'rotate', nodeId: lookout.id }, plan, { x: 580, y: 340 }, around(lookout, 80, 268.5), null)!;
  near((aimed.map.nodes[LOOKOUT] as BackgroundCamera).angle, 268.5, 'camera');
});

test('drawing appends a box of at least 10 between the press and the pointer', () => {
  const blank: BackgroundSpace = { ...room, id: 'new', name: '새 공간', x: 0, y: 0, width: 10, height: 10 };
  const narrow = previewPlanGesture({ mode: 'draw', node: blank }, plan, { x: 100, y: 100 }, { x: 103, y: 250 }, null)!;
  assert.equal(narrow.map.nodes.length, plan.nodes.length + 1); assert.deepEqual(narrow.guides, []);
  assert.deepEqual(narrow.map.nodes[plan.nodes.length], { ...blank, x: 100, y: 100, width: 10, height: 150 });
  plan.nodes.forEach((node, index) => assert.equal(narrow.map.nodes[index], node));
  assert.deepEqual({ ...narrow.map, nodes: [] }, { ...plan, nodes: [] });
  // Up and to the left: the press is the far corner, and decimals stay as they are.
  const oval: BackgroundSpace = { ...blank, shape: 'ellipse' };
  const back = previewPlanGesture({ mode: 'draw', node: oval }, plan, { x: 300, y: 300 }, { x: 250.5, y: 220.25 }, null)!;
  assert.deepEqual(back.map.nodes[plan.nodes.length], { ...oval, x: 250.5, y: 220.25, width: 49.5, height: 79.75 });
  const flat = previewPlanGesture({ mode: 'draw', node: blank }, plan, { x: 300, y: 300 }, { x: 460, y: 296 }, null)!;
  assert.deepEqual(flat.map.nodes[plan.nodes.length], { ...blank, x: 300, y: 296, width: 160, height: 10 });
});

test('where a handle was pressed does not enter the result', () => {
  const sizes = (map: BackgroundMap, id: string) => { const node = map.nodes.find(item => item.id === id) as BackgroundSpace | BackgroundSymbol; return { width: node.width, height: node.height }; };
  for (const rotation of [0, 90, 37]) for (const source of [room, chair]) {
    const { node, initial } = turned(source, rotation), gesture: PlanGesture = { mode: 'resize', nodeId: node.id }, label = `${node.type} at ${rotation}`;
    // The same travel from two different presses gives the same map.
    const centred = previewPlanGesture(gesture, initial, { x: 400, y: 300 }, { x: 430.5, y: 310.25 }, null);
    assert.deepEqual(previewPlanGesture(gesture, initial, { x: 414, y: 314 }, { x: 444.5, y: 324.25 }, null), centred, label);
    assert.notDeepEqual(sizes(centred!.map, node.id), sizes(initial, node.id), label);
    // A press off the corner that has not travelled yet changes no length: the corner does not jump to the pointer.
    const pressed = add(nodeResizeCorner(node), { x: 14, y: 14 }), held = sizes(previewPlanGesture(gesture, initial, pressed, pressed, null)!.map, node.id);
    near(held.width, node.width, `${label} width`); near(held.height, node.height, `${label} height`);
  }
});

test('a preview depends on its arguments alone and leaves the map as it was', () => {
  const frozen = JSON.stringify(plan), blank: BackgroundSpace = { ...room, id: 'new', name: '새 공간' };
  const start = { x: 310.5, y: 240.25 }, point = { x: 352, y: 199.75 }, elsewhere = { x: 14.2, y: 633.1 };
  const gestures: PlanGesture[] = [
    ...[room.id, lens.id, chair.id, lookout.id].flatMap(nodeId => (['move', 'resize', 'rotate'] as const).map(mode => ({ mode, nodeId }))),
    { mode: 'draw', node: blank },
  ];
  for (const gesture of gestures) {
    const label = JSON.stringify(gesture), first = previewPlanGesture(gesture, plan, start, point, null);
    assert.ok(first, label); assert.deepEqual(first.guides, [], label);
    assert.deepEqual(previewPlanGesture(gesture, plan, start, point, null), first, label);
    // Another position in between leaves no trace.
    previewPlanGesture(gesture, plan, start, elsewhere, null);
    assert.deepEqual(previewPlanGesture(gesture, plan, start, point, null), first, label);
  }
  assert.equal(JSON.stringify(plan), frozen);

  for (const mode of ['move', 'resize', 'rotate'] as const) assert.equal(previewPlanGesture({ mode, nodeId: 'missing' }, plan, start, point, null), null, mode);
  // The drawn node is not on the map yet, and does not have to be.
  assert.ok(previewPlanGesture({ mode: 'draw', node: blank }, { ...plan, nodes: [] }, start, point, null));

  const fixed: BackgroundMap = { ...plan, nodes: plan.nodes.map(node => ({ ...node, locked: true })) };
  for (const node of fixed.nodes) assert.deepEqual(previewPlanGesture({ mode: 'move', nodeId: node.id }, fixed, start, point, null), { map: fixed, guides: [] }, node.id);
});

/** A snapping drag at a tolerance of 6 and a reach of 48, with the targets the gesture itself collects. */
const snapping = (gesture: PlanGesture, initial: BackgroundMap): PlanGestureSnap => ({ candidates: planGestureCandidates(gesture, initial), tolerance: 6, reach: 48 });
const snapped = (gesture: PlanGesture, initial: BackgroundMap, start: BackgroundPoint, point: BackgroundPoint) => {
  const preview = previewPlanGesture(gesture, initial, start, point, snapping(gesture, initial));
  assert.ok(preview, JSON.stringify(gesture));
  return preview;
};

test('a snapped move places the node on its neighbour, and the members of a space travel as far', () => {
  // A hall whose right edge is a decimal value, 15.35 to the left of the room.
  const hall: BackgroundSpace = { ...room, id: 'hall', name: '복도', x: 20, y: 40, width: 64.65, height: 350 };
  const initial: BackgroundMap = { ...plan, nodes: [...plan.nodes, hall] }, edge = hall.x + hall.width;
  const gesture: PlanGesture = { mode: 'move', nodeId: room.id }, start = { x: 150, y: 150 }, point = { x: 137.6, y: 153.7 };
  const preview = snapped(gesture, initial, start, point), moved = preview.map.nodes;
  // The left edge takes the very value of the right edge of the hall; the axis that stuck to nothing is a whole number.
  assert.equal(moved[ROOM].x, edge); assert.equal(moved[ROOM].y, 104);
  assert.deepEqual(preview.map, placeMapNode(initial, room.id, { x: edge, y: 104 }));
  assert.deepEqual(preview.guides, [{ axis: 'x', at: edge, from: 40, to: 390 }]);
  // Members go as far as the room went, not as far as the pointer did.
  for (const index of [LENS, CHAIR]) {
    near(moved[index].x - plan.nodes[index].x, edge - room.x, `member ${index} x`); near(moved[index].y - plan.nodes[index].y, 4, `member ${index} y`);
  }
  assert.equal(moved[LOOKOUT], lookout); assert.equal(moved[plan.nodes.length], hall);
  // The free drag of the same travel keeps its decimals and shows no guide.
  const free = previewPlanGesture(gesture, initial, start, point, null)!;
  near(free.map.nodes[ROOM].x, 87.6, 'free x'); near(free.map.nodes[ROOM].y, 103.7, 'free y'); assert.deepEqual(free.guides, []);

  // The snapped position is stored as it is. Reached by adding the travel, a drag from far away would miss the last digit.
  const stool: BackgroundSymbol = { ...chair, id: 'stool', spaceId: null, x: 512.7, y: 420.3 };
  assert.notEqual(stool.x + (edge - stool.x), edge);
  const far = snapped({ mode: 'move', nodeId: stool.id }, { ...initial, nodes: [...initial.nodes, stool] }, { x: 520, y: 430 }, { x: 94.7, y: 260.1 });
  assert.deepEqual(far.map.nodes[initial.nodes.length], { ...stool, x: edge, y: 250 });
  assert.deepEqual(far.guides, [{ axis: 'x', at: edge, from: 40, to: 390 }]);
});

test('a space does not stick to a member it carries, and does stick to a locked one that stays', () => {
  const gesture: PlanGesture = { mode: 'move', nodeId: room.id }, start = { x: 150, y: 150 }, point = { x: 347.2, y: 150.4 };
  // The left edge of the room comes 2.8 short of where its chair was. The chair travels along, so it is no target.
  const carried = snapped(gesture, plan, start, point);
  assert.equal(carried.map.nodes[ROOM].x, 297); assert.equal(carried.map.nodes[ROOM].y, 100); assert.deepEqual(carried.guides, []);
  near(carried.map.nodes[CHAIR].x, 497, 'carried chair');
  // Locked, the chair stays where it is and the room sticks to its left edge.
  const bolted = replaceMapNode(plan, { ...chair, locked: true });
  const held = snapped(gesture, bolted, start, point);
  assert.equal(held.map.nodes[ROOM].x, 300); assert.equal(held.map.nodes[ROOM].y, 100);
  assert.deepEqual(held.guides, [{ axis: 'x', at: 300, from: 100, to: 300 }]);
  assert.equal(held.map.nodes[CHAIR], bolted.nodes[CHAIR]); near(held.map.nodes[LENS].x, 400, 'carried camera');
});

test('a space sticks by its own edges, not by those of a member that reaches past them', () => {
  // A door in the left wall pokes 20 out of the room, and the hall ends 15.35 to the left of that wall.
  const door: BackgroundSymbol = { ...chair, id: 'door', name: '문', symbol: 'door', x: 80, y: 180, width: 40, height: 40 };
  const hall: BackgroundSpace = { ...room, id: 'hall', name: '복도', x: 20, y: 40, width: 64.65, height: 350 };
  const initial: BackgroundMap = { ...plan, nodes: [room, door, hall] }, edge = hall.x + hall.width;
  // The wall comes 2.95 from the hall and takes its value. Measured together with the door, the left edge
  // would be 20 further out and there would be nothing for it to stick to.
  const preview = snapped({ mode: 'move', nodeId: room.id }, initial, { x: 150, y: 150 }, { x: 137.6, y: 153.7 }), moved = preview.map.nodes;
  assert.equal(moved[0].x, edge); assert.equal(moved[0].y, 104);
  assert.deepEqual(preview.guides, [{ axis: 'x', at: edge, from: 40, to: 390 }]);
  // The door goes as far as the room did.
  near(moved[1].x, door.x + (edge - room.x), 'door x'); near(moved[1].y, 184, 'door y'); assert.equal(moved[2], hall);
});

test('a snapped move takes a camera by its point', () => {
  // Brought to 2.3 left of the left wall of the room and 1.4 below its middle line.
  const camera: BackgroundCamera = { ...lookout, id: 'camera', x: 60, y: 420 };
  const initial: BackgroundMap = { ...plan, nodes: [room, camera] };
  const preview = snapped({ mode: 'move', nodeId: camera.id }, initial, { x: 60, y: 420 }, { x: 97.7, y: 201.4 });
  assert.deepEqual(preview.map.nodes[1], { ...camera, x: 100, y: 200 }); assert.equal(preview.map.nodes[0], room);
  assert.deepEqual(preview.guides, [{ axis: 'x', at: 100, from: 100, to: 300 }, { axis: 'y', at: 200, from: 100, to: 400 }]);
});

test('a snapped move sticks only to what is near on the other axis', () => {
  const gesture: PlanGesture = { mode: 'move', nodeId: room.id }, start = { x: 250, y: 200 };
  const stool = (x: number, y: number): BackgroundSymbol => ({ ...chair, id: 'stool', spaceId: null, x, y, width: 60, height: 60 });
  // The top of the room comes 1.3 from the top of the stool, but the stool is 299.7 away to the right.
  const apart = snapped(gesture, { ...plan, nodes: [room, stool(700, 451.5)] }, start, { x: 250.3, y: 550.2 });
  assert.equal(apart.map.nodes[0].x, 100); assert.equal(apart.map.nodes[0].y, 450); assert.deepEqual(apart.guides, []);
  // The same 1.3 with the stool 29.7 away.
  const beside = snapped(gesture, { ...plan, nodes: [room, stool(430, 151.5)] }, start, { x: 250.3, y: 250.2 });
  assert.equal(beside.map.nodes[0].x, 100); assert.equal(beside.map.nodes[0].y, 151.5);
  assert.deepEqual(beside.guides, [{ axis: 'y', at: 151.5, from: 100, to: 490 }]);
});

test('a snapped resize sticks only to what is near on the other axis', () => {
  const gesture: PlanGesture = { mode: 'resize', nodeId: room.id }, start = { x: 400, y: 300 }, point = { x: 697.6, y: 300.3 };
  const stool = (y: number): BackgroundSymbol => ({ ...chair, id: 'stool', spaceId: null, x: 700, y, width: 60, height: 60 });
  // The dragged corner comes 2.4 short of the left edge of the stool, but the stool is 99.7 further down.
  const apart = snapped(gesture, { ...plan, nodes: [room, stool(400)] }, start, point);
  assert.deepEqual(apart.map.nodes[0], { ...room, width: 598, height: 200 }); assert.deepEqual(apart.guides, []);
  // The same 2.4 with the stool 39.7 further down.
  const beside = snapped(gesture, { ...plan, nodes: [room, stool(340)] }, start, point);
  assert.deepEqual(beside.map.nodes[0], { ...room, width: 600, height: 200 });
  assert.deepEqual(beside.guides, [{ axis: 'x', at: 700, from: 100, to: 400 }]);
});

test('a snapped resize takes the corner to a near line and makes the other length a whole number', () => {
  const start = { x: 396, y: 296 };
  // The right edge of the room comes 2.4 short of the camera at x 500, which is 19.7 below the dragged corner.
  const grown = snapped({ mode: 'resize', nodeId: room.id }, plan, start, { x: 493.6, y: 316.3 });
  assert.deepEqual(grown.map.nodes[ROOM], { ...room, width: 400, height: 220 });
  assert.deepEqual(grown.map, transformMapSpace(plan, { ...room, width: 400, height: 220 }));
  assert.deepEqual(grown.guides, [{ axis: 'x', at: 500, from: 100, to: 340 }]);
  near(grown.map.nodes[LENS].x, 100 + 100 * 400 / 300, 'member x'); near(grown.map.nodes[LENS].y, 100 + 50 * 220 / 200, 'member y');

  // A symbol is resized alone: both edges of the chair reach the walls of its room.
  const seat = snapped({ mode: 'resize', nodeId: chair.id }, plan, start, { x: 453.8, y: 344.4 });
  assert.deepEqual(seat.map.nodes[CHAIR], { ...chair, width: 100, height: 80 });
  for (const index of [ROOM, LENS, LOOKOUT]) assert.equal(seat.map.nodes[index], plan.nodes[index]);
  assert.deepEqual(seat.guides, [{ axis: 'x', at: 400, from: 100, to: 300 }, { axis: 'y', at: 300, from: 100, to: 400 }]);

  // Turned off the quarter turns nothing sticks: both lengths of the free result become whole numbers.
  const tilted = turned(room, 37), gesture: PlanGesture = { mode: 'resize', nodeId: room.id }, point = { x: 426.5, y: 306.25 };
  const free = previewPlanGesture(gesture, tilted.initial, start, point, null)!.map.nodes[ROOM] as BackgroundSpace;
  const loose = snapped(gesture, tilted.initial, start, point), sized = loose.map.nodes[ROOM] as BackgroundSpace;
  assert.equal(sized.width, Math.round(free.width)); assert.equal(sized.height, Math.round(free.height));
  assert.notEqual(sized.width, free.width); assert.notEqual(sized.height, free.height); assert.deepEqual(loose.guides, []);

  // A camera has no size, snapped or not.
  const lensless = snapped({ mode: 'resize', nodeId: lookout.id }, plan, start, point);
  assert.equal(lensless.map, plan); assert.deepEqual(lensless.guides, []);
});

test('a locked node sticks to nothing: the map is as it was and no guide shows', () => {
  // The room of the first snapped move, locked: 2.95 from the hall, where it would stick if it could move.
  const hall: BackgroundSpace = { ...room, id: 'hall', name: '복도', x: 20, y: 40, width: 64.65, height: 350 };
  const initial: BackgroundMap = { ...plan, nodes: [{ ...room, locked: true }, hall] };
  const moved = snapped({ mode: 'move', nodeId: room.id }, initial, { x: 150, y: 150 }, { x: 137.6, y: 153.7 });
  assert.equal(moved.map, initial); assert.deepEqual(moved.guides, []);
  // Its corner dragged to 1.8 from the bottom edge of the hall.
  const sized = snapped({ mode: 'resize', nodeId: room.id }, initial, { x: 400, y: 300 }, { x: 400.4, y: 388.2 });
  assert.equal(sized.map, initial); assert.deepEqual(sized.guides, []);
  // Whatever kind the locked node is, its snapped move is the free one: the chair would stick to the middle line of its room.
  const fixed: BackgroundMap = { ...plan, nodes: plan.nodes.map(node => ({ ...node, locked: true })) };
  for (const node of fixed.nodes) {
    assert.deepEqual(snapped({ mode: 'move', nodeId: node.id }, fixed, { x: 310.5, y: 240.25 }, { x: 352, y: 199.75 }), { map: fixed, guides: [] }, node.id);
  }
});

test('a snapped rotation is caught by the quarter turns, and the members of a space turn with it', () => {
  const around = (centre: BackgroundPoint, radius: number, degrees: number): BackgroundPoint =>
    ({ x: centre.x + radius * Math.cos(degrees * Math.PI / 180), y: centre.y + radius * Math.sin(degrees * Math.PI / 180) });
  const gesture: PlanGesture = { mode: 'rotate', nodeId: room.id }, top = { x: 250, y: 72 };
  // Swept 91.5 degrees: exactly 90, and the members turn by that 90 too.
  const caught = snapped(gesture, plan, top, around({ x: 250, y: 200 }, 128, 1.5));
  assert.equal((caught.map.nodes[ROOM] as BackgroundSpace).rotation, 90);
  assert.deepEqual(caught, { map: transformMapSpace(plan, { ...room, rotation: 90 }), guides: [] });
  near((caught.map.nodes[LENS] as BackgroundCamera).angle, 100, 'member angle'); near((caught.map.nodes[CHAIR] as BackgroundSymbol).rotation, 90, 'member rotation');
  // A symbol 1.5 degrees short of a full turn is back at 0, a camera 1.5 short of 270 points there.
  const spun = snapped({ mode: 'rotate', nodeId: chair.id }, plan, { x: 320, y: 210 }, around({ x: 320, y: 235 }, 25, -91.5));
  assert.equal((spun.map.nodes[CHAIR] as BackgroundSymbol).rotation, 0); assert.deepEqual(spun.guides, []);
  const aimed = snapped({ mode: 'rotate', nodeId: lookout.id }, plan, { x: 580, y: 340 }, around(lookout, 80, 268.5));
  assert.equal((aimed.map.nodes[LOOKOUT] as BackgroundCamera).angle, 270); assert.deepEqual(aimed.guides, []);
  // More than 3 degrees from every stop the angle is as it was computed: it is not made a whole number.
  const loose = snapped(gesture, plan, top, around({ x: 250, y: 200 }, 128, 5.5));
  near((loose.map.nodes[ROOM] as BackgroundSpace).rotation, 95.5, 'past the stop'); assert.deepEqual(loose.guides, []);
});

test('drawing is not snapped: the box is the press and the pointer as they are', () => {
  const blank: BackgroundSpace = { ...room, id: 'new', name: '새 공간', x: 0, y: 0, width: 10, height: 10 };
  const gesture: PlanGesture = { mode: 'draw', node: blank };
  // Pressed 1.3 from the corner of the room and released 1.4 from the camera.
  const start = { x: 401.3, y: 301.7 }, point = { x: 498.6, y: 338.2 };
  const free = previewPlanGesture(gesture, plan, start, point, null)!;
  // Whatever the snap carries: what a drawing collects, or every line and corner of the map.
  for (const candidates of [planGestureCandidates(gesture, plan), collectSnapCandidates(plan, new Set())]) {
    const drawn = previewPlanGesture(gesture, plan, start, point, { candidates, tolerance: 6, reach: 48 })!;
    assert.deepEqual(drawn, free); assert.deepEqual(drawn.guides, []);
    assert.deepEqual(drawn.map.nodes[plan.nodes.length], { ...blank, x: 401.3, y: 301.7, width: 498.6 - 401.3, height: 338.2 - 301.7 });
  }
});

test('a move and a resize collect everything that does not travel along; drawing and turning collect nothing', () => {
  const bolted = replaceMapNode(plan, { ...chair, locked: true });
  for (const mode of ['move', 'resize'] as const) {
    // The room carries its camera and its chair: the plan border and the camera outside are left.
    const beside = planGestureCandidates({ mode, nodeId: room.id }, plan);
    assert.deepEqual(beside, collectSnapCandidates(plan, snapTravellingIds(plan, [room.id])), mode);
    assert.deepEqual(beside.x.map(line => line.at), [0, 1000, 500], mode); assert.deepEqual(beside.y.map(line => line.at), [0, 680, 340], mode);
    assert.deepEqual(beside.points, [], mode);
    // A chair travels alone: its room, the camera in that room and the one outside are all targets.
    const inside = planGestureCandidates({ mode, nodeId: chair.id }, plan);
    assert.deepEqual(inside, collectSnapCandidates(plan, new Set([chair.id])), mode);
    assert.deepEqual(inside.x.map(line => line.at), [0, 1000, 100, 250, 400, 200, 500], mode);
    assert.deepEqual(inside.y.map(line => line.at), [0, 680, 100, 200, 300, 150, 340], mode);
    assert.deepEqual(inside.points, nodePlanOutline(room), mode);
    // A locked member stays behind, so its own room may stick to it.
    assert.deepEqual(planGestureCandidates({ mode, nodeId: room.id }, bolted).x.map(line => line.at), [0, 1000, 300, 320, 340, 500], mode);
  }
  const blank: BackgroundSpace = { ...room, id: 'new', name: '새 공간' };
  const none: PlanGesture[] = [{ mode: 'draw', node: blank }, ...[room.id, lens.id, chair.id, lookout.id].map(nodeId => ({ mode: 'rotate' as const, nodeId }))];
  for (const gesture of none) {
    const candidates = planGestureCandidates(gesture, plan), label = JSON.stringify(gesture);
    assert.equal(candidates.x.length, 0, label); assert.equal(candidates.y.length, 0, label); assert.equal(candidates.points.length, 0, label);
  }
});

test('a snapped preview depends on its arguments alone as well', () => {
  const frozen = JSON.stringify(plan), start = { x: 310.5, y: 240.25 }, point = { x: 352, y: 199.75 }, elsewhere = { x: 14.2, y: 633.1 };
  for (const nodeId of [room.id, lens.id, chair.id, lookout.id]) for (const mode of ['move', 'resize', 'rotate'] as const) {
    const gesture: PlanGesture = { mode, nodeId }, snap = snapping(gesture, plan), label = `${mode} ${nodeId}`;
    const first = previewPlanGesture(gesture, plan, start, point, snap);
    assert.ok(first, label);
    // Another position in between leaves no trace, in the result or in the targets.
    previewPlanGesture(gesture, plan, start, elsewhere, snap);
    assert.deepEqual(previewPlanGesture(gesture, plan, start, point, snap), first, label);
    assert.deepEqual(snap, snapping(gesture, plan), label);
    assert.equal(previewPlanGesture({ mode, nodeId: 'missing' }, plan, start, point, snap), null, label);
  }
  assert.equal(JSON.stringify(plan), frozen);
  // A pointer position that is no number cannot be snapped: the move is the free one, with no guide.
  const gesture: PlanGesture = { mode: 'move', nodeId: chair.id }, lost = { x: Number.NaN, y: 199.75 };
  assert.deepEqual(previewPlanGesture(gesture, plan, start, lost, snapping(gesture, plan)), previewPlanGesture(gesture, plan, start, lost, null));
});
