import { BACKGROUND_SPATIAL_LIMITS } from './domain.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol, BackgroundSymbolKind } from './types.ts';

/**
 * Pure plan <-> world conversions shared by the plan editor, the 3D view and the plan inset.
 * world X = plan x, world Y = up, world Z = plan y. Plan angles are degrees with 0 = +x and
 * +90 = +y (clockwise on screen): a plan turn of r is a turn of -r about world +Y.
 * Quaternions are unit {x,y,z,w} values in the three.js convention; three is never imported here.
 */
export type Vec3 = { x: number; y: number; z: number };
export type QuaternionValue = { x: number; y: number; z: number; w: number };
export type CameraAngles = { angle: number; pitch: number; roll: number };
export type NodeAngles = { rotation: number; pitch: number; roll: number };
export type CameraPlanProjection = {
  position: BackgroundPoint;
  /** Horizontal part of the line of sight; its length is cos(pitch) and it is zero when vertical. */
  direction: BackgroundPoint;
  elevation: number;
  pitch: number;
  vertical: 'up' | 'down' | null;
};
/** Root of a node in the world: base centre of a space or symbol, lens of a camera. */
export type NodeWorldPose = { position: Vec3; quaternion: QuaternionValue; size: Vec3 };

export const MAP_PLAN_EXTENT = { width: 1000, height: 680 } as const;
export const MAP_SPATIAL_LIMITS = BACKGROUND_SPATIAL_LIMITS;
/** Read-time defaults of the optional vertical fields. Viewing a map never writes them. */
export const MAP_SPATIAL_DEFAULTS = { spaceElevation: 0, spaceVolumeHeight: 180, symbolElevation: 0, cameraElevation: 120, pitch: 0, roll: 0, aspect: 16 / 9 } as const;
/** Legacy kinds render as the generic object, so they share its height. */
export const SYMBOL_VOLUME_HEIGHTS: Readonly<Record<BackgroundSymbolKind, number>> = {
  door: 160, chair: 70, table: 60, bed: 45, custom: 80, desk: 80, sofa: 80, cabinet: 80, plant: 80,
};
/** Every new camera starts here, whatever is clicked, selected or visible. */
export const DEFAULT_MAP_CAMERA_POSE = { x: 500, y: 340, elevation: 120, angle: 0, pitch: 0, roll: 0, fov: 60, aspect: 16 / 9 } as const;

const RADIANS = Math.PI / 180;
const EPSILON = 1e-6;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const rotatePlan = (point: BackgroundPoint, degrees: number): BackgroundPoint => {
  const radians = degrees * RADIANS;
  return { x: point.x * Math.cos(radians) - point.y * Math.sin(radians), y: point.x * Math.sin(radians) + point.y * Math.cos(radians) };
};

/** Degrees in [0, 360). A value already in range is returned as it is. */
export function normalizeDegrees(value: number): number {
  return value >= 0 && value < 360 ? value + 0 : ((value % 360) + 360) % 360;
}
/** Degrees in (-180, 180]. */
export function normalizeSignedDegrees(value: number): number {
  if (value > -180 && value <= 180) return value + 0;
  const turned = normalizeDegrees(value);
  return turned > 180 ? turned - 360 : turned;
}

export function nodeElevation(node: BackgroundNode): number {
  return node.elevation ?? (node.type === 'camera' ? MAP_SPATIAL_DEFAULTS.cameraElevation : node.type === 'space' ? MAP_SPATIAL_DEFAULTS.spaceElevation : MAP_SPATIAL_DEFAULTS.symbolElevation);
}
/** Vertical size. `height` is the plan depth and is never used for it. */
export function nodeVolumeHeight(node: BackgroundSpace | BackgroundSymbol): number {
  if (node.volumeHeight != null) return node.volumeHeight;
  if (node.type === 'space') return MAP_SPATIAL_DEFAULTS.spaceVolumeHeight;
  return Object.prototype.hasOwnProperty.call(SYMBOL_VOLUME_HEIGHTS, node.symbol) ? SYMBOL_VOLUME_HEIGHTS[node.symbol] : SYMBOL_VOLUME_HEIGHTS.custom;
}
export function cameraAngles(camera: BackgroundCamera): CameraAngles {
  return { angle: camera.angle, pitch: camera.pitch ?? MAP_SPATIAL_DEFAULTS.pitch, roll: camera.roll ?? MAP_SPATIAL_DEFAULTS.roll };
}
export function cameraAspect(camera: BackgroundCamera): number {
  return camera.aspect ?? MAP_SPATIAL_DEFAULTS.aspect;
}
/** Spaces stay upright; only symbols tilt. */
export function nodeAngles(node: BackgroundSpace | BackgroundSymbol): NodeAngles {
  if (node.type === 'space') return { rotation: node.rotation, pitch: 0, roll: 0 };
  return { rotation: node.rotation, pitch: node.pitch ?? MAP_SPATIAL_DEFAULTS.pitch, roll: node.roll ?? MAP_SPATIAL_DEFAULTS.roll };
}

