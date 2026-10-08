import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraForward, toWorldPoint, toPlanPoint, verticalFov,
  createMapCamera, projectCameraToPlan } from '../src/features/backgrounds/mapSpatial.ts';
import {
  DEFAULT_MAP_CAMERA_POSE, MAP_PLAN_EXTENT, MAP_SPATIAL_DEFAULTS, MAP_SPATIAL_LIMITS, SYMBOL_VOLUME_HEIGHTS,
  cameraAngles, cameraAnglesFromOrientation, cameraAspect, cameraOrientation, cameraPitchLabel,
  mapPlanBounds, nextMapCameraName, nodeAngles, nodeAnglesFromOrientation, nodeElevation, nodeOrientation,
  nodePlanOutline, nodeVolumeHeight, nodeWorldPose, spaceOutline,
} from '../src/features/backgrounds/mapSpatial.ts';
import type { CameraAngles, NodeAngles, QuaternionValue, Vec3 } from '../src/features/backgrounds/mapSpatial.ts';
import { BACKGROUND_SPATIAL_LIMITS } from '../src/features/backgrounds/domain.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
test('map coordinates and camera pitch keep existing directions', () => {
  assert.deepEqual(toWorldPoint({ x: 10, y: 20 }, 30), { x: 10, y: 30, z: 20 });
  assert.deepEqual(toPlanPoint({ x: 10, y: 30, z: 20 }), { x: 10, y: 20 });
  const down = cameraForward(90, -30);
  near(down.x, 0); near(down.y, -0.5); near(down.z, Math.sqrt(3) / 2);
  near(verticalFov(60, 1), 60);
});
test('new cameras have the same spawn while IDs remain unique', () => {
  const a = createMapCamera('00000000-0000-4000-8000-000000000001', '카메라 1');
  const b = createMapCamera('00000000-0000-4000-8000-000000000002', '카메라 2');
  assert.notEqual(a.id, b.id);
  assert.deepEqual([a.x, a.y, a.elevation], [500, 340, 120]);
  assert.deepEqual([b.x, b.y, b.elevation], [500, 340, 120]);
  assert.equal(projectCameraToPlan({ ...a, pitch: 90 }).vertical, 'up');
  assert.equal(projectCameraToPlan({ ...a, pitch: -90 }).vertical, 'down');
});

// Independent helpers: the assertions must not lean on the module's own vector code.
const rot = (q: QuaternionValue, v: Vec3): Vec3 => {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + q.y * tz - q.z * ty, y: v.y + q.w * ty + q.z * tx - q.x * tz, z: v.z + q.w * tz + q.x * ty - q.y * tx };
};
const axisAngle = (axis: Vec3, degrees: number): QuaternionValue => {
  const half = degrees * Math.PI / 360, s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
};
const multiply = (a: QuaternionValue, b: QuaternionValue): QuaternionValue => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const nearVec = (actual: Vec3, expected: Vec3, label = '') => {
  for (const axis of ['x', 'y', 'z'] as const) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-6, `${label} ${axis}: ${actual[axis]} != ${expected[axis]}`);
};
const nearPoint = (actual: BackgroundPoint, expected: BackgroundPoint, label = '') => {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-6 && Math.abs(actual.y - expected.y) < 1e-6, `${label} (${actual.x}, ${actual.y}) != (${expected.x}, ${expected.y})`);
};
const circular = (actual: number, expected: number, label = '') => {
  const difference = Math.abs((((actual - expected) % 360) + 540) % 360 - 180);
  assert.ok(difference < 1e-6, `${label} ${actual} != ${expected}`);
};
const unit = (q: QuaternionValue) => near(Math.hypot(q.x, q.y, q.z, q.w), 1);
const X = { x: 1, y: 0, z: 0 }, Y = { x: 0, y: 1, z: 0 }, Z = { x: 0, y: 0, z: 1 }, LENS = { x: 0, y: 0, z: -1 };
const planRotate = (point: BackgroundPoint, degrees: number): BackgroundPoint => {
  const radians = degrees * Math.PI / 180;
  return { x: point.x * Math.cos(radians) - point.y * Math.sin(radians), y: point.x * Math.sin(radians) + point.y * Math.cos(radians) };
};

const legacySpace: BackgroundSpace = { id: 'space', type: 'space', name: '교실', placeId: null, childMapId: null, x: 100, y: 100, width: 100, height: 60, rotation: 0, shape: 'rect', points: [], locked: false };
const legacyCamera: BackgroundCamera = { id: 'camera', type: 'camera', name: '전경', x: 130, y: 140, spaceId: 'space', angle: 30, fov: 60, viewIds: ['view'], locked: false };
const legacySymbol: BackgroundSymbol = { id: 'door', type: 'symbol', name: '출입문', symbol: 'door', spaceId: 'space', x: 130, y: 145, width: 20, height: 10, rotation: 0, locked: false, hinge: 'right', swing: 'outward' };

