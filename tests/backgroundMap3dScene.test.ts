import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Object3D, PerspectiveCamera, Raycaster, Texture, TextureLoader, Vector3 } from 'three';
import type { BufferGeometry, Material, Mesh } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { MAP3D_DARK_PALETTE, MAP3D_VIEW_FOV, Map3DScene, fitMapView, mapWorldBounds, pickMapFloor, pickMapNode, resolveMapClick, topDownMapView } from '../src/features/backgrounds/map3dScene.ts';
import type { MapPickHit } from '../src/features/backgrounds/map3dScene.ts';
import { MAP_GIZMO_COLORS, MAP_GIZMO_SHAPE, mapGizmoSize, MapNodeGizmo, mapGizmoSetup, previewMapFromRoot, rootWorldPose, styleMapGizmo } from '../src/features/backgrounds/BackgroundMapCameraGizmo.ts';
import type { Map3DProps, Map3DViewState } from '../src/features/backgrounds/mapCanvas.ts';
import { createMapDocumentStore, mapDraft, mapViewport } from '../src/features/backgrounds/mapDocument.ts';
import { beginMapGesture, finishMapGesture, previewMapGesture } from '../src/features/backgrounds/mapEditSession.ts';
import type { MapGesture } from '../src/features/backgrounds/mapEditSession.ts';
import { addMapCamera } from '../src/features/backgrounds/mapGeometry.ts';
import { planCameraGlyph, planCameraReadout, planReadoutText } from '../src/features/backgrounds/mapPlanPreview.ts';
import { DEFAULT_MAP_CAMERA_POSE, SYMBOL_VOLUME_HEIGHTS, cameraOrientation, cameraPitchLabel, nodePlanOutline, nodeWorldPose, verticalFov } from '../src/features/backgrounds/mapSpatial.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const near = (actual: number, expected: number, label = '', tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} != ${expected}`);
const nearVec = (actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }, label = '', tolerance = 1e-6) => {
  for (const axis of ['x', 'y', 'z'] as const) near(actual[axis], expected[axis], `${label} ${axis}:`, tolerance);
};
// Identity checks on three.js objects go through booleans: a failing assert.equal would print whole object graphs.
const same = (actual: unknown, expected: unknown, label: string) => assert.ok(actual === expected, label);
const sameList = (actual: readonly unknown[], expected: readonly unknown[] | undefined) =>
  !!expected && actual.length === expected.length && actual.every((item, index) => item === expected[index]);
const planRotate = (point: BackgroundPoint, degrees: number): BackgroundPoint => {
  const radians = degrees * Math.PI / 180;
  return { x: point.x * Math.cos(radians) - point.y * Math.sin(radians), y: point.x * Math.sin(radians) + point.y * Math.cos(radians) };
};

const space = (index: number, changes: Partial<BackgroundSpace> = {}): BackgroundSpace => ({
  id: id(index), type: 'space', name: `공간 ${index}`, placeId: null, childMapId: null, x: 100, y: 80, width: 300, height: 200, rotation: 0,
  shape: 'rect', points: [], locked: false, ...changes,
});
const symbol = (index: number, kind: BackgroundSymbol['symbol'], changes: Partial<BackgroundSymbol> = {}): BackgroundSymbol => ({
  id: id(index), type: 'symbol', name: `사물 ${index}`, symbol: kind, spaceId: null, x: 130, y: 200, width: 60, height: 60, rotation: 0,
  locked: false, hinge: 'left', swing: 'inward', ...changes,
});
const camera = (index: number, changes: Partial<BackgroundCamera> = {}): BackgroundCamera => ({
  id: id(index), type: 'camera', name: `카메라 ${index}`, spaceId: null, x: 250, y: 180, angle: 0, fov: 60, viewIds: [], locked: false, ...changes,
});
const mapOf = (nodes: BackgroundNode[]): BackgroundMap => ({ id: id(900), revision: 3, name: '교실', parentId: null, placeId: null, imageUrl: '', nodes });

const tiltedRect = space(1, { x: 100, y: 80, width: 300, height: 200, rotation: 30, elevation: 15, volumeHeight: 140 });
const ellipse = space(2, { x: 520, y: 60, width: 240, height: 160, shape: 'ellipse', rotation: 20, elevation: 40 });
const polygon = space(3, { x: 560, y: 320, width: 260, height: 220, rotation: 75, shape: 'polygon', locked: true,
  points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.4 }, { x: 0.4, y: 0.4 }, { x: 0.4, y: 1 }, { x: 0, y: 1 }] });
const tiltedTable = symbol(10, 'table', { x: 420, y: 300, width: 180, height: 110, rotation: 40, pitch: 20, roll: -15, elevation: 12, volumeHeight: 70, spaceId: tiltedRect.id });
const legacyCamera = camera(20, { x: 250, y: 180, angle: 135, spaceId: tiltedRect.id });
const tiltedCamera = camera(21, { x: 610, y: 140, angle: 250, elevation: 210, pitch: -35, roll: 12, aspect: 2, fov: 80, spaceId: ellipse.id });
const everything = mapOf([tiltedRect, ellipse, polygon, tiltedTable, symbol(11, 'door'), symbol(12, 'chair'), symbol(13, 'bed', { width: 130, height: 210 }),
  symbol(14, 'custom', { width: 100, height: 80 }), symbol(15, 'sofa'), legacyCamera, tiltedCamera]);

function worldPoints(object: Object3D): Vector3[] {
  object.updateWorldMatrix(true, false);
  const attribute = (object as Mesh).geometry.getAttribute('position'), points: Vector3[] = [];
  for (let index = 0; index < attribute.count; index++) points.push(new Vector3().fromBufferAttribute(attribute, index).applyMatrix4(object.matrixWorld));
  return points;
}
function named(root: Object3D, name: string): Object3D {
  const found = root.getObjectByName(name);
  assert.ok(found, `missing part ${name}`);
  return found;
}
const rootOf = (scene: Map3DScene, node: BackgroundNode): Object3D => {
  const root = scene.root(node.id);
  assert.ok(root, `missing root of ${node.name}`);
  return root;
};
function cast(scene: Map3DScene, origin: [number, number, number], direction: [number, number, number]): MapPickHit[] {
  scene.scene.updateMatrixWorld(true);
  return new Raycaster(new Vector3(...origin), new Vector3(...direction).normalize()).intersectObjects(scene.pickTargets(), false);
}
function resources(scene: Map3DScene): { geometries: Set<BufferGeometry>; materials: Set<Material> } {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
  scene.scene.traverse(object => {
    const drawable = object as Partial<Mesh>;
    if (drawable.geometry) geometries.add(drawable.geometry);
    if (drawable.material) for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) materials.add(material);
  });
  return { geometries, materials };
}

test('every node root sits exactly at nodeWorldPose and is tagged with its node', () => {
  const scene = new Map3DScene();
  scene.sync(everything, null);
  for (const node of everything.nodes) {
    const root = rootOf(scene, node), pose = nodeWorldPose(node);
    nearVec(root.position, pose.position, node.name);
    for (const axis of ['x', 'y', 'z', 'w'] as const) near(root.quaternion[axis], pose.quaternion[axis], `${node.name} q.${axis}`);
    assert.deepEqual(root.scale.toArray(), [1, 1, 1]);
    assert.equal(root.userData.nodeId, node.id);
    assert.equal(root.userData.nodeKind, node.type);
  }
  // Independent of nodeWorldPose: base centre, plan turn as a turn of -r about +Y, height on +Y only.
  const rectRoot = rootOf(scene, tiltedRect);
  scene.scene.updateMatrixWorld(true);
  nearVec(rectRoot.position, { x: 250, y: 15, z: 180 }, 'rect base centre');
  const corner = planRotate({ x: 150, y: 100 }, 30);
  nearVec(rectRoot.localToWorld(new Vector3(150, 0, 100)), { x: 250 + corner.x, y: 15, z: 180 + corner.y }, 'rect corner');
  nearVec(rectRoot.localToWorld(new Vector3(0, 140, 0)), { x: 250, y: 155, z: 180 }, 'rect top centre');
  // A camera with no stored height reads at the default lens height and looks along its plan angle.
  const lens = rootOf(scene, legacyCamera);
  nearVec(lens.position, { x: 250, y: 120, z: 180 }, 'legacy lens');
  nearVec(new Vector3(0, 0, -1).applyQuaternion(lens.quaternion), { x: Math.cos(135 * Math.PI / 180), y: 0, z: Math.sin(135 * Math.PI / 180) }, 'legacy sight');
  const tilted = rootOf(scene, tiltedCamera), sight = new Vector3(0, 0, -1).applyQuaternion(tilted.quaternion);
  near(sight.y, Math.sin(-35 * Math.PI / 180), 'tilted camera looks down');
  nearVec(tilted.position, { x: 610, y: 210, z: 140 }, 'tilted lens');
  scene.dispose();
});

test('space boxes follow the real outline of rectangles, ellipses and polygons', () => {
  const scene = new Map3DScene();
  scene.sync(everything, null);
  for (const node of [tiltedRect, ellipse, polygon]) {
    const root = rootOf(scene, node), base = node.elevation ?? 0, top = base + (node.volumeHeight ?? 180);
    const outline = nodePlanOutline(node), walls = worldPoints(named(root, 'space-walls'));
    assert.equal(outline.length, node.shape === 'ellipse' ? 48 : node.shape === 'polygon' ? 6 : 4);
    for (const point of walls) {
      assert.ok(Math.abs(point.y - base) < 1e-3 || Math.abs(point.y - top) < 1e-3, `${node.name} wall vertex at ${point.y}`);
      assert.ok(outline.some(corner => Math.hypot(corner.x - point.x, corner.y - point.z) < 1e-3), `${node.name} wall vertex off the outline`);
    }
    for (const corner of outline) for (const level of [base, top]) {
      assert.ok(walls.some(point => Math.hypot(corner.x - point.x, corner.y - point.z) < 1e-3 && Math.abs(point.y - level) < 1e-3), `${node.name} outline corner without a wall`);
    }
    // No ceiling: the floor fill stays on the floor level, so things inside stay visible and clickable.
    for (const point of worldPoints(named(root, 'space-floor'))) near(point.y, base, `${node.name} floor`, 1e-3);
    for (const point of worldPoints(named(root, 'space-outline'))) assert.ok(point.y > base - 1e-3 && point.y < top + 1e-3);
  }
  // The plan depth (`height`) is never the vertical size.
  const flat = space(4, { width: 200, height: 900 });
  scene.sync(mapOf([flat]), null);
  near(Math.max(...worldPoints(named(rootOf(scene, flat), 'space-walls')).map(point => point.y)), 180, 'default box height');
  scene.dispose();
});

test('a selected space is stronger and a locked one is dashed', () => {
  const scene = new Map3DScene();
  const open = space(1), locked = space(2, { x: 500, locked: true });
  const material = (node: BackgroundSpace, name: string) => (named(rootOf(scene, node), name) as Mesh).material as Material & { isLineDashedMaterial?: boolean };
  scene.sync(mapOf([open, locked]), null);
  const quietWall = material(open, 'space-walls').opacity, quietLine = material(open, 'space-outline').opacity, quietFloor = material(open, 'space-floor').opacity;
  assert.ok(!material(open, 'space-outline').isLineDashedMaterial);
  assert.equal(material(locked, 'space-outline').isLineDashedMaterial, true);
  assert.ok((named(rootOf(scene, locked), 'space-outline') as Mesh).geometry.getAttribute('lineDistance'), 'dashes need line distances');
  scene.sync(mapOf([open, locked]), open.id);
  assert.ok(material(open, 'space-walls').opacity > quietWall * 1.5);
  assert.ok(material(open, 'space-floor').opacity > quietFloor * 1.5);
  assert.ok(material(open, 'space-outline').opacity > quietLine);
  assert.equal(material(locked, 'space-walls').opacity, quietWall);
  scene.sync(mapOf([open, locked]), locked.id);
  assert.equal(material(locked, 'space-outline').isLineDashedMaterial, true);
  assert.equal(material(locked, 'space-outline').opacity, 1);
  scene.dispose();
});

