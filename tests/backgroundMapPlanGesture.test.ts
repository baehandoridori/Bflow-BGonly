import test from 'node:test';
import assert from 'node:assert/strict';
import { planGestureCandidates, previewPlanGesture } from '../src/features/backgrounds/mapPlanGesture.ts';
import type { PlanGesture, PlanGestureSnap } from '../src/features/backgrounds/mapPlanGesture.ts';
import { moveMapNode, moveMapNodes, nodeResizeCorner, placeMapNode, replaceMapNode, resizeSpace, transformMapSpace } from '../src/features/backgrounds/mapGeometry.ts';
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

// --- Polygon points ----------------------------------------------------------------------------
type PointGesture = Extract<PlanGesture, { mode: 'vertex' }>;
const xy = (x: number, y: number): BackgroundPoint => ({ x, y });
const sameOutline = (actual: BackgroundPoint[], expected: BackgroundPoint[], label = '') => {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((point, index) => { near(point.x, expected[index].x, `${label} point ${index} x`); near(point.y, expected[index].y, `${label} point ${index} y`); });
};
/** An L-shaped room whose outline runs through CORNERS. */
const yard: BackgroundSpace = { ...room, id: 'yard', name: '마당', x: 100, y: 100, width: 200, height: 200, shape: 'polygon',
  points: [xy(0, 0), xy(0.5, 0), xy(0.5, 0.5), xy(1, 0.5), xy(1, 1), xy(0, 1)] };
const CORNERS = [xy(100, 100), xy(200, 100), xy(200, 200), xy(300, 200), xy(300, 300), xy(100, 300)];
/** Members of the yard, standing inside it. */
const bench: BackgroundSymbol = { ...chair, id: 'bench', name: '벤치', spaceId: 'yard', x: 130, y: 230, width: 40, height: 30 };
const yardLens: BackgroundCamera = { ...lens, id: 'yard-lens', name: '카메라 3', spaceId: 'yard', x: 250, y: 250 };
/** Other spaces: a room with decimal corners and an oval. */
const shed: BackgroundSpace = { ...room, id: 'shed', name: '창고', x: 400.35, y: 100.7, width: 120, height: 80 };
const pond: BackgroundSpace = { ...room, id: 'pond', name: '연못', x: 600, y: 400, width: 100, height: 60, shape: 'ellipse' };
const garden: BackgroundMap = { ...plan, nodes: [yard, bench, yardLens, shed, pond] };
const YARD = 0, OTHERS = [1, 2, 3, 4];
const yardOutline = (map: BackgroundMap) => nodePlanOutline(map.nodes[YARD] as BackgroundSpace);
/** Dragging point `index` of the yard, or the + on the edge from that point to the next. */
const corner = (index: number): PointGesture => ({ mode: 'vertex', nodeId: yard.id, index, insert: false });
const edge = (index: number): PointGesture => ({ mode: 'vertex', nodeId: yard.id, index, insert: true });
/** Where the handle of a gesture stands: on its point, or in the middle of its edge. */
const handleOf = (gesture: PointGesture, initial: BackgroundMap): BackgroundPoint => {
  const outline = yardOutline(initial), from = outline[gesture.index], next = outline[(gesture.index + 1) % outline.length];
  return gesture.insert ? xy((from.x + next.x) / 2, (from.y + next.y) / 2) : from;
};
/** A snapping drag of a handle, from its middle to `to`, with the targets the gesture itself collects. */
const pull = (gesture: PointGesture, to: BackgroundPoint, initial: BackgroundMap = garden) =>
  previewPlanGesture(gesture, initial, handleOf(gesture, initial), to, snapping(gesture, initial));

test('a free point drag moves that one point by as far as the pointer went, and nothing else on the map', () => {
  assert.deepEqual(yardOutline(garden), CORNERS);
  for (const rotation of [0, 37]) {
    const space = { ...yard, rotation }, initial = replaceMapNode(garden, space), before = nodePlanOutline(space), frozen = JSON.stringify(initial);
    for (const index of [0, 3, 5]) {
      // Pressed off the middle of the handle.
      const start = xy(before[index].x + 6, before[index].y + 3), point = xy(start.x + 31.5, start.y - 22.25), label = `point ${index} at ${rotation}`;
      const preview = previewPlanGesture(corner(index), initial, start, point, null);
      assert.ok(preview, label); assert.deepEqual(preview.guides, [], label);
      const shaped = preview.map.nodes[YARD] as BackgroundSpace;
      sameOutline(nodePlanOutline(shaped), before.map((spot, at) => at === index ? xy(spot.x + 31.5, spot.y - 22.25) : spot), label);
      // The turn stays, and so does everything that is not the box or the points.
      assert.equal(shaped.rotation, rotation, label); assert.equal(shaped.points.length, 6, label);
      assert.deepEqual({ ...shaped, x: 0, y: 0, width: 0, height: 0, points: [] }, { ...space, x: 0, y: 0, width: 0, height: 0, points: [] }, label);
      // Members and every other node are the very objects they were: a reshaped space carries nothing along.
      for (const other of OTHERS) assert.equal(preview.map.nodes[other], initial.nodes[other], label);
      assert.deepEqual({ ...preview.map, nodes: [] }, { ...initial, nodes: [] }, label);
      // The first point is a corner of the box. Had that new box gone through the whole-space transform, the bench would have been carried.
      if (index === 0) assert.notDeepEqual(transformMapSpace(initial, shaped).nodes[1], bench, label);
    }
    assert.equal(JSON.stringify(initial), frozen);
  }
});