test('constants are the agreed defaults and share the domain limits object', () => {
  assert.equal(MAP_SPATIAL_LIMITS, BACKGROUND_SPATIAL_LIMITS);
  assert.deepEqual(MAP_PLAN_EXTENT, { width: 1000, height: 680 });
  assert.deepEqual(MAP_SPATIAL_DEFAULTS, { spaceElevation: 0, spaceVolumeHeight: 180, symbolElevation: 0, cameraElevation: 120, pitch: 0, roll: 0, aspect: 16 / 9 });
  assert.deepEqual(DEFAULT_MAP_CAMERA_POSE, { x: 500, y: 340, elevation: 120, angle: 0, pitch: 0, roll: 0, fov: 60, aspect: 16 / 9 });
  assert.deepEqual([SYMBOL_VOLUME_HEIGHTS.door, SYMBOL_VOLUME_HEIGHTS.chair, SYMBOL_VOLUME_HEIGHTS.table, SYMBOL_VOLUME_HEIGHTS.bed, SYMBOL_VOLUME_HEIGHTS.custom], [160, 70, 60, 45, 80]);
});

test('four plan directions map to the world without a mirror flip', () => {
  const expected: Array<[number, Vec3]> = [[0, X], [90, Z], [180, { x: -1, y: 0, z: 0 }], [270, { x: 0, y: 0, z: -1 }]];
  for (const [angle, forward] of expected) {
    nearVec(cameraForward(angle, 0), forward, `forward ${angle}`);
    const q = cameraOrientation({ angle, pitch: 0, roll: 0 });
    unit(q);
    nearVec(rot(q, LENS), forward, `lens ${angle}`);
    nearVec(rot(q, Y), Y, `camera up ${angle}`);
    // Seen from above, the right hand of a viewer is a quarter turn clockwise on screen.
    const right = planRotate({ x: forward.x, y: forward.z }, 90);
    nearVec(rot(q, X), { x: right.x, y: 0, z: right.y }, `camera right ${angle}`);
    // A node's local width axis follows the same plan rotation as the 2D editor.
    const node = nodeOrientation({ rotation: angle, pitch: 0, roll: 0 });
    unit(node);
    nearVec(rot(node, X), forward, `node width axis ${angle}`);
    nearVec(rot(node, Z), { x: right.x, y: 0, z: right.y }, `node depth axis ${angle}`);
    nearVec(rot(node, Y), Y, `node up ${angle}`);
  }
  nearVec(rot(nodeOrientation({ rotation: 90, pitch: 0, roll: 0 }), X), Z, 'rotation 90 puts local +X on plan +y');
  nearVec(rot(cameraOrientation({ angle: 0, pitch: 0, roll: 0 }), X), Z, 'a camera facing right has its right hand on plan +y');
  nearVec(cameraForward(0, 90), Y, 'positive pitch looks up');
  nearVec(cameraForward(0, -90), { x: 0, y: -1, z: 0 }, 'negative pitch looks down');
});

test('camera orientation round-trips across the yaw, pitch and roll fixtures', () => {
  for (const angle of [0, 90, 180, 270, 359.999]) for (const pitch of [0, 45, -45, 89.999, -89.999, 90, -90]) for (const roll of [0, 30, -30, 180, -120]) {
    const label = `${angle}/${pitch}/${roll}`, q = cameraOrientation({ angle, pitch, roll });
    unit(q);
    nearVec(rot(q, LENS), cameraForward(angle, pitch), `${label} forward`);
    // Roll is the only thing that lifts the camera's right axis off the horizon.
    near(rot(q, X).y, -Math.sin(roll * Math.PI / 180) * Math.cos(pitch * Math.PI / 180));
    const vertical = Math.abs(pitch) === 90;
    for (const previous of [{ angle, pitch: 0, roll: 0 }, { angle: 12, pitch: 5, roll: -7 }]) {
      const result = cameraAnglesFromOrientation(q, previous), back = cameraOrientation(result);
      nearVec(rot(back, LENS), rot(q, LENS), `${label} forward round trip`);
      nearVec(rot(back, Y), rot(q, Y), `${label} up round trip`);
      assert.ok(result.angle >= 0 && result.angle < 360, `${label} angle range ${result.angle}`);
      assert.ok(result.pitch >= -90 && result.pitch <= 90, `${label} pitch range ${result.pitch}`);
      assert.ok(result.roll > -180 && result.roll <= 180, `${label} roll range ${result.roll}`);
      near(result.pitch, pitch);
      if (vertical) circular(result.angle, previous.angle, `${label} keeps the previous yaw`);
      else { circular(result.angle, angle, `${label} angle`); circular(result.roll, roll, `${label} roll`); }
      if (vertical && previous.angle === angle) circular(result.roll, roll, `${label} vertical roll`);
    }
  }
});