test('membership never nests objects: members stay in absolute map coordinates', () => {
  const scene = new Map3DScene();
  scene.sync(everything, null);
  scene.scene.updateMatrixWorld(true);
  const parent = rootOf(scene, tiltedRect).parent;
  assert.ok(parent);
  for (const node of everything.nodes) {
    const root = rootOf(scene, node);
    same(root.parent, parent, `${node.name} must be a sibling of every other root`);
    nearVec(root.getWorldPosition(new Vector3()), nodeWorldPose(node).position, `${node.name} world position`);
  }
  // The group that holds the roots has no transform of its own, so a root's transform is its world pose.
  assert.deepEqual(parent.matrixWorld.toArray(), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  scene.dispose();
});

test('symbols are simple solids sized by width, volume height and plan depth', () => {
  const scene = new Map3DScene();
  const parts: Record<string, string[]> = {
    door: ['door-leaf', 'door-sill', 'door-swing'], chair: ['chair-seat', 'chair-back', 'chair-leg'], table: ['table-top', 'table-leg'],
    bed: ['bed-mattress', 'bed-headboard', 'bed-pillow'], custom: ['object-fill', 'object-outline'],
  };
  for (const kind of ['door', 'chair', 'table', 'bed', 'custom', 'desk', 'sofa', 'cabinet', 'plant'] as const) {
    const node = symbol(30, kind, { width: 120, height: 90 });
    scene.sync(mapOf([node]), null);
    const root = rootOf(scene, node), body = named(root, 'symbol-body');
    assert.deepEqual(body.scale.toArray(), [120, SYMBOL_VOLUME_HEIGHTS[kind], 90], `${kind} body size`);
    for (const name of parts[kind] ?? parts.custom) named(root, name);
    assert.equal(named(root, 'symbol-proxy').userData.nodeId, node.id);
  }
  assert.ok(!rootOf(scene, symbol(30, 'plant')).getObjectByName('table-top'), 'a removed kind renders as the generic object');
  // Stored volume height wins over the kind default; the pillow end of a bed is the plan top (-Z).
  const bed = symbol(31, 'bed', { x: 0, y: 0, width: 130, height: 210, volumeHeight: 50 });
  scene.sync(mapOf([bed]), null);
  assert.deepEqual(named(rootOf(scene, bed), 'symbol-body').scale.toArray(), [130, 50, 210]);
  assert.ok(named(rootOf(scene, bed), 'bed-headboard').getWorldPosition(new Vector3()).z < 105 - 60);
  // Doors keep hinge and swing like the plan glyph.
  const sides = (hinge: 'left' | 'right', swing: 'inward' | 'outward') => {
    const door = symbol(32, 'door', { x: 150, y: 100, width: 100, height: 100, hinge, swing });
    scene.sync(mapOf([door]), null);
    const root = rootOf(scene, door), arc = worldPoints(named(root, 'door-swing'));
    return { leaf: named(root, 'door-leaf').getWorldPosition(new Vector3()), sill: named(root, 'door-sill').getWorldPosition(new Vector3()), middle: arc[Math.floor(arc.length / 2)] };
  };
  const leftIn = sides('left', 'inward'), rightIn = sides('right', 'inward'), leftOut = sides('left', 'outward');
  near(leftIn.leaf.x, 158, 'left hinge leaf', 1e-6); near(rightIn.leaf.x, 242, 'right hinge leaf', 1e-6);
  near(leftIn.sill.z, 192, 'inward doorway', 1e-6); near(leftOut.sill.z, 108, 'outward doorway', 1e-6);
  assert.ok(leftIn.middle.z < 150 && leftOut.middle.z > 150, 'the swing arc opens away from the doorway');
  assert.ok(leftIn.middle.x > 150 && rightIn.middle.x < 250);
  // A selected symbol gets a visible outline and its name.
  const chair = symbol(33, 'chair');
  scene.sync(mapOf([chair]), null);
  assert.ok(!rootOf(scene, chair).getObjectByName('selection-outline'), 'no outline before selection');
  scene.sync(mapOf([chair]), chair.id);
  named(rootOf(scene, chair), 'selection-outline');
  scene.dispose();
});

test('placed cameras show sight, frame shape, and a drop line to the floor', () => {
  const scene = new Map3DScene();
  scene.sync(everything, null);
  for (const node of [legacyCamera, tiltedCamera]) {
    const root = rootOf(scene, node), aspect = node.aspect ?? 16 / 9, height = node.elevation ?? 120;
    const frame = (named(root, 'camera-frame') as Mesh).geometry.getAttribute('position');
    let halfWidth = 0, halfHeight = 0, reach = 0;
    for (let index = 0; index < frame.count; index++) {
      halfWidth = Math.max(halfWidth, Math.abs(frame.getX(index))); halfHeight = Math.max(halfHeight, Math.abs(frame.getY(index))); reach = Math.max(reach, -frame.getZ(index));
    }
    assert.ok(reach > 0, 'the frame is in front of the lens (-Z)');
    near(halfWidth / reach, Math.tan(node.fov * Math.PI / 360), `${node.name} horizontal fov`, 1e-5);
    near(halfHeight / reach, Math.tan(verticalFov(node.fov, aspect) * Math.PI / 360), `${node.name} vertical fov`, 1e-5);
    near(halfWidth / halfHeight, aspect, `${node.name} aspect`, 1e-4);
    scene.scene.updateMatrixWorld(true);
    const drop = named(scene.scene, 'map-companions').children.map(child => child.getObjectByName('camera-drop')).filter((item): item is Object3D => !!item)
      .find(item => Math.abs(item.getWorldPosition(new Vector3()).x - node.x) < 1e-6 && Math.abs(item.getWorldPosition(new Vector3()).z - node.y) < 1e-6);
    assert.ok(drop, `${node.name} drop line`);
    nearVec(drop.localToWorld(new Vector3(0, 0, 0)), { x: node.x, y: 0, z: node.y }, 'drop line foot');
    nearVec(drop.localToWorld(new Vector3(0, 1, 0)), { x: node.x, y: height, z: node.y }, 'drop line top');
    assert.equal(named(root, 'camera-proxy').userData.nodeKind, 'camera');
  }
  scene.dispose();
});

test('a camera looking straight up or down keeps a finite orientation', () => {
  const scene = new Map3DScene();
  const up = camera(40, { x: 300, y: 300, angle: 70, pitch: 90, elevation: 0 }), down = camera(41, { x: 400, y: 300, angle: 200, pitch: -90, roll: 30, elevation: 260 });
  const almost = camera(42, { x: 500, y: 300, angle: 10, pitch: 89.9996 });
  scene.sync(mapOf([up, down, almost]), down.id);
  scene.scene.updateMatrixWorld(true);
  for (const [node, vertical] of [[up, 1], [down, -1], [almost, 1]] as const) {
    const root = rootOf(scene, node);
    assert.ok(root.visible);
    for (const value of [...root.quaternion.toArray(), ...root.matrixWorld.toArray()]) assert.ok(Number.isFinite(value), `${node.name} has a non-finite transform`);
    near(root.quaternion.length(), 1, `${node.name} unit quaternion`);
    nearVec(new Vector3(0, 0, -1).applyQuaternion(root.quaternion), { x: 0, y: vertical, z: 0 }, `${node.name} sight`, 1e-5);
    root.traverse(object => {
      const geometry = (object as Partial<Mesh>).geometry;
      if (geometry) for (const value of geometry.getAttribute('position').array) assert.ok(Number.isFinite(value));
    });
    // The lens can still be clicked from the side.
    assert.equal(pickMapNode(cast(scene, [node.x, (node.elevation ?? 120) + 4, 900], [0, 0, -1])), node.id);
  }
  scene.dispose();
});

test('picking prefers cameras and symbols; walls never swallow a click', () => {
  const room = space(1), inside = camera(20, { x: 250, y: 180, spaceId: room.id }), behind = camera(21, { x: 330, y: 20 });
  const chair = symbol(12, 'chair', { x: 130, y: 200, spaceId: room.id });
  const map = mapOf([room, chair, inside, behind]);
  const scene = new Map3DScene();
  scene.sync(map, null);

  // From outside, through the front wall, to the camera inside the room.
  const through = cast(scene, [250, 120, 700], [0, 0, -1]);
  assert.equal(through[0].object.userData.nodeKind, 'space', 'the wall is hit first');
  assert.ok(through.some(hit => hit.object.userData.nodeId === inside.id));
  assert.equal(pickMapNode(through), inside.id);
  // A camera behind the whole box: two walls are nearer than it.
  const past = cast(scene, [330, 120, 700], [0, 0, -1]);
  assert.ok(past.filter(hit => hit.object.userData.nodeKind === 'space').length >= 2);
  assert.ok(past.every(hit => hit.object.userData.nodeId !== inside.id));
  assert.equal(pickMapNode(past), behind.id);
  // Only the box under the pointer: the space itself.
  assert.equal(pickMapNode(cast(scene, [150, 120, 700], [0, 0, -1])), room.id);
  // From above: the chair wins over the floor of its room, and the bare floor selects the room.
  const above = cast(scene, [160, 600, 230], [0, -1, 0]);
  assert.ok(above.some(hit => hit.object.userData.nodeId === room.id));
  assert.equal(pickMapNode(above), chair.id);
  assert.equal(pickMapNode(cast(scene, [350, 600, 250], [0, -1, 0])), room.id);
  // Nothing under the pointer, and the base floor is not a node.
  assert.equal(pickMapNode(cast(scene, [250, 500, 180], [0, 1, 0])), null);
  assert.equal(pickMapNode(cast(scene, [900, 600, 600], [0, -1, 0])), null);

  // The rule itself, whatever order the hits arrive in.
  const hit = (nodeId: string, nodeKind: string, distance: number): MapPickHit => ({ distance, object: { userData: { nodeId, nodeKind } } });
  assert.equal(pickMapNode([hit(room.id, 'space', 1), hit(chair.id, 'symbol', 90), hit(inside.id, 'camera', 40)]), inside.id);
  assert.equal(pickMapNode([hit(inside.id, 'camera', 40), hit(chair.id, 'symbol', 12), hit(room.id, 'space', 1)]), chair.id);
  assert.equal(pickMapNode([hit(id(2), 'space', 30), hit(room.id, 'space', 8)]), room.id);
  assert.equal(pickMapNode([hit(inside.id, 'camera', Number.NaN), hit(room.id, 'space', 5)]), room.id);
  assert.equal(pickMapNode([{ distance: 3, object: { userData: {} } }]), null);
  assert.equal(pickMapNode([]), null);

  // A node hidden for the look-through view is neither drawn nor clickable.
  scene.sync(map, null, { hiddenId: inside.id });
  assert.equal(rootOf(scene, inside).visible, false);
  assert.equal(pickMapNode(cast(scene, [250, 120, 700], [0, 0, -1])), room.id);
  scene.sync(map, null);
  assert.equal(rootOf(scene, inside).visible, true);
  assert.equal(pickMapNode(cast(scene, [250, 120, 700], [0, 0, -1])), inside.id);
  scene.dispose();
});

test('the floor under the pointer decides the space: a room behind another one, and a room inside another one', () => {
  const aim = (viewer: PerspectiveCamera, x: number, y: number, z: number): [[number, number, number], [number, number, number]] => {
    const origin = viewer.position, target = new Vector3(x, y, z).sub(origin);
    return [[origin.x, origin.y, origin.z], [target.x, target.y, target.z]];
  };
  // A corridor in front of a classroom, seen from the fitted view: the corridor's walls stand between the viewer and the classroom floor.
  const classroom = space(1, { x: 100, y: 100, width: 400, height: 260 }), corridor = space(2, { x: 100, y: 420, width: 300, height: 120 });
  const rooms = mapOf([classroom, corridor]), scene = new Map3DScene();
  scene.sync(rooms, null);
  const fitted = viewerFor(fitMapView(rooms, 1.6), 1.6);
  let throughWalls = 0;
  for (let ix = 0; ix < 8; ix++) for (let iz = 0; iz < 8; iz++) {
    const hits = cast(scene, ...aim(fitted, 120 + ix * 50, 0, 115 + iz * 32));
    if (hits[0].object.userData.nodeId === corridor.id) throughWalls++;
    assert.equal(pickMapNode(hits, rooms), classroom.id, `classroom floor ${ix},${iz}`);
  }
  assert.ok(throughWalls > 0, 'some of those points lie behind a corridor wall');
  assert.equal(pickMapNode(cast(scene, ...aim(fitted, 200, 0, 480)), rooms), corridor.id);
  // No floor under the pointer: the nearest wall still selects its space.
  const wallOnly = cast(scene, [250, 120, 900], [0, 0, -1]);
  assert.ok(wallOnly.length > 0 && wallOnly.every(hit => hit.object.userData.pickPart === 'wall'));
  assert.equal(pickMapNode(wallOnly, rooms), corridor.id);
  assert.equal(pickMapFloor(wallOnly, rooms), null);
  scene.dispose();

  // A room drawn inside a larger one on the same level: the floors tie, and the smaller space is on top, whatever the order in the map.
  const outer = space(3, { x: 100, y: 80, width: 800, height: 520 }), inner = space(4, { x: 400, y: 260, width: 160, height: 140, shape: 'ellipse' });
  for (const nested of [mapOf([outer, inner]), mapOf([inner, outer])]) {
    const stacked = new Map3DScene(), top = inner, viewers = [viewerFor(fitMapView(nested, 1.6), 1.6), viewerFor(topDownMapView(nested, 1.6), 1.6)];
    stacked.sync(nested, null);
    for (const viewer of viewers) for (let ix = 0; ix < 5; ix++) for (let iz = 0; iz < 5; iz++) {
      const hits = cast(stacked, ...aim(viewer, 450 + ix * 15, 0, 300 + iz * 15));
      assert.deepEqual(new Set(hits.filter(hit => hit.object.userData.pickPart === 'floor').map(hit => hit.object.userData.nodeId)), new Set([outer.id, inner.id]));
      assert.equal(pickMapNode(hits, nested), top.id);
      assert.equal(pickMapFloor(hits, nested)?.object.userData.nodeId, top.id);
    }
    assert.equal(pickMapNode(cast(stacked, ...aim(viewers[0], 200, 0, 150)), nested), outer.id, 'outside the inner room');
    stacked.dispose();
  }
  // A floor above another one is nearer, whatever the order in the map.
  const ground = space(5, { x: 300, y: 200, width: 400, height: 280 }), loft = space(6, { x: 400, y: 260, width: 160, height: 140, elevation: 200 });
  const levels = mapOf([loft, ground]), tower = new Map3DScene();
  tower.sync(levels, null);
  const down = cast(tower, [480, 900, 330], [0, -1, 0]), landed = pickMapFloor(down, levels);
  assert.equal(pickMapNode(down, levels), loft.id);
  assert.ok(landed?.point);
  nearVec(landed.point, { x: 480, y: 200, z: 330 }, 'the hit point is on the raised floor');
  tower.dispose();

  // The rule itself.
  const hit = (nodeId: string, pickPart: string, distance: number): MapPickHit => ({ distance, object: { userData: { nodeId, nodeKind: 'space', pickPart } } });
  assert.equal(pickMapNode([hit(outer.id, 'wall', 5), hit(inner.id, 'floor', 80)]), inner.id, 'a floor beats a nearer wall');
  assert.equal(pickMapNode([hit(outer.id, 'floor', 80), hit(inner.id, 'floor', 80.00000001)], mapOf([inner, outer])), inner.id);
  assert.equal(pickMapNode([hit(outer.id, 'floor', 80), hit(inner.id, 'floor', 80.00000001)], mapOf([outer, inner])), inner.id);
  // Two spaces of one area: the later in the map is on top.
  const twinA = space(7, { x: 0, y: 0, width: 100, height: 100 }), twinB = space(8, { x: 50, y: 50, width: 100, height: 100 });
  assert.equal(pickMapNode([hit(twinA.id, 'floor', 80), hit(twinB.id, 'floor', 80.00000001)], mapOf([twinA, twinB])), twinB.id);
  assert.equal(pickMapNode([hit(twinA.id, 'floor', 80), hit(twinB.id, 'floor', 80.00000001)], mapOf([twinB, twinA])), twinA.id);
  assert.equal(pickMapNode([hit(id(99), 'floor', 80), hit(outer.id, 'floor', 80.00000001)], mapOf([outer, inner])), outer.id, 'a floor that is no space of the map never outranks one that is');
  assert.equal(pickMapNode([hit(outer.id, 'floor', 80), hit(inner.id, 'floor', 81)], mapOf([outer, inner])), outer.id, 'a floor clearly behind does not take over');
  assert.equal(pickMapNode([hit(inner.id, 'floor', 80.00000001), hit(outer.id, 'floor', 80)]), outer.id, 'without a map the nearest floor wins');
});

test('only what is drawn solid stops a click: a door frame, a table gap and a see-through object let it through', () => {
  const room = space(1, { x: 300, y: 140, width: 400, height: 400 });
  const door = symbol(11, 'door', { x: 450, y: 490, width: 100, height: 100, spaceId: room.id });
  const doorway = camera(20, { x: 525, y: 540, elevation: 120 }), chair = symbol(12, 'chair', { x: 470, y: 380 });
  const map = mapOf([room, door, doorway, chair]), scene = new Map3DScene();
  scene.sync(map, null);
  const parts = (hits: MapPickHit[], nodeId: string) => hits.filter(hit => hit.object.userData.nodeId === nodeId).map(hit => hit.object.userData.pickPart);
  const partName = (hit: MapPickHit) => (hit.object as { name?: string }).name;
  // A camera standing in the doorway, from every side and from above.
  for (let turn = 0; turn < 24; turn++) for (const lift of [10, 200, 500]) {
    const angle = turn / 24 * Math.PI * 2, origin: [number, number, number] = [525 + Math.cos(angle) * 700, 120 + lift, 540 + Math.sin(angle) * 700];
    const hits = cast(scene, origin, [525 - origin[0], 120 - origin[1], 540 - origin[2]]);
    const leaf = hits.findIndex(hit => partName(hit) === 'door-leaf'), lens = hits.findIndex(hit => hit.object.userData.nodeId === doorway.id);
    // Only the leaf itself, when it really stands in front, hides the camera.
    assert.equal(pickMapNode(hits, map), leaf >= 0 && leaf < lens ? door.id : doorway.id, `turn ${turn} lift ${lift}`);
  }
  assert.equal(pickMapNode(cast(scene, [525, 900, 540], [0, -1, 0]), map), doorway.id, 'from straight above');
  // A chair behind the door. The ray crosses the door's footprint at a height of 74 to 129, inside its 160 high swing box:
  // that air is not the door.
  const seat = cast(scene, [500, 300, 900], [0, 32 - 300, 415 - 900]);
  assert.deepEqual(parts(seat, door.id), []);
  assert.ok(seat.some(hit => partName(hit) === 'chair-seat'));
  assert.equal(pickMapNode(seat, map), chair.id);
  // The door itself: its leaf, and its footprint on the floor.
  const leafHits = cast(scene, [458, 80, 900], [0, 0, -1]);
  assert.ok(parts(leafHits, door.id).includes('solid'));
  assert.equal(pickMapNode(leafHits, map), door.id);
  assert.equal(pickMapNode(cast(scene, [520, 600, 520], [0, -1, 0]), map), door.id, 'the swing area on the floor');
  assert.equal(pickMapNode(cast(scene, [480, 100, 900], [0, 0, -1]), map), room.id, 'through the open doorway onto the room');
  scene.dispose();

  // The gap between table legs still selects the table, unless something solid shows through it.
  const table = symbol(13, 'table', { x: 400, y: 300, width: 200, height: 120, volumeHeight: 100 }), under = camera(21, { x: 500, y: 360, elevation: 40 });
  const behind = symbol(14, 'chair', { x: 470, y: 150 });
  const dining = mapOf([table]), second = new Map3DScene();
  second.sync(dining, null);
  const gap: [[number, number, number], [number, number, number]] = [[500, 40, 900], [0, 0, -1]];
  assert.deepEqual(parts(cast(second, ...gap), table.id), ['box', 'box']);
  assert.equal(pickMapNode(cast(second, ...gap), dining), table.id);
  second.sync(mapOf([table, under]), null);
  assert.equal(pickMapNode(cast(second, ...gap)), under.id, 'a camera under the table');
  second.sync(mapOf([table, behind]), null);
  assert.equal(pickMapNode(cast(second, [500, 50, 900], [0, 0, -1])), behind.id, 'the back of a chair seen through the gap');
  // The table top is solid: it hides the camera below it.
  second.sync(mapOf([table, under]), null);
  assert.equal(pickMapNode(cast(second, [500, 600, 360], [0, -1, 0])), table.id);
  // A generic object is a see-through box: what stands inside it can be clicked, and the empty box is still the object.
  const crate = symbol(15, 'custom', { x: 400, y: 300, width: 200, height: 120, volumeHeight: 300 });
  second.sync(mapOf([crate, under]), null);
  assert.equal(pickMapNode(cast(second, ...gap)), under.id);
  assert.equal(pickMapNode(cast(second, [450, 200, 900], [0, 0, -1])), crate.id);
  second.dispose();

  const hit = (nodeId: string, nodeKind: string, distance: number, pickPart?: string): MapPickHit => ({ distance, object: { userData: { nodeId, nodeKind, pickPart } } });
  assert.equal(pickMapNode([hit(door.id, 'symbol', 3, 'box'), hit(chair.id, 'symbol', 90, 'solid')]), chair.id);
  assert.equal(pickMapNode([hit(door.id, 'symbol', 3, 'box'), hit(doorway.id, 'camera', 90)]), doorway.id);
  assert.equal(pickMapNode([hit(door.id, 'symbol', 30, 'box'), hit(chair.id, 'symbol', 9, 'box'), hit(room.id, 'space', 1, 'floor')]), chair.id, 'a box still beats a floor');
});

test('cameras created on the same default spot can each be selected by clicking again', () => {
  let map = mapOf([space(1, { x: 300, y: 200, width: 400, height: 300 }), symbol(12, 'table', { x: 700, y: 500 })]);
  const cameras: BackgroundCamera[] = [];
  for (const index of [50, 51, 52]) {
    const added = addMapCamera(map, id(index));
    map = added.map; cameras.push(added.camera);
  }
  for (const item of cameras) assert.deepEqual([item.x, item.y, item.elevation], [DEFAULT_MAP_CAMERA_POSE.x, DEFAULT_MAP_CAMERA_POSE.y, DEFAULT_MAP_CAMERA_POSE.elevation]);
  const scene = new Map3DScene();
  scene.sync(map, null);
  const click = (selectedId: string | null) => resolveMapClick(map, selectedId, cast(scene, [495, 800, 340], [0, -1, 0]));
  const first = click(null);
  assert.ok(first && cameras.some(item => item.id === first));
  const visited: (string | null)[] = [first];
  for (let turn = 0; turn < 3; turn++) visited.push(click(visited[visited.length - 1]));
  assert.deepEqual(new Set(visited.slice(0, 3)), new Set(cameras.map(item => item.id)), 'three clicks reach all three cameras');
  assert.equal(visited[3], visited[0], 'the fourth click wraps around');
  // Selecting something elsewhere is a plain pick, and a space never cycles.
  const table = map.nodes[1], room = map.nodes[0];
  assert.equal(resolveMapClick(map, cameras[1].id, cast(scene, [730, 600, 530], [0, -1, 0])), table.id);
  assert.equal(resolveMapClick(map, table.id, cast(scene, [495, 800, 340], [0, -1, 0])), first);
  assert.equal(resolveMapClick(map, room.id, cast(scene, [320, 600, 220], [0, -1, 0])), room.id);
  assert.equal(resolveMapClick(map, cameras[0].id, cast(scene, [900, 600, 600], [0, -1, 0])), null);
  scene.dispose();

  // Same plan spot, different heights: clicking the top one selects it directly, because the selected one is not under the pointer.
  const low = camera(60, { x: 500, y: 340, elevation: 40 }), middle = camera(61, { x: 500, y: 340, elevation: 300 }), high = camera(62, { x: 500, y: 340, elevation: 560 });
  const tower = mapOf([low, middle, high]), stacked = new Map3DScene();
  stacked.sync(tower, low.id);
  const level = cast(stacked, [495, 560, 900], [0, 0, -1]);
  assert.deepEqual([...new Set(level.map(hit => hit.object.userData.nodeId))], [high.id]);
  assert.equal(resolveMapClick(tower, low.id, level), high.id);
  // From straight above all three are under the pointer, so the click steps to the next one.
  assert.equal(resolveMapClick(tower, low.id, cast(stacked, [495, 900, 340], [0, -1, 0])), middle.id);
  stacked.dispose();

  // A pile seen from the side with one member high above it: only the ones under the pointer take turns,
  // so stepping never lands on the one above and leaves the rest out of reach.
  const a = camera(70, { x: 500, y: 340 }), above = camera(71, { x: 500, y: 340, elevation: 420 }), b = camera(72, { x: 500, y: 340 }), c = camera(73, { x: 500, y: 340 });
  const mixed = mapOf([a, above, b, c]), side = new Map3DScene();
  side.sync(mixed, null);
  const sideways = () => cast(side, [495, 120, 900], [0, 0, -1]);
  assert.deepEqual(new Set(sideways().map(hit => hit.object.userData.nodeId)), new Set([a.id, b.id, c.id]));
  assert.deepEqual([a.id, b.id, c.id].map(selected => resolveMapClick(mixed, selected, sideways())), [b.id, c.id, a.id]);
  assert.equal(resolveMapClick(mixed, above.id, sideways()), a.id, 'coming from the one above is a plain pick');
  // A plain pick is the nearest one, not the first of the pile.
  const nearer = camera(74, { x: 500, y: 346 }), depth = mapOf([a, above, nearer]);
  side.sync(depth, null);
  assert.deepEqual(new Set(sideways().map(hit => hit.object.userData.nodeId)), new Set([a.id, nearer.id]));
  assert.equal(resolveMapClick(depth, above.id, sideways()), nearer.id);
  assert.equal(resolveMapClick(depth, nearer.id, sideways()), a.id);
  // Something solid standing in front of the pile is picked, not stepped over.
  const front = symbol(75, 'bed', { x: 470, y: 500, width: 60, height: 60, volumeHeight: 200 }), blocked = mapOf([a, b, front]);
  side.sync(blocked, null);
  assert.deepEqual(new Set(sideways().map(hit => hit.object.userData.nodeId)), new Set([a.id, b.id, front.id]));
  assert.equal(resolveMapClick(blocked, a.id, sideways()), front.id);
  // A see-through object in front is no obstacle: the pile behind it still takes turns.
  const glass = symbol(76, 'custom', { x: 470, y: 500, width: 60, height: 60, volumeHeight: 200 }), seen = mapOf([a, b, glass]);
  side.sync(seen, null);
  assert.deepEqual(new Set(sideways().map(hit => hit.object.userData.nodeId)), new Set([a.id, b.id, glass.id]));
  assert.deepEqual([a.id, b.id].map(selected => resolveMapClick(seen, selected, sideways())), [b.id, a.id]);
  side.dispose();
});

test('syncing again reuses unchanged nodes and only moves the ones that moved', () => {
  const scene = new Map3DScene();
  scene.sync(everything, null);
  const snapshot = () => new Map(everything.nodes.map(node => [node.id, { root: rootOf(scene, node), children: [...rootOf(scene, node).children] }]));
  const before = snapshot();
  const kept = (node: BackgroundNode, label: string) => {
    same(rootOf(scene, node), before.get(node.id)?.root, `${label}: ${node.name} root`);
    assert.ok(sameList(rootOf(scene, node).children, before.get(node.id)?.children), `${label}: ${node.name} parts`);
  };
  scene.sync(everything, null);
  for (const node of everything.nodes) kept(node, 'same map');
  scene.sync({ ...everything, name: '이름만 바뀜', nodes: [...everything.nodes] }, null);
  for (const node of everything.nodes) kept(node, 'same nodes in a new map object');

  // A moved camera keeps every object and only gets a new pose.
  const moved = { ...legacyCamera, x: 320, elevation: 90, pitch: 40 };
  const movedMap = { ...everything, nodes: everything.nodes.map(node => node.id === moved.id ? moved : node) };
  scene.sync(movedMap, null);
  for (const node of movedMap.nodes) kept(node, 'after a move');
  nearVec(rootOf(scene, moved).position, { x: 320, y: 90, z: 180 }, 'moved lens');

  // A resized table is rebuilt inside the same root, and its old geometry is released.
  const oldGeometry = (named(rootOf(scene, tiltedCamera), 'camera-frustum') as Mesh).geometry;
  let released = 0;
  oldGeometry.addEventListener('dispose', () => { released++; });
  const wider = { ...tiltedCamera, fov: 100 }, resized = { ...tiltedTable, width: 240 };
  const changedMap = { ...movedMap, nodes: movedMap.nodes.map(node => node.id === wider.id ? wider : node.id === resized.id ? resized : node) };
  scene.sync(changedMap, null);
  assert.equal(released, 1);
  same(rootOf(scene, wider), before.get(wider.id)?.root, 'a rebuilt camera keeps its root');
  assert.ok(named(rootOf(scene, wider), 'camera-frustum') !== before.get(wider.id)?.children.find(child => child.name === 'camera-frustum'), 'the frustum is rebuilt for the new angle');
  same(rootOf(scene, resized), before.get(resized.id)?.root, 'a rebuilt table keeps its root');
  assert.equal(named(rootOf(scene, resized), 'symbol-body').scale.x, 240);
  for (const node of changedMap.nodes) if (node.id !== wider.id && node.id !== resized.id) kept(node, 'neighbours of a rebuilt node');

  // Selecting rebuilds only the node whose look changes.
  scene.sync(changedMap, ellipse.id);
  assert.ok(!sameList(rootOf(scene, ellipse).children, before.get(ellipse.id)?.children), 'the newly selected space is rebuilt');
  kept(polygon, 'selection elsewhere'); kept(tiltedRect, 'selection elsewhere');

  // A removed node leaves the graph; the others stay.
  const without = { ...changedMap, nodes: changedMap.nodes.filter(node => node.id !== polygon.id) };
  scene.sync(without, ellipse.id);
  same(scene.root(polygon.id), null, 'the removed node has no root');
  same(before.get(polygon.id)?.root.parent, null, 'the removed root left the graph');
  kept(tiltedRect, 'after a removal');
  scene.dispose();
});

test('a held root is not overwritten while its neighbours follow the map', () => {
  const scene = new Map3DScene();
  const table = symbol(10, 'table', { x: 400, y: 300, width: 180, height: 110 }), lens = camera(20);
  const map = mapOf([table, lens]);
  scene.sync(map, table.id);
  const root = rootOf(scene, table), parts = [...root.children];
  root.position.set(555, 30, 444); root.scale.set(2, 1.5, 1);
  const next = mapOf([{ ...table, x: 410, width: 360 }, { ...lens, x: 300 }]);
  scene.sync(next, table.id, { holdId: table.id });
  assert.deepEqual(root.position.toArray(), [555, 30, 444], 'the gizmo still owns the root');
  assert.deepEqual(root.scale.toArray(), [2, 1.5, 1]);
  assert.ok(sameList(root.children, parts), 'a held node is not rebuilt at the new size, which would scale it twice');
  near(rootOf(scene, lens).position.x, 300, 'neighbour follows');
  // Released: everything comes from the map again.
  scene.invalidate(table.id);
  scene.sync(next, table.id);
  nearVec(root.position, nodeWorldPose(next.nodes[0]).position, 'released root');
  assert.deepEqual(root.scale.toArray(), [1, 1, 1]);
  assert.equal(named(root, 'symbol-body').scale.x, 360);
  // A drag that changed nothing in the data (clamped, or back where it began) still leaves the root to be reset.
  const rebuilt = [...root.children];
  root.scale.set(3, 1, 1); root.position.x += 7;
  scene.sync(next, table.id);
  assert.deepEqual(root.scale.toArray(), [3, 1, 1], 'an unchanged node is skipped by the diff');
  scene.invalidate(table.id);
  scene.sync(next, table.id);
  assert.deepEqual(root.scale.toArray(), [1, 1, 1]);
  nearVec(root.position, nodeWorldPose(next.nodes[0]).position, 'reset root');
  assert.ok(!sameList(root.children, rebuilt), 'an invalidated node is rebuilt');
  scene.dispose();
});

test('the floor is the base extent without a dot grid, and a palette change keeps the roots', () => {
  const scene = new Map3DScene(MAP3D_DARK_PALETTE);
  scene.sync(everything, tiltedRect.id);
  const floor = worldPoints(named(scene.scene, 'floor-fill'));
  near(Math.min(...floor.map(point => point.x)), 0, 'floor left'); near(Math.max(...floor.map(point => point.x)), 1000, 'floor right');
  near(Math.min(...floor.map(point => point.z)), 0, 'floor top'); near(Math.max(...floor.map(point => point.z)), 680, 'floor bottom');
  scene.scene.traverse(object => assert.ok(!(object as { isPoints?: boolean }).isPoints, 'no point grid'));
  assert.equal(scene.resourceCount().textures, 0, 'labels and underlay need a document');

  const roots = everything.nodes.map(node => rootOf(scene, node)), old = resources(scene).materials;
  let released = 0;
  for (const material of old) material.addEventListener('dispose', () => { released++; });
  scene.setPalette({ ...MAP3D_DARK_PALETTE, light: true, accent: 0x123456 });
  assert.equal(released, old.size, 'every material of the old theme is released');
  assert.ok(sameList(everything.nodes.map(node => rootOf(scene, node)), roots), 'roots survive a theme change');
  const wall = (named(rootOf(scene, tiltedRect), 'space-walls') as Mesh).material as Material & { color: { getHex(): number } };
  assert.equal(wall.color.getHex(), 0x123456);
  nearVec(rootOf(scene, tiltedCamera).position, nodeWorldPose(tiltedCamera).position, 'pose after a theme change');
  scene.dispose();

  // In the middle of a drag the held node is repainted as it was when the drag began, under the gizmo's transform.
  const held = new Map3DScene(MAP3D_DARK_PALETTE), table = symbol(10, 'table', { x: 400, y: 300, width: 180, height: 110 });
  held.sync(mapOf([table]), table.id);
  const heldRoot = rootOf(held, table);
  heldRoot.position.set(9, 8, 7); heldRoot.scale.set(2, 1, 1);
  held.sync(mapOf([{ ...table, width: 360 }]), table.id, { holdId: table.id });
  const stale = [...heldRoot.children];
  held.setPalette({ ...MAP3D_DARK_PALETTE, accentSub: 0x224466 });
  assert.deepEqual([heldRoot.position.toArray(), heldRoot.scale.toArray()], [[9, 8, 7], [2, 1, 1]]);
  assert.ok(!sameList(heldRoot.children, stale), 'the held node is repainted');
  assert.equal(named(heldRoot, 'symbol-body').scale.x, 180, 'at the size the gizmo is scaling, not at the previewed one');
  assert.equal(((named(heldRoot, 'table-top') as Mesh).material as Material & { color: { getHex(): number } }).color.getHex(), 0x224466);
  held.dispose();
  assert.deepEqual(held.resourceCount(), { geometries: 0, materials: 0, textures: 0 });
});

test('dispose releases every geometry and material', () => {
  const scene = new Map3DScene();
  scene.sync(everything, tiltedTable.id);
  scene.sync({ ...everything, nodes: [...everything.nodes, camera(60, { x: 800, y: 500, locked: true })] }, polygon.id);
  const { geometries, materials } = resources(scene), counted = scene.resourceCount();
  assert.ok(geometries.size > 10 && materials.size > 5);
  assert.ok(counted.geometries >= geometries.size && counted.materials >= materials.size, 'everything drawn is tracked');
  const released = new Map<object, number>();
  for (const item of [...geometries, ...materials]) item.addEventListener('dispose', () => { released.set(item, (released.get(item) ?? 0) + 1); });
  scene.dispose();
  for (const item of [...geometries, ...materials]) assert.equal(released.get(item), 1, `${(item as { type?: string }).type} was not released exactly once`);
  assert.deepEqual(scene.resourceCount(), { geometries: 0, materials: 0, textures: 0 });
  assert.equal(scene.scene.children.length, 0);
  assert.equal(scene.pickTargets().length, 0);
  same(scene.root(tiltedRect.id), null, 'no root after dispose');
  // Safe to call again, and a late sync after dispose does nothing.
  scene.dispose();
  scene.sync(everything, null);
  same(scene.root(tiltedRect.id), null, 'a late sync builds nothing');
});

function viewerFor(view: Map3DViewState, aspect: number): PerspectiveCamera {
  const viewer = new PerspectiveCamera(MAP3D_VIEW_FOV, aspect, 1, 1e6);
  viewer.position.set(...view.position);
  viewer.lookAt(new Vector3(...view.target));
  viewer.updateMatrixWorld(true);
  return viewer;
}

test('fit and top-down views hold the whole map, and top-down is turned like the plan', () => {
  const wide = mapOf([...everything.nodes, space(70, { x: -400, y: 900, width: 300, height: 300, volumeHeight: 400 }), camera(71, { x: 1500, y: -200, elevation: 600 })]);
  const { min, max } = mapWorldBounds(wide);
  assert.ok(min.x <= -400 && max.x >= 1500 && min.z <= -200 && max.z >= 1200 && min.y === 0 && max.y === 600);
  const corners = [min.x, max.x].flatMap(x => [min.y, max.y].flatMap(y => [min.z, max.z].map(z => new Vector3(x, y, z))));
  for (const aspect of [1.6, 0.5, 3]) {
    const fit = fitMapView(wide, aspect), top = topDownMapView(wide, aspect);
    for (const value of [...fit.target, ...fit.position, ...top.target, ...top.position]) assert.ok(Number.isFinite(value));
    assert.ok(fit.position[1] > fit.target[1], 'the fit view looks down from above');
    for (const view of [fit, top]) {
      const viewer = viewerFor(view, aspect);
      for (const corner of corners) {
        const projected = corner.clone().project(viewer);
        assert.ok(Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z < 1, `corner outside the view at aspect ${aspect}`);
      }
    }
    const viewer = viewerFor(top, aspect);
    const topLeft = new Vector3(min.x, 0, min.z).project(viewer), bottomRight = new Vector3(max.x, 0, max.z).project(viewer);
    assert.ok(topLeft.x < 0 && topLeft.y > 0, 'plan top left is screen top left');
    assert.ok(bottomRight.x > 0 && bottomRight.y < 0, 'plan bottom right is screen bottom right');
    near(top.position[0], top.target[0], 'top-down is straight above');
    assert.ok(top.position[1] > 600);
  }
  // An empty map still gives a usable view of the base extent.
  const empty = fitMapView(mapOf([]), 1.5);
  nearVec({ x: empty.target[0], y: empty.target[1], z: empty.target[2] }, { x: 500, y: 0, z: 340 }, 'empty map target');
});

test('each kind gets the handles that make sense for it', () => {
  for (const type of ['space', 'symbol', 'camera'] as const) {
    assert.deepEqual(mapGizmoSetup(type, 'translate'), { mode: 'translate', space: 'world', showX: true, showY: true, showZ: true });
  }
  assert.deepEqual(mapGizmoSetup('space', 'rotate'), { mode: 'rotate', space: 'world', showX: false, showY: true, showZ: false });
  assert.deepEqual(mapGizmoSetup('symbol', 'rotate'), { mode: 'rotate', space: 'local', showX: true, showY: true, showZ: true });
  assert.deepEqual(mapGizmoSetup('camera', 'rotate'), { mode: 'rotate', space: 'local', showX: true, showY: true, showZ: true });
  assert.deepEqual(mapGizmoSetup('space', 'scale'), { mode: 'scale', space: 'local', showX: true, showY: true, showZ: true });
  assert.deepEqual(mapGizmoSetup('symbol', 'scale'), { mode: 'scale', space: 'local', showX: true, showY: true, showZ: true });
  assert.equal(mapGizmoSetup('camera', 'scale'), null, 'a camera has no size');
});

test('a root transform converts back into node fields with minimal writes', () => {
  const scene = new Map3DScene();
  const lens = camera(20, { x: 250, y: 180, angle: 135 }), table = symbol(10, 'table', { x: 400, y: 300, width: 180, height: 110 });
  const map = mapOf([lens, table]);
  scene.sync(map, lens.id);
  // Untouched roots change nothing: no vertical field is invented by looking.
  assert.equal(previewMapFromRoot(map, lens.id, rootOf(scene, lens)), map);
  assert.equal(previewMapFromRoot(map, table.id, rootOf(scene, table)), map);
  assert.deepEqual(rootWorldPose(rootOf(scene, lens)).scale, { x: 1, y: 1, z: 1 });

  // Raising the lens and pointing it straight down keeps the plan position and the horizontal direction.
  const lensRoot = rootOf(scene, lens), down = cameraOrientation({ angle: 135, pitch: -90, roll: 0 });
  lensRoot.position.y = 300;
  lensRoot.quaternion.set(down.x, down.y, down.z, down.w);
  const lowered = previewMapFromRoot(map, lens.id, lensRoot).nodes[0] as BackgroundCamera;
  assert.deepEqual([lowered.x, lowered.y, lowered.angle, lowered.elevation, lowered.pitch], [250, 180, 135, 300, -90]);
  assert.ok(!('roll' in lowered) && !('aspect' in lowered), 'untouched optional fields are not written');
  for (const value of Object.values(lowered)) assert.notEqual(value, undefined);

  // Scale: X is the width, Z the plan depth, Y the vertical size. The base centre stays where the gizmo left it.
  const tableRoot = rootOf(scene, table);
  tableRoot.scale.set(2, 1.5, 1);
  const grown = previewMapFromRoot(map, table.id, tableRoot).nodes[1] as BackgroundSymbol;
  assert.deepEqual([grown.width, grown.height, grown.volumeHeight], [360, 110, 90]);
  near(grown.x + grown.width / 2, 490, 'base centre x'); near(grown.y + grown.height / 2, 355, 'base centre y');
  assert.ok(!('elevation' in grown) && !('pitch' in grown));
  scene.dispose();
});

type GizmoHarness = {
  scene: Map3DScene; gizmo: MapNodeGizmo; calls: string[]; previews: BackgroundMap[]; ended: BackgroundMap[];
  frame(): void; press(axis: 'X' | 'Y' | 'Z'): void; move(x: number, y: number): void; release(): void; queued(): number;
};
function gizmoHarness(map: BackgroundMap, selectedId: string, mode: 'translate' | 'rotate' | 'scale', slop = 0): GizmoHarness {
  const scene = new Map3DScene();
  scene.sync(map, selectedId);
  const viewer = new PerspectiveCamera(MAP3D_VIEW_FOV, 1.5, 1, 20000);
  viewer.position.set(500, 700, 1300); viewer.lookAt(500, 0, 340); viewer.updateMatrixWorld(true);
  const calls: string[] = [], previews: BackgroundMap[] = [], ended: BackgroundMap[] = [], queue = new Map<number, () => void>();
  let current = map, handle = 0;
  const gizmo = new MapNodeGizmo(viewer, null, {
    currentMap: () => current,
    beginDrag: nodeId => { calls.push(`hold:${nodeId === selectedId}`); },
    endDrag: (_nodeId, shown) => { calls.push('release'); ended.push(shown); },
    schedule: callback => { queue.set(++handle, callback); return handle; },
    unschedule: scheduled => { queue.delete(scheduled); },
    onBeginGesture: () => { calls.push('begin'); },
    onPreview: next => { calls.push('preview'); previews.push(next); current = next; },
    onFinishGesture: () => { calls.push('finish'); },
    onCancelGesture: () => { calls.push('cancel'); },
  }, { slop });
  scene.scene.add(gizmo.helper);
  const node = map.nodes.find(item => item.id === selectedId);
  assert.ok(node);
  assert.equal(gizmo.setTarget({ id: node.id, type: node.type, root: rootOf(scene, node) }, mode), true);
  const pointer = (x: number, y: number, button: number) => ({ x, y, button }) as unknown as PointerEvent;
  return {
    scene, gizmo, calls, previews, ended,
    frame: () => { const callbacks = [...queue.values()]; queue.clear(); for (const callback of callbacks) callback(); },
    queued: () => queue.size,
    press: axis => {
      // The pointer hover of the real controls picks the axis; here it is set directly.
      gizmo.controls.axis = axis;
      scene.scene.updateMatrixWorld(true);
      gizmo.controls.pointerDown(pointer(0, 0, 0));
    },
    move: (x, y) => { scene.scene.updateMatrixWorld(true); gizmo.controls.pointerMove(pointer(x, y, -1)); },
    release: () => { gizmo.controls.pointerUp(pointer(0, 0, 0)); },
  };
}

test('one gizmo drag is one gesture: begin, coalesced previews, one finish', () => {
  const lens = camera(20, { x: 250, y: 180, angle: 135 });
  const map = mapOf([space(1), lens]);
  const harness = gizmoHarness(map, lens.id, 'translate'), { gizmo, calls, previews } = harness, root = rootOf(harness.scene, lens);
  assert.equal(gizmo.dragging, false);
  harness.press('X');
  assert.equal(gizmo.dragging, true);
  assert.equal(gizmo.draggedId, lens.id);
  assert.deepEqual(calls, ['hold:true', 'begin']);
  harness.move(0.05, 0); harness.move(0.1, 0); harness.move(0.15, 0);
  assert.deepEqual(calls, ['hold:true', 'begin'], 'pointer moves alone send nothing');
  assert.equal(harness.queued(), 1, 'three moves, one scheduled preview');
  harness.frame();
  assert.deepEqual(calls, ['hold:true', 'begin', 'preview']);
  const first = previews[0].nodes[1] as BackgroundCamera;
  assert.notEqual(first.x, 250);
  near(first.x, root.position.x, 'preview follows the root', 1e-3);
  assert.deepEqual([first.y, first.angle], [180, 135], 'only the dragged axis changes');
  assert.ok(!('elevation' in first) && !('pitch' in first) && !('roll' in first), 'a plan move writes no vertical field');
  assert.equal(previews[0].nodes[0], map.nodes[0], 'other nodes keep their identity');
  // During the drag the scene sync leaves the dragged root to the gizmo.
  const held = root.position.clone();
  harness.scene.sync(previews[0], lens.id, { holdId: lens.id });
  assert.deepEqual(root.position.toArray(), held.toArray());
  // The handles of a running drag are not swapped underneath it.
  assert.equal(gizmo.setTarget({ id: lens.id, type: 'camera', root }, 'rotate'), true);
  assert.equal(gizmo.controls.mode, 'translate');
  assert.equal(gizmo.dragging, true);

  harness.move(0.3, 0);
  harness.release();
  assert.deepEqual(calls, ['hold:true', 'begin', 'preview', 'preview', 'finish', 'release'], 'the pending preview is flushed before the finish');
  assert.equal(harness.queued(), 0);
  assert.equal(gizmo.dragging, false);
  assert.equal(harness.ended[0], previews[1], 'the scene is handed the last preview');
  near((previews[1].nodes[1] as BackgroundCamera).x, root.position.x, 'final preview', 1e-3);
  // Every preview is computed from the map the drag started on, not from the previous preview.
  near((previews[1].nodes[1] as BackgroundCamera).x - 250, root.position.x - 250, 'no accumulated drift', 1e-3);
  assert.equal(gizmo.cancel(), false, 'nothing left to cancel');
  harness.frame();
  assert.equal(calls.filter(call => call === 'begin').length, 1);
  assert.equal(calls.filter(call => call === 'finish').length, 1);
  assert.ok(!calls.includes('cancel'));
  gizmo.dispose();
  harness.scene.dispose();
});

test('a click on a handle without movement begins and finishes without a preview', () => {
  const lens = camera(20);
  const map = mapOf([lens]), harness = gizmoHarness(map, lens.id, 'translate');
  harness.press('Y');
  harness.release();
  assert.deepEqual(harness.calls, ['hold:true', 'begin', 'finish', 'release']);
  assert.equal(harness.ended[0], map, 'the map is untouched, so the editor adds no undo step');
  harness.gizmo.dispose();
  harness.scene.dispose();
});

test('a press that stays inside the click slop never edits, however the controls nudged the root', () => {
  const room = space(1), chair = symbol(12, 'chair', { spaceId: room.id });
  const map = mapOf([room, chair]), harness = gizmoHarness(map, room.id, 'translate', 4), { gizmo, calls } = harness, root = rootOf(harness.scene, room);
  const start = root.position.toArray();
  harness.press('X');
  gizmo.pointerTravel(1);
  harness.move(0.01, 0);
  gizmo.pointerTravel(3.9);
  harness.move(0.02, 0);
  assert.notDeepEqual(root.position.toArray(), start, 'the controls did move the root a little');
  assert.equal(harness.queued(), 0, 'nothing is previewed inside the slop');
  harness.release();
  assert.deepEqual(calls, ['hold:true', 'begin', 'finish', 'release']);
  assert.deepEqual(root.position.toArray(), start, 'the root snaps back');
  assert.equal(harness.ended[0], map, 'the data is untouched, so there is no undo step');
  // Past the slop the same press becomes a real drag, and it stays one even if the pointer comes back.
  harness.press('X');
  gizmo.pointerTravel(2);
  harness.move(0.01, 0);
  gizmo.pointerTravel(4);
  harness.move(0.05, 0);
  gizmo.pointerTravel(1);
  harness.move(0.06, 0);
  assert.equal(harness.queued(), 1);
  harness.release();
  assert.deepEqual(calls.slice(4), ['hold:true', 'begin', 'preview', 'finish', 'release']);
  const moved = harness.previews[0].nodes as [BackgroundSpace, BackgroundSymbol];
  assert.ok(Math.abs(moved[0].x - room.x) > 0.5);
  near(moved[1].x - chair.x, moved[0].x - room.x, 'the member follows', 1e-6);
  gizmo.dispose();
  harness.scene.dispose();
});

test('a cancelled drag restores the root, reports cancel once and never finishes', () => {
  const table = symbol(10, 'table', { x: 400, y: 300, width: 180, height: 110, rotation: 25 });
  const map = mapOf([table]), harness = gizmoHarness(map, table.id, 'scale'), { gizmo, calls } = harness, root = rootOf(harness.scene, table);
  const start = { position: root.position.toArray(), quaternion: root.quaternion.toArray(), scale: root.scale.toArray() };
  harness.press('X');
  harness.move(0.2, 0.05);
  harness.frame();
  assert.notDeepEqual(root.scale.toArray(), start.scale, 'the drag really changed the root');
  // Size comes from the stored node times the gizmo scale, not from the previous preview (that would compound).
  harness.move(0.3, 0.08);
  harness.frame();
  const sized = harness.previews[1].nodes[0] as BackgroundSymbol;
  assert.ok(Math.abs(root.scale.x - 1) > 0.05);
  near(sized.width, Math.min(100000, Math.max(10, 180 * root.scale.x)), 'width from the stored size', 1e-3);
  assert.deepEqual([sized.height, sized.rotation], [110, 25]);
  harness.move(0.4, 0.1);
  assert.equal(harness.queued(), 1);
  assert.equal(gizmo.cancel(), true);
  const cancelled = ['hold:true', 'begin', 'preview', 'preview', 'release', 'cancel'];
  assert.deepEqual(calls, cancelled);
  assert.equal(harness.queued(), 0, 'the pending preview is dropped');
  assert.deepEqual({ position: root.position.toArray(), quaternion: root.quaternion.toArray(), scale: root.scale.toArray() }, start);
  assert.equal(harness.ended[0], map, 'the scene goes back to the map the drag started on');
  assert.equal(gizmo.dragging, false);
  assert.equal(gizmo.controls.dragging, false);
  assert.equal(gizmo.controls.axis, null);
  // Whatever arrives afterwards (the queued frame, the late pointer up, a second cancel) adds nothing.
  harness.frame();
  harness.move(0.5, 0.1);
  harness.release();
  assert.equal(gizmo.cancel(), false);
  assert.deepEqual(calls, cancelled);
  // The next drag is a new gesture.
  harness.press('X');
  harness.release();
  assert.deepEqual(calls.slice(6), ['hold:true', 'begin', 'finish', 'release']);
  // Disposing mid-drag cancels exactly once as well.
  harness.press('Z');
  harness.move(0.1, 0.1);
  gizmo.dispose();
  assert.deepEqual(calls.slice(10), ['hold:true', 'begin', 'release', 'cancel']);
  harness.scene.dispose();
});

test('dragging a space carries its members once and leaves locked ones in place', () => {
  const room = space(1, { x: 100, y: 80, width: 300, height: 200 });
  const chair = symbol(12, 'chair', { x: 130, y: 200, spaceId: room.id }), fixed = symbol(13, 'table', { x: 260, y: 120, spaceId: room.id, locked: true });
  const member = camera(20, { x: 250, y: 180, spaceId: room.id, elevation: 150, pitch: -20 }), outsider = camera(21, { x: 800, y: 500 });
  const map = mapOf([room, chair, fixed, member, outsider]);
  const harness = gizmoHarness(map, room.id, 'translate'), roomRoot = rootOf(harness.scene, room);
  harness.press('X');
  for (const x of [0.1, 0.2]) {
    harness.move(x, 0);
    harness.frame();
    const preview = harness.previews[harness.previews.length - 1], [nextRoom, nextChair, nextFixed, nextMember, nextOutsider] = preview.nodes as [BackgroundSpace, BackgroundSymbol, BackgroundSymbol, BackgroundCamera, BackgroundCamera];
    const shift = nextRoom.x - room.x;
    assert.ok(Math.abs(shift) > 1);
    near(nextChair.x - chair.x, shift, 'chair carried by the same shift', 1e-6);
    near(nextMember.x - member.x, shift, 'camera carried by the same shift', 1e-6);
    assert.deepEqual([nextMember.y, nextMember.elevation, nextMember.pitch, nextMember.angle], [180, 150, -20, 0], 'a plan move keeps height and tilt');
    assert.equal(nextFixed, fixed, 'a locked member stays');
    assert.equal(nextOutsider, outsider);
    // The scene shows the members at their own absolute pose; nothing is parented to the room.
    harness.scene.sync(preview, room.id, { holdId: room.id });
    nearVec(rootOf(harness.scene, chair).position, nodeWorldPose(nextChair).position, 'chair root');
    nearVec(rootOf(harness.scene, member).position, nodeWorldPose(nextMember).position, 'member lens');
    same(rootOf(harness.scene, chair).parent, roomRoot.parent, 'the chair is a sibling of its room');
    near(roomRoot.position.x - 250, shift, 'the held room root is where the gizmo put it', 1e-3);
  }
  harness.release();
  const final = harness.ended[0];
  harness.scene.invalidate(room.id);
  harness.scene.sync(final, room.id);
  nearVec(roomRoot.position, nodeWorldPose(final.nodes[0]).position, 'room after the drag');
  harness.gizmo.dispose();
  harness.scene.dispose();
});

test('the gizmo is offered per kind and mode, and hides for a camera in size mode', () => {
  const room = space(1), lens = camera(20);
  const map = mapOf([room, lens]), harness = gizmoHarness(map, room.id, 'rotate'), { gizmo } = harness;
  const controls = gizmo.controls as unknown as { object?: Object3D; showX: boolean; showY: boolean; showZ: boolean; showE: boolean; showXYZE: boolean; mode: string; space: string };
  assert.deepEqual([controls.mode, controls.space, controls.showX, controls.showY, controls.showZ], ['rotate', 'world', false, true, false]);
  assert.deepEqual([controls.showE, controls.showXYZE], [false, false], 'only the axis rings turn a node');
  same(controls.object, rootOf(harness.scene, room), 'attached to the room');
  assert.equal(gizmo.attachedId, room.id);
  assert.equal(gizmo.setTarget({ id: lens.id, type: 'camera', root: rootOf(harness.scene, lens) }, 'rotate'), true);
  assert.deepEqual([controls.space, controls.showX, controls.showY, controls.showZ], ['local', true, true, true]);
  same(controls.object, rootOf(harness.scene, lens), 'attached to the camera');
  assert.equal(gizmo.setTarget({ id: lens.id, type: 'camera', root: rootOf(harness.scene, lens) }, 'scale'), false);
  same(controls.object, undefined, 'hidden for a camera in size mode');
  assert.equal(gizmo.attachedId, null);
  assert.equal(gizmo.hovering, false);
  // Turning a space with its ring changes the plan rotation only.
  assert.equal(gizmo.setTarget({ id: room.id, type: 'space', root: rootOf(harness.scene, room) }, 'rotate'), true);
  harness.press('Y');
  harness.move(0.2, 0);
  harness.frame();
  const turned = harness.previews[0].nodes[0] as BackgroundSpace;
  assert.notEqual(turned.rotation, 0);
  assert.deepEqual([turned.x, turned.y, turned.width, turned.height], [room.x, room.y, room.width, room.height]);
  assert.ok(!('elevation' in turned) && !('volumeHeight' in turned));
  // Detaching mid-drag is a cancel.
  gizmo.setTarget(null, 'rotate');
  assert.deepEqual(harness.calls.slice(-2), ['release', 'cancel']);
  assert.ok(!harness.calls.includes('finish'));
  gizmo.dispose();
  harness.scene.dispose();
});

test('the size gizmo has no centre handle, and a release from outside ends a drag exactly once', () => {
  const room = space(1), chair = symbol(12, 'chair', { spaceId: room.id });
  const map = mapOf([room, chair]), harness = gizmoHarness(map, room.id, 'scale'), { gizmo, calls } = harness, root = rootOf(harness.scene, room);
  const drawn = (mode: string): boolean => (gizmo.controls as Any)._gizmo.gizmo[mode].children.some((child: Object3D) => child.name === 'XYZ');
  assert.deepEqual([drawn('scale'), drawn('translate')], [false, true], 'only the size gizmo loses its centre cube');
  // The centre scales by the ratio to a start a few pixels long: pressing it is not a drag at all.
  harness.press('XYZ' as 'X');
  assert.deepEqual([gizmo.dragging, gizmo.controls.dragging, gizmo.controls.axis, gizmo.hovering], [false, false, null, false]);
  harness.move(0.2, 0.1); harness.move(-0.3, 0.2);
  harness.release();
  harness.frame();
  assert.deepEqual(calls, [], 'no gesture, no preview');
  assert.deepEqual(root.scale.toArray(), [1, 1, 1]);
  // An axis handle still sizes, and ending the drag from outside commits it like letting go of the button.
  harness.press('X');
  harness.move(0.1, 0);
  assert.notEqual(root.scale.x, 1);
  gizmo.release();
  assert.deepEqual(calls, ['hold:true', 'begin', 'preview', 'finish', 'release']);
  assert.deepEqual([gizmo.dragging, gizmo.controls.dragging], [false, false]);
  const sized = harness.previews[0].nodes as [BackgroundSpace, BackgroundSymbol];
  assert.notEqual(sized[0].width, room.width);
  near(sized[1].width / chair.width, sized[0].width / room.width, 'the member is scaled once');
  gizmo.release();
  harness.release();
  assert.equal(calls.length, 5, 'nothing left to end');
  gizmo.dispose();
  harness.scene.dispose();

  // The centre handle of the move gizmo is not affected.
  const mover = gizmoHarness(map, room.id, 'translate');
  mover.press('XYZ' as 'X');
  assert.equal(mover.gizmo.dragging, true);
  mover.release();
  assert.deepEqual(mover.calls, ['hold:true', 'begin', 'finish', 'release']);
  mover.gizmo.dispose();
  mover.scene.dispose();
});

test('an underlay answer that was overtaken never attaches, also when it asked for the same address', () => {
  const scope = globalThis as Any, hadDocument = 'document' in scope, load = TextureLoader.prototype.load;
  const pending: { url: string; done(texture: Texture): void; fail(): void }[] = [];
  if (!hadDocument) scope.document = {};
  TextureLoader.prototype.load = function (url: string, onLoad?: (texture: Texture) => void, _onProgress?: unknown, onError?: (error: unknown) => void) {
    pending.push({ url, done: texture => onLoad?.(texture), fail: () => onError?.(new Error('no image')) });
    return new Texture();
  } as typeof load;
  try {
    let frames = 0, errors = 0;
    const scene = new Map3DScene(MAP3D_DARK_PALETTE, () => { frames++; });
    scene.onUnderlayError = () => { errors++; };
    const floor = named(scene.scene, 'map-floor'), underlays = () => floor.children.filter(child => child.name === 'floor-underlay');
    const released = new Set<Texture>();
    const picture = () => { const texture = new Texture({ width: 200, height: 100 }); texture.addEventListener('dispose', () => { released.add(texture); }); return texture; };
    const a = 'https://example.test/a.png', first = picture(), second = picture();
    // Open a map, go to another one and come back before the first image has arrived.
    scene.setUnderlay(a); scene.setUnderlay(''); scene.setUnderlay(a);
    assert.deepEqual(pending.map(item => item.url), [a, a]);
    pending[0].done(first);
    assert.deepEqual([underlays().length, released.has(first), frames], [0, true, 0], 'the overtaken answer is dropped and released');
    pending[1].done(second);
    assert.deepEqual([underlays().length, frames, scene.resourceCount().textures], [1, 1, 1]);
    same((underlays()[0] as Mesh<BufferGeometry, Material & { map: Texture }>).material.map, second, 'the image of the current request');
    // The same answers in the other order.
    const third = picture(), fourth = picture();
    scene.setUnderlay(''); scene.setUnderlay(a); scene.setUnderlay(''); scene.setUnderlay(a);
    assert.deepEqual([underlays().length, released.has(second)], [0, true]);
    pending[3].done(fourth); pending[2].done(third);
    assert.deepEqual([underlays().length, released.has(third), released.has(fourth)], [1, true, false]);
    // A map without an underlay leaves nothing on the floor.
    scene.setUnderlay('');
    assert.deepEqual([underlays().length, released.has(fourth), scene.resourceCount().textures], [0, true, 0]);
    // Only the current request reports a failure.
    scene.setUnderlay('https://example.test/b.png'); scene.setUnderlay('https://example.test/c.png');
    pending[4].fail();
    assert.equal(errors, 0);
    pending[5].fail();
    assert.equal(errors, 1);
    // An answer after dispose is released and ignored.
    const late = picture();
    scene.setUnderlay(a);
    scene.dispose();
    pending[6].done(late);
    assert.deepEqual([released.has(late), floor.children.length], [true, 0]);
  } finally {
    TextureLoader.prototype.load = load;
    if (!hadDocument) delete scope.document;
  }
});

// ---------------------------------------------------------------------------------------------
// The WebGL viewport itself, driven through a minimal fake DOM and a renderer stub.
// OrbitControls, TransformControls and every project module are the real ones.
// ---------------------------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type ViewportInstance = { update(props: Map3DProps): void; zoom(factor: number): void; fit(): void; topDown(): void; dispose(): void };
type ViewportModule = { Map3DViewport: new (host: Any, stage: Any, props: Map3DProps, onNotice: (text: string) => void) => ViewportInstance };
type ScreenPoint = { x: number; y: number };

const stub = { renderers: [] as Any[], fail: false };
const frames = new Map<number, (time: number) => void>();
const observers = { resize: [] as Any[], mutation: [] as Any[] };
let themeValues: Record<string, string> = {};

class FakeElement extends EventTarget {
  tagName: string; style: Record<string, string> = {}; children: FakeElement[] = []; parentNode: FakeElement | null = null;
  attributes: Record<string, string> = {}; className = ''; captured = new Set<number>(); focused = 0;
  box = { left: 0, top: 0, width: 0, height: 0 };
  constructor(tagName: string) { super(); this.tagName = tagName; }
  get clientWidth() { return this.box.width; }
  get clientHeight() { return this.box.height; }
  get ownerDocument() { return (globalThis as Any).document; }
  getRootNode() { return (globalThis as Any).document; }
  appendChild(child: FakeElement) { this.children.push(child); child.parentNode = this; child.box = this.box; return child; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(item => item !== this); this.parentNode = null; }
  setAttribute(key: string, value: string) { this.attributes[key] = String(value); }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  getBoundingClientRect() { const { left, top, width, height } = this.box; return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }; }
  setPointerCapture(pointerId: number) { this.captured.add(pointerId); }
  releasePointerCapture(pointerId: number) { this.captured.delete(pointerId); }
  hasPointerCapture(pointerId: number) { return this.captured.has(pointerId); }
  focus() { this.focused++; }
  // No 2D context: name labels are skipped, exactly as without a document.
  getContext() { return null; }
}