test('where a point handle was pressed does not enter the result', () => {
  // Point 1 stands on (200, 100). Pressed 6 right of and 3 below its middle, then dragged 10 to the right.
  const nudged = previewPlanGesture(corner(1), garden, xy(206, 103), xy(216, 103), null)!;
  sameOutline(yardOutline(nudged.map), CORNERS.map((spot, at) => at === 1 ? xy(210, 100) : spot));
  // The same travel from any press gives the same map: for a point and for a + on an edge, the closing edge too.
  for (const gesture of [corner(1), corner(5), edge(1), edge(5)]) {
    const label = JSON.stringify(gesture), centred = previewPlanGesture(gesture, garden, xy(200, 100), xy(231, 78), null);
    assert.ok(centred, label);
    assert.deepEqual(previewPlanGesture(gesture, garden, xy(206, 103), xy(237, 81), null), centred, label);
    assert.deepEqual(previewPlanGesture(gesture, garden, xy(-40, 512), xy(-9, 490), null), centred, label);
    // Whatever was previewed in between.
    previewPlanGesture(gesture, garden, xy(206, 103), xy(14.2, 633.1), null);
    assert.deepEqual(previewPlanGesture(gesture, garden, xy(200, 100), xy(231, 78), null), centred, label);
  }
});

test('a point drag that came back to where it was pressed is the map as it was', () => {
  // Also in a turned box of decimals, which does not come back digit for digit when it is rebuilt from its plan points.
  const odd = { x: 244.65, y: 120.3, width: 144.65, height: 80 }, press = xy(206.4, 103.7);
  for (const space of [yard, { ...yard, ...odd }, { ...yard, ...odd, rotation: 37 }]) {
    const initial = replaceMapNode(garden, space);
    for (const index of [0, 1, 2, 3, 4, 5]) {
      const preview = previewPlanGesture(corner(index), initial, press, press, null), label = `point ${index} at ${space.rotation}`;
      // Nothing is left to undo.
      assert.deepEqual(preview, { map: initial, guides: [] }, label); assert.equal(preview!.map.nodes[YARD], space, label);
    }
  }
  // Snapping, a point that stands on whole numbers stays too: (200, 100) is lined up with both points beside it.
  const still = pull(corner(1), CORNERS[1])!;
  assert.deepEqual(still.map, garden);
  assert.deepEqual(still.guides, [{ axis: 'x', at: 200, from: 100, to: 200 }, { axis: 'y', at: 100, from: 100, to: 200 }]);
});

test('dragging a + adds a point after its corner, also on the edge that closes the outline', () => {
  for (const rotation of [0, 37]) {
    const space = { ...yard, rotation }, initial = replaceMapNode(garden, space), before = nodePlanOutline(space);
    for (const index of [0, 1, 4, 5]) {
      const gesture = edge(index), base = handleOf(gesture, initial), label = `edge ${index} at ${rotation}`;
      // Pressed beside the +, which stands in the middle of the edge, and pulled 40 right and 10 down.
      const preview = previewPlanGesture(gesture, initial, xy(base.x + 3, base.y - 2), xy(base.x + 43, base.y + 8), null);
      assert.ok(preview, label); assert.deepEqual(preview.guides, [], label);
      const shaped = preview.map.nodes[YARD] as BackgroundSpace;
      assert.equal(shaped.points.length, 7, label); assert.equal(shaped.rotation, rotation, label);
      // The new point takes the place after its corner: after the last corner that is the end of the list.
      sameOutline(nodePlanOutline(shaped), [...before.slice(0, index + 1), xy(base.x + 40, base.y + 10), ...before.slice(index + 1)], label);
      for (const other of OTHERS) assert.equal(preview.map.nodes[other], initial.nodes[other], label);
    }
  }
  // The edge from the last point (100, 300) back to the first (100, 100): its + stands on (100, 200).
  assert.deepEqual(handleOf(edge(5), garden), xy(100, 200));
  sameOutline(yardOutline(previewPlanGesture(edge(5), garden, xy(100, 200), xy(70, 200), null)!.map), [...CORNERS, xy(70, 200)]);
  // A + that has not travelled yet stands on its edge: nothing moves, and nothing sticks out.
  sameOutline(yardOutline(previewPlanGesture(edge(1), garden, xy(203, 148), xy(203, 148), null)!.map), [...CORNERS.slice(0, 2), xy(200, 150), ...CORNERS.slice(2)]);
});