test('a vertical camera keeps its yaw and does not jump when tilted back', () => {
  const up = cameraOrientation({ angle: 137, pitch: 90, roll: 0 });
  nearVec(rot(up, LENS), Y, 'looks straight up');
  const atVertical = cameraAnglesFromOrientation(up, { angle: 137, pitch: 85, roll: 0 });
  assert.equal(atVertical.angle, 137); assert.equal(atVertical.pitch, 90); near(atVertical.roll, 0);
  const back = cameraAnglesFromOrientation(cameraOrientation({ angle: 137, pitch: 80, roll: 0 }), atVertical);
  near(back.angle, 137); near(back.pitch, 80); near(back.roll, 0);

  // The same motion as a gizmo makes it: turn the vertical camera about its own right axis.
  const rightAxis = rot(up, X);
  nearVec(rightAxis, { x: -Math.sin(137 * Math.PI / 180), y: 0, z: Math.cos(137 * Math.PI / 180) }, 'right axis follows the stored yaw');
  const tilted = cameraAnglesFromOrientation(multiply(axisAngle(rightAxis, -10), up), atVertical);
  near(tilted.angle, 137); near(tilted.pitch, 80); near(tilted.roll, 0);
  // Tilting over the top is the same orientation written with the opposite yaw.
  const beyond = multiply(axisAngle(rightAxis, 10), up), over = cameraAnglesFromOrientation(beyond, atVertical);
  near(over.angle, 317); near(over.pitch, 80); circular(over.roll, 180);
  nearVec(rot(cameraOrientation(over), LENS), rot(beyond, LENS), 'over the top forward');
  nearVec(rot(cameraOrientation(over), Y), rot(beyond, Y), 'over the top up');

  const down = cameraOrientation({ angle: 222, pitch: -90, roll: 15 });
  nearVec(rot(down, LENS), { x: 0, y: -1, z: 0 }, 'looks straight down');
  const atDown = cameraAnglesFromOrientation(down, { angle: 222, pitch: -80, roll: 15 });
  assert.equal(atDown.angle, 222); assert.equal(atDown.pitch, -90); near(atDown.roll, 15);
  // Another previous yaw is an equivalent reading of the same vertical orientation.
  const other = cameraAnglesFromOrientation(down, { angle: 10, pitch: -80, roll: 0 });
  assert.equal(other.angle, 10); assert.equal(other.pitch, -90);
  nearVec(rot(cameraOrientation(other), Y), rot(down, Y), 'equivalent vertical up vector');
  // The kept yaw is the stored number itself when it is in range, and the same direction when it is not.
  for (const angle of [130.123456789, 0.1, 211.11111, 359.99999999]) assert.equal(cameraAnglesFromOrientation(up, { angle, pitch: 0, roll: 0 }).angle, angle);
  assert.equal(cameraAnglesFromOrientation(up, { angle: -223, pitch: 0, roll: 0 }).angle, 137);
  assert.equal(cameraAnglesFromOrientation(up, { angle: 497, pitch: 0, roll: 0 }).angle, 137);
});

