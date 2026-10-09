import test from 'node:test';
import assert from 'node:assert/strict';
import { polygonSpace, resizeSpace, moveMapNode, removeMapNode, containsPoint, transformMapSpace } from '../src/features/backgrounds/mapGeometry.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';
import { addMapCamera, applyNodeWorldPose, stackedMapNodeIds } from '../src/features/backgrounds/mapGeometry.ts';
import { nodeLocalPoint, nodeResizeCorner, placeMapNode, replaceMapNode, resizeSpaceTo } from '../src/features/backgrounds/mapGeometry.ts';
import { nodeNameAnchor, renameMapNode } from '../src/features/backgrounds/mapGeometry.ts';
import { insertPolygonVertex, movePolygonVertex, polygonFromWorldPoints, rectToPolygon, removePolygonVertex } from '../src/features/backgrounds/mapGeometry.ts';
import { lockMapNodes, moveMapNodes, removeMapNodes } from '../src/features/backgrounds/mapGeometry.ts';
import { cameraOrientation, nodeOrientation, nodePlanOutline, nodeWorldPose } from '../src/features/backgrounds/mapSpatial.ts';
import { validateBackgroundEntity } from '../src/features/backgrounds/domain.ts';

const space: BackgroundSpace = { id: 'space', type: 'space', name: '교실', placeId: null, childMapId: null, x: 100, y: 100, width: 100, height: 60, rotation: 90, shape: 'rect', points: [], locked: false };
const map: BackgroundMap = { id: 'map', revision: 1, name: '학교', parentId: null, placeId: null, imageUrl: '', nodes: [space, { id: 'camera', type: 'camera', name: '전경', x: 130, y: 130, spaceId: 'space', angle: 0, fov: 60, viewIds: ['view'], locked: false }] };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);
const symbol:BackgroundSymbol={id:'door',type:'symbol',name:'출입문',symbol:'door',spaceId:space.id,x:130,y:145,width:20,height:10,rotation:350,locked:false,hinge:'right',swing:'outward'};

test('symbols resize in local axes while preserving door configuration and enforcing bounded dimensions',()=>{
  const door={...symbol,x:100,y:100,width:100,height:60,rotation:90};
  const resized=resizeSpace(door,{x:100,y:230});
  near(resized.width,150);near(resized.height,80);near(resized.x,65);near(resized.y,115);
  assert.equal(resized.type,'symbol');assert.equal(resized.hinge,'right');assert.equal(resized.swing,'outward');
  const tiny=resizeSpace(door,{x:500,y:-100});assert.equal(tiny.width,10);assert.equal(tiny.height,10);
  const large=resizeSpace({...door,rotation:0},{x:200000,y:200000});assert.equal(large.width,100000);assert.equal(large.height,100000);
});

test('space transforms carry furniture centers and orientation, scale bounds, and preserve fixed symbols',()=>{
  const locked={...symbol,id:'locked-symbol',locked:true},unrelated={...symbol,id:'free-symbol',spaceId:null};
  const source:BackgroundMap={...map,nodes:[...map.nodes,symbol,locked,unrelated]};
  const transformed=transformMapSpace(source,{...space,x:300,y:200,width:200,height:180,rotation:180});
  const moved=transformed.nodes[2] as BackgroundSymbol;
  near(moved.x+moved.width/2,360);near(moved.y+moved.height/2,260);near(moved.rotation,80);
  near(moved.width,40);near(moved.height,30);assert.equal(moved.hinge,'right');assert.equal(moved.swing,'outward');
  assert.equal(transformed.nodes[3],locked);assert.equal(transformed.nodes[4],unrelated);assert.equal(source.nodes[2],symbol);
  const restored=transformMapSpace(transformed,space).nodes[2] as BackgroundSymbol;
  near(restored.x,symbol.x);near(restored.y,symbol.y);near(restored.rotation,symbol.rotation);near(restored.width,symbol.width);near(restored.height,symbol.height);
  const tiny=transformMapSpace(source,{...space,width:10,height:10}).nodes[2] as BackgroundSymbol;assert.equal(tiny.width,10);assert.equal(tiny.height,10);
});

test('symbol movement and space deletion retain symbols with their absolute geometry and unlink membership',()=>{
  const source:BackgroundMap={...map,nodes:[...map.nodes,symbol]};
  const moved=moveMapNode(source,symbol.id,{x:30,y:-20});
  assert.equal(moved.nodes[2].x,160);assert.equal(moved.nodes[2].y,125);assert.equal(moved.nodes[0],space);
  const removed=removeMapNode(moved,space.id),kept=removed.nodes.find(node=>node.id===symbol.id) as BackgroundSymbol;
  assert.deepEqual(kept,{...symbol,x:160,y:125,spaceId:null});assert.equal(removed.nodes[0].type,'camera');
  assert.deepEqual(removeMapNode(source,symbol.id).nodes,map.nodes);
});

test('rotated resizing fixes the opposite world corner and enforces minimum size', () => {
  const resized = resizeSpace(space, { x: 100, y: 230 });
  near(resized.width, 150); near(resized.height, 80);
  near(resized.x, 65); near(resized.y, 115);
  const small = resizeSpace(space, { x: 500, y: -100 });
  assert.equal(small.width, 10); assert.equal(small.height, 10);
});

test('space movement carries attached unlocked cameras once and leaves original untouched', () => {
  const moved = moveMapNode(map, 'space', { x: 40, y: -10 });
  assert.equal(moved.nodes[0].x, 140); assert.equal(moved.nodes[1].x, 170);
  assert.equal(moved.nodes[1].y, 120); assert.equal(map.nodes[1].x, 130);
  assert.deepEqual(moveMapNode({ ...map, nodes: [{ ...space, locked: true }] }, 'space', { x: 40, y: 10 }).nodes[0], { ...space, locked: true });
});

test('space transforms scale cameras in local axes and rotate their positions and directions', () => {
  const camera: BackgroundCamera = { ...map.nodes[1] as BackgroundCamera, x: 140, y: 150, angle: 350 };
  const source: BackgroundMap = { ...map, nodes: [space, camera] };
  const transformed = transformMapSpace(source, { ...space, x: 300, y: 200, width: 200, height: 180, rotation: 180 });
  const moved = transformed.nodes[1] as BackgroundCamera;
  near(moved.x, 360); near(moved.y, 260); near(moved.angle, 80);
  assert.equal(moved.fov, camera.fov); assert.deepEqual(moved.viewIds, camera.viewIds);
  const restored = transformMapSpace(transformed, space).nodes[1] as BackgroundCamera;
  near(restored.x, camera.x); near(restored.y, camera.y); near(restored.angle, camera.angle);
  assert.equal(source.nodes[1], camera);
});

test('rotated handle resize carries attached cameras with the new center and size', () => {
  const resized = transformMapSpace(map, resizeSpace(space, { x: 100, y: 230 }));
  const camera = resized.nodes[1] as BackgroundCamera;
  near(camera.x, 340 / 3); near(camera.y, 155); near(camera.angle, 0);
});

test('space geometry changes preserve locked or unrelated cameras and metadata edits do not move cameras', () => {
  const camera = map.nodes[1] as BackgroundCamera;
  const locked = { ...camera, id: 'locked', locked: true };
  const unrelated = { ...camera, id: 'unrelated', spaceId: null };
  const source = { ...map, nodes: [...map.nodes, locked, unrelated] };
  const changed = transformMapSpace(source, { ...space, width: 200, height: 180, rotation: 270 });
  assert.equal(changed.nodes[2], locked); assert.equal(changed.nodes[3], unrelated);
  const renamed = transformMapSpace(source, { ...space, name: '새 교실', locked: true });
  assert.equal(renamed.nodes[1], camera);
  assert.equal(transformMapSpace(renamed, { ...space, x: 500 }), renamed);
  assert.equal(transformMapSpace(renamed, space).nodes[0].locked, false);
});

test('removing a space detaches surviving cameras while preserving their source view IDs', () => {
  const removed = removeMapNode(map, 'space');
  assert.equal(removed.nodes.length, 1);
  const camera = removed.nodes[0];
  assert.equal(camera.type, 'camera');
  if (camera.type === 'camera') { assert.equal(camera.spaceId, null); assert.deepEqual(camera.viewIds, ['view']); }
  assert.equal(map.nodes.length, 2);
});

test('free polygon points normalize against the drawn bounds', () => {
  const result = polygonSpace([{ x: 20, y: 30 }, { x: 120, y: 30 }, { x: 70, y: 80 }]);
  assert.deepEqual(result, { x: 20, y: 30, width: 100, height: 50, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] });
  assert.equal(polygonSpace([{ x: 0, y: 0 }, { x: 1, y: 1 }]), null);
  assert.equal(polygonSpace([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]), null);
});

test('point containment respects rotation, ellipse edges, and polygon outline', () => {
  assert.equal(containsPoint(space, { x: 150, y: 170 }), true);
  assert.equal(containsPoint(space, { x: 195, y: 130 }), false);
  assert.equal(containsPoint({ ...space, rotation: 0, shape: 'ellipse' }, { x: 100, y: 100 }), false);
  const triangle = { ...space, rotation: 0, shape: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] };
  assert.equal(containsPoint(triangle, { x: 150, y: 120 }), true);
  assert.equal(containsPoint(triangle, { x: 105, y: 155 }), false);
});

// --- Plan/3D shared geometry -------------------------------------------------------------------
const one = { x: 1, y: 1, z: 1 };
const memberCamera = map.nodes[1] as BackgroundCamera;
const verticalKeys = ['elevation', 'volumeHeight', 'pitch', 'roll', 'aspect'];
const hasVerticalKey = (node: object) => verticalKeys.some(key => key in node);