test('a snapped point sticks to the x and y of the two points beside it', () => {
  // Point 1 is between (100, 100) and (200, 200). Lifted to 3.7 right of the x of the second, far from either y.
  const lifted = pull(corner(1), xy(203.7, 60.4))!;
  sameOutline(yardOutline(lifted.map), CORNERS.map((spot, at) => at === 1 ? xy(200, 60) : spot));
  assert.deepEqual(lifted.guides, [{ axis: 'x', at: 200, from: 60, to: 200 }]);
  // Both at once make the square corner: point 2 comes back to 4.2 and 3.1 from where its two neighbours cross.
  const squared = pull(corner(2), xy(204.2, 196.9))!;
  sameOutline(yardOutline(squared.map), CORNERS);
  assert.deepEqual(squared.guides, [{ axis: 'x', at: 200, from: 100, to: 200 }, { axis: 'y', at: 200, from: 200, to: 300 }]);
  // However far away the point beside it is: point 0 lines up with point 5, 137 further down.
  const aligned = pull(corner(0), xy(97.8, 163.3))!;
  sameOutline(yardOutline(aligned.map), CORNERS.map((spot, at) => at === 0 ? xy(100, 163) : spot));
  assert.deepEqual(aligned.guides, [{ axis: 'x', at: 100, from: 163, to: 300 }]);
  // The points beside a new point are the two ends of its edge: pulled out to the right, level with the upper end (200, 100).
  const added = pull(edge(1), xy(262.6, 102.3))!;
  sameOutline(yardOutline(added.map), [...CORNERS.slice(0, 2), xy(263, 100), ...CORNERS.slice(2)]);
  assert.deepEqual(added.guides, [{ axis: 'y', at: 100, from: 200, to: 263 }]);
  for (const other of OTHERS) for (const preview of [lifted, squared, aligned, added]) assert.equal(preview.map.nodes[other], garden.nodes[other]);
  // Dragged freely the same point keeps its decimals, and no guide shows.
  const free = previewPlanGesture(corner(1), garden, CORNERS[1], xy(203.7, 60.4), null)!;
  sameOutline(yardOutline(free.map), CORNERS.map((spot, at) => at === 1 ? xy(203.7, 60.4) : spot)); assert.deepEqual(free.guides, []);
  // Turned, the points still stick along the screen axes: to the x of the point beside it, as it stands on the plan.
  const tilted = replaceMapNode(garden, { ...yard, rotation: 37 }), before = yardOutline(tilted);
  const level = pull(corner(1), xy(before[2].x + 2.4, before[1].y - 71.3), tilted)!;
  sameOutline(yardOutline(level.map), before.map((spot, at) => at === 1 ? xy(before[2].x, Math.round(before[1].y - 71.3)) : spot));
  assert.deepEqual(level.guides.map(guide => guide.axis), ['x']);
});

test('a snapped point takes the corner of another space as it is', () => {
  const [topLeft] = nodePlanOutline(shed);
  near(topLeft.x, 400.35); near(topLeft.y, 100.7);
  // Point 3 comes 3.6 from that corner.
  const stuck = pull(corner(3), xy(397.7, 103.1))!;
  sameOutline(yardOutline(stuck.map), CORNERS.map((spot, at) => at === 3 ? topLeft : spot));
  // A corner shows as a small cross: two guides without a length.
  assert.deepEqual(stuck.guides, [{ axis: 'x', at: topLeft.x, from: topLeft.y, to: topLeft.y }, { axis: 'y', at: topLeft.y, from: topLeft.x, to: topLeft.x }]);
  for (const other of OTHERS) assert.equal(stuck.map.nodes[other], garden.nodes[other]);
  // A new point takes it as well.
  const added = pull(edge(2), xy(402.1, 98.2))!;
  sameOutline(yardOutline(added.map), [...CORNERS.slice(0, 3), topLeft, ...CORNERS.slice(3)]);
  // More than the tolerance away, the corner is no target: both coordinates become whole numbers.
  const short = pull(corner(3), xy(394.2, 102.4))!;
  sameOutline(yardOutline(short.map), CORNERS.map((spot, at) => at === 3 ? xy(394, 102) : spot)); assert.deepEqual(short.guides, []);
  // Dragged freely nothing sticks.
  const free = previewPlanGesture(corner(3), garden, CORNERS[3], xy(397.7, 103.1), null)!;
  sameOutline(yardOutline(free.map), CORNERS.map((spot, at) => at === 3 ? xy(397.7, 103.1) : spot)); assert.deepEqual(free.guides, []);
});