test('turning a vertical camera about the vertical moves its direction, and a later tilt goes that way', () => {
  for (const pitch of [90, -90]) for (const roll of [0, 25, -160]) for (const spin of [40, -115, 180, 0.5]) {
    const start = { angle: 137, pitch, roll }, label = `${pitch}/${roll}/${spin}`, held = cameraOrientation(start);
    // Untouched, it reads back as it is stored.
    const same = cameraAnglesFromOrientation(held, start);
    circular(same.angle, 137, `${label} untouched angle`); assert.equal(same.pitch, pitch); circular(same.roll, roll, `${label} untouched roll`);
    // A plan turn of r is a turn of -r about world +Y. The spin is a new direction; the roll stays as stored.
    const spun = multiply(axisAngle(Y, -spin), held), read = cameraAnglesFromOrientation(spun, start);
    circular(read.angle, 137 + spin, `${label} direction follows the spin`);
    assert.equal(read.pitch, pitch); circular(read.roll, roll, `${label} roll is kept`);
    assert.ok(read.angle >= 0 && read.angle < 360 && read.roll > -180 && read.roll <= 180, `${label} ranges`);
    nearVec(rot(cameraOrientation(read), Y), rot(spun, Y), `${label} same up`);
    nearVec(rot(cameraOrientation(read), X), rot(spun, X), `${label} same right`);
    if (roll !== 0) continue;
    // Tilting back with the camera's own pitch ring ends on the direction the plan was already showing.
    const tilted = cameraAnglesFromOrientation(multiply(axisAngle(rot(spun, X), pitch > 0 ? -10 : 10), spun), read);
    circular(tilted.angle, 137 + spin, `${label} tilt goes where the plan pointed`); near(tilted.pitch, pitch > 0 ? 80 : -80); circular(tilted.roll, 0, `${label} level after the tilt`);
  }
  // From one pole straight to the other the direction is kept.
  const flipped = cameraAnglesFromOrientation(cameraOrientation({ angle: 137, pitch: -90, roll: 0 }), { angle: 137, pitch: 90, roll: 0 });
  circular(flipped.angle, 137, 'pole to pole'); assert.equal(flipped.pitch, -90); circular(flipped.roll, 0, 'pole to pole roll');
  // Arriving at vertical from a tilt still keeps the previous direction: the turn goes into the roll.
  const arriving = cameraAnglesFromOrientation(multiply(axisAngle(Y, -40), cameraOrientation({ angle: 137, pitch: 90, roll: 0 })), { angle: 137, pitch: 60, roll: 0 });
  assert.equal(arriving.angle, 137); assert.equal(arriving.pitch, 90); assert.ok(Math.abs(Math.abs(arriving.roll) - 40) < 1e-6, `roll ${arriving.roll}`);
});

test('roll alone tilts the frame around an unchanged line of sight', () => {
  for (const angles of [{ angle: 40, pitch: 25 }, { angle: 300, pitch: -60 }, { angle: 90, pitch: 90 }]) {
    const level = cameraOrientation({ ...angles, roll: 0 }), rolled = cameraOrientation({ ...angles, roll: 30 });
    nearVec(rot(rolled, LENS), rot(level, LENS), 'forward');
    nearVec(rot(rolled, LENS), cameraForward(angles.angle, angles.pitch), 'forward formula');
    near(rot(rolled, Y).x * rot(level, Y).x + rot(rolled, Y).y * rot(level, Y).y + rot(rolled, Y).z * rot(level, Y).z, Math.cos(Math.PI / 6));
    // Positive roll leans the top of the frame towards the camera's right.
    assert.ok(rot(rolled, Y).x * rot(level, X).x + rot(rolled, Y).y * rot(level, X).y + rot(rolled, Y).z * rot(level, X).z > 0);
  }
  const base = { ...legacyCamera, pitch: -45 };
  nearPoint(projectCameraToPlan({ ...base, roll: 70 }).direction, projectCameraToPlan(base).direction, 'plan direction ignores roll');
});

test('node orientation round-trips in YXZ order including gimbal lock', () => {
  nearVec(rot(nodeOrientation({ rotation: 0, pitch: 90, roll: 0 }), Y), Z, 'positive pitch tips the top towards plan +y');
  nearVec(rot(nodeOrientation({ rotation: 0, pitch: 0, roll: 90 }), X), Y, 'positive roll lifts the width axis');
  for (const rotation of [0, 90, 180, 270, 359.999]) for (const pitch of [0, 45, -45, 89.999, -89.999, 90, -90]) for (const roll of [0, 30, -30, 180]) {
    const label = `${rotation}/${pitch}/${roll}`, angles: NodeAngles = { rotation, pitch, roll }, q = nodeOrientation(angles);
    unit(q);
    const lock = Math.abs(pitch) === 90;
    for (const previous of [angles, { rotation: 77, pitch: 0, roll: 0 }]) {
      const result = nodeAnglesFromOrientation(q, previous), back = nodeOrientation(result);
      for (const axis of [X, Y, Z]) nearVec(rot(back, axis), rot(q, axis), `${label} axis`);
      assert.ok(result.rotation >= 0 && result.rotation < 360, `${label} rotation range ${result.rotation}`);
      assert.ok(result.pitch >= -90 && result.pitch <= 90, `${label} pitch range ${result.pitch}`);
      assert.ok(result.roll > -180 && result.roll <= 180, `${label} roll range ${result.roll}`);
      near(result.pitch, pitch);
      if (lock) circular(result.rotation, previous.rotation, `${label} keeps the previous rotation`);
      else { circular(result.rotation, rotation, `${label} rotation`); circular(result.roll, roll, `${label} roll`); }
      if (lock && previous === angles) circular(result.roll, roll, `${label} locked roll`);
    }
  }
  const locked = nodeAnglesFromOrientation(nodeOrientation({ rotation: 250, pitch: 90, roll: 20 }), { rotation: 250, pitch: 80, roll: 20 });
  assert.equal(locked.rotation, 250); assert.equal(locked.pitch, 90); near(locked.roll, 20);
  const legacy = nodeAnglesFromOrientation(nodeOrientation({ rotation: 250, pitch: -90, roll: 20 }), { rotation: -110, pitch: 0, roll: 0 });
  assert.equal(legacy.rotation, 250); assert.equal(legacy.pitch, -90); near(legacy.roll, 20);
  assert.equal(nodeAnglesFromOrientation(nodeOrientation({ rotation: 0, pitch: 90, roll: 0 }), { rotation: 33.123456789, pitch: 0, roll: 0 }).rotation, 33.123456789);
});