function installFakeDom(): void {
  const scope = globalThis as Any;
  if (scope.__map3dStub) return;
  scope.__map3dStub = stub;
  const documentTarget = Object.assign(new EventTarget(), { pointerLockElement: null, documentElement: new FakeElement('html'), createElement: (tag: string) => new FakeElement(tag) });
  const windowTarget = Object.assign(new EventTarget(), { devicePixelRatio: 1, setTimeout, clearTimeout,
    matchMedia: () => Object.assign(new EventTarget(), { matches: true }) });
  let nextFrame = 1;
  scope.window = windowTarget;
  scope.document = documentTarget;
  scope.requestAnimationFrame = (callback: (time: number) => void) => { frames.set(nextFrame, callback); return nextFrame++; };
  scope.cancelAnimationFrame = (handle: number) => { frames.delete(handle); };
  scope.getComputedStyle = () => ({ getPropertyValue: (name: string) => themeValues[name] ?? '', fontFamily: 'sans-serif' });
  const observer = (list: Any[]) => class {
    callback: (entries: unknown[]) => void; target: unknown = null;
    constructor(callback: (entries: unknown[]) => void) { this.callback = callback; list.push(this); }
    observe(target: unknown) { this.target = target; }
    disconnect() { this.target = null; }
  };
  scope.ResizeObserver = observer(observers.resize);
  scope.MutationObserver = observer(observers.mutation);
}