test('a snapped point sticks to nothing else: it lands on whole numbers and no guide shows', () => {
  const places: [string, number, BackgroundPoint, BackgroundPoint][] = [
    // 2 from the left wall of the shed, 30 and more from its corners.
    ['the middle of an edge of another room', 3, xy(398.4, 131.2), xy(398, 131)],
    ['a centre line of another room', 3, xy(430.6, 142.4), xy(431, 142)],
    ['the box of an oval room', 3, xy(598.3, 398.4), xy(598, 398)],
    ['an edge of a chair inside the polygon', 0, xy(128.3, 231.6), xy(128, 232)],
    ['a centre line of that chair', 0, xy(151.8, 243.4), xy(152, 243)],
    ['a camera inside the polygon', 0, xy(251.7, 248.4), xy(252, 248)],
    ['the border of the plan', 0, xy(2.4, 150.3), xy(2, 150)],
  ];
  // What a move would stick to: every line of the map but those of the yard itself.
  const everything: PlanGestureSnap = { candidates: collectSnapCandidates(garden, new Set([yard.id])), tolerance: 6, reach: 48 };
  for (const [label, index, to, landed] of places) {
    const preview = pull(corner(index), to);
    assert.ok(preview, label); assert.deepEqual(preview.guides, [], label);
    sameOutline(yardOutline(preview.map), CORNERS.map((spot, at) => at === index ? landed : spot), label);
    // Each of these places is on such a line: handed all of them, the same drag does stick.
    assert.notDeepEqual(previewPlanGesture(corner(index), garden, CORNERS[index], to, everything)!.guides, [], label);
  }
});

test('a point drag that cannot be shown gives null', () => {
  // A triangle (500, 400) (600, 400) (550, 450): its apex cannot come closer than 10 to the side across.
  const wedge: BackgroundSpace = { ...yard, id: 'wedge', x: 500, y: 400, width: 100, height: 50, points: [xy(0, 0), xy(1, 0), xy(0.5, 1)] };
  const initial: BackgroundMap = { ...plan, nodes: [wedge, shed] }, apex: PlanGesture = { mode: 'vertex', nodeId: wedge.id, index: 2, insert: false };
  assert.ok(previewPlanGesture(apex, initial, xy(550, 450), xy(550, 410), null));
  assert.equal(previewPlanGesture(apex, initial, xy(550, 450), xy(550, 409.5), null), null);
  // Snapped to whole numbers it lands 9 from that side.
  assert.equal(previewPlanGesture(apex, initial, xy(550, 450), xy(550.2, 409.3), snapping(apex, initial)), null);
  assert.ok(previewPlanGesture(apex, initial, xy(550, 450), xy(550.2, 410.3), snapping(apex, initial)));

  // 2.3 and 2.4 from point 0: the x and the y of that point both take point 1, which would then stand on it.
  assert.equal(pull(corner(1), xy(102.3, 97.6)), null);
  assert.ok(previewPlanGesture(corner(1), garden, CORNERS[1], xy(102.3, 97.6), null));
  // A new point pulled onto an end of its own edge.
  assert.equal(pull(edge(1), xy(203.1, 104.2)), null);
  assert.ok(previewPlanGesture(edge(1), garden, xy(200, 150), xy(203.1, 104.2), null));

  // Only a point of an unlocked polygon can be dragged. What is none has no point beside it either: it collects no line.
  const start = xy(200, 100), point = xy(231, 78), bolted = replaceMapNode(garden, { ...yard, locked: true });
  // Two stored points are no polygon: the plan draws such a space as its box, and the four corners of that box are not its points.
  const stub = replaceMapNode(garden, { ...yard, points: yard.points.slice(0, 2) });
  const pointless = (gesture: PlanGesture, label: string, initial: BackgroundMap = garden) => {
    assert.equal(previewPlanGesture(gesture, initial, start, point, null), null, label);
    assert.equal(previewPlanGesture(gesture, initial, start, point, snapping(gesture, initial)), null, label);
    const candidates = planGestureCandidates(gesture, initial);
    assert.deepEqual([candidates.x, candidates.y], [[], []], label);
  };
  for (const insert of [false, true]) {
    for (const nodeId of [shed.id, pond.id, bench.id, yardLens.id, 'missing']) pointless({ mode: 'vertex', nodeId, index: 0, insert }, nodeId);
    for (const index of [-1, 6, 1.5, Number.NaN]) pointless({ mode: 'vertex', nodeId: yard.id, index, insert }, `index ${index}`);
    const gesture: PlanGesture = { mode: 'vertex', nodeId: yard.id, index: 1, insert };
    assert.ok(previewPlanGesture(gesture, garden, start, point, null));
    assert.equal(planGestureCandidates(gesture, garden).x.length, 2);
    pointless(gesture, 'locked', bolted);
    for (const index of [0, 1, 2, 3]) pointless({ ...gesture, index }, `two points, index ${index}`, stub);
    // A pointer position that is no number.
    assert.equal(previewPlanGesture(gesture, garden, start, xy(Number.NaN, 78), null), null);
    assert.equal(previewPlanGesture(gesture, garden, start, xy(Number.NaN, 78), snapping(gesture, garden)), null);
  }
});