test('orientations match three.js cameras and YXZ eulers', async () => {
  const THREE = await import('three');
  const radians = Math.PI / 180;
  for (const [rotation, pitch, roll] of [[0, 0, 0], [35, 20, -15], [200, -70, 110], [359.999, 89.999, 30], [90, 90, 45], [270, -90, -30]]) {
    const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * radians, -rotation * radians, roll * radians, 'YXZ'));
    const actual = nodeOrientation({ rotation, pitch, roll });
    near(Math.abs(actual.x * expected.x + actual.y * expected.y + actual.z * expected.z + actual.w * expected.w), 1);
    const object = new THREE.Object3D();
    object.quaternion.set(actual.x, actual.y, actual.z, actual.w);
    nearVec(new THREE.Vector3(1, 2, 3).applyQuaternion(object.quaternion), rot(actual, { x: 1, y: 2, z: 3 }), 'three applies the same rotation');
  }
  for (const [angle, pitch, roll] of [[0, 0, 0], [90, -30, 0], [137, 45, 25], [300, -89, -140], [180, 60, 180], [90, 0, 180], [270, 10, 90]]) {
    const forward = cameraForward(angle, pitch), camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 20, 30);
    camera.lookAt(10 + forward.x, 20 + forward.y, 30 + forward.z);
    // The lens looks down local -Z, so a turn about the line of sight is a negative turn about local Z.
    camera.rotateZ(-roll * radians);
    const actual = cameraOrientation({ angle, pitch, roll }), expected = camera.quaternion.clone();
    near(Math.abs(actual.x * expected.x + actual.y * expected.y + actual.z * expected.z + actual.w * expected.w), 1);
    const read = cameraAnglesFromOrientation(expected, { angle: 0, pitch: 0, roll: 0 });
    circular(read.angle, angle); near(read.pitch, pitch); circular(read.roll, roll);
    camera.quaternion.set(actual.x, actual.y, actual.z, actual.w);
    nearVec(camera.getWorldDirection(new THREE.Vector3()), forward, `three camera direction ${angle}/${pitch}`);
  }
});

test('vertical field of view follows the horizontal value and the frame shape', () => {
  near(verticalFov(60, 1), 60);
  near(verticalFov(60, 16 / 9), 2 * Math.atan(Math.tan(Math.PI / 6) * 9 / 16) * 180 / Math.PI);
  near(verticalFov(60, 16 / 9), 35.9833978);
  near(verticalFov(90, 2), 2 * Math.atan(0.5) * 180 / Math.PI);
  assert.ok(verticalFov(60, 16 / 9) < 60 && verticalFov(60, 0.5) > 60);
});