test('raising a space lifts only its unlocked members and only once', () => {
  const shelf: BackgroundSymbol = { ...symbol, id: 'shelf', elevation: 10 };
  const lockedCamera: BackgroundCamera = { ...memberCamera, id: 'locked', locked: true, elevation: 200 };
  const unrelated: BackgroundCamera = { ...memberCamera, id: 'unrelated', spaceId: null };
  const otherSpace: BackgroundSpace = { ...space, id: 'other' };
  const source: BackgroundMap = { ...map, nodes: [space, memberCamera, shelf, lockedCamera, unrelated, otherSpace] };
  const raised = transformMapSpace(source, { ...space, elevation: 50 });
  assert.deepEqual(raised.nodes[0], { ...space, elevation: 50 });
  assert.deepEqual(raised.nodes[1], { ...memberCamera, elevation: 170 });
  assert.deepEqual(raised.nodes[2], { ...shelf, elevation: 60 });
  assert.equal(raised.nodes[3], lockedCamera); assert.equal(raised.nodes[4], unrelated); assert.equal(raised.nodes[5], otherSpace);
  assert.equal(source.nodes[1], memberCamera); assert.equal('elevation' in memberCamera, false); assert.equal(shelf.elevation, 10);

  const lowered = transformMapSpace(raised, { ...space, elevation: 20 });
  assert.deepEqual(lowered.nodes[1], { ...memberCamera, elevation: 140 });
  assert.deepEqual(lowered.nodes[2], { ...shelf, elevation: 30 });

  // A move and a lift in one edit: the plan carry and the height difference each apply once.
  const both = transformMapSpace(source, { ...space, x: 140, y: 90, elevation: -25 });
  const carried = both.nodes[1] as BackgroundCamera, expected = moveMapNode(source, space.id, { x: 40, y: -10 }).nodes[1] as BackgroundCamera;
  near(carried.x, expected.x); near(carried.y, expected.y); near(carried.x, 170); near(carried.y, 120);
  assert.equal(carried.elevation, 95); assert.equal(carried.angle, memberCamera.angle);
  assert.equal((both.nodes[2] as BackgroundSymbol).elevation, -15);
  assert.equal(both.nodes[3], lockedCamera);

  // Writing the default explicitly is not a height change.
  const explicit = transformMapSpace(source, { ...space, elevation: 0 });
  assert.equal(explicit.nodes[1], memberCamera); assert.equal(explicit.nodes[2], shelf);
  assert.deepEqual(explicit.nodes[0], { ...space, elevation: 0 });

  // A lift alone never recomputes the plan position, even in a turned space with uneven numbers.
  const turned: BackgroundSpace = { ...space, x: 101.3, y: 97.7, width: 123.4, height: 61.9, rotation: 37 };
  const odd: BackgroundCamera = { ...memberCamera, x: 130.123456789, y: 141.987654321, angle: 211.11111 };
  const oddShelf: BackgroundSymbol = { ...symbol, x: 133.3333333, y: 144.4444444, width: 21.7, height: 9.3, rotation: 349.9 };
  const lifted = transformMapSpace({ ...map, nodes: [turned, odd, oddShelf] }, { ...turned, elevation: 12.5 });
  assert.deepEqual(lifted.nodes[1], { ...odd, elevation: 132.5 }); assert.deepEqual(lifted.nodes[2], { ...oddShelf, elevation: 12.5 });
  // Members stop at the saved limit instead of leaving it.
  const top: BackgroundCamera = { ...memberCamera, elevation: 99990 };
  assert.equal((transformMapSpace({ ...map, nodes: [space, top] }, { ...space, elevation: 50 }).nodes[1] as BackgroundCamera).elevation, 100000);
  assert.equal((transformMapSpace({ ...map, nodes: [space, { ...top, elevation: -99990 }] }, { ...space, elevation: -50 }).nodes[1] as BackgroundCamera).elevation, -100000);
  // A broken height on the space is not handed on to its members.
  assert.equal(transformMapSpace(source, { ...space, elevation: Number.NaN }).nodes[1], memberCamera);
  assert.equal((transformMapSpace(source, { ...space, x: 140, elevation: Number.NaN }).nodes[1] as BackgroundCamera).elevation, undefined);
});

test('changing only the box height of a space leaves its members untouched', () => {
  const tall: BackgroundCamera = { ...memberCamera, elevation: 150, pitch: -20 };
  const source: BackgroundMap = { ...map, nodes: [space, tall, symbol] };
  const changed = transformMapSpace(source, { ...space, volumeHeight: 400 });
  assert.deepEqual(changed.nodes[0], { ...space, volumeHeight: 400 });
  assert.equal(changed.nodes[1], tall); assert.equal(changed.nodes[2], symbol);
  const again = transformMapSpace(changed, { ...space, volumeHeight: 90 });
  assert.equal(again.nodes[1], tall); assert.equal(again.nodes[2], symbol);
  assert.equal(hasVerticalKey(symbol), false);
});

test('plan moves and rotations of a space keep the vertical fields of its members', () => {
  const camera: BackgroundCamera = { ...memberCamera, elevation: 200, pitch: -30, roll: 5, aspect: 2 };
  const tilted: BackgroundSymbol = { ...symbol, elevation: 10, volumeHeight: 33, pitch: 20, roll: -15 };
  const source: BackgroundMap = { ...map, nodes: [{ ...space, elevation: 40, volumeHeight: 250 }, camera, tilted, memberCamera] };
  const moved = transformMapSpace(source, { ...source.nodes[0] as BackgroundSpace, x: 300, y: 200, width: 200, height: 180, rotation: 180 });
  const nextCamera = moved.nodes[1] as BackgroundCamera, nextSymbol = moved.nodes[2] as BackgroundSymbol, legacy = moved.nodes[3] as BackgroundCamera;
  assert.notEqual(nextCamera.x, camera.x); near(nextCamera.angle, 90);
  assert.deepEqual([nextCamera.elevation, nextCamera.pitch, nextCamera.roll, nextCamera.aspect], [200, -30, 5, 2]);
  assert.notEqual(nextSymbol.x, tilted.x); near(nextSymbol.rotation, 80);
  assert.deepEqual([nextSymbol.elevation, nextSymbol.volumeHeight, nextSymbol.pitch, nextSymbol.roll], [10, 33, 20, -15]);
  assert.notEqual(legacy.x, memberCamera.x); assert.equal(hasVerticalKey(legacy), false);
  assert.deepEqual([(moved.nodes[0] as BackgroundSpace).elevation, (moved.nodes[0] as BackgroundSpace).volumeHeight], [40, 250]);
});

test('a locked space rejects elevation and box height changes', () => {
  const lockedSpace: BackgroundSpace = { ...space, locked: true, elevation: 10, volumeHeight: 200 };
  const source: BackgroundMap = { ...map, nodes: [lockedSpace, memberCamera] };
  assert.equal(transformMapSpace(source, { ...lockedSpace, elevation: 60 }), source);
  assert.equal(transformMapSpace(source, { ...lockedSpace, volumeHeight: 90 }), source);
  const legacyLocked: BackgroundMap = { ...map, nodes: [{ ...space, locked: true }, memberCamera] };
  assert.equal(transformMapSpace(legacyLocked, { ...space, locked: true, elevation: 5 }), legacyLocked);
  assert.equal(transformMapSpace(legacyLocked, { ...space, locked: true, volumeHeight: 181 }), legacyLocked);
  // Renaming and unlocking stay possible, and keep the vertical fields.
  const renamed = transformMapSpace(source, { ...lockedSpace, name: '과학실', locked: false });
  assert.deepEqual(renamed.nodes[0], { ...lockedSpace, name: '과학실', locked: false }); assert.equal(renamed.nodes[1], memberCamera);
});

test('moving a camera on the plan preserves its height, tilt and frame', () => {
  const camera: BackgroundCamera = { ...memberCamera, elevation: 260, pitch: -90, roll: 12, aspect: 2.35 };
  const moved = moveMapNode({ ...map, nodes: [space, camera] }, camera.id, { x: 25, y: -40 });
  assert.deepEqual(moved.nodes[1], { ...camera, x: 155, y: 90 });
  const legacy = moveMapNode(map, memberCamera.id, { x: 25, y: -40 }).nodes[1];
  assert.deepEqual(legacy, { ...memberCamera, x: 155, y: 90 }); assert.equal(hasVerticalKey(legacy), false);
});

test('new cameras always start at the same fixed point with their own id and name', () => {
  const empty: BackgroundMap = { ...map, nodes: [] };
  const first = addMapCamera(empty, 'camera-1'), second = addMapCamera(first.map, 'camera-2');
  // Earlier cameras may have been moved and anything may be selected: the spawn does not follow them.
  const rearranged = moveMapNode(second.map, 'camera-1', { x: 300, y: -200 });
  const third = addMapCamera(rearranged, 'camera-3');
  for (const { camera } of [first, second, third]) assert.deepEqual([camera.x, camera.y, camera.elevation], [500, 340, 120]);
  assert.deepEqual([first, second, third].map(result => result.camera.id), ['camera-1', 'camera-2', 'camera-3']);
  assert.deepEqual([first, second, third].map(result => result.camera.name), ['카메라 1', '카메라 2', '카메라 3']);
  assert.deepEqual(third.map.nodes.map(node => node.id), ['camera-1', 'camera-2', 'camera-3']);
  assert.equal(third.map.nodes[2], third.camera); assert.equal(third.map.nodes[1], second.camera);
  assert.deepEqual([third.map.nodes[0].x, third.map.nodes[0].y], [800, 140]);
  assert.deepEqual(first.camera, { id: 'camera-1', type: 'camera', name: '카메라 1', x: 500, y: 340, spaceId: null, angle: 0, fov: 60, viewIds: [], locked: false, elevation: 120, pitch: 0, roll: 0, aspect: 16 / 9 });
  assert.equal(empty.nodes.length, 0); assert.equal(first.map.nodes.length, 1); assert.equal(addMapCamera.length, 2);
  // A freed number is reused, like any other smallest free name.
  assert.equal(addMapCamera(removeMapNode(third.map, 'camera-2'), 'camera-4').camera.name, '카메라 2');
});

test('a new camera joins a space only when exactly one space contains the fixed point', () => {
  const room: BackgroundSpace = { ...space, id: 'room', x: 400, y: 300, width: 200, height: 100, rotation: 0 };
  const far: BackgroundSpace = { ...space, id: 'far', x: 0, y: 0, width: 100, height: 100, rotation: 0 };
  const hall: BackgroundSpace = { ...room, id: 'hall', x: 450, y: 320, shape: 'ellipse' };
  const withNodes = (nodes: BackgroundMap['nodes']): BackgroundMap => ({ ...map, nodes });
  assert.equal(addMapCamera(withNodes([far]), 'c').camera.spaceId, null);
  const joined = addMapCamera(withNodes([far, room]), 'c');
  assert.equal(joined.camera.spaceId, 'room'); assert.equal(joined.map.nodes[2], joined.camera);
  assert.equal(joined.map.nodes[0], far); assert.equal(joined.map.nodes[1], room);
  assert.equal(addMapCamera(withNodes([room, hall]), 'c').camera.spaceId, null);
  assert.equal(addMapCamera(withNodes([far, hall]), 'c').camera.spaceId, 'hall');
  // Rotation decides containment the same way the plan does.
  const below: BackgroundSpace = { ...space, id: 'thin', x: 300, y: 490, width: 400, height: 20, rotation: 0 };
  assert.equal(addMapCamera(withNodes([below]), 'c').camera.spaceId, null);
  assert.equal(addMapCamera(withNodes([{ ...below, rotation: 90 }]), 'c').camera.spaceId, 'thin');
  const across: BackgroundSpace = { ...below, x: 450, y: 330 };
  assert.equal(addMapCamera(withNodes([across]), 'c').camera.spaceId, 'thin');
  assert.equal(addMapCamera(withNodes([{ ...across, rotation: 90 }]), 'c').camera.spaceId, null);
  // A locked space still counts; the camera itself is new and free.
  assert.equal(addMapCamera(withNodes([{ ...room, locked: true }]), 'c').camera.spaceId, 'room');
});

test('a 3D move along one axis writes that axis only and adds no vertical field to saved nodes', () => {
  const camera: BackgroundCamera = { ...memberCamera, spaceId: null, x: 130.123456789, y: 130.987654321, angle: -37.5 };
  const chair: BackgroundSymbol = { ...symbol, id: 'chair', symbol: 'chair', spaceId: null, x: 10.1111111, y: 20.2222222, width: 33.3333333, height: 44.4444444, rotation: 350 };
  const room: BackgroundSpace = { ...space, id: 'room', x: 65.3333333, y: 115.7777777, width: 150.1234567, height: 80.7654321, rotation: -90 };
  const source: BackgroundMap = { ...map, nodes: [room, camera, chair] }, frozen = JSON.stringify(source);
  for (const node of source.nodes) {
    const pose = nodeWorldPose(node);
    assert.equal(applyNodeWorldPose(source, node.id, { position: pose.position, quaternion: pose.quaternion, scale: one }), source, `${node.id} identity`);
    const moved = applyNodeWorldPose(source, node.id, { position: { ...pose.position, x: pose.position.x + 50 }, quaternion: pose.quaternion, scale: one });
    const next = moved.nodes.find(item => item.id === node.id)!;
    assert.deepEqual(Object.keys(next), Object.keys(node), `${node.id} keys`);
    assert.equal(hasVerticalKey(next), false);
    assert.equal(JSON.stringify(next.y), JSON.stringify(node.y), `${node.id} y`);
    assert.equal(next.x, Math.round((node.x + 50) * 1000) / 1000, `${node.id} x`);
    assert.deepEqual({ ...next, x: node.x }, node, `${node.id} other fields`);
    for (const other of source.nodes) if (other.id !== node.id) assert.equal(moved.nodes.find(item => item.id === other.id), other);
  }
  assert.equal(JSON.stringify(source), frozen);
  // Depth only: x stays byte-identical instead.
  const pose = nodeWorldPose(chair), deeper = applyNodeWorldPose(source, chair.id, { position: { ...pose.position, z: pose.position.z - 7.25 }, quaternion: pose.quaternion, scale: one }).nodes[2];
  assert.equal(deeper.x, chair.x); assert.equal(deeper.y, 12.972); assert.equal(hasVerticalKey(deeper), false);
});