test('a point collects the two points beside it and the corners of the other spaces, and nothing else', () => {
  // Two other rooms (one of them a turned polygon), an oval, and a bench and a camera inside the yard.
  const annex: BackgroundSpace = { ...yard, id: 'annex', name: '별채', x: 600, y: 60, width: 100, height: 50, rotation: 37, points: [xy(0, 0), xy(1, 0), xy(0.5, 1)] };
  const initial: BackgroundMap = { ...garden, nodes: [...garden.nodes, annex] }, corners = [...nodePlanOutline(shed), ...nodePlanOutline(annex)];
  assert.equal(corners.length, 7);
  const lines = (axis: 'x' | 'y', ...points: BackgroundPoint[]) => points.map(point => axis === 'x'
    ? { axis, at: point.x, from: point.y, to: point.y } : { axis, at: point.y, from: point.x, to: point.x });
  const beside: [PointGesture, BackgroundPoint, BackgroundPoint][] = [
    // A point: the one before it and the one after it, around the end of the list as well.
    [corner(1), CORNERS[0], CORNERS[2]], [corner(0), CORNERS[5], CORNERS[1]], [corner(5), CORNERS[4], CORNERS[0]],
    // A +: the two ends of its edge.
    [edge(1), CORNERS[1], CORNERS[2]], [edge(5), CORNERS[5], CORNERS[0]],
  ];
  for (const [gesture, first, second] of beside) {
    const candidates = planGestureCandidates(gesture, initial), label = JSON.stringify(gesture);
    // No border of the plan and no line of another node: each axis has the lines of the two points beside it.
    assert.deepEqual(candidates.x, lines('x', first, second), label); assert.deepEqual(candidates.y, lines('y', first, second), label);
    // Corners of the other rectangles and polygons: not its own, and none for the oval, the bench or the camera.
    assert.deepEqual(candidates.points, corners, label);
  }
  // The same map hands a move of the yard the border and the lines of every node that stays behind.
  const moving = planGestureCandidates({ mode: 'move', nodeId: yard.id }, initial);
  assert.equal(moving.x.length, 2 + 3 + 3 + 1); assert.equal(moving.y.length, 2 + 3 + 3 + 1);
  // Locked members stay behind in a move, but a point never sticks to them.
  const bolted = replaceMapNode(initial, { ...bench, locked: true });
  assert.deepEqual(planGestureCandidates(corner(1), bolted), planGestureCandidates(corner(1), initial));
});

// --- Several nodes moved as one ----------------------------------------------------------------
/** A room whose right edge is the decimal 244.65, a smaller room to its right, and a crate beside that one which belongs to no room. */
const blockA: BackgroundSpace = { ...room, id: 'A', name: '본관', x: 100, y: 100, width: 144.65, height: 80 };
const blockB: BackgroundSpace = { ...room, id: 'B', name: '별관', x: 300.4, y: 120.3, width: 60, height: 40 };
const crate: BackgroundSymbol = { ...chair, id: 'free', name: '상자', spaceId: null, x: 400.5, y: 126.25, width: 30, height: 30 };
/** A chair in room B, which carries it. */
const seatB: BackgroundSymbol = { ...chair, id: 'chairB', spaceId: 'B', x: 310, y: 130, width: 20, height: 20 };
const court: BackgroundMap = { ...plan, nodes: [blockA, blockB, crate] }, seatedCourt: BackgroundMap = { ...plan, nodes: [blockA, blockB, crate, seatB] };
const [BLOCK_A, BLOCK_B, CRATE, SEAT_B] = [0, 1, 2, 3];
/** The room and the crate moved as one, unless other ids are given. */
const group = (nodeId: string, ids: readonly string[] = ['B', 'free']): PlanGesture => ({ mode: 'move-group', nodeId, ids });
/** Where the group is pressed, and where the pointer is after a travel from there. */
const grip = { x: 320, y: 140 };
const hauled = (travel: BackgroundPoint) => add(grip, travel);