test('plan projection shortens with pitch and marks vertical views without a horizontal arrow', () => {
  const camera: BackgroundCamera = { ...legacyCamera, angle: 90, elevation: 200 }, frozen = JSON.stringify(camera);
  const level = projectCameraToPlan(camera);
  assert.deepEqual(level.position, { x: 130, y: 140 }); nearPoint(level.direction, { x: 0, y: 1 });
  assert.equal(level.elevation, 200); assert.equal(level.pitch, 0); assert.equal(level.vertical, null);
  for (const pitch of [45, -45]) {
    const tilted = projectCameraToPlan({ ...camera, pitch });
    nearPoint(tilted.direction, { x: 0, y: Math.SQRT1_2 }, `pitch ${pitch}`);
    near(Math.hypot(tilted.direction.x, tilted.direction.y), Math.cos(Math.PI / 4));
    assert.equal(tilted.pitch, pitch); assert.equal(tilted.vertical, null);
  }
  for (const [angle, direction] of [[0, { x: 1, y: 0 }], [90, { x: 0, y: 1 }], [180, { x: -1, y: 0 }], [270, { x: 0, y: -1 }]] as Array<[number, BackgroundPoint]>)
    nearPoint(projectCameraToPlan({ ...camera, angle }).direction, direction, `yaw ${angle}`);
  const up = { ...camera, angle: 137, pitch: 90 }, down = { ...camera, angle: 137, pitch: -90 };
  assert.deepEqual(projectCameraToPlan(up), { position: { x: 130, y: 140 }, direction: { x: 0, y: 0 }, elevation: 200, pitch: 90, vertical: 'up' });
  assert.deepEqual(projectCameraToPlan(down), { position: { x: 130, y: 140 }, direction: { x: 0, y: 0 }, elevation: 200, pitch: -90, vertical: 'down' });
  assert.equal(up.angle, 137); assert.equal(down.angle, 137);
  assert.equal(projectCameraToPlan({ ...camera, pitch: 89.999 }).vertical, null);
  // Legacy cameras read as level at the default lens height.
  const legacy = projectCameraToPlan(legacyCamera);
  assert.equal(legacy.elevation, 120); assert.equal(legacy.pitch, 0); assert.equal(legacy.vertical, null);
  nearPoint(legacy.direction, { x: Math.cos(Math.PI / 6), y: 0.5 });
  assert.equal(JSON.stringify(camera), frozen); assert.equal('elevation' in legacyCamera, false);
});

test('pitch labels name level, tilted and vertical views', () => {
  assert.equal(cameraPitchLabel(0), '수평'); assert.equal(cameraPitchLabel(0.4), '수평'); assert.equal(cameraPitchLabel(-0.49), '수평');
  assert.equal(cameraPitchLabel(30), '위 30°'); assert.equal(cameraPitchLabel(-45), '아래 45°');
  assert.equal(cameraPitchLabel(0.5), '위 1°'); assert.equal(cameraPitchLabel(-34.6), '아래 35°');
  assert.equal(cameraPitchLabel(90), '수직 위'); assert.equal(cameraPitchLabel(-90), '수직 아래');
  assert.equal(cameraPitchLabel(89.7), '위 89°'); assert.equal(cameraPitchLabel(-89.999), '아래 89°');
});

test('new cameras take the whole fixed pose and the next free name', () => {
  const camera = createMapCamera('00000000-0000-4000-8000-000000000001', '카메라 1');
  assert.deepEqual(camera, { id: '00000000-0000-4000-8000-000000000001', type: 'camera', name: '카메라 1', x: 500, y: 340, spaceId: null, angle: 0, fov: 60, viewIds: [], locked: false, elevation: 120, pitch: 0, roll: 0, aspect: 16 / 9 });
  assert.equal(createMapCamera.length, 2);
  assert.notEqual(createMapCamera('a', 'b').viewIds, createMapCamera('a', 'b').viewIds);
  const named = (name: string, id = name): BackgroundCamera => ({ ...legacyCamera, id, name });
  assert.equal(nextMapCameraName([]), '카메라 1');
  assert.equal(nextMapCameraName([named('카메라 1'), named('카메라 2')]), '카메라 3');
  assert.equal(nextMapCameraName([named('카메라 1'), named('카메라 3')]), '카메라 2');
  assert.equal(nextMapCameraName([named('카메라 2'), named('새 카메라'), named('카메라 01'), named('카메라 1 '), named('카메라 0')]), '카메라 1');
  // Only cameras reserve a number.
  assert.equal(nextMapCameraName([{ ...legacySpace, name: '카메라 1' }, { ...legacySymbol, name: '카메라 2' }]), '카메라 1');
});