test('a 3D lift writes the elevation and nothing else', () => {
  const chair: BackgroundSymbol = { ...symbol, id: 'chair', symbol: 'chair', spaceId: null };
  const source: BackgroundMap = { ...map, nodes: [space, memberCamera, chair] };
  const cameraPose = nodeWorldPose(memberCamera);
  assert.equal(cameraPose.position.y, 120);
  const lifted = applyNodeWorldPose(source, memberCamera.id, { position: { ...cameraPose.position, y: 75.55555 }, quaternion: cameraPose.quaternion, scale: one });
  assert.deepEqual(lifted.nodes[1], { ...memberCamera, elevation: 75.556 });
  assert.equal(lifted.nodes[0], space); assert.equal(lifted.nodes[2], chair);
  const chairPose = nodeWorldPose(chair);
  const raised = applyNodeWorldPose(source, chair.id, { position: { ...chairPose.position, y: 40 }, quaternion: chairPose.quaternion, scale: one });
  assert.deepEqual(raised.nodes[2], { ...chair, elevation: 40 });
  // A stored value is replaced, and returning to it is not a rewrite.
  const again = applyNodeWorldPose(raised, chair.id, { position: { ...chairPose.position, y: -12.5 }, quaternion: chairPose.quaternion, scale: one });
  assert.deepEqual(again.nodes[2], { ...chair, elevation: -12.5 });
  assert.equal(applyNodeWorldPose(raised, chair.id, { position: { ...chairPose.position, y: 40 }, quaternion: chairPose.quaternion, scale: one }), raised);
});

test('a 3D turn reads the camera angles and keeps the yaw while looking straight up or down', () => {
  const camera: BackgroundCamera = { ...memberCamera, spaceId: null, angle: 37.5 };
  const source: BackgroundMap = { ...map, nodes: [camera] }, position = nodeWorldPose(camera).position;
  const turn = (from: BackgroundMap, angles: { angle: number; pitch: number; roll: number }) =>
    applyNodeWorldPose(from, camera.id, { position, quaternion: cameraOrientation(angles), scale: { x: 3, y: 3, z: 3 } });
  const up = turn(source, { angle: 37.5, pitch: 90, roll: 0 });
  assert.deepEqual(up.nodes[0], { ...camera, pitch: 90 });
  const back = turn(up, { angle: 37.5, pitch: 60, roll: 0 }).nodes[0] as BackgroundCamera;
  assert.deepEqual(back, { ...camera, pitch: 60 });
  const down = turn(up, { angle: 37.5, pitch: -90, roll: 0 });
  assert.deepEqual(down.nodes[0], { ...camera, pitch: -90 });
  // Almost vertical snaps to exactly vertical; a clear tilt is rounded, never snapped.
  assert.equal((turn(source, { angle: 37.5, pitch: 89.9997, roll: 0 }).nodes[0] as BackgroundCamera).pitch, 90);
  assert.equal((turn(source, { angle: 37.5, pitch: -89.99962, roll: 0 }).nodes[0] as BackgroundCamera).pitch, -90);
  assert.equal((turn(source, { angle: 37.5, pitch: 89.99, roll: 0 }).nodes[0] as BackgroundCamera).pitch, 89.99);
  assert.equal((turn(source, { angle: 37.5, pitch: -44.44449, roll: 0 }).nodes[0] as BackgroundCamera).pitch, -44.444);
  // Yaw and roll are written only when they change; the frame, lens and links are never touched.
  const framed: BackgroundCamera = { ...camera, fov: 35, aspect: 2.35, viewIds: ['view', 'other'], spaceId: 'space' };
  const rolled = applyNodeWorldPose({ ...map, nodes: [space, framed] }, framed.id, { position, quaternion: cameraOrientation({ angle: 200.12345, pitch: 0, roll: -30 }), scale: one }).nodes[1];
  assert.deepEqual(rolled, { ...framed, angle: 200.123, roll: -30 });
  const wrapped = turn(source, { angle: 359.9998, pitch: 0, roll: 0 }).nodes[0] as BackgroundCamera;
  assert.equal(wrapped.angle, 0); assert.equal('pitch' in wrapped, false);
  // A legacy angle outside 0..360 is the same direction and is left as stored, digit for digit.
  for (const angle of [-90, -90.0004, -359.99999, 360]) {
    const negative: BackgroundCamera = { ...camera, angle };
    const lifted = applyNodeWorldPose({ ...map, nodes: [negative] }, negative.id, { position: { ...position, y: 10 }, quaternion: nodeWorldPose(negative).quaternion, scale: one }).nodes[0];
    assert.deepEqual(lifted, { ...negative, elevation: 10 }, `angle ${angle}`);
  }
  const turnedChair: BackgroundSymbol = { ...symbol, spaceId: null, rotation: -45.0004, roll: -180, pitch: 10 };
  const chairPose = nodeWorldPose(turnedChair);
  const liftedChair = applyNodeWorldPose({ ...map, nodes: [turnedChair] }, turnedChair.id, { position: { ...chairPose.position, y: 3 }, quaternion: chairPose.quaternion, scale: one }).nodes[0];
  assert.deepEqual(liftedChair, { ...turnedChair, elevation: 3 });
});

test('a 3D result that lands back on the saved value is not a change', () => {
  const edge: BackgroundCamera = { ...memberCamera, id: 'edge', spaceId: null, x: 100000, y: -100000, elevation: 100000 };
  const table: BackgroundSymbol = { ...symbol, id: 'table', symbol: 'table', spaceId: null, x: 0, y: 0, width: 10, height: 100000, volumeHeight: 1 };
  const source: BackgroundMap = { ...map, nodes: [edge, table, memberCamera] };
  const edgePose = nodeWorldPose(edge), tablePose = nodeWorldPose(table), cameraPose = nodeWorldPose(memberCamera);
  // Pushed past a limit it already sits on.
  assert.equal(applyNodeWorldPose(source, edge.id, { position: { x: 150000, y: 150000, z: -150000 }, quaternion: edgePose.quaternion, scale: one }), source);
  assert.equal(applyNodeWorldPose(source, table.id, { position: tablePose.position, quaternion: tablePose.quaternion, scale: { x: 0.5, y: 0.5, z: 2 } }), source);
  // Nudged by less than the stored precision.
  assert.equal(applyNodeWorldPose(source, memberCamera.id, { position: { x: cameraPose.position.x + 0.0002, y: cameraPose.position.y - 0.0003, z: cameraPose.position.z + 0.0004 }, quaternion: cameraPose.quaternion, scale: one }), source);
  assert.equal(applyNodeWorldPose(source, memberCamera.id, { position: cameraPose.position, quaternion: cameraOrientation({ angle: 0.0002, pitch: 0.0003, roll: -0.0004 }), scale: one }), source);
  // One real change still leaves the other nudged axes as saved.
  const moved = applyNodeWorldPose(source, memberCamera.id, { position: { x: cameraPose.position.x + 0.0002, y: cameraPose.position.y, z: cameraPose.position.z + 5 }, quaternion: cameraPose.quaternion, scale: one }).nodes[2];
  assert.deepEqual(moved, { ...memberCamera, y: 135 });
});

test('a 3D edit of a space carries its members once, like the plan edit', () => {
  const shelf: BackgroundSymbol = { ...symbol, id: 'shelf', elevation: 10 };
  const lockedCamera: BackgroundCamera = { ...memberCamera, id: 'locked', locked: true };
  const source: BackgroundMap = { ...map, nodes: [space, memberCamera, shelf, lockedCamera] }, frozen = JSON.stringify(source);
  const pose = nodeWorldPose(space);
  assert.deepEqual(pose.position, { x: 150, y: 0, z: 130 });
  const sameMembers = (actual: BackgroundMap, expected: BackgroundMap) => actual.nodes.forEach((node, index) => {
    const other = expected.nodes[index];
    assert.deepEqual(Object.keys(node), Object.keys(other), node.id);
    for (const [key, value] of Object.entries(node)) typeof value === 'number' ? near(value, (other as unknown as Record<string, number>)[key]) : assert.deepEqual(value, (other as unknown as Record<string, unknown>)[key]);
  });

  const moved = applyNodeWorldPose(source, space.id, { position: { x: 190, y: 0, z: 120 }, quaternion: pose.quaternion, scale: one });
  assert.deepEqual(moved.nodes[0], { ...space, x: 140, y: 90 });
  sameMembers(moved, moveMapNode(source, space.id, { x: 40, y: -10 }));
  near(moved.nodes[1].x, 170); near(moved.nodes[1].y, 120); assert.equal(moved.nodes[3], lockedCamera);
  assert.equal(hasVerticalKey(moved.nodes[0]), false); assert.equal(hasVerticalKey(moved.nodes[1]), false);

  const turned = applyNodeWorldPose(source, space.id, { position: pose.position, quaternion: nodeOrientation({ rotation: 180, pitch: 0, roll: 0 }), scale: one });
  assert.deepEqual(turned.nodes[0], { ...space, rotation: 180 });
  sameMembers(turned, transformMapSpace(source, { ...space, rotation: 180 }));
  near((turned.nodes[1] as BackgroundCamera).angle, 90);

  const raised = applyNodeWorldPose(source, space.id, { position: { ...pose.position, y: 30 }, quaternion: pose.quaternion, scale: one });
  assert.deepEqual(raised.nodes[0], { ...space, elevation: 30 });
  assert.deepEqual(raised.nodes[1], { ...memberCamera, elevation: 150 }); assert.deepEqual(raised.nodes[2], { ...shelf, elevation: 40 });
  assert.equal(raised.nodes[3], lockedCamera);

  const scaled = applyNodeWorldPose(source, space.id, { position: pose.position, quaternion: pose.quaternion, scale: { x: 2, y: 1.5, z: 0.5 } });
  assert.deepEqual(scaled.nodes[0], { ...space, x: 50, y: 115, width: 200, height: 30, volumeHeight: 270 });
  sameMembers(scaled, transformMapSpace(source, { ...space, x: 50, y: 115, width: 200, height: 30, volumeHeight: 270 }));

  // Spaces stay upright: a tilt in the gizmo result is ignored, the heading is kept.
  assert.equal(applyNodeWorldPose(source, space.id, { position: pose.position, quaternion: nodeOrientation({ rotation: 90, pitch: 25, roll: 10 }), scale: one }), source);
  const tiltedTurn = applyNodeWorldPose(source, space.id, { position: pose.position, quaternion: nodeOrientation({ rotation: 45, pitch: 25, roll: 10 }), scale: one }).nodes[0];
  assert.deepEqual(tiltedTurn, { ...space, rotation: 45 });
  assert.equal(JSON.stringify(source), frozen);
});