test('a free group move is the listed nodes moved together by as far as the pointer went', () => {
  const point = hauled({ x: -52, y: -7.6 }), delta = between(grip, point);
  // Whichever node was pressed, one of the group or not.
  for (const nodeId of ['B', 'free', 'A', 'missing']) {
    assert.deepEqual(previewPlanGesture(group(nodeId), court, grip, point, null), { map: moveMapNodes(court, ['B', 'free'], delta), guides: [] }, nodeId);
  }
  const moved = previewPlanGesture(group('B'), court, grip, point, null)!.map.nodes;
  near(moved[BLOCK_B].x, 248.4, 'room x'); near(moved[BLOCK_B].y, 112.7, 'room y');
  near(moved[CRATE].x, 348.5, 'crate x'); near(moved[CRATE].y, 118.65, 'crate y'); assert.equal(moved[BLOCK_A], blockA);

  // A room and a chair it carries, both listed: the chair goes once, as in the move of the room alone.
  const by = hauled({ x: 10, y: 5 });
  for (const nodeId of ['B', 'chairB']) {
    const preview = previewPlanGesture(group(nodeId, ['B', 'chairB']), seatedCourt, grip, by, null);
    assert.deepEqual(preview, { map: moveMapNode(seatedCourt, 'B', between(grip, by)), guides: [] }, nodeId);
    near(preview!.map.nodes[SEAT_B].x, 320, 'chair x'); near(preview!.map.nodes[SEAT_B].y, 135, 'chair y');
  }
  // Two rooms of one group both go, and the chair of one of them still goes once.
  const pair = previewPlanGesture(group('B', ['A', 'B', 'chairB']), seatedCourt, grip, by, null)!;
  assert.deepEqual(pair, { map: moveMapNode(moveMapNode(seatedCourt, 'A', between(grip, by)), 'B', between(grip, by)), guides: [] });
  assert.deepEqual(pair.map.nodes[BLOCK_A], { ...blockA, x: 110, y: 105 }); near(pair.map.nodes[BLOCK_B].x, 310.4, 'second room x'); near(pair.map.nodes[BLOCK_B].y, 125.3, 'second room y');
  near(pair.map.nodes[SEAT_B].x, 320, 'chair x'); near(pair.map.nodes[SEAT_B].y, 135, 'chair y'); assert.equal(pair.map.nodes[CRATE], crate);
});

test('a snapped group move sticks by the box around the group, and the group keeps its own distances', () => {
  const point = hauled({ x: -52, y: -7.6 });
  assert.equal(blockA.x + blockA.width, 244.65);
  // Pressed on the room. The left end of the box around both comes 3.75 from the right edge of A and takes its very
  // value; the axis that stuck to nothing makes the stored value of the pressed node a whole number.
  const byRoom = snapped(group('B'), court, grip, point);
  assert.equal(byRoom.map.nodes[BLOCK_B].x, 244.65); assert.equal(byRoom.map.nodes[BLOCK_B].y, 113);
  // The crate goes as far as the room went: it is not made a whole number of its own.
  near(byRoom.map.nodes[CRATE].x, 344.75, 'crate x'); near(byRoom.map.nodes[CRATE].y, 118.95, 'crate y');
  assert.deepEqual(byRoom.guides, [{ axis: 'x', at: 244.65, from: 100, to: 180 }]);
  assert.equal(byRoom.map.nodes[BLOCK_A], blockA);
  // Pressed on the crate, the same edge sticks and the whole number is that of the crate.
  const byCrate = snapped(group('free'), court, grip, point);
  near(byCrate.map.nodes[CRATE].x, 344.75, 'pressed crate x'); assert.equal(byCrate.map.nodes[CRATE].y, 119);
  near(byCrate.map.nodes[BLOCK_B].x, 244.65, 'room x'); near(byCrate.map.nodes[BLOCK_B].y, 113.05, 'room y');
  assert.deepEqual(byCrate.guides, [{ axis: 'x', at: 244.65, from: 100, to: 180 }]);
  // Either way the two are as far apart as they were.
  for (const { map } of [byRoom, byCrate]) {
    near(map.nodes[CRATE].x - map.nodes[BLOCK_B].x, crate.x - blockB.x, 'gap x'); near(map.nodes[CRATE].y - map.nodes[BLOCK_B].y, crate.y - blockB.y, 'gap y');
  }
  // Nothing near: the stored position of the pressed node is made of whole numbers, and no guide shows.
  const away = snapped(group('B'), court, grip, hauled({ x: 200.3, y: 300.3 }));
  assert.equal(away.map.nodes[BLOCK_B].x, 501); assert.equal(away.map.nodes[BLOCK_B].y, 421); assert.deepEqual(away.guides, []);
  near(away.map.nodes[CRATE].x, 601.1, 'far crate x'); near(away.map.nodes[CRATE].y, 426.95, 'far crate y');

  // The snapped position of the pressed node is stored as it is. Reached by adding the travel, a drag from far away would miss the last digit.
  const farRoom: BackgroundSpace = { ...blockB, x: 512.7, y: 420.3 }, farCrate: BackgroundSymbol = { ...crate, x: 612.8, y: 426.25 };
  assert.notEqual(farRoom.x + (244.65 - farRoom.x), 244.65);
  const far = snapped(group('B'), { ...court, nodes: [blockA, farRoom, farCrate] }, grip, hauled({ x: -264.3, y: -307.6 }));
  assert.equal(far.map.nodes[BLOCK_B].x, 244.65); assert.equal(far.map.nodes[BLOCK_B].y, 113);
  near(far.map.nodes[CRATE].x, 344.75, 'brought crate x'); near(far.map.nodes[CRATE].y, 118.95, 'brought crate y');
  assert.deepEqual(far.guides, [{ axis: 'x', at: 244.65, from: 100, to: 180 }]);
});