// Stands in for THREE.WebGLRenderer: it keeps the matrix updates of a real frame and records what it was asked to do.
const rendererStub = `
export * from 'three';
export class WebGLRenderer {
  constructor(parameters) {
    const stub = globalThis.__map3dStub;
    if (stub.fail) throw new Error('THREE.WebGLRenderer: Error creating WebGL context.');
    this.domElement = parameters.canvas; this.calls = []; this.renders = 0; this.scissorTest = false;
    stub.renderers.push(this);
  }
  getContext() { return { isContextLost: () => false }; }
  setPixelRatio(value) { this.ratio = value; }
  setSize(width, height) { this.size = [width, height]; }
  setClearColor(color) { this.clearColor = color; }
  clear() { this.calls.push('clear'); }
  setViewport(...rect) { this.viewport = rect; }
  setScissor(...rect) { this.scissor = rect; }
  setScissorTest(value) { this.scissorTest = value; }
  render(scene, camera) {
    scene.updateMatrixWorld();
    if (camera.parent === null) camera.updateMatrixWorld();
    this.renders++;
    this.lastCamera = { fov: camera.fov, aspect: camera.aspect, position: camera.position.toArray(), quaternion: camera.quaternion.toArray() };
  }
  dispose() { this.calls.push('dispose'); }
  // A real context fires this event when it is dropped on purpose.
  forceContextLoss() { this.calls.push('forceContextLoss'); this.domElement.dispatchEvent(new Event('webglcontextlost')); }
}
`;
let viewportModule: Promise<ViewportModule> | null = null;
function loadViewport(): Promise<ViewportModule> {
  viewportModule ??= (async () => {
    installFakeDom();
    const directory = fileURLToPath(new URL('../src/features/backgrounds/', import.meta.url));
    // The viewport class is private to the component file; the bundle reaches it through one appended export.
    const contents = `${readFileSync(`${directory}BackgroundMap3D.tsx`, 'utf8')}\nexport { Map3DViewport };\n`;
    const result = await build({
      stdin: { contents, resolveDir: directory, sourcefile: 'BackgroundMap3D.tsx', loader: 'tsx' },
      bundle: true, format: 'cjs', platform: 'node', target: 'node22', write: false, logLevel: 'silent', jsx: 'automatic',
      loader: { '.css': 'empty' }, define: { 'import.meta.env.DEV': 'true' },
      plugins: [{ name: 'renderer-stub', setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^three$/ }, args => args.namespace === 'renderer-stub' ? undefined : { path: 'three', namespace: 'renderer-stub' });
        pluginBuild.onLoad({ filter: /.*/, namespace: 'renderer-stub' }, () => ({ contents: rendererStub, resolveDir: directory, loader: 'js' }));
      } }],
    });
    const module = { exports: {} as Record<string, unknown> };
    new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
    return module.exports as unknown as ViewportModule;
  })();
  return viewportModule;
}

const viewRoom = space(1, { name: '교실', childMapId: id(901) });
const viewChair = symbol(12, 'chair', { spaceId: viewRoom.id });
const viewLockedTable = symbol(13, 'table', { x: 700, y: 450, width: 180, height: 110, locked: true });
const viewLens = camera(20, { x: 600, y: 200, angle: 135 });
const viewMap = mapOf([viewRoom, viewChair, viewLockedTable, viewLens]);

type EditorState = Pick<Map3DProps, 'map' | 'selectedId' | 'canEdit' | 'tool' | 'gizmoMode' | 'placing' | 'focusRequest' | 'initialView' | 'lookThroughId'>;
type EditorWiring = (state: EditorState, changed: () => void) => Partial<Map3DProps>;
/**
 * A stand-in for the editor: it owns the draft, runs the shared gesture primitives and re-renders the viewport.
 * `wire` replaces some of its callbacks, e.g. with the real map document.
 */