test('a 3D edit of an object reads its three turns, size and base centre', () => {
  const chair: BackgroundSymbol = { ...symbol, id: 'chair', symbol: 'chair', spaceId: null, x: 100, y: 200, width: 60, height: 40, rotation: 350 };
  const source: BackgroundMap = { ...map, nodes: [chair] }, pose = nodeWorldPose(chair);
  assert.deepEqual(pose.position, { x: 130, y: 0, z: 220 }); assert.deepEqual(pose.size, { x: 60, y: 70, z: 40 });
  const tilted = applyNodeWorldPose(source, chair.id, { position: pose.position, quaternion: nodeOrientation({ rotation: 350, pitch: 30, roll: 0 }), scale: one }).nodes[0];
  assert.deepEqual(tilted, { ...chair, pitch: 30 });
  const all = applyNodeWorldPose(source, chair.id, { position: { x: 200, y: 15, z: 300 }, quaternion: nodeOrientation({ rotation: 120.5, pitch: -45, roll: 170 }), scale: { x: 2, y: 2, z: 0.5 } }).nodes[0];
  assert.deepEqual(all, { ...chair, x: 140, y: 290, width: 120, height: 20, rotation: 120.5, elevation: 15, volumeHeight: 140, pitch: -45, roll: 170 });
  // Lying flat keeps the stored heading and the plan size.
  const flat = applyNodeWorldPose(source, chair.id, { position: pose.position, quaternion: nodeOrientation({ rotation: 350, pitch: 90, roll: 0 }), scale: one }).nodes[0];
  assert.deepEqual(flat, { ...chair, pitch: 90 });
  const half = applyNodeWorldPose(source, chair.id, { position: pose.position, quaternion: nodeOrientation({ rotation: 350, pitch: 0, roll: 180 }), scale: one }).nodes[0] as BackgroundSymbol;
  assert.equal(half.roll, 180); assert.equal(half.rotation, 350); assert.equal('pitch' in half, false);
});

test('3D edits ignore locked or unknown nodes and clamp values to the saved limits', () => {
  const lockedSpace: BackgroundSpace = { ...space, locked: true }, lockedCamera: BackgroundCamera = { ...memberCamera, locked: true };
  const lockedSymbol: BackgroundSymbol = { ...symbol, locked: true };
  const source: BackgroundMap = { ...map, nodes: [lockedSpace, lockedCamera, lockedSymbol] };
  const pose = { position: { x: 1, y: 2, z: 3 }, quaternion: cameraOrientation({ angle: 10, pitch: 20, roll: 30 }), scale: { x: 2, y: 2, z: 2 } };
  for (const id of [lockedSpace.id, lockedCamera.id, lockedSymbol.id, 'missing']) assert.equal(applyNodeWorldPose(source, id, pose), source);

  const free: BackgroundMap = { ...map, nodes: [space, { ...memberCamera, spaceId: null }, { ...symbol, spaceId: null }] };
  const upright = { x: 0, y: 0, z: 0, w: 1 };
  const farCamera = applyNodeWorldPose(free, memberCamera.id, { position: { x: 1e9, y: -1e9, z: -1e9 }, quaternion: nodeWorldPose(memberCamera).quaternion, scale: one }).nodes[1];
  assert.deepEqual([farCamera.x, farCamera.y, (farCamera as BackgroundCamera).elevation], [100000, -100000, -100000]);
  const huge = applyNodeWorldPose(free, symbol.id, { position: { x: 0, y: 1e9, z: 0 }, quaternion: upright, scale: { x: 1e9, y: 1e9, z: 1e9 } }).nodes[2] as BackgroundSymbol;
  assert.deepEqual([huge.width, huge.height, huge.volumeHeight, huge.elevation], [100000, 100000, 100000, 100000]);
  assert.deepEqual([huge.x, huge.y], [-50000, -50000]);
  const tiny = applyNodeWorldPose(free, symbol.id, { position: nodeWorldPose(symbol).position, quaternion: nodeWorldPose(symbol).quaternion, scale: { x: 1e-9, y: 1e-9, z: -4 } }).nodes[2] as BackgroundSymbol;
  assert.deepEqual([tiny.width, tiny.height, tiny.volumeHeight], [10, 10, 1]);
  const tinySpace = applyNodeWorldPose(free, space.id, { position: nodeWorldPose(space).position, quaternion: nodeWorldPose(space).quaternion, scale: { x: 0, y: 0, z: 0 } }).nodes[0] as BackgroundSpace;
  assert.deepEqual([tinySpace.width, tinySpace.height, tinySpace.volumeHeight], [10, 10, 1]);
  // A broken gizmo result never reaches the draft.
  const broken = applyNodeWorldPose(free, memberCamera.id, { position: { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: 130 }, quaternion: { x: Number.NaN, y: 0, z: 0, w: 1 }, scale: one });
  assert.equal(broken, free);
  const empty = { x: 0, y: 0, z: 0, w: 0 };
  for (const node of free.nodes) assert.equal(applyNodeWorldPose(free, node.id, { position: nodeWorldPose(node).position, quaternion: empty, scale: { x: Number.NaN, y: Number.NaN, z: Number.NaN } }), free, node.id);
  for (const result of [farCamera, huge, tiny, tinySpace]) for (const value of Object.values(result)) assert.notEqual(value, undefined);
});

test('overlapping cameras and objects can be listed to pick each one', () => {
  const at = (id: string, x: number, y: number, extra: Partial<BackgroundCamera> = {}): BackgroundCamera => ({ ...memberCamera, id, x, y, spaceId: null, ...extra });
  const box: BackgroundSymbol = { ...symbol, id: 'box', spaceId: null, x: 490, y: 335, width: 20, height: 10, rotation: 40 };
  const around: BackgroundSpace = { ...space, id: 'around', x: 450, y: 310, width: 100, height: 60, rotation: 0 };
  const corner: BackgroundSpace = { ...space, id: 'corner', x: 500, y: 340, width: 100, height: 60, rotation: 0 };
  const source: BackgroundMap = { ...map, nodes: [around, corner, at('a', 500, 340), at('far', 520, 340), at('b', 500, 340, { elevation: 300, locked: true }), box, at('c', 505, 345)] };
  assert.deepEqual(stackedMapNodeIds(source, 'a'), ['a', 'b', 'box', 'c']);
  assert.deepEqual(stackedMapNodeIds(source, 'b'), ['a', 'b', 'box', 'c']);
  assert.deepEqual(stackedMapNodeIds(source, 'box'), ['a', 'b', 'box', 'c']);
  assert.deepEqual(stackedMapNodeIds(source, 'far'), ['far']);
  assert.deepEqual(stackedMapNodeIds(source, 'far', 20), ['a', 'far', 'b', 'box', 'c']);
  assert.deepEqual(stackedMapNodeIds(source, 'a', 0), ['a', 'b', 'box']);
  assert.deepEqual(stackedMapNodeIds(source, 'c', 6), ['c']);
  assert.deepEqual(stackedMapNodeIds(source, 'around'), ['around']);
  assert.deepEqual(stackedMapNodeIds(source, 'missing'), []);
  const three = [1, 2, 3].reduce((current, index) => addMapCamera(current, `new-${index}`).map, { ...map, nodes: [] } as BackgroundMap);
  assert.deepEqual(stackedMapNodeIds(three, 'new-2'), ['new-1', 'new-2', 'new-3']);
});

test('a 3D edit never rewrites a stored pitch that already reads as straight up or down', () => {
  // Closer than about 0.00006 degrees to a pole the line of sight has no horizontal part left to read.
  for (const pitch of [89.99995, 89.99999, -89.99995, -89.99999]) {
    const pole = Math.sign(pitch) * 90;
    const camera: BackgroundCamera = { ...memberCamera, spaceId: null, angle: 137, pitch, roll: 0, elevation: 120 };
    const chair: BackgroundSymbol = { ...symbol, id: 'chair', symbol: 'chair', spaceId: null, pitch, roll: 12 };
    const source: BackgroundMap = { ...map, nodes: [camera, chair] };
    for (const node of [camera, chair]) {
      const pose = nodeWorldPose(node), label = `${node.type} ${pitch}`;
      const at = (position: typeof pose.position) => applyNodeWorldPose(source, node.id, { position, quaternion: pose.quaternion, scale: one });
      assert.equal(at(pose.position), source, `${label} identity`);
      assert.deepEqual(at({ ...pose.position, x: pose.position.x + 50 }).nodes.find(item => item.id === node.id), { ...node, x: node.x + 50 }, `${label} move`);
      assert.deepEqual(at({ ...pose.position, y: 33 }).nodes.find(item => item.id === node.id), { ...node, elevation: 33 }, `${label} lift`);
    }
    // The other pole and a clear tilt are real changes and are still written.
    const position = nodeWorldPose(camera).position;
    const turn = (tilt: number) => applyNodeWorldPose(source, camera.id, { position, quaternion: cameraOrientation({ angle: 137, pitch: tilt, roll: 0 }), scale: one }).nodes[0];
    assert.deepEqual(turn(-pole), { ...camera, pitch: -pole }); assert.deepEqual(turn(pole / 2), { ...camera, pitch: pole / 2 });
    const chairPose = nodeWorldPose(chair);
    const tilted = applyNodeWorldPose(source, chair.id, { position: chairPose.position, quaternion: nodeOrientation({ rotation: 350, pitch: pole / 3, roll: 12 }), scale: one }).nodes[1];
    assert.deepEqual(tilted, { ...chair, pitch: pole / 3 });
  }
  // Outside that window the stored pitch is not vertical yet: it survives a move, and reaching the pole is written.
  for (const pitch of [89.9999, 89.9996, -89.9999]) {
    const pole = Math.sign(pitch) * 90;
    const camera: BackgroundCamera = { ...memberCamera, spaceId: null, angle: 137, pitch };
    const source: BackgroundMap = { ...map, nodes: [camera] }, pose = nodeWorldPose(camera);
    assert.deepEqual(applyNodeWorldPose(source, camera.id, { position: { ...pose.position, x: pose.position.x + 50 }, quaternion: pose.quaternion, scale: one }).nodes[0], { ...camera, x: camera.x + 50 });
    assert.deepEqual(applyNodeWorldPose(source, camera.id, { position: pose.position, quaternion: cameraOrientation({ angle: 137, pitch: pole, roll: 0 }), scale: one }).nodes[0], { ...camera, pitch: pole });
  }
});