test('a snapped group move is measured from the pressed node, or from the room that carries it', () => {
  const point = hauled({ x: -52, y: -7.6 });
  // Pressed on the chair, which its room carries: the stored position of the room is what sticks and what becomes a
  // whole number. Measured from the chair, the whole number would be the y of the chair (122) and the room would stand on 112.3.
  const preview = snapped(group('chairB', ['B', 'chairB']), seatedCourt, grip, point), moved = preview.map.nodes;
  assert.equal(moved[BLOCK_B].x, 244.65); assert.equal(moved[BLOCK_B].y, 113);
  near(moved[SEAT_B].x, 254.25, 'chair x'); near(moved[SEAT_B].y, 122.7, 'chair y');
  assert.deepEqual(preview.guides, [{ axis: 'x', at: 244.65, from: 100, to: 180 }]);
  assert.equal(moved[BLOCK_A], blockA); assert.equal(moved[CRATE], crate);
  assert.deepEqual(preview, snapped(group('B', ['B', 'chairB']), seatedCourt, grip, point));
  // Locked, the room stays and carries nothing: the chair is measured from itself, and sticks to the top of its own room.
  const held = replaceMapNode(seatedCourt, { ...blockB, locked: true });
  const alone = snapped(group('chairB', ['B', 'chairB']), held, grip, point);
  assert.equal(alone.map.nodes[SEAT_B].x, 258); assert.equal(alone.map.nodes[SEAT_B].y, 120.3);
  assert.deepEqual(alone.guides, [{ axis: 'y', at: 120.3, from: 258, to: 360.4 }]);
  assert.equal(alone.map.nodes[BLOCK_B], held.nodes[BLOCK_B]);
  assert.deepEqual(alone, snapped({ mode: 'move', nodeId: 'chairB' }, held, grip, point));
  // Left out of the group, the room stays too, although it is not locked: the chair is measured from itself again,
  // and the top of the box around chair and crate sticks to the top of that room. Measured from the room, which
  // does not move, nothing could stick: the chair would stand on 122.4 with no guide.
  const loose = snapped(group('chairB', ['chairB', 'free']), seatedCourt, grip, point);
  assert.equal(loose.map.nodes[SEAT_B].x, 258); assert.equal(loose.map.nodes[SEAT_B].y, 124.05);
  near(loose.map.nodes[CRATE].x, 348.5, 'crate x'); near(loose.map.nodes[CRATE].y, 120.3, 'crate y');
  assert.deepEqual(loose.guides, [{ axis: 'y', at: 120.3, from: 258, to: 378.5 }]);
  assert.equal(loose.map.nodes[BLOCK_B], blockB); assert.equal(loose.map.nodes[BLOCK_A], blockA);
  // A pressed node that does not move is no anchor: the first moving node in map order is, however the ids are listed.
  for (const nodeId of ['A', 'missing']) {
    assert.deepEqual(snapped(group(nodeId, ['free', 'B']), court, grip, point), snapped(group('B'), court, grip, point), nodeId);
  }
  // That first node may be a chair stored before the room that carries it: the room is what the move is measured from
  // then as well. Measured from the chair, the whole number would be the y of the chair (123) with the room on 112.75,
  // and the edge of the room, reached by adding the travel, would miss the last digit of 244.65.
  const farRoom: BackgroundSpace = { ...blockB, x: 512.7, y: 420.3 }, farSeat: BackgroundSymbol = { ...seatB, x: 522.7, y: 430.55 };
  const early: BackgroundMap = { ...court, nodes: [blockA, farSeat, farRoom] }, brought = hauled({ x: -264.3, y: -307.6 });
  for (const nodeId of ['A', 'missing', 'chairB', 'B']) {
    const landed = snapped(group(nodeId, ['B', 'chairB']), early, grip, brought);
    assert.equal(landed.map.nodes[2].x, 244.65, nodeId); assert.equal(landed.map.nodes[2].y, 113, nodeId);
    near(landed.map.nodes[1].x, 254.65, `${nodeId} chair x`); near(landed.map.nodes[1].y, 123.25, `${nodeId} chair y`);
    assert.deepEqual(landed.guides, [{ axis: 'x', at: 244.65, from: 100, to: 180 }], nodeId);
  }
});