async function mountViewport(overrides: Partial<EditorState> = {}, size: [number, number] = [800, 500], wire?: EditorWiring) {
  const { Map3DViewport } = await loadViewport();
  frames.clear(); stub.renderers.length = 0; stub.fail = false; observers.resize.length = 0; observers.mutation.length = 0; themeValues = {};
  const log: [string, unknown?][] = [], undo: BackgroundMap[] = [];
  const state: EditorState = { map: viewMap, selectedId: null, canEdit: true, tool: 'select', gizmoMode: 'translate', placing: false, focusRequest: null,
    initialView: null, lookThroughId: null, ...overrides };
  let gesture: MapGesture | null = null, dirty = false;
  const props = (): Map3DProps => ({
    ...state,
    onSelect: value => { log.push(['select', value]); state.selectedId = value; dirty = true; },
    onBeginGesture: () => { log.push(['begin']); gesture = beginMapGesture(state.map); },
    onPreview: next => {
      log.push(['preview']);
      assert.ok(gesture, 'a preview needs a running gesture');
      gesture = previewMapGesture(gesture, next); state.map = next; dirty = true;
    },
    onFinishGesture: () => {
      log.push(['finish']);
      assert.ok(gesture, 'a finish needs a running gesture');
      const result = finishMapGesture(gesture);
      gesture = null; state.map = result.value; dirty = true;
      if (result.historyEntry) undo.push(result.historyEntry);
    },
    onCancelGesture: () => { log.push(['cancel']); if (gesture) state.map = gesture.initial; gesture = null; dirty = true; },
    onPlace: point => { log.push(['place', point]); },
    onViewChange: view => { log.push(['view', view]); },
    onLookThroughChange: value => { log.push(['look', value]); state.lookThroughId = value; dirty = true; },
    onOpenSpace: value => { log.push(['open', value]); },
    onUnavailable: reason => { log.push(['unavailable', reason]); },
    ...wire?.(state, () => { dirty = true; }),
  });
  const host = new FakeElement('div'), stage = new FakeElement('div');
  host.box = { left: 40, top: 30, width: size[0], height: size[1] };
  host.appendChild(stage);
  const viewport = new Map3DViewport(host, stage, props(), text => { log.push(['notice', text]); });
  viewport.update(props());
  const renderer = stub.renderers[stub.renderers.length - 1];
  const dev = (): Any => (globalThis as Any).window.__bflowMap3d;
  const canvas = (): FakeElement => stage.children[0];
  /** What React does after the editor's state changed. */
  const render = (changes?: Partial<EditorState>) => { if (changes) Object.assign(state, changes); dirty = false; viewport.update(props()); };
  const settle = () => { if (dirty) render(); };
  const fire = (type: string, at: ScreenPoint, extra: Record<string, unknown> = {}) => {
    const make = () => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: at.x, clientY: at.y, pageX: at.x, pageY: at.y, button: 0, buttons: 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, ctrlKey: false, metaKey: false, shiftKey: false, deltaY: 0, deltaMode: 0, ...extra });
    const event = make();
    canvas().dispatchEvent(event);
    // Bubbling to the document, where OrbitControls listens while a pointer is down.
    if (type === 'pointermove' || type === 'pointerup') (globalThis as Any).document.dispatchEvent(make());
    settle();
    return event;
  };
  const press = (at: ScreenPoint, extra?: Record<string, unknown>) => { fire('pointerdown', at, extra); fire('mousedown', at, extra); };
  const move = (at: ScreenPoint, extra?: Record<string, unknown>) => fire('pointermove', at, { button: -1, ...extra });
  const release = (at: ScreenPoint, extra?: Record<string, unknown>) => {
    fire('pointerup', at, extra);
    if (stage.children.length && canvas().captured.size === 0) { canvas().dispatchEvent(new Event('lostpointercapture')); settle(); }
  };
  const root = (nodeId: string): Any => dev().scene.getObjectByName('map-nodes').children.find((child: Any) => child.userData.nodeId === nodeId);
  const toScreen = (point: Any): ScreenPoint => {
    dev().camera.updateMatrixWorld();
    const projected = point.project(dev().camera);
    return { x: host.box.left + (projected.x + 1) / 2 * host.box.width, y: host.box.top + (1 - projected.y) / 2 * host.box.height };
  };
  return {
    log, undo, state, host, stage, viewport, renderer, dev, canvas, render, settle, fire, press, move, release, root,
    get gesture() { return gesture; },
    names: () => log.map(entry => entry[0]),
    count: (name: string) => log.filter(entry => entry[0] === name).length,
    clear: () => { log.length = 0; },
    click: (at: ScreenPoint) => { press(at); release(at); },
    /** One animation frame, then (unless told otherwise) the re-render it caused. */
    frame: (rerender = true) => {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(16);
      if (rerender) settle();
      return callbacks.length;
    },
    resize: (width: number, height: number) => { host.box.width = width; host.box.height = height; for (const item of observers.resize) if (item.target === host) item.callback([]); },
    view: (): Map3DViewState => ({ target: dev().orbit.target.toArray(), position: dev().camera.position.toArray() }),
    node: (nodeId: string) => state.map.nodes.find(item => item.id === nodeId),
    screen: (nodeId: string): ScreenPoint => dev().nodeScreenPoint(nodeId),
    /** Screen position of a world point. */
    at: (x: number, y: number, z: number): ScreenPoint => toScreen(dev().orbit.target.clone().set(x, y, z)),
    /** Screen position on a handle of the attached gizmo: `reach` 0.3 is on an arrow or size handle, 0.5 on a turn ring. */
    handle: (nodeId: string, axis: 'X' | 'Y' | 'Z', reach = 0.3): ScreenPoint => {
      const viewer = dev().camera, position = root(nodeId).position;
      const factor = viewer.position.distanceTo(position) * Math.min(1.9 * Math.tan(Math.PI * viewer.fov / 360) / viewer.zoom, 7);
      const length = reach * factor * dev().transform.size / 4;
      return toScreen(position.clone().set(position.x + (axis === 'X' ? length : 0), position.y + (axis === 'Y' ? length : 0), position.z + (axis === 'Z' ? length : 0)));
    },
  };
}
const nearList = (actual: readonly number[], expected: readonly number[], label: string, tolerance = 1e-6) =>
  expected.forEach((value, index) => near(actual[index], value, `${label}[${index}]`, tolerance));

test('viewport: one renderer, first frame in the same turn, fitted view, clean exit without a failure report', async () => {
  const editor = await mountViewport();
  const { renderer, dev } = editor;
  assert.equal(stub.renderers.length, 1);
  assert.deepEqual([renderer.size, renderer.ratio, renderer.renders], [[800, 500], 1, 1], 'sized and drawn before the first paint');
  assert.equal(editor.canvas().tagName, 'canvas');
  for (const key of ['scene', 'camera', 'renderer', 'orbit', 'transform', 'nodeScreenPoint', 'render']) assert.ok(dev()[key], `dev handle exposes ${key}`);
  same(dev().renderer, renderer, 'dev handle renderer');
  assert.deepEqual(editor.names(), [], 'opening a map reports nothing');
  const view = editor.view();
  near(view.target[0], 500, 'fit target x'); near(view.target[2], 340, 'fit target z');
  assert.ok(view.position[1] > view.target[1] && view.position[2] > view.target[2], 'looking down from the plan bottom side');
  for (const node of viewMap.nodes) {
    const point = editor.screen(node.id);
    assert.ok(point.x > 40 && point.x < 840 && point.y > 30 && point.y < 530, `${node.name} is inside the fitted view`);
  }
  same(dev().nodeScreenPoint(id(999)), null, 'unknown node');
  dev().render();
  assert.equal(renderer.renders, 2, 'the dev handle can draw on request');
  editor.viewport.dispose();
  same((globalThis as Any).window.__bflowMap3d, undefined, 'dev handle removed');
  assert.equal(editor.stage.children.length, 0, 'canvas removed');
  assert.deepEqual(renderer.calls.slice(-2), ['dispose', 'forceContextLoss']);
  assert.equal(editor.count('unavailable'), 0, 'leaving never reports a failure');
});

test('viewport: looking around and editing are separate, and the view is reported when an orbit ends', async () => {
  const editor = await mountViewport();
  const start = editor.view(), empty = { x: 60, y: 50 };
  editor.press(empty); editor.move({ x: 160, y: 120 }); editor.move({ x: 260, y: 150 }); editor.release({ x: 260, y: 150 });
  assert.deepEqual(editor.view(), start, 'select tool: a left drag does not turn the world');
  assert.deepEqual(editor.names(), [], 'a drag is not a click');
  editor.press(empty, { button: 2, buttons: 2 }); editor.move({ x: 160, y: 80 }, { buttons: 2 }); editor.move({ x: 200, y: 90 }, { buttons: 2 });
  assert.equal(editor.count('view'), 0, 'no report while turning');
  editor.release({ x: 200, y: 90 }, { button: 2, buttons: 0 });
  const turned = editor.view();
  nearList(turned.target, start.target, 'orbit target', 1e-9);
  assert.ok(Math.hypot(turned.position[0] - start.position[0], turned.position[2] - start.position[2]) > 10, 'a right drag turns the world');
  assert.deepEqual(editor.log, [['view', turned]]);
  editor.press(empty, { button: 1, buttons: 4 }); editor.move({ x: 120, y: 90 }, { buttons: 4 }); editor.release({ x: 120, y: 90 }, { button: 1, buttons: 0 });
  const panned = editor.view();
  assert.ok(Math.hypot(panned.target[0] - turned.target[0], panned.target[2] - turned.target[2]) > 5, 'a middle drag pans');
  near(panned.target[1], turned.target[1], 'panning stays level', 1e-9);
  assert.equal(editor.count('view'), 2);
  assert.equal(editor.fire('contextmenu', empty).defaultPrevented, true, 'no context menu on the canvas');
  editor.fire('wheel', { x: 400, y: 300 }, { deltaY: -120 });
  assert.ok(editor.dev().camera.position.distanceTo(editor.dev().orbit.target) < Math.hypot(...panned.position.map((value, index) => value - panned.target[index])), 'the wheel zooms in');
  // The look tool turns with the left button and never selects.
  editor.clear();
  editor.render({ tool: 'look' });
  const before = editor.view();
  editor.press(empty); editor.move({ x: 140, y: 60 }); editor.release({ x: 140, y: 60 });
  assert.ok(Math.hypot(editor.view().position[0] - before.position[0], editor.view().position[2] - before.position[2]) > 10, 'look tool: a left drag turns the world');
  assert.equal(editor.count('view'), 1);
  editor.clear();
  editor.click(editor.screen(viewLens.id));
  assert.equal(editor.count('select'), 0, 'the look tool only looks');
  editor.viewport.dispose();
});

test('viewport: click selects, an empty click clears, and the view buttons work', async () => {
  const editor = await mountViewport({ canEdit: false });
  editor.click(editor.screen(viewLens.id));
  assert.deepEqual(editor.log, [['select', viewLens.id]]);
  assert.ok(editor.host.focused > 0, 'the viewport takes keyboard focus, so the editor shortcuts keep working');
  same(editor.dev().transform.object, undefined, 'selectable, but no gizmo without edit permission');
  editor.clear();
  editor.click({ x: 60, y: 520 });
  assert.deepEqual(editor.log, [['select', null]]);
  editor.clear();
  const distance = () => editor.dev().camera.position.distanceTo(editor.dev().orbit.target), before = distance();
  editor.viewport.zoom(0.8);
  near(distance(), before * 0.8, 'zoom in');
  editor.viewport.zoom(1.25);
  near(distance(), before, 'zoom out');
  assert.equal(editor.count('view'), 2);
  editor.viewport.topDown();
  const top = editor.view(), room = editor.screen(viewRoom.id), table = editor.screen(viewLockedTable.id);
  near(top.position[0], top.target[0], 'straight above');
  assert.ok(room.x < table.x && room.y < table.y, 'top-down is turned like the plan');
  editor.viewport.fit();
  assert.equal(editor.count('view'), 4);
  editor.viewport.dispose();
});

test('viewport: a gizmo drag is one undo step, previews once per frame, and never turns the world', async () => {
  const editor = await mountViewport({ selectedId: viewLens.id });
  const { dev } = editor;
  same(dev().transform.object, editor.root(viewLens.id), 'gizmo on the selected camera');
  editor.frame();
  const start = editor.view(), handle = editor.handle(viewLens.id, 'X');
  editor.move(handle);
  assert.equal(dev().transform.axis, 'X', 'the pointer is over the X arrow');
  editor.press(handle);
  assert.deepEqual(editor.names(), ['begin']);
  assert.equal(dev().orbit.enabled, false, 'orbiting is off for the drag');
  editor.move({ x: handle.x + 2, y: handle.y });
  editor.frame();
  assert.deepEqual(editor.names(), ['begin'], 'inside the click slop nothing is previewed');
  editor.move({ x: handle.x + 20, y: handle.y }); editor.move({ x: handle.x + 40, y: handle.y }); editor.move({ x: handle.x + 60, y: handle.y });
  assert.deepEqual(editor.names(), ['begin'], 'pointer moves wait for the frame');
  editor.frame();
  assert.deepEqual(editor.names(), ['begin', 'preview']);
  const dragged = editor.node(viewLens.id) as BackgroundCamera;
  assert.ok(Math.abs(dragged.x - viewLens.x) > 5, 'the camera moved along x');
  assert.deepEqual([dragged.y, dragged.angle, 'elevation' in dragged, 'pitch' in dragged], [viewLens.y, viewLens.angle, false, false]);
  assert.deepEqual(editor.view(), start, 'the world did not turn');
  assert.equal(dev().orbit.enabled, false, 'orbiting stays off through the re-renders of a drag');
  editor.move({ x: handle.x + 80, y: handle.y });
  editor.release({ x: handle.x + 80, y: handle.y });
  assert.deepEqual(editor.names(), ['begin', 'preview', 'preview', 'finish']);
  assert.equal(getEventListeners((globalThis as Any).window, 'keydown').length, 0, 'the Escape listener only lives during a drag');
  assert.deepEqual(editor.undo, [viewMap], 'one drag, one undo entry');
  same(editor.gesture, null, 'gesture closed');
  assert.equal(dev().orbit.enabled, true, 'orbiting is back');
  assert.deepEqual(editor.view(), start);
  editor.frame();
  const final = editor.node(viewLens.id) as BackgroundCamera, root = editor.root(viewLens.id);
  nearList(root.position.toArray(), [final.x, 120, final.y], 'root follows the data after the drag');
  assert.deepEqual(root.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(editor.names(), ['begin', 'preview', 'preview', 'finish'], 'the end of a drag is neither a click nor a view change');
  // A plain click on a handle is no edit at all.
  editor.clear();
  const lift = editor.handle(viewLens.id, 'Y');
  editor.move(lift); editor.click(lift);
  assert.deepEqual(editor.names(), ['begin', 'finish']);
  assert.equal(editor.undo.length, 1);
  same(editor.node(viewLens.id), final, 'data untouched by a click');
  editor.viewport.dispose();
  assert.equal(editor.count('cancel'), 0);
});

test('viewport: an arrow is grabbed along its whole drawn length, from the base of the shaft to the tip of the head', async () => {
  const editor = await mountViewport({ selectedId: viewLens.id });
  const { dev } = editor;
  editor.frame();
  // The base of the upright shaft, right next to the centre dot: a drag from there lifts the camera and moves it nowhere on the plan.
  const base = editor.handle(viewLens.id, 'Y', 0.1);
  editor.move(base);
  assert.equal(dev().transform.axis, 'Y', 'the base of the shaft belongs to the arrow, not to the free-move centre');
  editor.press(base);
  editor.move({ x: base.x, y: base.y - 30 }); editor.frame();
  editor.move({ x: base.x, y: base.y - 60 });
  editor.release({ x: base.x, y: base.y - 60 });
  assert.deepEqual(editor.names(), ['begin', 'preview', 'preview', 'finish']);
  const lifted = editor.node(viewLens.id) as BackgroundCamera;
  assert.deepEqual([lifted.x, lifted.y, lifted.angle], [viewLens.x, viewLens.y, viewLens.angle], 'the plan position is untouched');
  assert.ok((lifted.elevation ?? 0) > 130, `the camera went up (${lifted.elevation})`);
  // The very tip of an arrow head: the click belongs to the handle, so the room behind it is not selected instead.
  editor.frame(); editor.clear();
  const tip = editor.handle(viewLens.id, 'X', 0.63);
  editor.move(tip);
  assert.equal(dev().transform.axis, 'X', 'the tip of the head belongs to the arrow');
  editor.click(tip);
  assert.deepEqual(editor.names(), ['begin', 'finish'], 'a click on the handle, not a selection');
  assert.equal(editor.state.selectedId, viewLens.id);
  editor.viewport.dispose();
});

test('viewport: every interruption of a drag cancels it exactly once and never commits', async () => {
  type Editor = Awaited<ReturnType<typeof mountViewport>>;
  const lost = (editor: Editor, type: string) => { editor.canvas().dispatchEvent(new Event(type, { cancelable: true })); editor.settle(); };
  const interruptions: [string, (editor: Editor) => void][] = [
    ['Escape', editor => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
      (globalThis as Any).window.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    }],
    ['pointer cancel', editor => { editor.fire('pointercancel', { x: 0, y: 0 }); }],
    ['lost pointer capture', editor => lost(editor, 'lostpointercapture')],
    ['tool change', editor => editor.render({ tool: 'look' })],
    ['edit permission lost', editor => editor.render({ canEdit: false })],
    ['gizmo mode change', editor => editor.render({ gizmoMode: 'rotate' })],
    ['selection change', editor => editor.render({ selectedId: viewChair.id })],
    ['lock', editor => editor.render({ map: { ...editor.state.map, nodes: editor.state.map.nodes.map(node => node.id === viewLens.id ? { ...node, locked: true } : node) } })],
    ['look-through', editor => editor.render({ lookThroughId: viewLens.id })],
    ['placing', editor => editor.render({ placing: true })],
    ['map change', editor => editor.render({ map: { ...editor.state.map, id: id(950) } })],
    ['context lost', editor => lost(editor, 'webglcontextlost')],
    ['unmount', editor => editor.viewport.dispose()],
  ];
  for (const [label, interrupt] of interruptions) {
    const editor = await mountViewport({ selectedId: viewLens.id });
    editor.frame();
    const handle = editor.handle(viewLens.id, 'X');
    editor.move(handle); editor.press(handle); editor.move({ x: handle.x + 30, y: handle.y }); editor.frame(); editor.move({ x: handle.x + 50, y: handle.y });
    assert.deepEqual(editor.names(), ['begin', 'preview'], label);
    assert.notEqual((editor.node(viewLens.id) as BackgroundCamera).x, viewLens.x, label);
    interrupt(editor);
    editor.settle();
    const outcome = () => [editor.count('cancel'), editor.count('finish'), editor.count('preview'), editor.count('select'), editor.undo.length, editor.gesture];
    assert.deepEqual(outcome(), [1, 0, 1, 0, 0, null], `${label}: cancelled once, never finished, pending preview dropped`);
    if (label === 'unmount') continue;
    if (label !== 'map change' && label !== 'lock') same(editor.node(viewLens.id), viewLens, `${label}: data restored`);
    assert.equal(editor.dev().orbit.enabled, label !== 'look-through', `${label}: orbiting restored`);
    assert.equal(editor.dev().transform.dragging, false, label);
    editor.frame();
    // The pointer is still down: its late release is neither a finish nor a click.
    editor.release({ x: handle.x + 50, y: handle.y });
    editor.frame();
    assert.deepEqual(outcome(), [1, 0, 1, 0, 0, null], `${label}: nothing more after the late release`);
    if (label !== 'lock' && label !== 'look-through') nearList(editor.root(viewLens.id).position.toArray(), [viewLens.x, 120, viewLens.y], `${label}: root restored`);
    assert.equal(editor.count('unavailable'), label === 'context lost' ? 1 : 0, label);
    editor.viewport.dispose();
    assert.equal(editor.count('cancel'), 1, `${label}: dispose adds no second cancel`);
  }
});

test('viewport: size and turn drags follow the data, rebuild the root unscaled, and carry members once', async () => {
  const editor = await mountViewport({ selectedId: viewChair.id, gizmoMode: 'scale' });
  const { dev } = editor;
  editor.frame();
  const start = editor.view();
  let handle = editor.handle(viewChair.id, 'X');
  editor.move(handle);
  assert.equal(dev().transform.axis, 'X');
  editor.press(handle); editor.move({ x: handle.x + 25, y: handle.y }); editor.frame(); editor.move({ x: handle.x + 45, y: handle.y });
  assert.notEqual(editor.root(viewChair.id).scale.x, 1, 'while dragging, the gizmo scales the root');
  editor.release({ x: handle.x + 45, y: handle.y });
  editor.frame();
  const sized = editor.node(viewChair.id) as BackgroundSymbol;
  assert.notEqual(sized.width, viewChair.width);
  assert.deepEqual([sized.height, 'volumeHeight' in sized, 'elevation' in sized], [viewChair.height, false, false], 'only the dragged axis is written');
  near(sized.x + sized.width / 2, viewChair.x + viewChair.width / 2, 'the base centre stays', 1e-3);
  assert.deepEqual(editor.root(viewChair.id).scale.toArray(), [1, 1, 1], 'after the drag the root is unscaled again');
  near(editor.root(viewChair.id).getObjectByName('symbol-body').scale.x, sized.width, 'rebuilt at the new size');
  assert.deepEqual(editor.names(), ['begin', 'preview', 'preview', 'finish']);
  // Turn the room with its only ring.
  editor.render({ selectedId: viewRoom.id, gizmoMode: 'rotate' });
  editor.frame();
  handle = editor.handle(viewRoom.id, 'X', 0.5);
  editor.move(handle);
  assert.equal(dev().transform.axis, 'Y', 'a space only offers the vertical ring');
  editor.press(handle); editor.move({ x: handle.x + 6, y: handle.y + 30 }); editor.frame(); editor.move({ x: handle.x + 10, y: handle.y + 55 });
  editor.release({ x: handle.x + 10, y: handle.y + 55 });
  editor.frame();
  const turned = editor.node(viewRoom.id) as BackgroundSpace, carried = editor.node(viewChair.id) as BackgroundSymbol;
  assert.ok(Math.abs(turned.rotation) > 1 && Math.abs(turned.rotation - 360) > 1, 'the room turned');
  assert.deepEqual([turned.x, turned.y, turned.width, turned.height], [viewRoom.x, viewRoom.y, viewRoom.width, viewRoom.height]);
  assert.ok(Math.hypot(carried.x - sized.x, carried.y - sized.y) > 1, 'the member chair was carried around');
  near(carried.rotation, turned.rotation, 'and turned with its room');
  same(editor.node(viewLockedTable.id), viewLockedTable, 'outsiders stay');
  same(editor.node(viewLens.id), viewLens, 'outsiders stay');
  const pose = nodeWorldPose(carried);
  nearList(editor.root(viewChair.id).position.toArray(), [pose.position.x, pose.position.y, pose.position.z], 'chair root from its own data');
  same(editor.root(viewChair.id).parent, editor.root(viewRoom.id).parent, 'carried, not parented');
  assert.equal(editor.undo.length, 2);
  assert.deepEqual(editor.view(), start, 'no gizmo drag turned the world');
  assert.equal(editor.count('view'), 0);
  // While the room is moved, its members follow in the very frame of the preview, before the editor re-renders.
  editor.render({ gizmoMode: 'translate' });
  editor.frame();
  const before = editor.root(viewChair.id).position.x;
  handle = editor.handle(viewRoom.id, 'X');
  editor.move(handle); editor.press(handle); editor.move({ x: handle.x + 40, y: handle.y });
  editor.frame(false);
  assert.ok(Math.abs(editor.root(viewChair.id).position.x - before) > 1, 'the member moved with the preview');
  editor.settle();
  editor.release({ x: handle.x + 40, y: handle.y });
  editor.viewport.dispose();

  // A drag the data cannot follow (already at the smallest size) still leaves the root unscaled afterwards.
  const tiny = symbol(14, 'custom', { x: 500, y: 300, width: 10, height: 10 });
  const small = await mountViewport({ map: mapOf([tiny]), selectedId: tiny.id, gizmoMode: 'scale' });
  small.frame();
  const grip = small.handle(tiny.id, 'X'), centre = small.screen(tiny.id);
  small.move(grip); small.press(grip);
  const inward = { x: grip.x + (centre.x - grip.x) * 0.6, y: grip.y + (centre.y - grip.y) * 0.6 };
  small.move(inward); small.frame();
  assert.ok(small.root(tiny.id).scale.x < 0.9, 'the gizmo shrank the root');
  small.release(inward);
  small.frame();
  same(small.node(tiny.id), tiny, 'nothing smaller than the minimum is stored');
  assert.deepEqual(small.root(tiny.id).scale.toArray(), [1, 1, 1], 'the root is reset to the data');
  assert.equal(small.undo.length, 0);
  small.viewport.dispose();
});