export function toWorldPoint(point: BackgroundPoint, elevation: number): Vec3 {
  return { x: point.x, y: elevation, z: point.y };
}
export function toPlanPoint(point: Vec3): BackgroundPoint {
  return { x: point.x, y: point.z };
}
/** Line of sight. Positive pitch looks up. */
export function cameraForward(angle: number, pitch: number): Vec3 {
  const yaw = angle * RADIANS, tilt = pitch * RADIANS;
  return { x: Math.cos(tilt) * Math.cos(yaw), y: Math.sin(tilt), z: Math.cos(tilt) * Math.sin(yaw) };
}
/** `fov` on a camera node is horizontal; three.js cameras take the vertical value. */
export function verticalFov(horizontal: number, aspect: number): number {
  return 2 * Math.atan(Math.tan(horizontal * Math.PI / 360) / aspect) * 180 / Math.PI;
}

export function createMapCamera(id: string, name: string): BackgroundCamera {
  const pose = DEFAULT_MAP_CAMERA_POSE;
  return { id, type: 'camera', name, x: pose.x, y: pose.y, spaceId: null, angle: pose.angle, fov: pose.fov, viewIds: [], locked: false,
    elevation: pose.elevation, pitch: pose.pitch, roll: pose.roll, aspect: pose.aspect };
}
export function nextMapCameraName(nodes: readonly BackgroundNode[]): string {
  const used = new Set<string>();
  for (const node of nodes) if (node.type === 'camera') used.add(node.name);
  let index = 1;
  while (used.has(`카메라 ${index}`)) index++;
  return `카메라 ${index}`;
}

export function projectCameraToPlan(camera: BackgroundCamera): CameraPlanProjection {
  const { angle, pitch } = cameraAngles(camera), forward = cameraForward(angle, pitch);
  const vertical = Math.abs(Math.cos(pitch * RADIANS)) < EPSILON ? (pitch > 0 ? 'up' : 'down') : null;
  return { position: { x: camera.x, y: camera.y }, direction: vertical ? { x: 0, y: 0 } : { x: forward.x, y: forward.z },
    elevation: nodeElevation(camera), pitch, vertical };
}
export function cameraPitchLabel(pitch: number): string {
  if (Math.abs(pitch) < 0.5) return '수평';
  if (Math.abs(Math.cos(pitch * RADIANS)) < EPSILON) return pitch > 0 ? '수직 위' : '수직 아래';
  return `${pitch > 0 ? '위' : '아래'} ${Math.min(89, Math.round(Math.abs(pitch)))}°`;
}

/** A zero or non-finite input stays non-finite, so callers can tell a broken result from a real turn. */
function normalizeQuaternion(q: QuaternionValue): QuaternionValue {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}
/** v' = q v q^-1 */
export function rotateVector(quaternion: QuaternionValue, vector: Vec3): Vec3 {
  const q = quaternion, v = vector;
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + q.y * tz - q.z * ty, y: v.y + q.w * ty + q.z * tx - q.x * tz, z: v.z + q.w * tz + q.x * ty - q.y * tx };
}
/** Rotation whose matrix columns are the rotated local x, y and z axes. */
function quaternionFromBasis(x: Vec3, y: Vec3, z: Vec3): QuaternionValue {
  const m11 = x.x, m12 = y.x, m13 = z.x, m21 = x.y, m22 = y.y, m23 = z.y, m31 = x.z, m32 = y.z, m33 = z.z;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return normalizeQuaternion({ x: (m32 - m23) * s, y: (m13 - m31) * s, z: (m21 - m12) * s, w: 0.25 / s });
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return normalizeQuaternion({ x: 0.25 * s, y: (m12 + m21) / s, z: (m13 + m31) / s, w: (m32 - m23) / s });
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return normalizeQuaternion({ x: (m12 + m21) / s, y: 0.25 * s, z: (m23 + m32) / s, w: (m13 - m31) / s });
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return normalizeQuaternion({ x: (m13 + m31) / s, y: (m23 + m32) / s, z: 0.25 * s, w: (m21 - m12) / s });
}