test('a 3D spin of a camera that looks straight up or down turns its plan direction, as the plan handle does', () => {
  type Q = { x: number; y: number; z: number; w: number };
  const multiply = (a: Q, b: Q): Q => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z });
  const axisAngle = (axis: { x: number; y: number; z: number }, degrees: number): Q => {
    const half = degrees * Math.PI / 360, s = Math.sin(half);
    return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
  };
  for (const pitch of [90, -90]) {
    const camera: BackgroundCamera = { ...memberCamera, spaceId: null, angle: 137, pitch, elevation: 120 };
    const source: BackgroundMap = { ...map, nodes: [camera] }, pose = nodeWorldPose(camera);
    // The ring around the line of sight of a vertical camera turns it about the vertical: a plan turn of 40 is -40 about world +Y.
    const spin = multiply(axisAngle({ x: 0, y: 1, z: 0 }, -40), pose.quaternion);
    const spun = applyNodeWorldPose(source, camera.id, { position: pose.position, quaternion: spin, scale: one });
    assert.deepEqual(spun.nodes[0], { ...camera, angle: 177 }, 'only the direction is written: no roll, and the tilt stays');
    // Tilting back by 10 with the pitch ring then goes where the plan pointed, without a jump of the direction.
    const yaw = 177 * Math.PI / 180, rightAxis = { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
    const tilted = applyNodeWorldPose(spun, camera.id, { position: pose.position, quaternion: multiply(axisAngle(rightAxis, pitch > 0 ? -10 : 10), spin), scale: one });
    assert.deepEqual(tilted.nodes[0], { ...camera, angle: 177, pitch: pitch > 0 ? 80 : -80 });
    // A stored roll is kept through the spin as well.
    const rolled: BackgroundCamera = { ...camera, roll: 25 }, rolledPose = nodeWorldPose(rolled);
    const again = applyNodeWorldPose({ ...map, nodes: [rolled] }, rolled.id, { position: rolledPose.position, quaternion: multiply(axisAngle({ x: 0, y: 1, z: 0 }, 115), rolledPose.quaternion), scale: one });
    assert.deepEqual(again.nodes[0], { ...rolled, angle: 22 });
    // Moving or lifting it writes neither direction nor roll.
    assert.deepEqual(applyNodeWorldPose(source, camera.id, { position: { ...pose.position, x: pose.position.x + 30, y: 80 }, quaternion: pose.quaternion, scale: one }).nodes[0], { ...camera, x: camera.x + 30, elevation: 80 });
  }
});

test('a 3D edit of a space stops its carried members at the saved limit', () => {
  const room: BackgroundSpace = { ...space, id: 'room', x: 100, y: 110, width: 470, height: 300, rotation: 0 };
  const lens: BackgroundCamera = { ...memberCamera, id: 'lens', spaceId: 'room', x: 470, y: 340, elevation: 150, pitch: -30 };
  const desk: BackgroundSymbol = { ...symbol, id: 'desk', symbol: 'table', spaceId: 'room', x: 150, y: 150, width: 60, height: 40, rotation: 0 };
  const porch: BackgroundCamera = { ...memberCamera, id: 'porch', spaceId: 'room', x: 50, y: 60 };
  const lockedLens: BackgroundCamera = { ...lens, id: 'locked', locked: true }, unrelated: BackgroundCamera = { ...lens, id: 'unrelated', spaceId: null };
  const source: BackgroundMap = { ...map, nodes: [room, lens, desk, porch, lockedLens, unrelated] }, frozen = JSON.stringify(source);
  const upright = { x: 0, y: 0, z: 0, w: 1 };
  const edit = (position: { x: number; y: number; z: number }, scale = one) => applyNodeWorldPose(source, room.id, { position, quaternion: upright, scale });
  const storable = (result: BackgroundMap) => result.nodes.every(node => Math.abs(node.x) <= 100000 && Math.abs(node.y) <= 100000);

  // Inside the limit nothing differs from the plan carry.
  assert.deepEqual(edit({ x: 335, y: 0, z: 99000 }), transformMapSpace(source, { ...room, y: 98850 }));
  // Past it the space stops at the limit, and so does every member the carry would have pushed beyond.
  const down = edit({ x: 335, y: 0, z: 100200 });
  assert.deepEqual(down.nodes[0], { ...room, y: 100000 });
  assert.deepEqual(down.nodes[1], { ...lens, y: 100000 }); assert.deepEqual(down.nodes[2], { ...desk, y: 100000 });
  assert.deepEqual(down.nodes[3], { ...porch, y: 99950 });
  assert.equal(down.nodes[4], lockedLens); assert.equal(down.nodes[5], unrelated); assert.ok(storable(down));
  const left = edit({ x: -250000, y: 0, z: 260 });
  assert.deepEqual(left.nodes[0], { ...room, x: -100000 });
  assert.deepEqual(left.nodes[1], { ...lens, x: -99630 }); assert.deepEqual(left.nodes[2], { ...desk, x: -99950 });
  assert.deepEqual(left.nodes[3], { ...porch, x: -100000 }); assert.ok(storable(left));
  const corner = edit({ x: 250000, y: 0, z: -250000 });
  assert.deepEqual([corner.nodes[0].x, corner.nodes[0].y], [100000, -100000]);
  assert.deepEqual([corner.nodes[1].x, corner.nodes[1].y], [100000, -99770]); assert.deepEqual([corner.nodes[3].x, corner.nodes[3].y], [99950, -100000]);
  assert.ok(storable(corner));
  // A resize that throws members far out is held the same way; members still inside keep the carried place.
  const grown = edit({ x: 90000, y: 0, z: 260 }, { x: 1e6, y: 1, z: 1 }), carried = transformMapSpace(source, grown.nodes[0] as BackgroundSpace);
  assert.equal((grown.nodes[0] as BackgroundSpace).width, 100000); assert.ok((carried.nodes[1] as BackgroundCamera).x > 100000);
  assert.deepEqual(grown.nodes[1], { ...carried.nodes[1], x: 100000 }); assert.deepEqual(grown.nodes[2], carried.nodes[2]);
  assert.ok(storable(grown));
  // Each preview starts again from the saved map, so coming back inside restores the arrangement.
  assert.deepEqual(edit({ x: 375, y: 0, z: 250 }), moveMapNode(source, room.id, { x: 40, y: -10 }));
  assert.equal(JSON.stringify(source), frozen);
  // Only coordinates this edit moved are held. A draft a plan drag already left outside keeps them through a lift.
  const outside = moveMapNode(source, room.id, { x: 100000, y: 0 }), outsideRoom = outside.nodes[0] as BackgroundSpace;
  assert.deepEqual([outsideRoom.x, outside.nodes[1].x], [100100, 100470]);
  const lifted = applyNodeWorldPose(outside, room.id, { position: { ...nodeWorldPose(outsideRoom).position, y: 30 }, quaternion: upright, scale: one });
  assert.deepEqual(lifted, transformMapSpace(outside, { ...outsideRoom, elevation: 30 }));
  assert.deepEqual(lifted.nodes[1], { ...outside.nodes[1], elevation: 180 }); assert.equal(lifted.nodes[4], lockedLens);
});