test('viewport: the gizmo is offered only for an unlocked selection while editing with the select tool', async () => {
  const editor = await mountViewport({ selectedId: viewLockedTable.id });
  const transform = editor.dev().transform;
  const attached = (label: string, node: BackgroundNode | null) => same(transform.object, node ? editor.root(node.id) : undefined, label);
  attached('locked: selectable but no gizmo', null);
  editor.click(editor.screen(viewLockedTable.id));
  assert.deepEqual(editor.log, [['select', viewLockedTable.id]]);
  editor.render({ selectedId: viewRoom.id, gizmoMode: 'rotate' });
  attached('space', viewRoom);
  assert.deepEqual([transform.mode, transform.space, transform.showX, transform.showY, transform.showZ], ['rotate', 'world', false, true, false]);
  editor.render({ selectedId: viewChair.id });
  assert.deepEqual([transform.mode, transform.space, transform.showX, transform.showY, transform.showZ], ['rotate', 'local', true, true, true]);
  editor.render({ selectedId: viewLens.id, gizmoMode: 'scale' });
  attached('a camera has no size', null);
  editor.render({ gizmoMode: 'translate' });
  attached('camera', viewLens);
  editor.render({ tool: 'look' });
  attached('the look tool hides the gizmo', null);
  editor.render({ tool: 'select', canEdit: false });
  attached('no edit permission', null);
  editor.render({ canEdit: true, placing: true });
  attached('placing', null);
  editor.render({ placing: false, lookThroughId: viewLens.id });
  attached('camera preview', null);
  editor.render({ lookThroughId: null, selectedId: null });
  attached('nothing selected', null);
  editor.viewport.dispose();
});

test('viewport: placing reports the floor point instead of selecting', async () => {
  const editor = await mountViewport({ placing: true, selectedId: viewLens.id });
  editor.click(editor.at(250, 0, 180));
  assert.deepEqual(editor.names(), ['place']);
  const point = editor.log[0][1] as BackgroundPoint;
  near(point.x, 250, 'floor x', 0.02); near(point.y, 180, 'floor y', 0.02);
  // Nearly level with the horizon: the top of the screen shows no floor.
  editor.clear();
  editor.dev().orbit.target.set(500, 0, 340); editor.dev().camera.position.set(500, 12, 1400); editor.dev().orbit.update();
  editor.frame();
  editor.click({ x: 440, y: 31 });
  // The view was moved by hand above, so the end of this press also reports it; nothing is placed or selected.
  assert.deepEqual(editor.names().filter(name => name !== 'view'), ['notice']);
  editor.viewport.dispose();
});

test('viewport: placing lands on the floor under the pointer, whatever its level', async () => {
  const upper = space(1, { x: 300, y: 200, width: 400, height: 280, elevation: 200 }), pit = space(2, { x: 60, y: 440, width: 200, height: 180, elevation: -80 });
  const inner = space(3, { x: 420, y: 260, width: 120, height: 100, elevation: 200 });
  const editor = await mountViewport({ map: mapOf([upper, pit, inner]), placing: true });
  const placed = (at: ScreenPoint): BackgroundPoint => { editor.clear(); editor.click(at); assert.deepEqual(editor.names(), ['place']); return editor.log[0][1] as BackgroundPoint; };
  // The middle of the raised floor as it is seen on screen. Projected onto the ground it would land far outside the room.
  let point = placed(editor.at(600, 200, 430));
  near(point.x, 600, 'raised floor x', 0.02); near(point.y, 430, 'raised floor y', 0.02);
  // A room on the raised floor shares its level: the point is the same whichever of the two is on top.
  point = placed(editor.at(480, 200, 310));
  near(point.x, 480, 'shared level x', 0.02); near(point.y, 310, 'shared level y', 0.02);
  // A sunken floor is seen through the ground.
  point = placed(editor.at(160, -80, 530));
  near(point.x, 160, 'sunken floor x', 0.02); near(point.y, 530, 'sunken floor y', 0.02);
  // Where no space is, the ground itself takes the click.
  point = placed(editor.at(850, 0, 120));
  near(point.x, 850, 'ground x', 0.02); near(point.y, 120, 'ground y', 0.02);
  // From straight above the level makes no difference.
  editor.viewport.topDown();
  point = placed(editor.at(600, 200, 430));
  near(point.x, 600, 'top view x', 0.02); near(point.y, 430, 'top view y', 0.02);
  editor.viewport.dispose();
});

test('viewport: a click and a double click take the room whose floor is under the pointer', async () => {
  const classroom = space(1, { name: '교실', x: 100, y: 100, width: 400, height: 260, childMapId: id(901) });
  const corridor = space(2, { name: '복도', x: 100, y: 420, width: 300, height: 120, childMapId: id(902) });
  const nook = space(3, { name: '안쪽 방', x: 300, y: 150, width: 120, height: 100, childMapId: id(903) });
  const editor = await mountViewport({ map: mapOf([nook, classroom, corridor]), canEdit: false });
  for (const [x, z] of [[200, 330], [250, 280], [150, 240], [460, 340]]) {
    editor.click(editor.at(x, 0, z));
    assert.equal(editor.state.selectedId, classroom.id, `classroom floor ${x},${z}`);
  }
  editor.click(editor.at(200, 0, 480));
  assert.equal(editor.state.selectedId, corridor.id);
  editor.click(editor.at(360, 0, 200));
  assert.equal(editor.state.selectedId, nook.id, 'the room drawn inside the classroom');
  editor.clear();
  editor.fire('dblclick', editor.at(200, 0, 300));
  editor.fire('dblclick', editor.at(360, 0, 200));
  editor.fire('dblclick', editor.at(250, 0, 500));
  assert.deepEqual(editor.log.filter(entry => entry[0] === 'open'), [['open', classroom.id], ['open', nook.id], ['open', corridor.id]]);
  editor.viewport.topDown();
  editor.clear();
  editor.fire('dblclick', editor.at(360, 0, 200));
  editor.fire('dblclick', editor.at(200, 0, 300));
  assert.deepEqual(editor.log.filter(entry => entry[0] === 'open'), [['open', nook.id], ['open', classroom.id]]);
  editor.viewport.dispose();
});

test('viewport: a press at the centre of the size gizmo never scales, and the axis handles still do', async () => {
  const room = space(1, { x: 350, y: 240, width: 300, height: 200 }), chair = symbol(12, 'chair', { x: 470, y: 310, spaceId: room.id });
  const map = mapOf([room, chair]);
  const editor = await mountViewport({ map, selectedId: room.id, gizmoMode: 'scale' });
  editor.frame();
  const centre = editor.screen(room.id);
  for (const offset of [1, 3, 6]) {
    const start = { x: centre.x + offset, y: centre.y };
    editor.move(start);
    assert.equal(editor.dev().transform.axis, null, 'the centre lights up no handle');
    editor.press(start);
    assert.equal(editor.dev().transform.dragging, false, `press ${offset}px from the centre`);
    editor.move({ x: start.x + 12, y: start.y }); editor.move({ x: start.x + 30, y: start.y }); editor.frame();
    editor.move({ x: start.x - 12, y: start.y }); editor.frame();
    editor.release({ x: start.x - 12, y: start.y }); editor.frame();
  }
  same(editor.state.map, map, 'the map is untouched');
  assert.deepEqual([editor.count('begin'), editor.count('preview'), editor.undo.length], [0, 0, 0]);
  assert.deepEqual(editor.root(room.id).scale.toArray(), [1, 1, 1]);
  assert.equal(editor.dev().orbit.enabled, true);
  const grip = editor.handle(room.id, 'X', 0.5);
  editor.move(grip);
  assert.equal(editor.dev().transform.axis, 'X');
  editor.press(grip); editor.move({ x: grip.x + 20, y: grip.y }); editor.frame(); editor.release({ x: grip.x + 20, y: grip.y }); editor.frame();
  const sized = editor.node(room.id) as BackgroundSpace;
  assert.ok(sized.width > room.width && sized.width < room.width * 2, `a handle sizes in proportion: ${sized.width}`);
  assert.equal(editor.undo.length, 1);
  editor.viewport.dispose();
});

test('viewport: letting go of the left button while another one is down ends the drag as one undo step', async () => {
  const editor = await mountViewport({ selectedId: viewLens.id });
  editor.frame();
  const start = editor.view(), handle = editor.handle(viewLens.id, 'X');
  editor.move(handle); editor.press(handle);
  editor.move({ x: handle.x + 30, y: handle.y }); editor.frame();
  // A second button going down, then the left one going up: browsers report both as moves.
  editor.move({ x: handle.x + 30, y: handle.y }, { button: 2, buttons: 3 });
  assert.equal(editor.count('finish'), 0, 'still dragging with both buttons down');
  editor.move({ x: handle.x + 40, y: handle.y }, { button: -1, buttons: 3 });
  editor.move({ x: handle.x + 40, y: handle.y }, { button: 0, buttons: 2 });
  assert.deepEqual(editor.names().filter(name => name !== 'preview'), ['begin', 'finish']);
  assert.equal(editor.undo.length, 1);
  same(editor.gesture, null, 'gesture closed');
  assert.deepEqual([editor.dev().transform.dragging, editor.dev().orbit.enabled], [false, true]);
  const moved = editor.node(viewLens.id) as BackgroundCamera;
  assert.ok(moved.x - viewLens.x > 5);
  // The other button alone moves nothing, and its release is neither a click nor a cancel.
  editor.clear();
  editor.move({ x: handle.x + 90, y: handle.y }, { buttons: 2 }); editor.frame();
  editor.release({ x: handle.x + 90, y: handle.y }, { button: 2, buttons: 0 }); editor.frame();
  assert.deepEqual(editor.names(), []);
  same(editor.node(viewLens.id), moved, 'nothing after the release');
  assert.deepEqual(editor.view(), start, 'the world did not turn');
  assert.equal(getEventListeners((globalThis as Any).window, 'keydown').length, 0);
  // The next drag works as usual.
  const again = editor.handle(viewLens.id, 'X');
  editor.move(again); editor.press(again); editor.move({ x: again.x + 20, y: again.y }); editor.release({ x: again.x + 20, y: again.y });
  assert.deepEqual([editor.count('begin'), editor.count('finish'), editor.count('cancel'), editor.undo.length], [1, 1, 0, 2]);
  editor.viewport.dispose();
});

test('viewport: double click opens a space only, and stacked cameras are reached by clicking again', async () => {
  let map = mapOf([viewRoom, viewChair]);
  const stacked = [50, 51, 52].map(id);
  for (const cameraId of stacked) map = addMapCamera(map, cameraId).map;
  const editor = await mountViewport({ map });
  const spot = editor.at(330, 0, 130);
  editor.click(spot); editor.click(spot);
  editor.fire('dblclick', spot);
  assert.deepEqual(editor.log.filter(entry => entry[0] === 'open'), [['open', viewRoom.id]]);
  assert.equal(editor.state.selectedId, viewRoom.id);
  // With the gizmo of the selected room under the pointer the double click still opens it, and edits nothing.
  editor.clear(); editor.frame();
  const centre = editor.screen(viewRoom.id);
  editor.click(centre); editor.click(centre);
  editor.fire('dblclick', centre);
  assert.equal(editor.count('open'), 1);
  assert.equal(editor.undo.length, 0, 'no accidental edit from double clicking the gizmo');
  editor.render({ canEdit: false }); editor.frame(); editor.clear();
  const seat = editor.at(160, 35, 230);
  editor.click(seat);
  assert.equal(editor.state.selectedId, viewChair.id);
  editor.fire('dblclick', seat);
  assert.equal(editor.count('open'), 0, 'a symbol has no detail map');
  // Three cameras created on the default spot.
  editor.render({ selectedId: null });
  const pile = editor.screen(stacked[0]), visited: (string | null)[] = [];
  for (let turn = 0; turn < 4; turn++) { editor.click(pile); visited.push(editor.state.selectedId); }
  assert.deepEqual(new Set(visited.slice(0, 3)), new Set(stacked));
  assert.equal(visited[3], visited[0]);
  editor.viewport.dispose();
});

test('viewport: while editing, the handles cover a pile and a click on them still steps through it', async () => {
  let map = mapOf([viewRoom, viewChair]);
  const stacked = [50, 51, 52].map(id);
  for (const cameraId of stacked) map = addMapCamera(map, cameraId).map;
  // Same plan spot but high above: part of the plan pile, not of what is under the pointer.
  const high = camera(53, { x: DEFAULT_MAP_CAMERA_POSE.x, y: DEFAULT_MAP_CAMERA_POSE.y, elevation: 420 });
  map = { ...map, nodes: [...map.nodes.slice(0, 3), high, ...map.nodes.slice(3)] };
  const editor = await mountViewport({ map, selectedId: stacked[2] });
  const { dev } = editor;
  editor.frame();
  const pile = editor.screen(stacked[2]);
  editor.move(pile);
  assert.equal(dev().transform.axis, 'XYZ', 'the centre handle of the selected camera is under the pointer');
  const visited: (string | null)[] = [];
  for (let turn = 0; turn < 4; turn++) { editor.click(pile); editor.frame(); visited.push(editor.state.selectedId); }
  assert.deepEqual(visited, [stacked[0], stacked[1], stacked[2], stacked[0]], 'every camera of the pile is reached, and only those');
  same(dev().transform.object, editor.root(stacked[0]), 'the gizmo follows the selection');
  assert.deepEqual([editor.count('preview'), editor.undo.length, editor.count('begin') - editor.count('finish'), editor.count('cancel')], [0, 0, 0, 0], 'stepping edits nothing');
  same(editor.state.map, map, 'data untouched');
  // A press on the handle that is cancelled is not a click when it is released.
  editor.clear();
  editor.move(pile); editor.press(pile);
  (globalThis as Any).window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
  editor.settle();
  editor.release(pile);
  assert.deepEqual(editor.names(), ['begin', 'cancel']);
  assert.equal(editor.state.selectedId, stacked[0]);
  // A drag on the pile moves the selected camera and selects nothing else.
  editor.clear();
  editor.move(pile); editor.press(pile); editor.move({ x: pile.x + 30, y: pile.y }); editor.frame(); editor.release({ x: pile.x + 30, y: pile.y });
  assert.equal(editor.count('select'), 0);
  assert.equal(editor.undo.length, 1);
  assert.notDeepEqual(editor.node(stacked[0]), map.nodes.find(node => node.id === stacked[0]));
  same(editor.node(stacked[1]), map.nodes.find(node => node.id === stacked[1]), 'the others of the pile stay');
  // The one above is clicked where it stands, and the handle of a lone item selects nothing.
  editor.frame(); editor.clear();
  editor.click(editor.screen(high.id));
  assert.deepEqual(editor.log, [['select', high.id]]);
  editor.render({ selectedId: viewChair.id }); editor.frame(); editor.clear();
  const seat = editor.screen(viewChair.id);
  editor.move(seat);
  assert.equal(dev().transform.axis, 'XYZ');
  editor.click(seat);
  assert.deepEqual(editor.names(), ['begin', 'finish'], 'a click on the handle of a lone item changes nothing');
  editor.viewport.dispose();

  // An arrow of the selected camera may lie over another camera of the same plan spot: a click on that arrow selects nothing.
  const view: Map3DViewState = { target: [500, 120, 340], position: [500, 520, 1340] };
  // The handles are sized for the viewport (500px high here), so the arrow point comes from the same rule.
  const reach = 0.3 * Math.hypot(400, 1000) * Math.min(1.9 * Math.tan(Math.PI * MAP3D_VIEW_FOV / 360), 7) * mapGizmoSize(500) / 4;
  const lone = camera(55, { x: 500, y: 340 }), onArrow = camera(54, { x: 500, y: 340, elevation: 120 + reach });
  const overlap = await mountViewport({ map: mapOf([lone, onArrow]), selectedId: lone.id, initialView: view });
  overlap.frame();
  const arrow = overlap.handle(lone.id, 'Y');
  overlap.move(arrow);
  assert.equal(overlap.dev().transform.axis, 'Y');
  overlap.click(arrow);
  assert.deepEqual(overlap.names(), ['begin', 'finish']);
  // Without the handles the same click is a plain pick of the camera standing there.
  overlap.render({ canEdit: false }); overlap.clear();
  overlap.click(arrow);
  assert.deepEqual(overlap.log, [['select', onArrow.id]]);
  overlap.viewport.dispose();
});

test('viewport: looking through a placed camera follows its numbers and returns to the same orbit pose', async () => {
  const editor = await mountViewport({ selectedId: viewLens.id });
  const { renderer, dev } = editor;
  editor.viewport.zoom(0.7); editor.frame(); editor.clear();
  const saved = editor.view();
  editor.render({ lookThroughId: viewLens.id });
  editor.frame();
  assert.equal(dev().orbit.enabled, false);
  same(dev().transform.object, undefined, 'no gizmo in the preview');
  assert.equal(editor.root(viewLens.id).visible, false, 'the camera does not see its own body');
  const pose = nodeWorldPose(viewLens);
  nearList(renderer.lastCamera.position, [pose.position.x, pose.position.y, pose.position.z], 'viewer at the lens');
  nearList(renderer.lastCamera.quaternion, [pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w], 'viewer orientation');
  near(renderer.lastCamera.fov, verticalFov(60, 16 / 9), 'vertical angle from the horizontal one'); near(renderer.lastCamera.aspect, 16 / 9, 'frame shape');
  assert.equal(renderer.scissorTest, true);
  nearList(renderer.viewport, [0, 25, 800, 450], 'letterboxed to 16:9', 1e-9);
  // Facing the room: it fills the middle of the preview, and still nothing can be picked, opened or turned there.
  const facing = { ...viewLens, angle: 180 };
  editor.render({ map: mapOf(viewMap.nodes.map(node => node.id === viewLens.id ? facing : node)) });
  editor.frame();
  const middle = { x: 440, y: 280 };
  editor.click(middle);
  editor.fire('wheel', middle, { deltaY: -100 });
  editor.fire('dblclick', middle);
  assert.equal(editor.fire('contextmenu', middle).defaultPrevented, true, 'no context menu in the preview either');
  assert.deepEqual(editor.names(), [], 'the preview is for looking only');
  const raised = { ...viewLens, elevation: 300, pitch: -90, aspect: 1 };
  editor.render({ map: mapOf(viewMap.nodes.map(node => node.id === viewLens.id ? raised : node)) });
  editor.frame();
  const next = nodeWorldPose(raised);
  nearList(renderer.lastCamera.position, [600, 300, 200], 'follows the height');
  nearList(renderer.lastCamera.quaternion, [next.quaternion.x, next.quaternion.y, next.quaternion.z, next.quaternion.w], 'follows straight down');
  nearList(renderer.viewport, [150, 0, 500, 500], 'letterboxed to a square', 1e-9);
  same(editor.node(viewLens.id), raised, 'looking never edits');
  editor.render({ lookThroughId: null });
  editor.frame();
  nearList(editor.view().target, saved.target, 'target restored', 1e-9); nearList(editor.view().position, saved.position, 'position restored');
  assert.deepEqual([renderer.scissorTest, renderer.viewport], [false, [0, 0, 800, 500]]);
  near(renderer.lastCamera.fov, MAP3D_VIEW_FOV, 'viewer angle restored');
  assert.equal(editor.root(viewLens.id).visible, true);
  assert.equal(dev().orbit.enabled, true);
  same(dev().transform.object, editor.root(viewLens.id), 'gizmo back');
  assert.deepEqual(editor.names(), [], 'looking through reports no view');
  // Something that is not a camera is handed back once.
  editor.render({ lookThroughId: viewRoom.id });
  assert.deepEqual(editor.log, [['look', null]]);
  // Even an editor that keeps the id is told only once.
  editor.render({ lookThroughId: viewRoom.id });
  editor.render({ lookThroughId: viewRoom.id, selectedId: viewChair.id });
  assert.equal(editor.count('look'), 1);
  editor.viewport.dispose();
});