test('nodes saved before the 3D editor read as defaults without gaining keys', () => {
  const space = { ...legacySpace }, camera = { ...legacyCamera }, symbol = { ...legacySymbol };
  assert.equal(nodeElevation(space), 0); assert.equal(nodeElevation(symbol), 0); assert.equal(nodeElevation(camera), 120);
  assert.equal(nodeVolumeHeight(space), 180); assert.equal(nodeVolumeHeight(symbol), 160);
  assert.deepEqual(cameraAngles(camera), { angle: 30, pitch: 0, roll: 0 }); assert.equal(cameraAspect(camera), 16 / 9);
  assert.deepEqual(nodeAngles(symbol), { rotation: 0, pitch: 0, roll: 0 });
  assert.deepEqual(nodeAngles({ ...space, rotation: 45 }), { rotation: 45, pitch: 0, roll: 0 });
  // Spaces are always upright, whatever stray value an object carries.
  assert.deepEqual(nodeAngles({ ...space, pitch: 30, roll: 20 } as BackgroundSpace), { rotation: 0, pitch: 0, roll: 0 });
  assert.deepEqual(space, legacySpace); assert.deepEqual(camera, legacyCamera); assert.deepEqual(symbol, legacySymbol);
  for (const node of [space, camera, symbol]) for (const key of ['elevation', 'volumeHeight', 'pitch', 'roll', 'aspect']) assert.equal(key in node, false);

  const heights: Array<[BackgroundSymbol['symbol'], number]> = [['door', 160], ['chair', 70], ['table', 60], ['bed', 45], ['custom', 80], ['desk', 80], ['sofa', 80], ['cabinet', 80], ['plant', 80]];
  for (const [kind, height] of heights) assert.equal(nodeVolumeHeight({ ...legacySymbol, symbol: kind }), height, kind);
  assert.equal(nodeVolumeHeight({ ...legacySymbol, symbol: 'piano' as BackgroundSymbol['symbol'] }), 80);
  assert.equal(nodeVolumeHeight({ ...legacySymbol, symbol: 'toString' as BackgroundSymbol['symbol'] }), 80);

  // Stored values win over the defaults.
  assert.equal(nodeElevation({ ...space, elevation: -40 }), -40); assert.equal(nodeVolumeHeight({ ...space, volumeHeight: 300 }), 300);
  assert.equal(nodeElevation({ ...camera, elevation: 0 }), 0); assert.equal(nodeVolumeHeight({ ...symbol, volumeHeight: 12 }), 12);
  assert.deepEqual(cameraAngles({ ...camera, pitch: -90, roll: 12 }), { angle: 30, pitch: -90, roll: 12 }); assert.equal(cameraAspect({ ...camera, aspect: 2.35 }), 2.35);
  assert.deepEqual(nodeAngles({ ...symbol, rotation: 10, pitch: 20, roll: -30 }), { rotation: 10, pitch: 20, roll: -30 });
});

test('world poses put the root at the centre of the base and never reuse plan depth as height', () => {
  const space = nodeWorldPose({ ...legacySpace, rotation: 90 });
  assert.deepEqual(space.position, { x: 150, y: 0, z: 130 }); assert.deepEqual(space.size, { x: 100, y: 180, z: 60 });
  nearVec(rot(space.quaternion, X), Z, 'space width axis');
  const raised = nodeWorldPose({ ...legacySpace, elevation: 25, volumeHeight: 90 });
  assert.deepEqual(raised.position, { x: 150, y: 25, z: 130 }); assert.deepEqual(raised.size, { x: 100, y: 90, z: 60 });
  const symbol = nodeWorldPose({ ...legacySymbol, elevation: 5, pitch: 90 });
  assert.deepEqual(symbol.position, { x: 140, y: 5, z: 150 }); assert.deepEqual(symbol.size, { x: 20, y: 160, z: 10 });
  nearVec(rot(symbol.quaternion, Y), Z, 'tilted symbol up axis');
  const camera = nodeWorldPose({ ...legacyCamera, angle: 90, pitch: -30 });
  assert.deepEqual(camera.position, { x: 130, y: 120, z: 140 }); assert.deepEqual(camera.size, { x: 0, y: 0, z: 0 });
  nearVec(rot(camera.quaternion, LENS), { x: 0, y: -0.5, z: Math.sqrt(3) / 2 }, 'camera lens');
});

test('space outlines keep rectangles, ellipses and polygons in the local plan frame', () => {
  assert.deepEqual(spaceOutline(legacySpace), [{ x: -50, y: -30 }, { x: 50, y: -30 }, { x: 50, y: 30 }, { x: -50, y: 30 }]);
  assert.deepEqual(spaceOutline({ ...legacySpace, rotation: 77 }), spaceOutline(legacySpace));
  const ellipse = spaceOutline({ ...legacySpace, shape: 'ellipse' });
  assert.equal(ellipse.length, 48); nearPoint(ellipse[0], { x: 50, y: 0 }); nearPoint(ellipse[12], { x: 0, y: 30 }); nearPoint(ellipse[24], { x: -50, y: 0 });
  for (const point of ellipse) near((point.x / 50) ** 2 + (point.y / 30) ** 2, 1);
  assert.equal(spaceOutline({ ...legacySpace, shape: 'ellipse' }, 8).length, 8);
  const triangle = { ...legacySpace, shape: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] };
  assert.deepEqual(spaceOutline(triangle), [{ x: -50, y: -30 }, { x: 50, y: -30 }, { x: 0, y: 30 }]);
  assert.deepEqual(triangle.points, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }]);
  // Shapes that cannot make an outline still draw as their box.
  assert.deepEqual(spaceOutline({ ...triangle, points: triangle.points.slice(0, 2) }), spaceOutline(legacySpace));
  assert.equal(spaceOutline({ ...legacySpace, shape: 'ellipse' }, 1).length, 3);
});