// --- Resize helpers, exact placement and node replacement --------------------------------------
const tight = (actual: number, expected: number, label = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label} ${actual} != ${expected}`);
const plainRoom: BackgroundSpace = { ...space, id: 'room', x: 100, y: 100, width: 60, height: 40, rotation: 0 };
/** Stored with decimals, as drawn rooms are. */
const oddRoom: BackgroundSpace = { ...space, id: 'odd', x: 244.65, y: 120.3, width: 144.65, height: 80, rotation: 0 };

test('a pointer resize is the pointer read in the node frame, then a resize to that local size', () => {
  const pointers = [{ x: 100, y: 230 }, { x: 331.7, y: 208.4 }, { x: 500, y: -100 }, { x: 200000, y: 200000 }];
  for (const rotation of [0, 90, 37]) for (const node of [{ ...oddRoom, rotation }, { ...symbol, rotation }]) for (const pointer of pointers) {
    const local = nodeLocalPoint(node, pointer);
    assert.deepEqual(resizeSpaceTo(node, local.x, local.y), resizeSpace(node, pointer), `${node.type} at ${rotation}`);
  }
  // The frame starts at the turned top-left corner and runs along the node's own sides.
  const local = nodeLocalPoint(space, { x: 100, y: 230 });
  tight(local.x, 150, 'local x'); tight(local.y, 80, 'local y');
  const grown = resizeSpaceTo(space, 150, 80);
  assert.equal(grown.width, 150); assert.equal(grown.height, 80); tight(grown.x, 65, 'x'); tight(grown.y, 115, 'y');
  // A half and a three-quarter turn are turned as well: the frame flips, and a new size moves the stored position.
  for (const [rotation, pointer, size, x, y] of [[180, { x: 75, y: 90 }, { x: 85, y: 50 }, 75, 90], [270, { x: 170, y: 65 }, { x: 85, y: 60 }, 97.5, 77.5]] as const) {
    const node = { ...plainRoom, rotation }, read = nodeLocalPoint(node, pointer), sized = resizeSpaceTo(node, size.x, size.y);
    tight(read.x, size.x, `local x at ${rotation}`); tight(read.y, size.y, `local y at ${rotation}`);
    assert.equal(sized.width, size.x); assert.equal(sized.height, size.y); tight(sized.x, x, `x at ${rotation}`); tight(sized.y, y, `y at ${rotation}`);
  }
  assert.deepEqual(nodeLocalPoint(oddRoom, { x: 300.4, y: 177.7 }), { x: 300.4 - 244.65, y: 177.7 - 120.3 });
  // Lengths stay within the saved limits, turned or not.
  for (const rotation of [0, 37]) {
    const clamped = resizeSpaceTo({ ...oddRoom, rotation }, 5, 200000);
    assert.equal(clamped.width, 10); assert.equal(clamped.height, 100000);
  }
});

test('resizing an unturned node keeps its stored position digit for digit', () => {
  // Going through the centre and back loses the last digit: (244.65 + 30) - 30 is 244.64999999999998.
  for (const [width, height] of [[30, 50], [60, 40], [55.35, 79.7], [144.65, 80], [5, 200000], [0.1 + 0.2, 1 / 3]]) {
    const resized = resizeSpaceTo(oddRoom, width, height);
    assert.equal(resized.x, 244.65, `x at width ${width}`); assert.equal(resized.y, 120.3, `y at height ${height}`);
  }
  for (const pointer of [{ x: 300, y: 200 }, { x: 274.65, y: 170.3 }, { x: 500000, y: -5 }, { x: 244.65, y: 120.3 }]) {
    const resized = resizeSpace({ ...oddRoom, width: 60, height: 40 }, pointer);
    assert.equal(resized.x, 244.65, `x at ${pointer.x}`); assert.equal(resized.y, 120.3, `y at ${pointer.y}`);
  }
  assert.deepEqual(resizeSpaceTo(oddRoom, 30, 50), { ...oddRoom, width: 30, height: 50 });
  // Symbols follow the same rule and keep their own fields.
  const door: BackgroundSymbol = { ...symbol, x: 244.65, y: 120.3, rotation: 0 };
  assert.deepEqual(resizeSpaceTo(door, 33.3, 12.5), { ...door, width: 33.3, height: 12.5 });
  assert.deepEqual(resizeSpace(door, { x: 300, y: 200 }), { ...door, width: 300 - 244.65, height: 200 - 120.3 });
});

test('the resize corner is the bottom-right corner of the turned box', () => {
  assert.deepEqual(nodeResizeCorner(oddRoom), { x: 244.65 + 144.65, y: 120.3 + 80 });
  assert.deepEqual(nodeResizeCorner({ ...symbol, rotation: 0 }), { x: 150, y: 155 });
  // Not through the centre either: 433.69 + 18.33 / 2 + 18.33 / 2 is 452.02000000000004.
  assert.deepEqual(nodeResizeCorner({ ...plainRoom, x: 433.69, y: 433.69, width: 18.33, height: 18.33 }), { x: 433.69 + 18.33, y: 433.69 + 18.33 });
  for (const [rotation, x, y] of [[90, 110, 150], [180, 100, 100], [270, 150, 90]]) {
    const corner = nodeResizeCorner({ ...plainRoom, rotation });
    tight(corner.x, x, `x at ${rotation}`); tight(corner.y, y, `y at ${rotation}`);
  }
  // Resizing to where the handle already stands changes no length.
  for (const rotation of [0, 90, 37]) for (const node of [{ ...oddRoom, rotation }, { ...symbol, rotation }]) {
    const same = resizeSpace(node, nodeResizeCorner(node)), label = `${node.type} at ${rotation}`;
    tight(same.width, node.width, `${label} width`); tight(same.height, node.height, `${label} height`);
    tight(same.x, node.x, `${label} x`); tight(same.y, node.y, `${label} y`);
  }
});

test('placing a node stores exactly the given position and carries the members of a space', () => {
  const lockedDoor: BackgroundSymbol = { ...symbol, id: 'locked-symbol', locked: true };
  const unrelated: BackgroundCamera = { ...memberCamera, id: 'unrelated', spaceId: null };
  const source: BackgroundMap = { ...map, nodes: [space, memberCamera, symbol, lockedDoor, unrelated] }, frozen = JSON.stringify(source);
  const target = { x: 244.65, y: 120.3 };

  const placed = placeMapNode(source, space.id, target);
  assert.equal(placed.nodes[0].x, 244.65); assert.equal(placed.nodes[0].y, 120.3);
  assert.deepEqual(placed.nodes[0], { ...space, ...target });
  // Members land where a move by the same difference takes them.
  const moved = moveMapNode(source, space.id, { x: target.x - space.x, y: target.y - space.y });
  for (const index of [1, 2]) {
    tight(placed.nodes[index].x, moved.nodes[index].x, `member ${index} x`); tight(placed.nodes[index].y, moved.nodes[index].y, `member ${index} y`);
    assert.deepEqual({ ...placed.nodes[index], x: 0, y: 0 }, { ...source.nodes[index], x: 0, y: 0 });
  }
  tight(placed.nodes[1].x, 274.65, 'camera x'); tight(placed.nodes[1].y, 150.3, 'camera y');
  assert.equal(placed.nodes[3], lockedDoor); assert.equal(placed.nodes[4], unrelated);

  // A camera or a symbol is placed alone.
  const lens = placeMapNode(source, memberCamera.id, { x: 3.3, y: -7.1 });
  assert.deepEqual(lens.nodes[1], { ...memberCamera, x: 3.3, y: -7.1 });
  const door = placeMapNode(source, symbol.id, target);
  assert.deepEqual(door.nodes[2], { ...symbol, ...target });
  for (const [result, changed] of [[lens, 1], [door, 2]] as const) source.nodes.forEach((node, index) => { if (index !== changed) assert.equal(result.nodes[index], node); });

  // Locked and unknown nodes return the map itself.
  const fixed: BackgroundMap = { ...map, nodes: [{ ...space, locked: true }, { ...memberCamera, locked: true }, lockedDoor] };
  for (const id of [space.id, memberCamera.id, lockedDoor.id, 'missing']) assert.equal(placeMapNode(fixed, id, target), fixed, id);
  assert.equal(placeMapNode(source, 'missing', target), source);
  assert.equal(JSON.stringify(source), frozen);
});

test('replacing a node swaps that node alone, where a space transform carries its members', () => {
  const source: BackgroundMap = { ...map, nodes: [space, memberCamera, symbol] }, frozen = JSON.stringify(source);
  const shifted: BackgroundSpace = { ...space, x: 300 };
  const replaced = replaceMapNode(source, shifted);
  assert.equal(replaced.nodes[0], shifted); assert.equal(replaced.nodes[1], memberCamera); assert.equal(replaced.nodes[2], symbol);
  const carried = transformMapSpace(source, shifted);
  assert.equal(carried.nodes[0], shifted); near(carried.nodes[1].x, 330); near(carried.nodes[2].x, 330);
  // Any kind of node, and the rest of the map stays as it is.
  const lens: BackgroundCamera = { ...memberCamera, angle: 90 }, door: BackgroundSymbol = { ...symbol, rotation: 0 };
  const withLens = replaceMapNode(source, lens), withDoor = replaceMapNode(source, door);
  assert.deepEqual(withLens, { ...source, nodes: [space, lens, symbol] }); assert.equal(withLens.nodes[1], lens); assert.equal(withLens.nodes[0], space);
  assert.deepEqual(withDoor, { ...source, nodes: [space, memberCamera, door] }); assert.equal(withDoor.nodes[2], door); assert.equal(withDoor.nodes[1], memberCamera);
  assert.equal(JSON.stringify(source), frozen);
});

// --- Naming on the plan ------------------------------------------------------------------------
test('renaming a node stores the trimmed name, and a name that changes nothing returns the map itself', () => {
  const drawn: BackgroundSpace = { ...space, name: '새 공간' };
  const lockedDoor: BackgroundSymbol = { ...symbol, id: 'locked-symbol', locked: true };
  const source: BackgroundMap = { ...map, nodes: [drawn, memberCamera, symbol, lockedDoor] }, frozen = JSON.stringify(source);

  const renamed = renameMapNode(source, drawn.id, '  교실  ');
  assert.equal(renamed.nodes[0].name, '교실');
  assert.deepEqual(renamed.nodes[0], { ...drawn, name: '교실' });
  // Only the name of that node changes: its members and the rest of the map are the same objects.
  for (const index of [1, 2, 3]) assert.equal(renamed.nodes[index], source.nodes[index]);
  assert.deepEqual({ ...renamed, nodes: [] }, { ...source, nodes: [] });
  // Any kind of node, and spaces inside the name stay.
  assert.deepEqual(renameMapNode(source, memberCamera.id, '정면 카메라').nodes[1], { ...memberCamera, name: '정면 카메라' });
  assert.deepEqual(renameMapNode(source, symbol.id, '뒷문\n').nodes[2], { ...symbol, name: '뒷문' });

  // Blank, and the name it already has (as typed or once trimmed).
  for (const name of ['', '   ', '새 공간', '  새 공간 ']) assert.equal(renameMapNode(source, drawn.id, name), source, JSON.stringify(name));
  assert.equal(renameMapNode(source, memberCamera.id, memberCamera.name), source);
  // A stored name can carry outer whitespace: the name field of the inspector keeps what was typed. A name box nothing was
  // typed into hands that very name back, and that is no change. Outer whitespace alone never makes a new name.
  const padded: BackgroundMap = { ...source, nodes: [{ ...drawn, name: ' 교실 ' }, memberCamera] };
  for (const name of [' 교실 ', '교실', '교실 ', '  교실\t']) assert.equal(renameMapNode(padded, drawn.id, name), padded, JSON.stringify(name));
  assert.deepEqual(renameMapNode(padded, drawn.id, ' 과학실 ').nodes[0], { ...drawn, name: '과학실' });
  // Locked and unknown nodes.
  assert.equal(renameMapNode(source, lockedDoor.id, '뒷문'), source);
  assert.equal(renameMapNode({ ...source, nodes: [{ ...drawn, locked: true }] }, drawn.id, '교실').nodes[0].name, '새 공간');
  assert.equal(renameMapNode(source, 'missing', '교실'), source);
  assert.equal(JSON.stringify(source), frozen);
});

test('the name box of a node is centred on the box of a space or symbol and on the point of a camera', () => {
  // The centre of the box does not turn with the node.
  for (const rotation of [0, 37, 90, 180]) assert.deepEqual(nodeNameAnchor({ ...plainRoom, rotation }), { x: 130, y: 120 }, `room at ${rotation}`);
  assert.deepEqual(nodeNameAnchor({ ...plainRoom, shape: 'ellipse' }), { x: 130, y: 120 });
  assert.deepEqual(nodeNameAnchor(symbol), { x: 140, y: 150 });
  assert.deepEqual(nodeNameAnchor({ ...symbol, rotation: 37, pitch: 20 }), { x: 140, y: 150 });
  // A camera has no box: whatever it looks at, the anchor is the point it stands on.
  assert.deepEqual(nodeNameAnchor(memberCamera), { x: 130, y: 130 });
  assert.deepEqual(nodeNameAnchor({ ...memberCamera, x: 500.25, y: -340.5, angle: 211, pitch: -90 }), { x: 500.25, y: -340.5 });
});

// --- Polygon points ----------------------------------------------------------------------------
const xy = (x: number, y: number): BackgroundPoint => ({ x, y });
const midway = (a: BackgroundPoint, b: BackgroundPoint) => xy((a.x + b.x) / 2, (a.y + b.y) / 2);
/** Its plan outline is (20, 30) (120, 30) (70, 80). */
const triangle: BackgroundSpace = { ...plainRoom, id: 'triangle', x: 20, y: 30, width: 100, height: 50, shape: 'polygon', points: [xy(0, 0), xy(1, 0), xy(0.5, 1)] };
/** Four points on no common line, in a box of decimals that is turned by 37 degrees. */
const kite: BackgroundSpace = { ...oddRoom, id: 'kite', rotation: 37, shape: 'polygon', points: [xy(0.1, 0), xy(1, 0.35), xy(0.6, 1), xy(0, 0.7)] };
/** A regular polygon of `count` points in a box of 400. */
const ring = (count: number): BackgroundSpace => ({ ...plainRoom, id: 'ring', width: 400, height: 400, shape: 'polygon',
  points: Array.from({ length: count }, (_, index) => xy(0.5 + Math.cos(index / count * Math.PI * 2) / 2, 0.5 + Math.sin(index / count * Math.PI * 2) / 2)) });
const outlineArea = (points: BackgroundPoint[]) => Math.abs(points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length];
  return sum + point.x * next.y - next.x * point.y;
}, 0)) / 2;
const sameOutline = (actual: BackgroundPoint[], expected: BackgroundPoint[], label = '') => {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((point, index) => { tight(point.x, expected[index].x, `${label} point ${index} x`); tight(point.y, expected[index].y, `${label} point ${index} y`); });
};

test('moving a polygon point rebuilds the box around the points, and every other point stays where it is on the plan', () => {
  // The apex goes 50 further down: the box is twice as tall and the stored ratios are what they were.
  assert.deepEqual(movePolygonVertex(triangle, 2, xy(70, 130)), { ...triangle, x: 20, y: 30, width: 100, height: 100, points: [xy(0, 0), xy(1, 0), xy(0.5, 1)] });
  // A corner goes 20 to the left: the box starts there, and the apex is now 70 of 120 across.
  assert.deepEqual(movePolygonVertex(triangle, 0, xy(0, 30)), { ...triangle, x: 0, width: 120, points: [xy(0, 0), xy(1, 0), xy(70 / 120, 1)] });

  const frozen = JSON.stringify(kite), before = nodePlanOutline(kite);
  for (const index of [0, 1, 2, 3]) {
    const target = xy(before[index].x + 23.4, before[index].y - 41.7), moved = movePolygonVertex(kite, index, target), label = `point ${index}`;
    assert.ok(moved, label);
    // The turn is kept, and so is everything that is not the box or the points.
    assert.equal(moved.rotation, 37, label);
    assert.deepEqual({ ...moved, x: 0, y: 0, width: 0, height: 0, points: [] }, { ...kite, x: 0, y: 0, width: 0, height: 0, points: [] }, label);
    sameOutline(nodePlanOutline(moved), before.map((point, at) => at === index ? target : point), label);
    // The box is the bounds of the points along the space's own sides: each side of it carries a point.
    assert.equal(moved.points.length, 4, label);
    for (const axis of ['x', 'y'] as const) {
      for (const point of moved.points) assert.ok(point[axis] >= 0 && point[axis] <= 1, `${label} ${axis} ${point[axis]}`);
      assert.ok(moved.points.some(point => point[axis] === 0), `${label} ${axis} start`); assert.ok(moved.points.some(point => point[axis] === 1), `${label} ${axis} end`);
    }
  }
  assert.equal(JSON.stringify(kite), frozen);
});

test('a point is added after its corner, also on the edge that closes the outline, and a point is removed', () => {
  for (const source of [kite, { ...kite, rotation: 0 }]) {
    const frozen = JSON.stringify(source), before = nodePlanOutline(source), count = before.length;
    for (let index = 0; index < count; index++) {
      const centre = midway(before[index], before[(index + 1) % count]), added = insertPolygonVertex(source, index, centre), label = `edge ${index} at ${source.rotation}`;
      assert.ok(added, label); assert.equal(added.points.length, count + 1, label); assert.equal(added.rotation, source.rotation, label);
      // The new point takes the place after its corner: after the last corner that is the end of the list.
      sameOutline(nodePlanOutline(added), [...before.slice(0, index + 1), centre, ...before.slice(index + 1)], label);
      // The middle of an edge changes neither the box nor the area.
      for (const key of ['x', 'y', 'width', 'height'] as const) tight(added[key], source[key], `${label} ${key}`);
      tight(outlineArea(nodePlanOutline(added)), outlineArea(before), `${label} area`);
    }
    const closing = nodePlanOutline(insertPolygonVertex(source, count - 1, midway(before[count - 1], before[0]))!);
    tight(closing[count].x, (before[count - 1].x + before[0].x) / 2, 'closing x'); tight(closing[count].y, (before[count - 1].y + before[0].y) / 2, 'closing y');
    // Pulled off its edge, the new point is where it was put and the box grows around it.
    const out = xy(before[1].x + 300, before[1].y - 200), bulged = insertPolygonVertex(source, 1, out)!;
    sameOutline(nodePlanOutline(bulged), [before[0], before[1], out, before[2], before[3]], `bulge at ${source.rotation}`);
    assert.ok(bulged.width > source.width && bulged.height > source.height);

    for (let index = 0; index < count; index++) {
      const removed = removePolygonVertex(source, index), label = `without ${index} at ${source.rotation}`;
      assert.ok(removed, label); assert.equal(removed.points.length, 3, label); assert.equal(removed.rotation, source.rotation, label);
      sameOutline(nodePlanOutline(removed), before.filter((_, at) => at !== index), label);
      // Three points are the fewest a polygon has.
      for (const last of [0, 1, 2]) assert.equal(removePolygonVertex(removed, last), null, label);
    }
    assert.equal(JSON.stringify(source), frozen);
  }
  for (const index of [0, 1, 2]) assert.equal(removePolygonVertex(triangle, index), null);

  // 200 points are the most a polygon stores: a full one takes no more, and can still be changed.
  const full = ring(200), almost = ring(199), edge = (space: BackgroundSpace) => { const outline = nodePlanOutline(space); return midway(outline[0], outline[1]); };
  assert.equal(insertPolygonVertex(full, 0, edge(full)), null); assert.equal(insertPolygonVertex(full, 199, xy(900, 900)), null);
  assert.equal(insertPolygonVertex(almost, 0, edge(almost))!.points.length, 200);
  assert.equal(removePolygonVertex(full, 7)!.points.length, 199);
  assert.equal(movePolygonVertex(full, 7, xy(900, 900))!.points.length, 200);
  assert.equal(polygonFromWorldPoints(full, [...nodePlanOutline(full), xy(900, 900)]), null);
  assert.equal(polygonFromWorldPoints(full, nodePlanOutline(full))!.points.length, 200);
});

test('a polygon edit that cannot be stored gives null', () => {
  // Removing a point can leave too narrow a box: four points here, so it is not the three-point limit that refuses.
  const sliver: BackgroundSpace = { ...plainRoom, id: 'sliver', x: 0, y: 0, width: 100, height: 100, shape: 'polygon', points: [xy(0, 0), xy(0.05, 0), xy(1, 0.5), xy(0.05, 1)] };
  assert.equal(removePolygonVertex(sliver, 2), null);
  assert.equal(removePolygonVertex(sliver, 1)!.points.length, 3);

  // A side of the box under 10 or over 100000.
  assert.equal(movePolygonVertex(triangle, 2, xy(70, 39.9)), null); assert.equal(movePolygonVertex(triangle, 2, xy(70, 40))!.height, 10);
  assert.equal(movePolygonVertex(triangle, 1, xy(100021, 30)), null); assert.equal(movePolygonVertex(triangle, 1, xy(100020, 30))!.width, 100000);
  assert.equal(insertPolygonVertex(triangle, 1, xy(70, 100111)), null);
  // A box that starts beyond the saved limit, on either side.
  const far = (x: number, y: number) => polygonFromWorldPoints(triangle, [xy(x, y), xy(x + 100, y), xy(x + 50, y + 50)]);
  assert.deepEqual(far(100000, -100000), { ...triangle, x: 100000, y: -100000 });
  for (const [x, y] of [[100001, 30], [-100001, 30], [20, 100001], [20, -100001]]) assert.equal(far(x, y), null, `${x}, ${y}`);

  // Less than 1 of area: three points on one line, in a box that is large enough.
  const half: BackgroundSpace = { ...sliver, id: 'half', points: [xy(0, 0), xy(1, 1), xy(0, 1)] };
  assert.equal(movePolygonVertex(half, 2, xy(50, 50)), null); assert.equal(movePolygonVertex(half, 2, xy(50, 50.01)), null);
  assert.ok(movePolygonVertex(half, 2, xy(50, 51)));
  // The limit is 1 and no other number: an area of 0.95 is refused, one of 1.05 is kept.
  assert.equal(movePolygonVertex(half, 2, xy(50, 50.019)), null); assert.ok(movePolygonVertex(half, 2, xy(50, 50.021)));
  assert.equal(polygonFromWorldPoints(half, [xy(0, 0), xy(100, 100), xy(50, 50)]), null);
  // Fewer than three points.
  assert.equal(polygonFromWorldPoints(half, [xy(0, 0), xy(100, 100)]), null); assert.equal(polygonFromWorldPoints(half, []), null);

  const outline = nodePlanOutline(kite), away = xy(outline[0].x + 23.4, outline[0].y - 41.7);
  for (const broken of [xy(Number.NaN, 50), xy(50, Number.POSITIVE_INFINITY), xy(Number.NEGATIVE_INFINITY, Number.NaN)]) {
    assert.equal(movePolygonVertex(kite, 0, broken), null); assert.equal(insertPolygonVertex(kite, 0, broken), null);
    assert.equal(polygonFromWorldPoints(kite, [outline[0], outline[1], broken]), null);
  }
  // A locked space, a space that is no polygon (whatever it still carries in `points`), and an index that is none of its points.
  // Two stored points are no polygon either: the plan draws such a space as its box, and that outline is not theirs.
  const refused: [BackgroundSpace, number][] = [[{ ...kite, locked: true }, 0], [{ ...kite, shape: 'rect' }, 0], [{ ...kite, shape: 'ellipse' }, 0], [plainRoom, 0],
    [{ ...kite, points: kite.points.slice(0, 2) }, 0], [kite, -1], [kite, 4], [kite, 1.5], [kite, Number.NaN], [kite, Number.POSITIVE_INFINITY]];
  for (const [space, index] of refused) {
    const label = `${space.shape}${space.locked ? ' locked' : ''} ${space.points.length} points, index ${index}`;
    assert.equal(movePolygonVertex(space, index, away), null, label); assert.equal(insertPolygonVertex(space, index, away), null, label);
    assert.equal(removePolygonVertex(space, index), null, label);
  }
  for (const index of [0, 1, 2, 3]) assert.ok(movePolygonVertex(kite, index, away) && insertPolygonVertex(kite, index, away) && removePolygonVertex(kite, index), `point ${index}`);
});

test('a moved or added point cannot land on a point beside it', () => {
  const outline = nodePlanOutline(kite), count = outline.length;
  for (let index = 0; index < count; index++) {
    const previous = outline[(index + count - 1) % count], next = outline[(index + 1) % count], label = `point ${index}`;
    // That would leave an edge of no length and two point handles on one spot.
    assert.equal(movePolygonVertex(kite, index, previous), null, label); assert.equal(movePolygonVertex(kite, index, next), null, label);
    assert.equal(movePolygonVertex(kite, index, xy(next.x + 1e-7, next.y)), null, label);
    // A new point goes between its corner and the next one: neither end of that edge will do.
    assert.equal(insertPolygonVertex(kite, index, outline[index]), null, label); assert.equal(insertPolygonVertex(kite, index, next), null, label);
    assert.equal(insertPolygonVertex(kite, index, xy(outline[index].x, outline[index].y - 1e-7)), null, label);
    // One spot reaches 1e-6 and no other distance: half of that away is still on the point, twice that is beside it.
    assert.equal(movePolygonVertex(kite, index, xy(next.x + 5e-7, next.y)), null, label); assert.ok(movePolygonVertex(kite, index, xy(next.x + 2e-6, next.y)), label);
    assert.equal(insertPolygonVertex(kite, index, xy(next.x + 5e-7, next.y)), null, label); assert.ok(insertPolygonVertex(kite, index, xy(next.x + 2e-6, next.y)), label);
    // Right beside it is another place.
    assert.ok(movePolygonVertex(kite, index, xy(next.x + 0.001, next.y)), label); assert.ok(insertPolygonVertex(kite, index, xy(next.x + 0.001, next.y)), label);
  }
});

test('a point put where it already stands leaves the space as it is', () => {
  // Rebuilt from its plan points a box of decimals does not come back digit for digit, and a drag that
  // returned to where it started would stay as a change.
  assert.notDeepEqual(polygonFromWorldPoints(kite, nodePlanOutline(kite)), kite);
  for (const source of [kite, { ...kite, rotation: 0 }, triangle]) nodePlanOutline(source).forEach((spot, index) => {
    const label = `point ${index} at ${source.rotation}`;
    assert.equal(movePolygonVertex(source, index, spot), source, label);
    assert.equal(movePolygonVertex(source, index, xy(spot.x + 1e-7, spot.y - 1e-7)), source, label);
    // The same 1e-6 as for the points beside it: half of that away it has not moved, twice that away it has.
    assert.equal(movePolygonVertex(source, index, xy(spot.x + 5e-7, spot.y)), source, label);
    const nudged = movePolygonVertex(source, index, xy(spot.x + 2e-6, spot.y));
    assert.ok(nudged, label); assert.notEqual(nudged, source, label);
    // Any real travel is a new space.
    const moved = movePolygonVertex(source, index, xy(spot.x + 0.001, spot.y));
    assert.ok(moved, label); assert.notDeepEqual(moved, source, label);
  });
  // What cannot be edited is still refused.
  assert.equal(movePolygonVertex({ ...kite, locked: true }, 0, nodePlanOutline(kite)[0]), null);
  assert.equal(movePolygonVertex({ ...kite, shape: 'rect' }, 0, nodePlanOutline(kite)[0]), null);
});

test('an edited polygon is a node the saved-data check accepts', () => {
  const uuid = (tail: number) => `00000000-0000-4000-8000-${String(tail).padStart(12, '0')}`;
  const stored = (node: BackgroundSpace) => ({ id: uuid(1), revision: 1, name: '학교', parentId: null, placeId: null, imageUrl: '', nodes: [{ ...node, id: uuid(2) }] });
  const outline = nodePlanOutline(kite), full = ring(199);
  const edited = [
    movePolygonVertex(kite, 2, xy(outline[2].x + 311.7, outline[2].y - 96.3)), movePolygonVertex(triangle, 2, xy(70, 130)),
    insertPolygonVertex(kite, 3, xy(outline[3].x - 57.3, outline[3].y + 12.9)), insertPolygonVertex(full, 0, midway(nodePlanOutline(full)[0], nodePlanOutline(full)[1])),
    removePolygonVertex(kite, 0), rectToPolygon(oddRoom), rectToPolygon({ ...oddRoom, rotation: 37 }),
  ];
  for (const [index, node] of edited.entries()) {
    assert.ok(node, `edit ${index}`);
    assert.doesNotThrow(() => validateBackgroundEntity('map', stored(node)), `edit ${index}`);
  }
  // The check is the real one: a point outside the box is refused.
  assert.throws(() => validateBackgroundEntity('map', stored({ ...kite, points: [xy(0, 0), xy(1.0000001, 0), xy(0, 1)] })));
});

test('a rectangle becomes a four-point polygon with the very same outline', () => {
  const linked: BackgroundSpace = { ...oddRoom, name: '과학실', placeId: 'place', childMapId: 'child', elevation: 40, volumeHeight: 250 };
  for (const rotation of [0, 37]) {
    const rect: BackgroundSpace = { ...linked, rotation }, frozen = JSON.stringify(rect), polygon = rectToPolygon(rect);
    // Name, links, heights, position and turn are as they were.
    assert.deepEqual(polygon, { ...rect, shape: 'polygon', points: [xy(0, 0), xy(1, 0), xy(1, 1), xy(0, 1)] });
    assert.deepEqual(nodePlanOutline(polygon!), nodePlanOutline(rect));
    assert.equal(JSON.stringify(rect), frozen);
  }
  // Whatever a rectangle still carried in `points` is replaced.
  assert.deepEqual(rectToPolygon({ ...linked, points: [xy(0.2, 0.3)] })!.points, [xy(0, 0), xy(1, 0), xy(1, 1), xy(0, 1)]);
  // Only an unlocked rectangle is converted.
  for (const other of [{ ...linked, shape: 'ellipse' as const }, triangle, kite, { ...linked, locked: true }]) assert.equal(rectToPolygon(other), null, `${other.shape} ${other.locked}`);
});

// --- Several nodes at once ---------------------------------------------------------------------
const groupRoom = (id: string, x: number, y: number, width: number, height: number, locked = false): BackgroundSpace =>
  ({ ...plainRoom, id, x, y, width, height, locked });
const groupSeat = (id: string, x: number, y: number, size: number, spaceId: string | null, locked = false): BackgroundSymbol =>
  ({ ...symbol, id, symbol: 'chair', spaceId, x, y, width: size, height: size, rotation: 0, locked });
const roomA = groupRoom('A', 100, 100, 144.65, 80), roomB = groupRoom('B', 300.4, 120.3, 60, 40), lockedRoom = groupRoom('LS', 600, 300, 100, 100, true);
/** In room B: a chair and a camera it carries, and a locked chair it leaves behind. */
const chairB = groupSeat('chairB', 310, 130, 20, 'B'), lockedB = groupSeat('lockedB', 330, 130, 20, 'B', true);
const camB: BackgroundCamera = { ...memberCamera, id: 'camB', x: 320, y: 140, spaceId: 'B' };
/** In no room, and an unlocked chair in the locked room. */
const freeSeat = groupSeat('free', 400.5, 200.25, 30, null), memberOfLocked = groupSeat('mLS', 620, 320, 20, 'LS');
const crowd: BackgroundMap = { ...map, nodes: [roomA, roomB, chairB, lockedB, freeSeat, camB, lockedRoom, memberOfLocked] };
const nodeOf = (source: BackgroundMap, id: string) => source.nodes.find(node => node.id === id)!;
const stands = (source: BackgroundMap, id: string, x: number, y: number) => {
  const node = nodeOf(source, id);
  tight(node.x, x, `${id} x`); tight(node.y, y, `${id} y`);
  // Nothing but the position differs from the node as it was.
  assert.deepEqual({ ...node, x: 0, y: 0 }, { ...nodeOf(crowd, id), x: 0, y: 0 }, id);
};

test('several nodes move in one step: locked ones stay, and a member is carried by its space once', () => {
  const frozen = JSON.stringify(crowd), ids = ['B', 'chairB', 'free', 'LS', 'mLS', 'lockedB'], delta = { x: 10, y: -5 };
  const moved = moveMapNodes(crowd, ids, delta);
  stands(moved, 'B', 310.4, 115.3);
  // Listed and carried by its room: it goes once, not twice.
  stands(moved, 'chairB', 320, 125);
  // Not listed, and carried all the same.
  stands(moved, 'camB', 330, 135);
  stands(moved, 'free', 410.5, 195.25);
  // Its room is locked and stays, so this listed member moves on its own.
  stands(moved, 'mLS', 630, 315);
  for (const id of ['LS', 'lockedB', 'A']) assert.equal(nodeOf(moved, id), nodeOf(crowd, id), id);
  assert.deepEqual(moved.nodes.map(node => node.id), crowd.nodes.map(node => node.id));
  assert.deepEqual({ ...moved, nodes: [] }, { ...crowd, nodes: [] });
  // The order of the list does not enter the result, and neither does an id that is listed twice.
  assert.deepEqual(moveMapNodes(crowd, [...ids].reverse(), delta), moved);
  assert.deepEqual(moveMapNodes(crowd, [...ids, ...ids], delta), moved);

  // One id is the move of that node.
  assert.deepEqual(moveMapNodes(crowd, ['B'], delta), moveMapNode(crowd, 'B', delta));
  assert.deepEqual(moveMapNodes(crowd, ['free'], delta), moveMapNode(crowd, 'free', delta));
  assert.deepEqual(moveMapNodes(crowd, ['chairB'], delta), moveMapNode(crowd, 'chairB', delta));
  // Nothing that can move: the map itself.
  assert.equal(moveMapNodes(crowd, ['LS', 'lockedB', 'missing'], delta), crowd);
  assert.equal(moveMapNodes(crowd, [], delta), crowd);
  assert.equal(JSON.stringify(crowd), frozen);
});

test('an anchored group move stores the very position given for the anchor, and the rest go by the delta', () => {
  const frozen = JSON.stringify(crowd), ids = ['B', 'chairB', 'free', 'LS', 'mLS', 'lockedB'], delta = { x: 10, y: -5 };
  const position = { x: 244.65, y: 113 };
  const placed = moveMapNodes(crowd, ids, delta, { id: 'B', position });
  assert.equal(nodeOf(placed, 'B').x, 244.65); assert.equal(nodeOf(placed, 'B').y, 113);
  assert.deepEqual(nodeOf(placed, 'B'), { ...roomB, ...position });
  // Its members go where the placed room takes them.
  const carried = placeMapNode(crowd, 'B', position);
  for (const id of ['chairB', 'camB']) assert.deepEqual(nodeOf(placed, id), nodeOf(carried, id), id);
  stands(placed, 'chairB', 254.25, 122.7); stands(placed, 'camB', 264.25, 132.7);
  // Everything else that moves goes by the delta.
  stands(placed, 'free', 410.5, 195.25); stands(placed, 'mLS', 630, 315);
  for (const id of ['LS', 'lockedB', 'A']) assert.equal(nodeOf(placed, id), nodeOf(crowd, id), id);

  // A node that is no space is placed the same way.
  const seated = moveMapNodes(crowd, ids, delta, { id: 'free', position: { x: 344.75, y: 119 } });
  assert.deepEqual(nodeOf(seated, 'free'), { ...freeSeat, x: 344.75, y: 119 });
  stands(seated, 'B', 310.4, 115.3); stands(seated, 'chairB', 320, 125);
  // An anchor that does not move by itself changes nothing: a member its room carries, a locked node, one that is not listed.
  for (const id of ['chairB', 'LS', 'lockedB', 'A', 'missing']) assert.deepEqual(moveMapNodes(crowd, ids, delta, { id, position }), moveMapNodes(crowd, ids, delta), id);
  assert.equal(moveMapNodes(crowd, ['LS', 'lockedB'], delta, { id: 'LS', position }), crowd);
  assert.equal(JSON.stringify(crowd), frozen);
});

test('several nodes are removed in one step: locked ones stay, and what a removed space leaves behind is detached', () => {
  const frozen = JSON.stringify(crowd), left = ['A', 'chairB', 'lockedB', 'camB', 'LS', 'mLS'];
  const removed = removeMapNodes(crowd, ['B', 'free']);
  assert.deepEqual(removed.nodes.map(node => node.id), left);
  for (const id of ['chairB', 'lockedB', 'camB']) assert.deepEqual(nodeOf(removed, id), { ...nodeOf(crowd, id), spaceId: null }, id);
  // Its own room is still there.
  assert.equal(nodeOf(removed, 'mLS'), memberOfLocked); assert.equal(nodeOf(removed, 'A'), roomA);
  assert.deepEqual(removed, removeMapNode(removeMapNode(crowd, 'B'), 'free'));
  assert.deepEqual(removeMapNodes(crowd, ['free', 'B']), removed);
  // A room and one of its members together.
  assert.deepEqual(removeMapNodes(crowd, ['B', 'chairB']), removeMapNode(removeMapNode(crowd, 'B'), 'chairB'));
  // Unknown ids alone: the map itself.
  assert.equal(removeMapNodes(crowd, ['missing', 'gone']), crowd); assert.equal(removeMapNodes(crowd, []), crowd);

  // Locked nodes stay: of these four only the unlocked room and the free chair go.
  const kept = removeMapNodes(crowd, ['B', 'lockedB', 'LS', 'free']);
  assert.deepEqual(kept.nodes.map(node => node.id), left);
  // The locked chair stays, but the room it was in is gone.
  assert.deepEqual(nodeOf(kept, 'lockedB'), { ...lockedB, spaceId: null });
  assert.equal(nodeOf(kept, 'LS'), lockedRoom); assert.equal(nodeOf(kept, 'mLS'), memberOfLocked);
  assert.equal(removeMapNodes(crowd, ['LS', 'lockedB']), crowd);
  assert.equal(JSON.stringify(crowd), frozen);
});

test('locking several nodes changes only those whose lock differs', () => {
  const frozen = JSON.stringify(crowd), ids = ['B', 'lockedB', 'free', 'LS', 'missing'];
  const locked = lockMapNodes(crowd, ids, true);
  for (const id of ['B', 'lockedB', 'free', 'LS']) assert.equal(nodeOf(locked, id).locked, true, id);
  // Position, size and membership are as they were.
  for (const id of ['B', 'free']) assert.deepEqual(nodeOf(locked, id), { ...nodeOf(crowd, id), locked: true }, id);
  // Already locked: the very objects. So is every node that is not listed, the members of a locked room too.
  for (const id of ['lockedB', 'LS', 'A', 'chairB', 'camB', 'mLS']) assert.equal(nodeOf(locked, id), nodeOf(crowd, id), id);
  assert.deepEqual(locked.nodes.map(node => node.id), crowd.nodes.map(node => node.id));
  assert.deepEqual({ ...locked, nodes: [] }, { ...crowd, nodes: [] });

  const freed = lockMapNodes(crowd, ids, false);
  for (const id of ['lockedB', 'LS']) assert.deepEqual(nodeOf(freed, id), { ...nodeOf(crowd, id), locked: false }, id);
  for (const id of ['B', 'free', 'A', 'chairB', 'camB', 'mLS']) assert.equal(nodeOf(freed, id), nodeOf(crowd, id), id);
  // Nothing differs: the map itself.
  assert.equal(lockMapNodes(crowd, ['lockedB', 'LS', 'missing'], true), crowd); assert.equal(lockMapNodes(crowd, ['A', 'B', 'free'], false), crowd);
  assert.equal(lockMapNodes(crowd, [], true), crowd); assert.equal(lockMapNodes(locked, ids, true), locked);
  assert.equal(JSON.stringify(crowd), frozen);
});