test('viewport: a focus request moves the orbit target only for an off-screen node and only when it is new', async () => {
  const far = camera(21, { x: 5000, y: 4000 });
  const map = mapOf([...viewMap.nodes, far]);
  const editor = await mountViewport({ map, focusRequest: { id: far.id, nonce: 7 }, initialView: { target: [500, 0, 340], position: [700, 700, 1300] } });
  const start = editor.view();
  assert.deepEqual(editor.names(), [], 'the request already there at mount is not replayed');
  editor.render({ focusRequest: { id: viewLens.id, nonce: 8 } });
  assert.deepEqual(editor.view(), start, 'a node in view needs no move');
  editor.render({ focusRequest: { id: far.id, nonce: 9 } });
  const moved = editor.view(), offset = start.position.map((value, index) => value - start.target[index]);
  nearList(moved.target, [5000, 120, 4000], 'target on the node');
  nearList(moved.position.map((value, index) => value - moved.target[index]), offset, 'viewing offset kept');
  assert.equal(editor.count('view'), 1);
  editor.render(); editor.render({ selectedId: far.id });
  assert.equal(editor.count('view'), 1, 'the same request is not replayed');
  // A request that arrives before its node is honoured when the node appears.
  editor.clear();
  const late = camera(22, { x: -3000, y: -2000 });
  editor.render({ focusRequest: { id: late.id, nonce: 10 } });
  assert.equal(editor.count('view'), 0);
  editor.render({ map: mapOf([...map.nodes, late]) });
  nearList(editor.view().target, [-3000, 120, -2000], 'late node');
  editor.viewport.dispose();
});

test('viewport: saved view, map change with the same renderer, hidden tab, resize and pixel ratio', async () => {
  const initialView: Map3DViewState = { target: [200, 0, 100], position: [200, 400, 700] };
  const editor = await mountViewport({ initialView });
  const { renderer } = editor;
  nearList(editor.view().target, initialView.target, 'saved target'); nearList(editor.view().position, initialView.position, 'saved position');
  assert.deepEqual(editor.names(), []);
  const drawn = renderer.renders;
  editor.resize(0, 0);
  editor.render({ selectedId: viewLens.id }); editor.frame(); editor.render({ tool: 'look' }); editor.frame();
  assert.equal(renderer.renders, drawn, 'nothing is drawn while the tab is hidden');
  editor.resize(640, 360);
  assert.deepEqual([renderer.size, renderer.renders], [[640, 360], drawn + 1], 'drawn again in the same turn when shown');
  near(editor.dev().camera.aspect, 640 / 360, 'aspect');
  const other = { ...viewMap, id: id(951), name: '복도', nodes: [space(2, { x: 2000, y: 2000 })] };
  editor.render({ map: other, selectedId: null, initialView: null, tool: 'select' });
  assert.equal(stub.renderers.length, 1, 'one renderer for the whole life');
  same(editor.root(viewLens.id), undefined, 'old content gone');
  assert.ok(editor.root(id(2)), 'new content');
  assert.ok(editor.view().target[0] > 800 && editor.view().target[2] > 800, 'fitted to the new map');
  assert.equal(editor.count('view'), 0);
  (globalThis as Any).window.devicePixelRatio = 3;
  editor.resize(641, 360);
  assert.equal(renderer.ratio, 2, 'pixel ratio is capped at 2');
  (globalThis as Any).window.devicePixelRatio = 1;
  editor.viewport.dispose();
  // Mounted while hidden: the fit waits for the first real size.
  const hidden = await mountViewport({}, [0, 0]);
  assert.equal(hidden.renderer.renders, 0);
  hidden.resize(800, 500);
  assert.equal(hidden.renderer.renders, 1);
  near(hidden.view().target[0], 500, 'fitted once visible');
  hidden.viewport.dispose();
});

test('viewport: theme changes repaint, a lost context is reported once, and a failed start leaves nothing behind', async () => {
  const editor = await mountViewport();
  const { renderer } = editor, before = renderer.renders, root = (globalThis as Any).document.documentElement;
  themeValues = { '--color-bg-primary': '250 250 252', '--color-accent': '90 70 200' };
  root.setAttribute('data-color-mode', 'light');
  for (const item of observers.mutation) item.callback([]);
  editor.frame();
  assert.deepEqual([renderer.renders, renderer.clearColor], [before + 1, 0xfafafc]);
  for (const item of observers.mutation) item.callback([]);
  assert.equal(frames.size, 0, 'an unchanged palette asks for nothing');
  themeValues = {}; root.setAttribute('data-color-mode', 'dark');
  for (let times = 0; times < 2; times++) editor.canvas().dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  assert.equal(editor.count('unavailable'), 1);
  assert.match(String(editor.log.find(entry => entry[0] === 'unavailable')?.[1]), /평면 도면/);
  const drawn = renderer.renders;
  editor.render({ selectedId: viewLens.id }); editor.frame();
  assert.equal(renderer.renders, drawn, 'nothing is drawn on a lost context');
  editor.viewport.dispose();
  assert.equal(editor.count('unavailable'), 1);
  // WebGL cannot start: the constructor throws and the canvas is gone, so the component can fall back to the plan.
  const { Map3DViewport } = await loadViewport();
  const host = new FakeElement('div'), stage = new FakeElement('div');
  host.appendChild(stage);
  stub.fail = true;
  assert.throws(() => new Map3DViewport(host, stage, {} as Map3DProps, () => {}), /WebGL/);
  stub.fail = false;
  assert.equal(stage.children.length, 0);
});

// The seam between the three parts: the real viewport, the editor's real map document, and what the companion
// plan derives from that same document. The callbacks are wired as BackgroundMapEditor wires them.
test('integration: a gizmo drag reaches the shared document, the 3D scene and the companion plan together, and is one undo step', async () => {
  const store = createMapDocumentStore();
  store.dispatch({ type: 'begin-editing', map: viewMap });
  store.dispatch({ type: 'select', mapId: viewMap.id, id: viewLens.id });
  const draft = () => { const found = mapDraft(store.getState(), viewMap.id); assert.ok(found); return found; };
  const lens = () => draft().value.nodes.find(node => node.id === viewLens.id) as BackgroundCamera;
  let unsubscribe: (() => void) | null = null;
  const editor = await mountViewport({ map: draft().value, selectedId: viewLens.id }, [800, 500], (state, changed) => {
    // A change of the document is a re-render with its current value and selection.
    unsubscribe ??= store.subscribe(() => { state.map = draft().value; state.selectedId = mapViewport(store.getState(), viewMap.id).selectedId; changed(); });
    return {
      onSelect: value => store.dispatch({ type: 'select', mapId: viewMap.id, id: value }),
      onBeginGesture: () => store.dispatch({ type: 'gesture-begin', mapId: viewMap.id }),
      onPreview: map => store.dispatch({ type: 'gesture-preview', map }),
      onFinishGesture: () => store.dispatch({ type: 'gesture-finish' }),
      onCancelGesture: () => store.dispatch({ type: 'gesture-cancel' }),
    };
  });
  const { dev } = editor, initial = draft().value;
  editor.frame();
  /** The 3D root and the companion plan describe the camera of the document: position, direction, up/down view and height. */
  const together = (label: string) => {
    const node = lens(), pose = nodeWorldPose(node), root = editor.root(viewLens.id), glyph = planCameraGlyph(node, 1), readout = planCameraReadout(node);
    nearList(root.position.toArray(), [pose.position.x, pose.position.y, pose.position.z], `${label}: 3D position`, 2e-3);
    assert.deepEqual(root.scale.toArray(), [1, 1, 1], `${label}: unscaled`);
    assert.ok(glyph, `${label}: plan mark`);
    nearList([glyph.position.x, glyph.position.y], [root.position.x, root.position.z], `${label}: plan position`, 2e-3);
    const sight = new Vector3(0, 0, -1).applyQuaternion(root.quaternion), level = Math.hypot(sight.x, sight.z);
    assert.ok(glyph.arrow, `${label}: plan arrow`);
    const along = { x: glyph.arrow.tip.x - glyph.position.x, y: glyph.arrow.tip.y - glyph.position.y }, length = Math.hypot(along.x, along.y);
    nearList([along.x / length, along.y / length], [sight.x / level, sight.z / level], `${label}: plan direction`, 1e-3);
    near(glyph.reach, level, `${label}: arrow length follows the tilt`, 1e-3);
    const [, pitch, height] = readout.items.map(planReadoutText);
    assert.equal(height, `높이 ${Math.round(root.position.y)}`, `${label}: plan height`);
    assert.equal(pitch, cameraPitchLabel(Math.asin(sight.y) * 180 / Math.PI), `${label}: plan up/down view`);
    return { pitch, height };
  };
  together('at rest');

  // Height with the vertical arrow.
  let grip = editor.handle(viewLens.id, 'Y');
  editor.move(grip); editor.press(grip);
  assert.ok(store.getState().gesture, 'the press began the one gesture of the document');
  same(store.getState().gesture?.initial, initial, 'it starts from the draft');
  editor.move({ x: grip.x, y: grip.y - 40 });
  editor.frame(false);
  // Inside the frame, before any re-render: the document already holds the preview and both views can read it.
  assert.ok((lens().elevation ?? 0) > 125, 'the preview is in the document');
  assert.equal(draft().past.length, 0, 'a preview is not an undo step');
  same(editor.state.map, draft().value, 'the next render passes the preview on');
  assert.equal(together('lifting').height, `높이 ${Math.round(lens().elevation ?? 0)}`);
  editor.settle();
  together('lifting, re-rendered');
  editor.move({ x: grip.x, y: grip.y - 70 });
  editor.release({ x: grip.x, y: grip.y - 70 });
  same(store.getState().gesture, null, 'gesture closed');
  assert.deepEqual(draft().past, [initial], 'one drag, one undo step');
  editor.frame();
  const lifted = draft().value;
  assert.deepEqual({ ...lens(), elevation: 0 }, { ...viewLens, elevation: 0 }, 'only the height was written');
  together('lifted');

  // Up/down view with the ring around the camera's own left-right axis.
  editor.render({ gizmoMode: 'rotate' });
  editor.frame();
  const centre = editor.screen(viewLens.id), edge = editor.handle(viewLens.id, 'X', 0.5), radius = Math.hypot(edge.x - centre.x, edge.y - centre.y);
  let ring: ScreenPoint | null = null;
  for (let turn = 0; turn < 360 && !ring; turn += 5) {
    const point = { x: centre.x + radius * Math.cos(turn * Math.PI / 180), y: centre.y + radius * Math.sin(turn * Math.PI / 180) };
    editor.move(point);
    if (dev().transform.axis === 'X') ring = point;
  }
  assert.ok(ring, 'the tilt ring is on screen');
  editor.press(ring);
  for (const [dx, dy] of [[14, 22], [24, 40], [30, 55]]) editor.move({ x: ring.x + dx, y: ring.y + dy });
  editor.frame();
  assert.ok(Math.abs(lens().pitch ?? 0) > 2, `the camera tilted: ${lens().pitch}`);
  assert.deepEqual([lens().x, lens().y, lens().elevation], [viewLens.x, viewLens.y, (lifted.nodes[3] as BackgroundCamera).elevation], 'turning writes no position or height');
  assert.equal(draft().past.length, 1, 'still one step while tilting');
  assert.match(together('tilting').pitch, /^(위|아래) \d+°$/);
  editor.release({ x: ring.x + 30, y: ring.y + 55 });
  editor.frame();
  assert.deepEqual(draft().past, [initial, lifted]);
  const tilted = draft().value;
  together('tilted');

  // A cancelled drag leaves no trace in the document or in either view.
  editor.render({ gizmoMode: 'translate' });
  editor.frame();
  grip = editor.handle(viewLens.id, 'X');
  editor.move(grip); editor.press(grip); editor.move({ x: grip.x + 40, y: grip.y }); editor.frame();
  assert.notEqual(lens().x, viewLens.x);
  together('moving');
  (globalThis as Any).window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
  editor.settle();
  same(draft().value, tilted, 'cancel restores the draft object');
  assert.equal(draft().past.length, 2);
  same(store.getState().gesture, null, 'cancelled');
  editor.release({ x: grip.x + 40, y: grip.y });
  editor.frame();
  same(draft().value, tilted, 'the late release commits nothing');
  together('cancelled');

  // Undo and redo are the document's; both views follow its value.
  store.dispatch({ type: 'undo', mapId: viewMap.id }); editor.settle(); editor.frame();
  same(draft().value, lifted, 'undo of the tilt');
  assert.equal(together('undone once').pitch, '수평');
  store.dispatch({ type: 'undo', mapId: viewMap.id }); editor.settle(); editor.frame();
  same(draft().value, initial, 'undo of the lift');
  assert.equal(together('undone twice').height, '높이 120');
  store.dispatch({ type: 'redo', mapId: viewMap.id }); editor.settle(); editor.frame();
  same(draft().value, lifted, 'redo');
  together('redone');
  // Selecting in 3D is the document's selection, and no undo step.
  editor.click(editor.screen(viewChair.id));
  assert.equal(mapViewport(store.getState(), viewMap.id).selectedId, viewChair.id);
  same(dev().transform.object, editor.root(viewChair.id), 'the gizmo follows the shared selection');
  assert.deepEqual([draft().past.length, draft().future.length], [1, 1]);
  editor.viewport.dispose();
  (unsubscribe as (() => void) | null)?.();
});

test('viewport: after dispose nothing listens, draws or reports any more', async () => {
  const editor = await mountViewport({ selectedId: viewLens.id });
  const canvas = editor.canvas(), { renderer } = editor;
  editor.frame();
  const point = editor.screen(viewChair.id);
  editor.viewport.dispose();
  editor.viewport.dispose();
  const drawn = renderer.renders, scope = globalThis as Any;
  // The context-lost listener goes first, before the context is dropped on purpose; nothing else stays on the canvas either.
  for (const type of ['webglcontextlost', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'dblclick', 'wheel', 'contextmenu', 'mousedown']) {
    assert.equal(getEventListeners(canvas, type).length, 0, `canvas ${type}`);
  }
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'dblclick', 'webglcontextlost', 'wheel', 'contextmenu']) {
    canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { clientX: point.x, clientY: point.y, pageX: point.x, pageY: point.y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, deltaY: 1 }));
  }
  scope.window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
  for (const item of [...observers.resize, ...observers.mutation]) same(item.target, null, 'observer disconnected');
  editor.render({ selectedId: viewChair.id });
  editor.viewport.zoom(0.5); editor.viewport.fit(); editor.viewport.topDown();
  assert.equal(editor.frame(), 0, 'no frame left pending');
  assert.equal(renderer.renders, drawn);
  assert.deepEqual(editor.names(), []);
  // Every viewport of this file is disposed by now: no listener may be left on the window or the document.
  for (const type of ['keydown', 'keyup', 'pointermove', 'pointerup']) {
    assert.equal(getEventListeners(scope.window, type).length, 0, `window ${type}`);
    assert.equal(getEventListeners(scope.document, type).length, 0, `document ${type}`);
  }
});

test('gizmo handles keep a usable size in short viewports and stay compact in tall ones', () => {
  // About 0.119 of the viewport height per size unit: 72px arrows where the split view is short.
  near(mapGizmoSize(329) * 0.11875 * 329, 72, 'short split view', 1e-9);
  near(mapGizmoSize(500) * 0.11875 * 500, 72, 'medium view', 1e-9);
  assert.equal(mapGizmoSize(900), 0.8, 'tall views keep the compact size');
  assert.equal(mapGizmoSize(120), 2.2, 'a sliver of a view is capped');
  for (const broken of [0, -5, Number.NaN]) assert.equal(mapGizmoSize(broken), 0.8);
});

test('viewport: an untouched fitted view is fitted again when the pane changes shape, a moved one is left alone', async () => {
  const editor = await mountViewport({});
  editor.frame();
  const map = editor.state.map;
  const wide = fitMapView(map, 800 / 500), narrow = fitMapView(map, 300 / 500);
  nearList(editor.view().position, wide.position, 'opens fitted to the pane', 1e-3);
  editor.resize(300, 500); editor.frame();
  nearList(editor.view().position, narrow.position, 'refitted for the narrow pane', 1e-3);
  assert.ok(Math.hypot(...narrow.position.map((value, index) => value - wide.position[index])) > 1, 'the two fits really differ');
  // Once the user has moved the view it is theirs: a reshape keeps it.
  editor.viewport.zoom(0.8); editor.frame();
  const moved = editor.view();
  editor.resize(640, 360); editor.frame();
  nearList(editor.view().position, moved.position, 'a moved view stays', 1e-6);
  // The fit button makes it automatic again.
  editor.viewport.fit(); editor.frame();
  editor.resize(900, 300); editor.frame();
  nearList(editor.view().position, fitMapView(map, 900 / 300).position, 'fitted again after the fit button', 1e-3);
  editor.viewport.dispose();
});