test('a group move collects everything that is neither in the group nor travels with it', () => {
  const candidates = planGestureCandidates(group('B'), court);
  assert.deepEqual(candidates, collectSnapCandidates(court, new Set(['B', 'free'])));
  // The border of the plan and room A: the room and the crate that move offer no line.
  assert.deepEqual(candidates.x.map(line => line.at), [0, 1000, 100, 172.325, 244.65]);
  assert.deepEqual(candidates.y.map(line => line.at), [0, 680, 100, 140, 180]);
  assert.deepEqual(candidates.points, nodePlanOutline(blockA));
  // Which node was pressed does not enter.
  for (const nodeId of ['free', 'missing']) assert.deepEqual(planGestureCandidates(group(nodeId), court), candidates, nodeId);
  // A chair the room carries travels along, listed or not.
  for (const ids of [['B', 'free'], ['B', 'free', 'chairB']]) assert.deepEqual(planGestureCandidates(group('B', ids), seatedCourt), candidates, ids.join());

  // Locked, a listed node stays where it is, and the rest of the group may stick to it.
  const bolted = replaceMapNode(court, { ...crate, locked: true }), beside = planGestureCandidates(group('B'), bolted);
  assert.deepEqual(beside, collectSnapCandidates(bolted, new Set(['B'])));
  assert.deepEqual(beside.x.map(line => line.at), [0, 1000, 100, 172.325, 244.65, 400.5, 415.5, 430.5]);
  // A locked room in the group carries nothing: the room and its chair are both targets of the crate.
  const held = replaceMapNode(seatedCourt, { ...blockB, locked: true });
  assert.deepEqual(planGestureCandidates(group('free'), held), collectSnapCandidates(held, new Set(['free'])));
  assert.equal(planGestureCandidates(group('free'), held).x.length, 2 + 3 + 3 + 3);
});

test('a group move leaves its locked nodes where they are, and a group that cannot move is the map as it was', () => {
  const point = hauled({ x: -52, y: -7.6 });
  // The crate is locked: it stays the very object, and the room moves as it would alone.
  const bolted = replaceMapNode(court, { ...crate, locked: true });
  for (const nodeId of ['B', 'free']) {
    const stuck = snapped(group(nodeId), bolted, grip, point);
    assert.deepEqual(stuck, snapped({ mode: 'move', nodeId: 'B' }, bolted, grip, point), nodeId);
    assert.equal(stuck.map.nodes[BLOCK_B].x, 244.65, nodeId); assert.equal(stuck.map.nodes[BLOCK_B].y, 113, nodeId);
    assert.equal(stuck.map.nodes[CRATE], bolted.nodes[CRATE], nodeId);
    const free = previewPlanGesture(group(nodeId), bolted, grip, point, null)!;
    assert.deepEqual(free, { map: moveMapNode(bolted, 'B', between(grip, point)), guides: [] }, nodeId);
    assert.equal(free.map.nodes[CRATE], bolted.nodes[CRATE], nodeId);
  }
  // Nothing in the group can move: locked nodes alone, ids that are not on the map, or none at all.
  const fixed: BackgroundMap = { ...court, nodes: court.nodes.map(node => ({ ...node, locked: true })) };
  const still: [BackgroundMap, string[]][] = [[fixed, ['B', 'free']], [court, ['missing']], [court, []]];
  for (const [initial, ids] of still) for (const nodeId of ['B', 'missing']) {
    const gesture = group(nodeId, ids), label = `${nodeId} of ${ids.join()}`;
    for (const snap of [null, snapping(gesture, initial)]) {
      const preview = previewPlanGesture(gesture, initial, grip, point, snap);
      assert.ok(preview, label); assert.equal(preview.map, initial, label); assert.deepEqual(preview.guides, [], label);
    }
  }
});

test('a group preview depends on its arguments alone and leaves the map as it was', () => {
  const frozen = JSON.stringify(seatedCourt), point = hauled({ x: -52, y: -7.6 }), elsewhere = { x: 14.2, y: 633.1 };
  for (const gesture of [group('B'), group('free'), group('chairB', ['B', 'chairB']), group('B', ['chairB', 'free', 'B'])]) {
    for (const snap of [null, snapping(gesture, seatedCourt)]) {
      const label = `${JSON.stringify(gesture)} ${snap ? 'snapped' : 'free'}`, first = previewPlanGesture(gesture, seatedCourt, grip, point, snap);
      assert.ok(first, label);
      assert.deepEqual(previewPlanGesture(gesture, seatedCourt, grip, point, snap), first, label);
      // Another position in between leaves no trace, in the result or in the targets.
      previewPlanGesture(gesture, seatedCourt, grip, elsewhere, snap);
      assert.deepEqual(previewPlanGesture(gesture, seatedCourt, grip, point, snap), first, label);
      if (snap) assert.deepEqual(snap, snapping(gesture, seatedCourt), label);
    }
  }
  assert.equal(JSON.stringify(seatedCourt), frozen);
  // A pointer position that is no number cannot be snapped: the move is the free one, with no guide.
  const gesture = group('B'), lost = { x: Number.NaN, y: 132.4 };
  assert.deepEqual(previewPlanGesture(gesture, court, grip, lost, snapping(gesture, court)), previewPlanGesture(gesture, court, grip, lost, null));
});
