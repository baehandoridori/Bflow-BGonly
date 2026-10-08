import type { BackgroundCamera, BackgroundMap, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from './types.ts';
import { MAP_SPATIAL_LIMITS, cameraAngles, cameraAnglesFromOrientation, cameraOrientation, createMapCamera, nextMapCameraName, nodeAngles, nodeAnglesFromOrientation,
  nodeElevation, nodeOrientation, nodeVolumeHeight, normalizeDegrees, normalizeSignedDegrees } from './mapSpatial.ts';
import type { QuaternionValue, Vec3 } from './mapSpatial.ts';

function rotate(point: BackgroundPoint, angle: number): BackgroundPoint {
  const radians = angle * Math.PI / 180;
  return { x: point.x * Math.cos(radians) - point.y * Math.sin(radians), y: point.x * Math.sin(radians) + point.y * Math.cos(radians) };
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Resize from the bottom-right handle while the rotated top-left stays fixed. */
export function resizeSpace<T extends BackgroundSpace | BackgroundSymbol>(space: T, pointer: BackgroundPoint): T {
  const cornerOffset = rotate({ x: -space.width / 2, y: -space.height / 2 }, space.rotation);
  const origin = { x: space.x + space.width / 2 + cornerOffset.x, y: space.y + space.height / 2 + cornerOffset.y };
  const local = rotate({ x: pointer.x - origin.x, y: pointer.y - origin.y }, -space.rotation);
  const width = Math.min(100000, Math.max(10, local.x)), height = Math.min(100000, Math.max(10, local.y));
  const centerOffset = rotate({ x: width / 2, y: height / 2 }, space.rotation);
  return { ...space, width, height, x: origin.x + centerOffset.x - width / 2, y: origin.y + centerOffset.y - height / 2 };
}

/**
 * Keep attached cameras and symbols in the same relative position when a space changes geometry.
 * Members are absolute map coordinates: this is the only place they follow their space, on the plan
 * and by the same lift when the floor level changes. The box height alone never moves them.
 */
export function transformMapSpace(map: BackgroundMap, next: BackgroundSpace): BackgroundMap {
  const previous = map.nodes.find(node => node.id === next.id);
  if (!previous || previous.type !== 'space') return map;
  const changed = previous.x !== next.x || previous.y !== next.y || previous.width !== next.width || previous.height !== next.height || previous.rotation !== next.rotation;
  const rise = nodeElevation(next) - nodeElevation(previous), lift = Number.isFinite(rise) ? rise : 0;
  if ((changed || rise !== 0 || nodeVolumeHeight(next) !== nodeVolumeHeight(previous)) && previous.locked) return map;
  const rotationDelta = next.rotation - previous.rotation;
  return { ...map, nodes: map.nodes.map(node => {
    if (node.id === next.id) return next;
    if ((!changed && lift === 0) || node.type === 'space' || node.spaceId !== next.id || node.locked) return node;
    const lifted = lift === 0 ? {} : { elevation: clamp(nodeElevation(node) + lift, MAP_SPATIAL_LIMITS.elevation.min, MAP_SPATIAL_LIMITS.elevation.max) };
    if (!changed) return { ...node, ...lifted };
    const center = node.type === 'symbol' ? { x: node.x + node.width / 2, y: node.y + node.height / 2 } : node;
    const local = rotate({ x: center.x - previous.x - previous.width / 2, y: center.y - previous.y - previous.height / 2 }, -previous.rotation);
    const scaleX = next.width / previous.width, scaleY = next.height / previous.height;
    const offset = rotate({ x: local.x * scaleX, y: local.y * scaleY }, next.rotation);
    const x = next.x + next.width / 2 + offset.x, y = next.y + next.height / 2 + offset.y;
    if (node.type === 'camera') return { ...node, ...lifted, x, y,
      angle: rotationDelta === 0 ? node.angle : ((node.angle + rotationDelta) % 360 + 360) % 360 };
    const width = Math.min(100000, Math.max(10, node.width * scaleX)), height = Math.min(100000, Math.max(10, node.height * scaleY));
    return { ...node, ...lifted, x: x - width / 2, y: y - height / 2, width, height,
      rotation: rotationDelta === 0 ? node.rotation : ((node.rotation + rotationDelta) % 360 + 360) % 360 };
  }) };
}

export function moveMapNode(map: BackgroundMap, id: string, delta: BackgroundPoint): BackgroundMap {
  const selected = map.nodes.find(node => node.id === id);
  if (!selected || selected.locked) return map;
  if (selected.type === 'space') return transformMapSpace(map, { ...selected, x: selected.x + delta.x, y: selected.y + delta.y });
  return { ...map, nodes: map.nodes.map(node => node.id === id ? { ...node, x: node.x + delta.x, y: node.y + delta.y } : node) };
}

export function removeMapNode(map: BackgroundMap, id: string): BackgroundMap {
  return { ...map, nodes: map.nodes.filter(node => node.id !== id).map(node => node.type !== 'space' && node.spaceId === id ? { ...node, spaceId: null } : node) };
}

export function polygonSpace(points: BackgroundPoint[]): Pick<BackgroundSpace, 'x' | 'y' | 'width' | 'height' | 'points'> | null {
  if (points.length < 3) return null;
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
  const width = Math.max(...points.map(point => point.x)) - x, height = Math.max(...points.map(point => point.y)) - y;
  const area = Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
  if (width < 10 || height < 10 || area < 1) return null;
  return { x, y, width, height, points: points.map(point => ({ x: (point.x - x) / width, y: (point.y - y) / height })) };
}

export function containsPoint(space: BackgroundSpace, point: BackgroundPoint): boolean {
  const local = rotate({ x: point.x - space.x - space.width / 2, y: point.y - space.y - space.height / 2 }, -space.rotation);
  const x = local.x / space.width + 0.5, y = local.y / space.height + 0.5;
  if (space.shape === 'ellipse') return (x - 0.5) ** 2 * 4 + (y - 0.5) ** 2 * 4 <= 1;
  if (space.shape !== 'polygon') return x >= 0 && y >= 0 && x <= 1 && y <= 1;
  let inside = false;
  for (let index = 0, previous = space.points.length - 1; index < space.points.length; previous = index++) {
    const a = space.points[index], b = space.points[previous];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Add a camera at the fixed spawn point, whatever is clicked, selected or in view.
 * It joins a space only when exactly one space contains that point; overlaps stay unassigned.
 */
export function addMapCamera(map: BackgroundMap, id: string): { map: BackgroundMap; camera: BackgroundCamera } {
  const created = createMapCamera(id, nextMapCameraName(map.nodes));
  const containing = map.nodes.filter(node => node.type === 'space' && containsPoint(node, created));
  const camera: BackgroundCamera = containing.length === 1 ? { ...created, spaceId: containing[0].id } : created;
  return { map: { ...map, nodes: [...map.nodes, camera] }, camera };
}

/** Result of a 3D gizmo: world position and orientation of the node root, and scale relative to the stored node. */
export type NodeWorldPoseInput = { position: Vec3; quaternion: QuaternionValue; scale: Vec3 };

const CHANGE_EPSILON = 1e-6, PLAN_LIMIT = 100000, MIN_PLAN_SIZE = 10, VERTICAL_SNAP = 0.0005;
const round3 = (value: number) => Math.round(value * 1000) / 1000 + 0;
/** The value to store, or null when the axis was not really touched and the saved field must stay as it is. */
function settle(value: number, current: number, min: number, max: number): number | null {
  if (!Number.isFinite(value) || Math.abs(value - current) <= CHANGE_EPSILON) return null;
  const result = round3(clamp(value, min, max));
  return result === current ? null : result;
}
function settleTurn(value: number, current: number, normalize: (degrees: number) => number): number | null {
  if (!Number.isFinite(value) || Math.abs(normalizeSignedDegrees(value - current)) <= CHANGE_EPSILON) return null;
  const result = normalize(round3(value));
  return Math.abs(normalizeSignedDegrees(result - current)) <= CHANGE_EPSILON ? null : result;
}
/**
 * `seen` is the stored pitch as the reader reports it. A hair from straight up or down it collapses
 * onto the pole, so reading that same pole back means the tilt was not touched.
 */
function settlePitch(value: number, current: number, seen: number): number | null {
  if (!Number.isFinite(value) || Math.abs(value - current) <= CHANGE_EPSILON || value === seen) return null;
  const { min, max } = MAP_SPATIAL_LIMITS.pitch;
  const result = value >= max - VERTICAL_SNAP ? max : value <= min + VERTICAL_SNAP ? min : round3(value);
  return result === current ? null : result;
}
const settled = <T extends Record<string, number | null>>(values: T) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null)) as { [K in keyof T]?: number };
const replaceNode = (map: BackgroundMap, next: BackgroundCamera | BackgroundSymbol): BackgroundMap =>
  ({ ...map, nodes: map.nodes.map(node => node.id === next.id ? next : node) });

/**
 * Convert a 3D gizmo result into node fields. Only values that really changed are written, so an
 * axis the gizmo did not touch keeps its saved number and optional vertical fields are not invented.
 * Unknown or locked nodes, and results without any change, return `initialMap` itself.
 */
export function applyNodeWorldPose(initialMap: BackgroundMap, id: string, pose: NodeWorldPoseInput): BackgroundMap {
  const node = initialMap.nodes.find(item => item.id === id);
  if (!node || node.locked) return initialMap;
  const { position, quaternion, scale } = pose, limits = MAP_SPATIAL_LIMITS;
  const elevation = settle(position.y, nodeElevation(node), limits.elevation.min, limits.elevation.max);
  if (node.type === 'camera') {
    const current = cameraAngles(node), read = cameraAnglesFromOrientation(quaternion, current), seen = cameraAnglesFromOrientation(cameraOrientation(current), current);
    const changes = settled({ x: settle(position.x, node.x, -PLAN_LIMIT, PLAN_LIMIT), y: settle(position.z, node.y, -PLAN_LIMIT, PLAN_LIMIT),
      angle: settleTurn(read.angle, current.angle, normalizeDegrees), elevation,
      pitch: settlePitch(read.pitch, current.pitch, seen.pitch), roll: settleTurn(read.roll, current.roll, normalizeSignedDegrees) });
    return Object.keys(changes).length ? replaceNode(initialMap, { ...node, ...changes }) : initialMap;
  }
  // The root is the centre of the base, so a resize keeps that centre where the gizmo left it.
  const current = nodeAngles(node), read = nodeAnglesFromOrientation(quaternion, current), volumeHeight = nodeVolumeHeight(node);
  const width = settle(node.width * scale.x, node.width, MIN_PLAN_SIZE, PLAN_LIMIT), height = settle(node.height * scale.z, node.height, MIN_PLAN_SIZE, PLAN_LIMIT);
  const box = { x: settle(position.x - (width ?? node.width) / 2, node.x, -PLAN_LIMIT, PLAN_LIMIT), y: settle(position.z - (height ?? node.height) / 2, node.y, -PLAN_LIMIT, PLAN_LIMIT),
    width, height, rotation: settleTurn(read.rotation, current.rotation, normalizeDegrees), elevation,
    volumeHeight: settle(volumeHeight * scale.y, volumeHeight, limits.volumeHeight.min, limits.volumeHeight.max) };
  if (node.type === 'space') {
    // Spaces stay upright: only the heading of the result is read, and members follow through the one shared carry.
    const changes = settled(box);
    if (!Object.keys(changes).length) return initialMap;
    const carried = transformMapSpace(initialMap, { ...node, ...changes });
    // The plan carry has no bounds of its own. A member it sweeps past the saved limit stops there, as the space does.
    const held = (value: number, before: number) => value === before ? value : clamp(value, -PLAN_LIMIT, PLAN_LIMIT);
    return { ...carried, nodes: carried.nodes.map((item, index) => {
      const before = initialMap.nodes[index], x = held(item.x, before.x), y = held(item.y, before.y);
      return x === item.x && y === item.y ? item : { ...item, x, y };
    }) };
  }
  const seen = nodeAnglesFromOrientation(nodeOrientation(current), current);
  const changes = settled({ ...box, pitch: settlePitch(read.pitch, current.pitch, seen.pitch), roll: settleTurn(read.roll, current.roll, normalizeSignedDegrees) });
  return Object.keys(changes).length ? replaceNode(initialMap, { ...node, ...changes }) : initialMap;
}

/** Cameras and symbols sharing a plan spot with the given one, in map order, so each can be picked in turn. */
export function stackedMapNodeIds(map: BackgroundMap, id: string, tolerance = 12): string[] {
  const target = map.nodes.find(node => node.id === id);
  if (!target) return [];
  if (target.type === 'space') return [id];
  const anchor = (node: BackgroundCamera | BackgroundSymbol): BackgroundPoint =>
    node.type === 'symbol' ? { x: node.x + node.width / 2, y: node.y + node.height / 2 } : node;
  const origin = anchor(target), ids: string[] = [];
  for (const node of map.nodes) {
    if (node.type === 'space') continue;
    const point = anchor(node);
    if (node.id === id || Math.hypot(point.x - origin.x, point.y - origin.y) <= tolerance) ids.push(node.id);
  }
  return ids;
}