test('gizmo handles follow the Blender look: one bold arrow per axis, blue up, solid rings', () => {
  // A tilted camera, so its own axes (the rings turn about them) differ from the world's.
  const room = space(1), lens = camera(30, { spaceId: room.id, angle: 250, elevation: 210, pitch: -35, roll: 12 });
  const harness = gizmoHarness(mapOf([room, lens]), lens.id, 'translate'), { gizmo } = harness;
  const parts = (gizmo.controls as Any)._gizmo as { gizmo: Record<string, Object3D>; picker: Record<string, Object3D>; materialLib: Record<string, { color: { getHex(): number } }> };
  // Red and green lie on the plan, blue is the vertical axis (world Y): the colours are spelled out here, not read back from the source.
  assert.deepEqual(MAP_GIZMO_COLORS, { planX: 0xff3352, up: 0x2890ff, planY: 0x8bdc00, active: 0xffd23f });
  assert.deepEqual([parts.materialLib.xAxis.color.getHex(), parts.materialLib.yAxis.color.getHex(), parts.materialLib.zAxis.color.getHex(), parts.materialLib.active.color.getHex()],
    [0xff3352, 0x2890ff, 0x8bdc00, 0xffd23f], 'red plan X, blue up, green plan depth, yellow while held');
  assert.deepEqual([parts.materialLib.xAxisTransparent.color.getHex(), parts.materialLib.yAxisTransparent.color.getHex(), parts.materialLib.zAxisTransparent.color.getHex()],
    [0xff3352, 0x2890ff, 0x8bdc00], 'plane squares follow the same colours');
  const extent = (handle: Object3D) => { const geometry = (handle as Mesh).geometry; geometry.computeBoundingBox(); return geometry.boundingBox!; };
  const along = (handle: Object3D) => { const box = extent(handle), key = handle.name.toLowerCase() as 'x' | 'y' | 'z'; return [box.min[key], box.max[key]]; };
  const across = (handle: Object3D) => { const box = extent(handle), key = handle.name === 'X' ? 'y' : 'x'; return box.max[key] - box.min[key]; };
  for (const mode of ['translate', 'scale']) {
    for (const axis of ['X', 'Y', 'Z']) {
      const drawn = parts.gizmo[mode].children.filter(child => child.name === axis), picked = parts.picker[mode].children.filter(child => child.name === axis);
      assert.equal(drawn.length, 2, `${mode} ${axis}: a shaft and one end`);
      assert.equal(picked.length, 1, `${mode} ${axis}: nothing is picked where nothing is drawn`);
      for (const handle of [...drawn, ...picked]) assert.ok(along(handle)[0] >= -1e-6, `${mode} ${axis}: only the positive direction`);
      const [shaft, end] = [...drawn].sort((a, b) => along(a)[1] - along(b)[1]);
      near(along(shaft)[0], MAP_GIZMO_SHAPE.gap, `${mode} ${axis} shaft leaves the centre free`, 1e-6);
      assert.ok(along(shaft)[0] >= 0.05, `${mode} ${axis}: a clear gap between the centre and the shaft (${along(shaft)[0]})`);
      near(along(shaft)[1], 0.5, `${mode} ${axis} shaft reaches the end`, 1e-6);
      assert.ok(across(shaft) >= 0.02, `${mode} ${axis}: the shaft is a bold line, not a hairline (${across(shaft)})`);
      near(along(end)[0], 0.5, `${mode} ${axis} end starts where the shaft stops`, 1e-6);
      assert.ok(across(end) >= 0.09, `${mode} ${axis}: the end is easy to see (${across(end)})`);
    }
  }
  const centre = parts.gizmo.translate.children.find(child => child.name === 'XYZ') as Mesh;
  assert.equal(centre.geometry.type, 'SphereGeometry');
  const dot = (centre.geometry as BufferGeometry & { parameters: { radius: number } }).parameters.radius;
  assert.ok(dot >= 0.03 && dot < MAP_GIZMO_SHAPE.gap, `the centre is a dot one can see, clear of the shafts (${dot})`);
  assert.ok((centre.material as Material).opacity >= 0.85, 'the centre is a clear dot');
  assert.equal(parts.gizmo.scale.children.some(child => child.name === 'XYZ'), false, 'the size gizmo still has no centre handle');
  // Rings: bold, still half circles of radius 0.5 so the controls can turn them toward the viewer.
  type RingShape = BufferGeometry & { parameters: { radius: number; tube: number; arc: number } };
  for (const axis of ['X', 'Y', 'Z']) {
    const ring = parts.gizmo.rotate.children.find(child => child.name === axis) as Mesh, box = extent(ring);
    const parameters = (ring.geometry as RingShape).parameters;
    near(parameters.radius, 0.5, `${axis} ring radius`); near(parameters.tube, MAP_GIZMO_SHAPE.ring, `${axis} ring thickness`); near(parameters.arc, Math.PI, `${axis} ring is a half circle`);
    assert.ok(parameters.tube >= 0.01, `${axis} ring is a solid band, not the stock hairline (${parameters.tube})`);
    const thin = axis.toLowerCase() as 'x' | 'y' | 'z';
    assert.ok(box.max[thin] - box.min[thin] < 0.06, `${axis} ring lies in the plane across its axis`);
  }
  const rim = parts.gizmo.rotate.children.filter(child => child.name === 'OUTLINE');
  assert.equal(rim.length, 1, 'one outline circle');
  assert.ok(Object.values(parts.picker).every(group => group.children.every(child => child.name !== 'OUTLINE')), 'the outline is never picked');
  // A full, thin circle around the ball, drawn over the scene like every other handle.
  const outline = rim[0] as Mesh, circle = (outline.geometry as RingShape).parameters, outlineMaterial = outline.material as Material;
  near(circle.radius, 0.5, 'outline radius'); near(circle.arc, Math.PI * 2, 'outline is a full circle');
  assert.ok(circle.tube > 0 && circle.tube < MAP_GIZMO_SHAPE.ring, `the outline is thinner than the rings (${circle.tube})`);
  assert.deepEqual([outlineMaterial.depthTest, outlineMaterial.transparent, outlineMaterial.opacity < 1], [false, true, true], 'a faint line that scene geometry never hides');
  // The outline is drawn only while all three rings are (a space turns about the vertical axis alone).
  gizmo.setTarget({ id: lens.id, type: 'camera', root: rootOf(harness.scene, lens) }, 'rotate');
  gizmo.helper.updateMatrixWorld(true);
  assert.equal(rim[0].visible, true);
  // As the controls lay them out for this viewer: each half ring is the half on the viewer's side of the ball, and the outline faces the viewer.
  const viewpoint = gizmo.controls as unknown as { worldPosition: Vector3; eye: Vector3 };
  const toViewer = (handle: Object3D) => worldPoints(handle).map(point => point.sub(viewpoint.worldPosition).dot(viewpoint.eye) / handle.scale.x);
  for (const axis of ['X', 'Y', 'Z']) {
    const depths = toViewer(parts.gizmo.rotate.children.find(child => child.name === axis)!);
    assert.ok(Math.min(...depths) >= -MAP_GIZMO_SHAPE.ring - 1e-6, `${axis} ring: nothing behind the ball (${Math.min(...depths)})`);
    assert.ok(Math.max(...depths) > 0.1, `${axis} ring is seen at an angle here, so its near half bulges toward the viewer (${Math.max(...depths)})`);
  }
  assert.ok(toViewer(outline).every(depth => Math.abs(depth) <= circle.tube + 1e-6), 'the outline lies flat across the line of sight');
  gizmo.setTarget({ id: room.id, type: 'space', root: rootOf(harness.scene, room) }, 'rotate');
  gizmo.helper.updateMatrixWorld(true);
  assert.equal(rim[0].visible, false, 'no ball outline around a single ring');
  assert.deepEqual(parts.gizmo.rotate.children.filter(child => child.visible).map(child => child.name), ['Y'], 'a space shows the vertical ring only');
  // Everything added is released with the controls.
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
  gizmo.helper.traverse(child => { const mesh = child as Mesh; if (mesh.geometry) geometries.add(mesh.geometry); if (mesh.material) materials.add(mesh.material as Material); });
  // Handles share materials, so one material is released once per handle: count each item once.
  const released = new Set<BufferGeometry | Material>();
  for (const item of [...geometries, ...materials]) item.addEventListener('dispose', () => { released.add(item); });
  gizmo.dispose();
  assert.equal(released.size, geometries.size + materials.size, 'handles, pickers and the outline are all disposed');
  harness.scene.dispose();
  // Controls without the expected internals keep their stock look instead of failing.
  assert.doesNotThrow(() => styleMapGizmo({ setColors() { throw new Error('must not be reached'); } } as Any));
});

const GIZMO_AXES: ['X' | 'Y' | 'Z', Vector3][] = [['X', new Vector3(1, 0, 0)], ['Y', new Vector3(0, 1, 0)], ['Z', new Vector3(0, 0, 1)]];
/** Real pointer positions on the gizmo of a harness: `reach` gizmo units from the node along a direction, as the viewer sees it now. */
function handlePointer(harness: GizmoHarness, root: Object3D) {
  const controls = harness.gizmo.controls, viewer = controls.camera as PerspectiveCamera;
  const unit = () => viewer.position.distanceTo(root.position) * Math.min(1.9 * Math.tan(Math.PI * viewer.fov / 360) / viewer.zoom, 7) * controls.size / 4;
  const at = (direction: Vector3, reach: number, button = 0) => {
    const point = root.position.clone().addScaledVector(direction, reach * unit()).project(viewer);
    return { x: point.x, y: point.y, button } as unknown as PointerEvent;
  };
  return {
    unit, at,
    /** The handle the controls would grab there, picked the way a real pointer picks it. */
    hover: (direction: Vector3, reach: number) => { controls.pointerHover(at(direction, reach)); return controls.axis; },
    /** Move the viewer: `distance` from the node in `direction`, looking at it. */
    standAt: (direction: Vector3, distance: number) => {
      viewer.position.copy(root.position).addScaledVector(direction.clone().normalize(), distance);
      viewer.lookAt(root.position);
      viewer.updateMatrixWorld(true);
    },
  };
}
/** Where the viewer stands when an arrow along `forward` points away from them: `elevation` degrees up, `azimuth` degrees off straight behind. */
function behind(forward: Vector3, elevation: number, azimuth: number): Vector3 {
  const up = new Vector3(0, 1, 0), tilt = elevation * Math.PI / 180, turn = azimuth * Math.PI / 180;
  return forward.clone().multiplyScalar(-Math.cos(tilt) * Math.cos(turn)).addScaledVector(up, Math.sin(tilt)).addScaledVector(up.clone().cross(forward), Math.cos(tilt) * Math.sin(turn));
}

test('the handle drawn under the pointer is the one that is grabbed: whole arrows, a small centre, arrows seen from behind', () => {
  const lens = camera(20, { x: 600, y: 200, angle: 135, elevation: 150 });
  const harness = gizmoHarness(mapOf([lens]), lens.id, 'translate'), { gizmo } = harness, root = rootOf(harness.scene, lens);
  const pointer = handlePointer(harness, root), viewer = gizmo.controls.camera;
  const drawn = (mode: string) => ((gizmo.controls as Any)._gizmo.gizmo[mode] as Object3D).children as Mesh[];
  /** How far the drawn handle of an axis reaches from the centre. */
  const tip = (mode: string, axis: 'X' | 'Y' | 'Z') => Math.max(...drawn(mode).filter(handle => handle.name === axis).map(handle => {
    handle.geometry.computeBoundingBox();
    return handle.geometry.boundingBox!.max[axis.toLowerCase() as 'x' | 'y' | 'z'];
  }));
  // Every part of a drawn arrow takes its own axis, from where the shaft begins to the tip of the head.
  for (const [axis, direction] of GIZMO_AXES) {
    assert.ok(tip('translate', axis) > 0.6, `${axis} arrow head`);
    for (let reach = MAP_GIZMO_SHAPE.gap + 0.005; reach < tip('translate', axis) - 0.004; reach += 0.01) assert.equal(pointer.hover(direction, reach), axis, `${axis} arrow at ${reach.toFixed(3)}`);
  }
  // Free movement starts on the centre dot, not on the bare pixels around it.
  const right = new Vector3().setFromMatrixColumn(viewer.matrixWorld, 0), up = new Vector3().setFromMatrixColumn(viewer.matrixWorld, 1);
  // A near miss beside an arrow still grabs it (the controls' own wide hit area), and a hidden arrow is not grabbed at all.
  for (const beside of [-0.03, 0.03]) assert.equal(pointer.hover(new Vector3(0, 0.4, 0).addScaledVector(right, beside), 1), 'Y', `just beside the upright shaft (${beside})`);
  gizmo.controls.showY = false;
  assert.notEqual(pointer.hover(GIZMO_AXES[1][1], 0.3), 'Y', 'an arrow that is switched off');
  gizmo.controls.showY = true;
  assert.equal(pointer.hover(right, 0), 'XYZ', 'the dot moves the node freely');
  for (let step = 0; step < 16; step++) {
    const angle = step * Math.PI / 8, direction = right.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle));
    assert.notEqual(pointer.hover(direction, 0.1), 'XYZ', `a little way off the dot (${step * 22.5} degrees round) nothing starts a free move`);
  }
  // A plan arrow that points away from the viewer lies behind the upright arrow's hit area, the squares and the centre. It is still the one grabbed.
  for (const [axis, forward] of [GIZMO_AXES[0], GIZMO_AXES[2]]) {
    for (const [elevation, azimuth] of [[38, 8], [20, 20], [50, 12]]) {
      pointer.standAt(behind(forward, elevation, azimuth), 700);
      const label = `${axis} arrow from behind (${elevation} up, ${azimuth} round)`;
      const start = root.position.clone(), travel = 0.15 * pointer.unit(), head = pointer.at(forward, 0.55), further = pointer.at(forward, 0.7, -1);
      gizmo.controls.pointerHover(head);
      assert.equal(gizmo.controls.axis, axis, `${label}: the arrow head`);
      gizmo.controls.pointerDown(head);
      gizmo.controls.pointerMove(further);
      const shift = root.position.clone().sub(start);
      near(shift.dot(forward), travel, `${label}: the node slides along the arrow`, 1e-3);
      near(shift.length(), travel, `${label}: and only along it (height untouched)`, 1e-3);
      harness.release();
    }
  }
  assert.equal(harness.calls.filter(call => call === 'begin' || call === 'finish').length, 12, 'each of the six presses was one gesture');
  // Turn rings stay with the controls: the outline circle around them is decoration and never becomes the grabbed handle.
  assert.equal(gizmo.setTarget({ id: lens.id, type: 'camera', root }, 'rotate'), true);
  const across = new Vector3().setFromMatrixColumn(viewer.matrixWorld, 0), upward = new Vector3().setFromMatrixColumn(viewer.matrixWorld, 1);
  for (let step = 0; step < 16; step++) {
    const angle = step * Math.PI / 8, grabbed = pointer.hover(across.clone().multiplyScalar(Math.cos(angle)).addScaledVector(upward, Math.sin(angle)), 0.5);
    assert.ok(grabbed === null || grabbed === 'X' || grabbed === 'Y' || grabbed === 'Z', `on the outline circle (${step * 22.5} degrees round): ${grabbed}`);
  }
  gizmo.dispose();
  harness.scene.dispose();

  // Size handles likewise: the whole handle from the shaft to its cube, and from behind.
  const table = symbol(10, 'table', { x: 400, y: 300, width: 180, height: 110 });
  const sizer = gizmoHarness(mapOf([table]), table.id, 'scale'), tableRoot = rootOf(sizer.scene, table), sizePointer = handlePointer(sizer, tableRoot);
  for (const [axis, direction] of GIZMO_AXES) {
    const own = direction.clone().applyQuaternion(tableRoot.quaternion);
    for (let reach = MAP_GIZMO_SHAPE.gap + 0.005; reach < 0.595; reach += 0.01) assert.equal(sizePointer.hover(own, reach), axis, `${axis} size handle at ${reach.toFixed(3)}`);
  }
  const widthAxis = new Vector3(1, 0, 0).applyQuaternion(tableRoot.quaternion);
  sizePointer.standAt(behind(widthAxis, 38, 8), 700);
  const cube = sizePointer.at(widthAxis, 0.55), pulled = sizePointer.at(widthAxis, 0.7, -1);
  sizer.gizmo.controls.pointerHover(cube);
  assert.equal(sizer.gizmo.controls.axis, 'X', 'the width cube from behind');
  sizer.gizmo.controls.pointerDown(cube);
  sizer.gizmo.controls.pointerMove(pulled);
  assert.ok(tableRoot.scale.x > 1.1, `the width grows (${tableRoot.scale.x})`);
  assert.deepEqual([tableRoot.scale.y, tableRoot.scale.z], [1, 1], 'the vertical size and the depth stay');
  sizer.release();
  sizer.gizmo.dispose();
  sizer.scene.dispose();
});

test('a press that arrives before the next frame starts on up-to-date handles and an up-to-date drag plane', () => {
  const lens = camera(20, { x: 600, y: 200, angle: 135, elevation: 150 }), table = symbol(10, 'table', { x: 220, y: 380, width: 180, height: 110 });
  const map = mapOf([lens, table]);
  for (const [index, [axis, direction]] of GIZMO_AXES.entries()) {
    const harness = gizmoHarness(map, lens.id, 'translate'), { gizmo } = harness, root = rootOf(harness.scene, lens), pointer = handlePointer(harness, root);
    // The last frame was drawn with no handle under the pointer. Nothing below draws another one.
    harness.scene.scene.updateMatrixWorld(true);
    const start = root.position.clone(), travel = 0.15 * pointer.unit(), from = pointer.at(direction, 0.3), to = pointer.at(direction, 0.45, -1);
    // Touch has no hover: the controls pick and press within one event, and the first move can come before the next frame too.
    gizmo.controls.pointerHover(from);
    gizmo.controls.pointerDown(from);
    assert.deepEqual([gizmo.controls.axis, gizmo.dragging], [axis, true], `${axis} arrow pressed`);
    // With a mouse the controls keep hovering during the drag: passing over another arrow does not swap the held one.
    assert.equal(pointer.hover(GIZMO_AXES[(index + 1) % 3][1], 0.3), axis, `${axis} stays held`);
    gizmo.controls.pointerMove(to);
    const shift = root.position.clone().sub(start);
    near(shift.dot(direction), travel, `${axis}: the node follows the pointer from the first move`, 1e-3);
    near(shift.length(), travel, `${axis}: along its arrow only`, 1e-3);
    harness.release();
    gizmo.dispose();
    harness.scene.dispose();
  }
  // The selection moved to another node and the pointer arrives before the next frame: its handles are where that node is.
  const harness = gizmoHarness(map, lens.id, 'translate'), { gizmo } = harness, tableRoot = rootOf(harness.scene, table);
  harness.scene.scene.updateMatrixWorld(true);
  assert.equal(gizmo.setTarget({ id: table.id, type: 'symbol', root: tableRoot }, 'translate'), true);
  assert.equal(handlePointer(harness, rootOf(harness.scene, lens)).hover(GIZMO_AXES[0][1], 0.3), null, 'nothing is grabbed where the gizmo was drawn last');
  assert.equal(handlePointer(harness, tableRoot).hover(GIZMO_AXES[0][1], 0.3), 'X', 'the arrow of the newly selected node');
  assert.equal(gizmo.hovering, true);
  gizmo.dispose();
  harness.scene.dispose();
});

test('the gizmo restyle is all or nothing, happens once, and releases what it replaces', () => {
  type Parts = { gizmo: Record<string, Object3D>; picker: Record<string, Object3D>; materialLib: Record<string, { color: { getHex(): number } }> };
  const bare = () => new TransformControls(new PerspectiveCamera(), null);
  const partsOf = (controls: TransformControls) => (controls as Any)._gizmo as Parts;
  const named = (group: Object3D, name: string) => group.children.filter(child => child.name === name);
  const geometriesOf = (controls: TransformControls) => {
    const found = new Set<BufferGeometry>();
    controls.getHelper().traverse(child => { const geometry = (child as Mesh).geometry; if (geometry) found.add(geometry); });
    return found;
  };
  // The stock shapes it takes out of the gizmo are released by the restyle itself: nobody else holds them afterwards.
  const controls = bare(), stock = geometriesOf(controls), released = new Set<BufferGeometry>();
  for (const geometry of stock) geometry.addEventListener('dispose', () => { released.add(geometry); });
  styleMapGizmo(controls);
  const kept = geometriesOf(controls), replaced = [...stock].filter(geometry => !kept.has(geometry));
  assert.ok(replaced.length >= 30, `arrows, ends, rings, centres and far-side hit areas are replaced or removed (${replaced.length})`);
  assert.ok(replaced.every(geometry => released.has(geometry)), 'every replaced or removed shape is released');
  assert.ok([...released].every(geometry => !kept.has(geometry)), 'nothing still in use is released');
  // A second pass changes nothing: one outline, the same handles, nothing released again.
  const before = [...kept];
  styleMapGizmo(controls);
  assert.equal(named(partsOf(controls).gizmo.rotate, 'OUTLINE').length, 1);
  assert.ok(sameList([...geometriesOf(controls)], before), 'the handles of the first pass are kept');
  assert.equal(released.size, replaced.length);
  controls.getHelper().dispose();

  // Restyled after a frame was drawn, the centre dot keeps its opacity on the frames that follow.
  const late = bare();
  late.getHelper().updateMatrixWorld(true);
  styleMapGizmo(late);
  late.getHelper().updateMatrixWorld(true);
  assert.equal(((named(partsOf(late).gizmo.translate, 'XYZ')[0] as Mesh).material as Material).opacity, 0.9);
  late.getHelper().dispose();

  // Internals that are not what the restyle expects: nothing is touched and nothing throws.
  const stockLook = (subject: TransformControls) => {
    const parts = partsOf(subject);
    return [parts.materialLib.xAxis.color.getHex(), parts.materialLib.yAxis.color.getHex(), named(parts.gizmo.rotate, 'OUTLINE').length,
      named(parts.gizmo.translate, 'X').length, named(parts.picker.translate, 'X').length, named(parts.gizmo.scale, 'XYZ').length,
      (named(parts.gizmo.translate, 'XYZ')[0] as Mesh).geometry.type, (named(parts.picker.translate, 'XYZ')[0] as Mesh).geometry.type];
  };
  assert.deepEqual(stockLook(bare()), [0xff0000, 0x00ff00, 0, 3, 2, 1, 'OctahedronGeometry', 'OctahedronGeometry'], 'what the stock gizmo looks like');
  const surprises: Record<string, (subject: TransformControls) => void> = {
    'an axis handle that is not a mesh': subject => { const odd = new Object3D(); odd.name = 'X'; partsOf(subject).gizmo.scale.add(odd); },
    'a handle without a material': subject => { (named(partsOf(subject).gizmo.scale, 'XYZ')[0] as Any).material = undefined; },
    'a handle without a shape': subject => { (named(partsOf(subject).gizmo.scale, 'Y')[0] as Any).geometry = undefined; },
    'a hit area that is not a mesh': subject => { const odd = new Object3D(); odd.name = 'Z'; partsOf(subject).picker.scale.add(odd); },
    'a turn ring that is not a mesh': subject => { const odd = new Object3D(); odd.name = 'Y'; partsOf(subject).gizmo.rotate.add(odd); },
    'a colour the palette call writes to is missing': subject => { delete (partsOf(subject).materialLib as Any).zAxisTransparent; },
    'no palette call': subject => { (subject as Any).setColors = undefined; },
  };
  for (const [label, surprise] of Object.entries(surprises)) {
    const subject = bare();
    surprise(subject);
    const look = stockLook(subject);
    assert.doesNotThrow(() => styleMapGizmo(subject), label);
    assert.deepEqual(stockLook(subject), look, `${label}: left exactly as it was`);
    assert.deepEqual(look.slice(0, 5), [0xff0000, 0x00ff00, 0, 3, 2], `${label}: and that is the stock gizmo`);
    subject.getHelper().dispose();
  }
  // Something that is not a three gizmo at all.
  const groups = () => ({ translate: new Object3D(), rotate: new Object3D(), scale: new Object3D() });
  for (const fake of [{}, { _gizmo: {} }, { _gizmo: { gizmo: groups() } }, { _gizmo: { gizmo: groups(), picker: groups() } }, { _gizmo: { gizmo: groups(), picker: groups(), materialLib: {} } }]) {
    assert.doesNotThrow(() => styleMapGizmo(fake as Any));
  }
});