test('plan outlines rotate like the 2D editor and project tilted objects', () => {
  const rotated = nodePlanOutline({ ...legacySpace, rotation: 90 });
  const expected = [{ x: -50, y: -30 }, { x: 50, y: -30 }, { x: 50, y: 30 }, { x: -50, y: 30 }].map(point => { const turned = planRotate(point, 90); return { x: 150 + turned.x, y: 130 + turned.y }; });
  assert.equal(rotated.length, 4); rotated.forEach((point, index) => nearPoint(point, expected[index], `corner ${index}`));
  nearPoint(rotated[0], { x: 180, y: 80 });
  const triangle = nodePlanOutline({ ...legacySpace, shape: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] });
  [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 160 }].forEach((point, index) => nearPoint(triangle[index], point, `triangle ${index}`));
  // The vertical placement of a space never changes its plan outline.
  assert.deepEqual(nodePlanOutline({ ...legacySpace, elevation: 300, volumeHeight: 20 }), nodePlanOutline(legacySpace));

  const symbol: BackgroundSymbol = { ...legacySymbol, x: 0, y: 0, width: 20, height: 10, rotation: 30 };
  const flat = nodePlanOutline(symbol);
  [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 }].forEach((point, index) => { const turned = planRotate(point, 30); nearPoint(flat[index], { x: 10 + turned.x, y: 5 + turned.y }, `symbol ${index}`); });
  assert.deepEqual(nodePlanOutline({ ...symbol, pitch: 0, roll: 0, elevation: 40 }), flat);

  // Tipped a quarter turn about its width axis, the 160-high door lies along plan +y from its base centre.
  const lying = nodePlanOutline({ ...symbol, rotation: 0, pitch: 90 });
  const xs = lying.map(point => point.x), ys = lying.map(point => point.y);
  near(Math.min(...xs), 0); near(Math.max(...xs), 20); near(Math.min(...ys), 5); near(Math.max(...ys), 165);
  assert.equal(lying.length, 4);
  const area = (points: BackgroundPoint[]) => points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y; }, 0) / 2;
  near(area(lying), 20 * 160); assert.ok(area(flat) > 0);
  // A partial tilt covers both the base and the leaning top; the stored size is untouched.
  const leaning = { ...symbol, rotation: 0, roll: 30 }, hull = nodePlanOutline(leaning);
  assert.ok(hull.length >= 4 && area(hull) > 0);
  near(Math.max(...hull.map(point => point.x)), 10 + 10 * Math.cos(Math.PI / 6));
  near(Math.min(...hull.map(point => point.x)), 10 - 10 * Math.cos(Math.PI / 6) - 160 * 0.5);
  assert.equal(leaning.width, 20); assert.equal(leaning.height, 10);
});

test('plan bounds cover the base extent, every outline and every camera', () => {
  const empty: BackgroundMap = { id: 'map', revision: 1, name: '학교', parentId: null, placeId: null, imageUrl: '', nodes: [] };
  assert.deepEqual(mapPlanBounds(empty), { x: 0, y: 0, width: 1000, height: 680 });
  assert.deepEqual(mapPlanBounds({ ...empty, nodes: [legacySpace, legacyCamera, legacySymbol] }), { x: 0, y: 0, width: 1000, height: 680 });
  const wide = mapPlanBounds({ ...empty, nodes: [
    { ...legacySpace, x: -200, y: 600, width: 100, height: 200 },
    { ...legacyCamera, x: 1500, y: -50 },
    { ...legacySymbol, x: 400, y: -300, width: 20, height: 10 },
  ] });
  assert.deepEqual(wide, { x: -200, y: -300, width: 1700, height: 1100 });
  const turned = mapPlanBounds({ ...empty, nodes: [{ ...legacySpace, x: -100, y: 0, width: 100, height: 20, rotation: 90 }] });
  near(turned.x, -60); near(turned.y, -40); near(turned.width, 1060); near(turned.height, 720);
  // A tilted object counts with the outline it casts, and a broken coordinate never poisons the frame.
  const lying = mapPlanBounds({ ...empty, nodes: [{ ...legacySymbol, x: 500, y: 600, rotation: 0, pitch: 90 }] });
  near(lying.y, 0); near(lying.height, 765);
  assert.deepEqual(mapPlanBounds({ ...empty, nodes: [{ ...legacyCamera, x: Number.NaN, y: 2000 }, { ...legacyCamera, id: 'ok', x: 1200, y: 700 }] }), { x: 0, y: 0, width: 1200, height: 700 });
});