/** Unrolled camera frame. `right` comes from the yaw alone, so it stays valid when looking straight up or down. */
function cameraBasis(angle: number, pitch: number): { forward: Vec3; right: Vec3; up: Vec3 } {
  const yaw = angle * RADIANS, forward = cameraForward(angle, pitch), right = { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  return { forward, right, up: cross(right, forward) };
}
/** Orientation of a three.js camera object: it looks down local -Z with local +Y up and local +X right. */
export function cameraOrientation(angles: CameraAngles): QuaternionValue {
  const basis = cameraBasis(angles.angle, angles.pitch), roll = angles.roll * RADIANS, c = Math.cos(roll), s = Math.sin(roll);
  const up = { x: basis.up.x * c + basis.right.x * s, y: basis.up.y * c + basis.right.y * s, z: basis.up.z * c + basis.right.z * s };
  const right = { x: basis.right.x * c - basis.up.x * s, y: basis.right.y * c - basis.up.y * s, z: basis.right.z * c - basis.up.z * s };
  return quaternionFromBasis(right, up, { x: -basis.forward.x, y: -basis.forward.y, z: -basis.forward.z });
}
/**
 * Inverse of cameraOrientation. A vertical line of sight has no yaw of its own. Arriving there keeps the previous yaw
 * and the roll takes the rest. Turning about the vertical while already there is a change of direction: the yaw
 * follows and the roll stays, so the plan shows the turn and a later tilt goes the way the plan pointed.
 */
export function cameraAnglesFromOrientation(orientation: QuaternionValue, previous: CameraAngles): CameraAngles {
  const q = normalizeQuaternion(orientation), forward = rotateVector(q, { x: 0, y: 0, z: -1 }), up = rotateVector(q, { x: 0, y: 1, z: 0 });
  const level = Math.hypot(forward.x, forward.z), vertical = level < EPSILON;
  const angle = normalizeDegrees(vertical ? previous.angle : Math.atan2(forward.z, forward.x) / RADIANS);
  const pitch = vertical ? (forward.y < 0 ? -90 : 90) : clamp(Math.atan2(forward.y, level) / RADIANS, -90, 90);
  const basis = cameraBasis(angle, pitch), roll = normalizeSignedDegrees(Math.atan2(dot(up, basis.right), dot(up, basis.up)) / RADIANS);
  if (!vertical || Math.abs(Math.cos(previous.pitch * RADIANS)) >= EPSILON) return { angle, pitch, roll };
  // Looking up, yaw and roll turn the same way; looking down, opposite ways.
  const turn = roll - previous.roll;
  return { angle: normalizeDegrees(angle + (pitch > 0 ? -turn : turn)), pitch, roll: normalizeSignedDegrees(previous.roll) };
}

/** Ry(-rotation) * Rx(pitch) * Rz(roll), the same as three.js Euler(pitch, -rotation, roll, 'YXZ') in radians. */
export function nodeOrientation(angles: NodeAngles): QuaternionValue {
  const x = angles.pitch * RADIANS / 2, y = -angles.rotation * RADIANS / 2, z = angles.roll * RADIANS / 2;
  const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z), s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);
  return normalizeQuaternion({ x: s1 * c2 * c3 + c1 * s2 * s3, y: c1 * s2 * c3 - s1 * c2 * s3, z: c1 * c2 * s3 - s1 * s2 * c3, w: c1 * c2 * c3 + s1 * s2 * s3 });
}
/** Inverse of nodeOrientation. At gimbal lock the previous rotation is kept and the roll absorbs the rest. */
export function nodeAnglesFromOrientation(orientation: QuaternionValue, previous: NodeAngles): NodeAngles {
  const q = normalizeQuaternion(orientation);
  const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
  const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2, yy = q.y * y2, yz = q.y * z2, zz = q.z * z2, wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
  const m11 = 1 - (yy + zz), m12 = xy - wz, m13 = xz + wy, m21 = xy + wz, m22 = 1 - (xx + zz), m23 = yz - wx, m33 = 1 - (xx + yy);
  const level = Math.hypot(m21, m22);
  if (level < EPSILON) {
    const rotation = normalizeDegrees(previous.rotation), yaw = -rotation * RADIANS, up = m23 < 0;
    const roll = up ? yaw - Math.atan2(m12, m11) : Math.atan2(-m12, m11) - yaw;
    return { rotation, pitch: up ? 90 : -90, roll: normalizeSignedDegrees(roll / RADIANS) };
  }
  return { rotation: normalizeDegrees(-Math.atan2(m13, m33) / RADIANS), pitch: clamp(Math.atan2(-m23, level) / RADIANS, -90, 90),
    roll: normalizeSignedDegrees(Math.atan2(m21, m22) / RADIANS) };
}

