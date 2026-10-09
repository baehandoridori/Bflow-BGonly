import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from './types.ts';
import { MAP_SPATIAL_LIMITS, cameraAngles, cameraAnglesFromOrientation, cameraOrientation, createMapCamera, nextMapCameraName, nodeAngles, nodeAnglesFromOrientation,
  nodeElevation, nodeOrientation, nodePlanOutline, nodeVolumeHeight, normalizeDegrees, normalizeSignedDegrees } from './mapSpatial.ts';
import type { QuaternionValue, Vec3 } from './mapSpatial.ts';

function rotate(point: BackgroundPoint, angle: number): BackgroundPoint {
  const radians = angle * Math.PI / 180;
  return { x: point.x * Math.cos(radians) - point.y * Math.sin(radians), y: point.x * Math.sin(radians) + point.y * Math.cos(radians) };
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The rotated top-left corner: the point a resize keeps fixed. Only for turned nodes. An unturned one
 * uses its stored x/y as they are, since `x + width / 2 - width / 2` can lose the last digit.
 */
function resizeOrigin(node: BackgroundSpace | BackgroundSymbol): BackgroundPoint {
  const cornerOffset = rotate({ x: -node.width / 2, y: -node.height / 2 }, node.rotation);
  return { x: node.x + node.width / 2 + cornerOffset.x, y: node.y + node.height / 2 + cornerOffset.y };
}

/** A plan point in the node's own unrotated frame, measured from its rotated top-left corner (the point a resize keeps fixed). */
export function nodeLocalPoint(node: BackgroundSpace | BackgroundSymbol, world: BackgroundPoint): BackgroundPoint {
  if (node.rotation === 0) return { x: world.x - node.x, y: world.y - node.y };
  const origin = resizeOrigin(node);
  return rotate({ x: world.x - origin.x, y: world.y - origin.y }, -node.rotation);
}

/** Resize to a local size (clamped to 10..100000) while the rotated top-left stays fixed. */
export function resizeSpaceTo<T extends BackgroundSpace | BackgroundSymbol>(space: T, width: number, height: number): T {
  const size = { width: clamp(width, 10, 100000), height: clamp(height, 10, 100000) };
  if (space.rotation === 0) return { ...space, ...size };
  const origin = resizeOrigin(space), centerOffset = rotate({ x: size.width / 2, y: size.height / 2 }, space.rotation);
  return { ...space, ...size, x: origin.x + centerOffset.x - size.width / 2, y: origin.y + centerOffset.y - size.height / 2 };
}

/** Resize from the bottom-right handle while the rotated top-left stays fixed. */
export function resizeSpace<T extends BackgroundSpace | BackgroundSymbol>(space: T, pointer: BackgroundPoint): T {
  const local = nodeLocalPoint(space, pointer);
  return resizeSpaceTo(space, local.x, local.y);
}

/** Plan position of the bottom-right corner: the point the resize handle stands for. */
export function nodeResizeCorner(node: BackgroundSpace | BackgroundSymbol): BackgroundPoint {
  if (node.rotation === 0) return { x: node.x + node.width, y: node.y + node.height };
  const origin = resizeOrigin(node), offset = rotate({ x: node.width, y: node.height }, node.rotation);
  return { x: origin.x + offset.x, y: origin.y + offset.y };
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

/** Replace one node. Members of a space do NOT follow: use transformMapSpace when a space moves, turns or scales as a whole. */
export function replaceMapNode(map: BackgroundMap, next: BackgroundNode): BackgroundMap {
  return { ...map, nodes: map.nodes.map(node => node.id === next.id ? next : node) };
}

export function moveMapNode(map: BackgroundMap, id: string, delta: BackgroundPoint): BackgroundMap {
  const selected = map.nodes.find(node => node.id === id);
  if (!selected || selected.locked) return map;
  if (selected.type === 'space') return transformMapSpace(map, { ...selected, x: selected.x + delta.x, y: selected.y + delta.y });
  return { ...map, nodes: map.nodes.map(node => node.id === id ? { ...node, x: node.x + delta.x, y: node.y + delta.y } : node) };
}

/** Move a node so that its stored x/y become exactly `position`. Members of a space follow as in moveMapNode. Unknown or locked nodes return `map`. */
export function placeMapNode(map: BackgroundMap, id: string, position: BackgroundPoint): BackgroundMap {
  const selected = map.nodes.find(node => node.id === id);
  if (!selected || selected.locked) return map;
  if (selected.type === 'space') return transformMapSpace(map, { ...selected, x: position.x, y: position.y });
  return replaceMapNode(map, { ...selected, x: position.x, y: position.y });
}

/**
 * Moves several nodes by one delta in one step. Locked nodes stay. A space carries its unlocked members as in
 * moveMapNode, and a listed node that such a space carries is not moved a second time. With `anchor`, that node's
 * stored x/y become exactly `anchor.position` instead. Returns `map` itself when nothing moves.
 */
export function moveMapNodes(map: BackgroundMap, ids: readonly string[], delta: BackgroundPoint,
  anchor?: { id: string; position: BackgroundPoint }): BackgroundMap {
  const moving = map.nodes.filter(node => ids.includes(node.id) && !node.locked);
  if (!moving.length) return map;
  const place = (node: BackgroundNode): BackgroundPoint => anchor?.id === node.id
    ? { x: anchor.position.x, y: anchor.position.y } : { x: node.x + delta.x, y: node.y + delta.y };
  const carrying = new Set<string>();
  let next = map;
  for (const node of moving) if (node.type === 'space') { next = transformMapSpace(next, { ...node, ...place(node) }); carrying.add(node.id); }
  // What a moving space carries has gone with it, listed or not: only the rest is moved here.
  const alone = new Set(moving.filter(node => node.type !== 'space' && !(node.spaceId !== null && carrying.has(node.spaceId))).map(node => node.id));
  return alone.size ? { ...next, nodes: next.nodes.map(node => alone.has(node.id) ? { ...node, ...place(node) } : node) } : next;
}

/**
 * The map with the node renamed to the trimmed name. Blank or unchanged names, unknown and locked nodes return `map` itself.
 * Unchanged is judged between the trimmed names: a stored name can carry outer whitespace (the inspector keeps what was typed),
 * and a name box nothing was typed into hands that name back.
 */
export function renameMapNode(map: BackgroundMap, id: string, name: string): BackgroundMap {
  const node = map.nodes.find(item => item.id === id), trimmed = name.trim();
  if (!node || node.locked || !trimmed || trimmed === node.name.trim()) return map;
  return replaceMapNode(map, { ...node, name: trimmed });
}

/** Plan point the name box of a node is centred on: the box centre of a space or symbol, the position of a camera. */
export function nodeNameAnchor(node: BackgroundNode): BackgroundPoint {
  return node.type === 'camera' ? { x: node.x, y: node.y } : { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

export function removeMapNode(map: BackgroundMap, id: string): BackgroundMap {
  return { ...map, nodes: map.nodes.filter(node => node.id !== id).map(node => node.type !== 'space' && node.spaceId === id ? { ...node, spaceId: null } : node) };
}

/**
 * Removes the listed nodes in one step. Locked nodes stay, as in moveMapNodes. Members of a removed space that stay
 * are detached from it, as in removeMapNode. Returns `map` itself when nothing is removed.
 */
export function removeMapNodes(map: BackgroundMap, ids: readonly string[]): BackgroundMap {
  const removed = new Set(map.nodes.filter(node => ids.includes(node.id) && !node.locked).map(node => node.id));
  if (!removed.size) return map;
  return { ...map, nodes: map.nodes.filter(node => !removed.has(node.id))
    .map(node => node.type !== 'space' && node.spaceId !== null && removed.has(node.spaceId) ? { ...node, spaceId: null } : node) };
}

/** Sets the lock of every listed node that differs. Returns `map` itself when nothing changes. */
export function lockMapNodes(map: BackgroundMap, ids: readonly string[], locked: boolean): BackgroundMap {
  const differs = (node: BackgroundNode) => node.locked !== locked && ids.includes(node.id);
  return map.nodes.some(differs) ? { ...map, nodes: map.nodes.map(node => differs(node) ? { ...node, locked } : node) } : map;
}

/** The area an outline encloses, whichever way round its points run. */
function outlineArea(points: readonly BackgroundPoint[]): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

export function polygonSpace(points: BackgroundPoint[]): Pick<BackgroundSpace, 'x' | 'y' | 'width' | 'height' | 'points'> | null {
  if (points.length < 3) return null;
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
  const width = Math.max(...points.map(point => point.x)) - x, height = Math.max(...points.map(point => point.y)) - y;
  if (width < 10 || height < 10 || outlineArea(points) < 1) return null;
  return { x, y, width, height, points: points.map(point => ({ x: (point.x - x) / width, y: (point.y - y) / height })) };
}

/** Saved limits of a plan box: no position and no side beyond the first, no side under the second. */
const PLAN_LIMIT = 100000, MIN_PLAN_SIZE = 10;
/**
 * A polygon stores three to this many points. The + handles (`mapPlanEdit.ts`, which does not import this module)
 * and the saved-data check (`validateBackgroundEntity` in `domain.ts`) hold the same number.
 */
const POLYGON_POINT_LIMIT = 200;
/** Points closer together than this are one point. */
const SAME_POINT = 1e-6;

/**
 * A polygon space rebuilt from absolute plan points. The rotation is kept, the box becomes the bounding box of the
 * points in the space's own unrotated frame, and every point is normalised against it, so each point keeps its plan
 * position. Null when the result cannot be stored.
 */
export function polygonFromWorldPoints(space: BackgroundSpace, points: readonly BackgroundPoint[]): BackgroundSpace | null {
  if (points.length < 3 || points.length > POLYGON_POINT_LIMIT || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const centre = { x: space.x + space.width / 2, y: space.y + space.height / 2 };
  const local = points.map(point => rotate({ x: point.x - centre.x, y: point.y - centre.y }, -space.rotation));
  const xs = local.map(point => point.x), ys = local.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = maxX - minX, height = maxY - minY;
  // Each limit is asked for as what passes, so a value that is no number fails it too.
  const storable = (length: number) => length >= MIN_PLAN_SIZE && length <= PLAN_LIMIT;
  if (!storable(width) || !storable(height) || !(outlineArea(local) >= 1)) return null;
  const middle = rotate({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, space.rotation);
  const x = centre.x + middle.x - width / 2, y = centre.y + middle.y - height / 2;
  if (!(Math.abs(x) <= PLAN_LIMIT && Math.abs(y) <= PLAN_LIMIT)) return null;
  return { ...space, x, y, width, height, points: local.map(point => ({ x: clamp((point.x - minX) / width, 0, 1), y: clamp((point.y - minY) / height, 0, 1) })) };
}

/** The plan points of an unlocked polygon space in stored order, when `index` is one of them. */
function polygonPlanPoints(space: BackgroundSpace, index: number): BackgroundPoint[] | null {
  // With fewer than three stored points the plan outline is that of the box, not of those points.
  if (space.shape !== 'polygon' || space.locked || space.points.length < 3) return null;
  return Number.isInteger(index) && index >= 0 && index < space.points.length ? nodePlanOutline(space) : null;
}
const samePoint = (a: BackgroundPoint, b: BackgroundPoint) => Math.hypot(a.x - b.x, a.y - b.y) < SAME_POINT;

/** Moves one point to `point`. Null on a point beside it: the edge between the two would have no length. */
export function movePolygonVertex(space: BackgroundSpace, index: number, point: BackgroundPoint): BackgroundSpace | null {
  const points = polygonPlanPoints(space, index);
  if (!points) return null;
  // Where it already stands, the space is left as it is: rebuilt from its plan points every stored value would
  // shift in its last digits, and a drag that came back would stay as a change.
  if (samePoint(point, points[index])) return space;
  const count = points.length;
  if (samePoint(point, points[(index + count - 1) % count]) || samePoint(point, points[(index + 1) % count])) return null;
  return polygonFromWorldPoints(space, points.map((item, at) => at === index ? point : item));
}

/** Adds `point` between `index` and the next point. Null on either of the two. */
export function insertPolygonVertex(space: BackgroundSpace, index: number, point: BackgroundPoint): BackgroundSpace | null {
  const points = polygonPlanPoints(space, index);
  if (!points || points.length >= POLYGON_POINT_LIMIT) return null;
  if (samePoint(point, points[index]) || samePoint(point, points[(index + 1) % points.length])) return null;
  return polygonFromWorldPoints(space, [...points.slice(0, index + 1), point, ...points.slice(index + 1)]);
}

/** Removes one point. Null when only three are left. */
export function removePolygonVertex(space: BackgroundSpace, index: number): BackgroundSpace | null {
  const points = polygonPlanPoints(space, index);
  if (!points || points.length <= 3) return null;
  return polygonFromWorldPoints(space, points.filter((_, at) => at !== index));
}

/** A rectangle as a four-point polygon with the same outline. Null for other shapes and for locked spaces. */
export function rectToPolygon(space: BackgroundSpace): BackgroundSpace | null {
  if (space.shape !== 'rect' || space.locked) return null;
  // The corners in the order the outline of a rectangle has them.
  return { ...space, shape: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
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

const CHANGE_EPSILON = 1e-6, VERTICAL_SNAP = 0.0005;
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
    return Object.keys(changes).length ? replaceMapNode(initialMap, { ...node, ...changes }) : initialMap;
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
  return Object.keys(changes).length ? replaceMapNode(initialMap, { ...node, ...changes }) : initialMap;
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
