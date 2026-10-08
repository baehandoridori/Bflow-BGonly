import test from 'node:test';
import assert from 'node:assert/strict';
import { previewPlanGesture } from '../src/features/backgrounds/mapPlanGesture.ts';
import type { PlanGesture } from '../src/features/backgrounds/mapPlanGesture.ts';
import { moveMapNode, nodeResizeCorner, replaceMapNode, resizeSpace, transformMapSpace } from '../src/features/backgrounds/mapGeometry.ts';
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