/** Outline in the space's own plan frame, centred on the box centre and not yet rotated. */
export function spaceOutline(space: BackgroundSpace, ellipseSegments = 48): BackgroundPoint[] {
  const halfWidth = space.width / 2, halfHeight = space.height / 2;
  if (space.shape === 'ellipse') {
    const count = Math.max(3, Math.floor(ellipseSegments));
    return Array.from({ length: count }, (_, index) => {
      const turn = index / count * Math.PI * 2;
      return { x: Math.cos(turn) * halfWidth, y: Math.sin(turn) * halfHeight };
    });
  }
  if (space.shape === 'polygon' && space.points.length >= 3) return space.points.map(point => ({ x: (point.x - 0.5) * space.width, y: (point.y - 0.5) * space.height }));
  return [{ x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight }, { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight }];
}

export function nodeWorldPose(node: BackgroundNode): NodeWorldPose {
  if (node.type === 'camera') return { position: { x: node.x, y: nodeElevation(node), z: node.y }, quaternion: cameraOrientation(cameraAngles(node)), size: { x: 0, y: 0, z: 0 } };
  return { position: { x: node.x + node.width / 2, y: nodeElevation(node), z: node.y + node.height / 2 }, quaternion: nodeOrientation(nodeAngles(node)),
    size: { x: node.width, y: nodeVolumeHeight(node), z: node.height } };
}

function convexHull(points: BackgroundPoint[]): BackgroundPoint[] {
  // Snap away float noise so coincident projected corners sort together.
  const snap = (value: number) => Math.round(value * 1e9) / 1e9 + 0;
  const sorted = points.map(point => ({ x: snap(point.x), y: snap(point.y) })).sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (origin: BackgroundPoint, a: BackgroundPoint, b: BackgroundPoint) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const chain = (source: BackgroundPoint[]) => {
    const result: BackgroundPoint[] = [];
    for (const point of source) {
      while (result.length >= 2 && turn(result[result.length - 2], result[result.length - 1], point) <= 1e-9) result.pop();
      result.push(point);
    }
    result.pop();
    return result;
  };
  return [...chain(sorted), ...chain([...sorted].reverse())];
}

/** Absolute plan polygon. A tilted symbol casts the outline of its whole box; its stored size is untouched. */
export function nodePlanOutline(node: BackgroundSpace | BackgroundSymbol): BackgroundPoint[] {
  const angles = nodeAngles(node);
  if (angles.pitch === 0 && angles.roll === 0) {
    const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    const local = node.type === 'space' ? spaceOutline(node)
      : [{ x: -node.width / 2, y: -node.height / 2 }, { x: node.width / 2, y: -node.height / 2 }, { x: node.width / 2, y: node.height / 2 }, { x: -node.width / 2, y: node.height / 2 }];
    return local.map(point => {
      const turned = rotatePlan(point, node.rotation);
      return { x: center.x + turned.x, y: center.y + turned.y };
    });
  }
  const pose = nodeWorldPose(node), corners: BackgroundPoint[] = [];
  for (const x of [-0.5, 0.5]) for (const y of [0, 1]) for (const z of [-0.5, 0.5]) {
    const turned = rotateVector(pose.quaternion, { x: x * pose.size.x, y: y * pose.size.y, z: z * pose.size.z });
    corners.push({ x: pose.position.x + turned.x, y: pose.position.z + turned.z });
  }
  return convexHull(corners);
}

/** Plan rectangle that holds the base extent, every outline and every camera. */
export function mapPlanBounds(map: BackgroundMap): { x: number; y: number; width: number; height: number } {
  let minX = 0, minY = 0, maxX: number = MAP_PLAN_EXTENT.width, maxY: number = MAP_PLAN_EXTENT.height;
  const include = (point: BackgroundPoint) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  };
  for (const node of map.nodes) {
    if (node.type === 'camera') include(node);
    else nodePlanOutline(node).forEach(include);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
