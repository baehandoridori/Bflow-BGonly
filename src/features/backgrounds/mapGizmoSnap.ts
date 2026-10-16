import type { Map3DSnapRequest } from './mapCanvas.ts';
import type { NodeWorldPoseInput } from './mapGeometry.ts';
import { MAP_SNAP, collectSnapCandidates, snapMove, snapRotation, snapTravellingIds } from './mapSnap.ts';
import {
  MAP_SPATIAL_LIMITS, cameraAngles, cameraAnglesFromOrientation, cameraOrientation, isRoadSpace, nodeAngles, nodeAnglesFromOrientation,
  nodeElevation, nodeOrientation, nodeVolumeHeight, normalizeDegrees, normalizeSignedDegrees,
} from './mapSpatial.ts';
import type { BackgroundMap, BackgroundNode, BackgroundPoint } from './types.ts';

/**
 * Snapping of a handle drag in 3D, as on the plan: the editor hands this to the 3D view while its snap is on, and the
 * 3D view leaves it out while Alt is held. Pure: the same request gives the same pose whatever came before.
 *
 * A move sticks the way the plan sticks (edges and middles of what is near, else whole numbers), and a height sticks to
 * the floors and tops of the map, else a whole number. A turn stops at the quarter turns of the plan (and at level and
 * either vertical for a tilt), else whole degrees. A size is a whole number. Shift: steps of `move`, `turn` and `size`.
 * Only what the handle in hand drives is touched: an axis it does not move keeps the pose the handles gave.
 */
export const MAP_GIZMO_SNAP = { move: 10, turn: 15, size: 10, pitchStops: [-90, 0, 90], rollStops: [-90, 0, 90, 180] } as const;
/** The least width and depth a box may have, as on the plan. */
const LEAST_LENGTH = 10;

/** Lines of the same level count as one. */
const TIE = 1e-9;
const whole = (value: number) => Math.round(value) + 0;
const stepOf = (value: number, step: number) => Math.round(value / step) * step + 0;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The pose of the dragged root as it may stand at this step, or null where nothing is snapped (no such node, a locked one, no handle). */
export function snapGizmoPose(request: Map3DSnapRequest): NodeWorldPoseInput | null {
  const node = request.map.nodes.find(item => item.id === request.id);
  if (!node || node.locked || !request.axis) return null;
  if (request.mode === 'translate') return snapGizmoMove(request.map, node, request);
  if (request.mode === 'rotate') return snapGizmoTurn(node, request);
  return node.type === 'camera' ? null : snapGizmoSize(node, request);
}

/** How far a screen distance of the plan's snap reaches at the node: nothing when the size of a pixel there is unknown. */
const reachOf = (pixels: number, unitsPerPixel: number) => Number.isFinite(unitsPerPixel) && unitsPerPixel > 0 ? pixels * unitsPerPixel : 0;

function snapGizmoMove(map: BackgroundMap, node: BackgroundNode, request: Map3DSnapRequest): NodeWorldPoseInput {
  const { start, pose, axis, big, unitsPerPixel } = request, moves = { x: axis.includes('X'), y: axis.includes('Y'), z: axis.includes('Z') };
  const position = { ...pose.position }, tolerance = reachOf(MAP_SNAP.tolerancePx, unitsPerPixel);
  if (moves.x || moves.z) {
    // The stored point of the node (the corner of a box, the camera itself) moves as far as the root did, which stands this far from it.
    const offset = { x: start.position.x - node.x, y: start.position.z - node.y };
    const delta = { x: moves.x ? pose.position.x - start.position.x : 0, y: moves.z ? pose.position.z - start.position.z : 0 };
    let stored: BackgroundPoint;
    if (big) stored = { x: stepOf(node.x + delta.x, MAP_GIZMO_SNAP.move), y: stepOf(node.y + delta.y, MAP_GIZMO_SNAP.move) };
    else {
      const candidates = collectSnapCandidates(map, snapTravellingIds(map, [node.id]));
      const stuck = snapMove(map, [node.id], node.id, delta, candidates, tolerance, reachOf(MAP_SNAP.reachPx, unitsPerPixel));
      stored = stuck ? stuck.position : { x: whole(node.x + delta.x), y: whole(node.y + delta.y) };
    }
    if (moves.x) position.x = stored.x + offset.x;
    if (moves.z) position.z = stored.y + offset.y;
  }
  if (moves.y) position.y = snapLevel(map, node, pose.position.y, big, tolerance);
  return { ...pose, position };
}

/**
 * The floor a node is lifted or lowered to. Its floor, and the top of a box, stick to level 0 and to the floor and the
 * top of everything else (a camera's floor is its height): the nearest within `tolerance`, else a whole number.
 */
function snapLevel(map: BackgroundMap, node: BackgroundNode, floor: number, big: boolean, tolerance: number): number {
  const { min, max } = MAP_SPATIAL_LIMITS.elevation;
  if (!Number.isFinite(floor)) return floor;
  if (big) return clamp(stepOf(floor, MAP_GIZMO_SNAP.move), min, max);
  const top = (item: BackgroundNode) => item.type === 'camera' || (item.type === 'space' && isRoadSpace(item)) ? null : nodeElevation(item) + nodeVolumeHeight(item);
  const own = top(node), offsets = own === null ? [0] : [0, own - nodeElevation(node)];
  const travelling = snapTravellingIds(map, [node.id]), levels = [0];
  for (const item of map.nodes) {
    if (travelling.has(item.id)) continue;
    const level = nodeElevation(item), above = top(item);
    if (Number.isFinite(level)) levels.push(level);
    if (above !== null && Number.isFinite(above)) levels.push(above);
  }
  let best: number | null = null, least = Infinity;
  if (tolerance > 0) for (const offset of offsets) for (const level of levels) {
    const distance = Math.abs(floor + offset - level);
    if (distance <= tolerance && distance < least - TIE) { best = level - offset; least = distance; }
  }
  return clamp(best ?? whole(floor), min, max);
}

/** A heading: a quarter turn within the plan's capture, else whole degrees; Shift, steps of `turn`. */
function snapHeading(degrees: number, big: boolean): number {
  if (big) return normalizeDegrees(stepOf(degrees, MAP_GIZMO_SNAP.turn));
  const stopped = snapRotation(degrees);
  return (MAP_SNAP.rotationStops as readonly number[]).includes(stopped) ? stopped : normalizeDegrees(whole(degrees));
}
/** A tilt or a roll: one of `stops` within the plan's capture, else whole degrees; Shift, steps of `turn`. */
function snapAngle(degrees: number, stops: readonly number[], big: boolean): number {
  if (big) return stepOf(degrees, MAP_GIZMO_SNAP.turn);
  const stop = stops.find(value => Math.abs(normalizeSignedDegrees(degrees - value)) <= MAP_SNAP.rotationCapture);
  return stop ?? whole(degrees);
}

/** A change of an angle smaller than this is the noise of the arithmetic, not a turn. */
const TURN_NOISE = 1e-6;
/**
 * A turn about one ring. Each angle the turn changed is snapped and an angle it left alone stays as it was: a ring
 * mostly drives one (the heading, the tilt or the roll), but about a tilted or rolled frame it moves the others a little,
 * and a camera looking straight up or down reads a turn about its line of sight as a change of heading.
 */
function snapGizmoTurn(node: BackgroundNode, request: Map3DSnapRequest): NodeWorldPoseInput | null {
  const { pose, axis, big } = request;
  if (axis !== 'X' && axis !== 'Y' && axis !== 'Z') return null;
  const changed = (before: number, after: number) => Math.abs(normalizeSignedDegrees(after - before)) > TURN_NOISE;
  const tilt = (before: number, after: number) => changed(before, after) ? clamp(snapAngle(after, MAP_GIZMO_SNAP.pitchStops, big), MAP_SPATIAL_LIMITS.pitch.min, MAP_SPATIAL_LIMITS.pitch.max) + 0 : after;
  const roll = (before: number, after: number) => changed(before, after) ? normalizeSignedDegrees(snapAngle(after, MAP_GIZMO_SNAP.rollStops, big)) : after;
  const heading = (before: number, after: number) => changed(before, after) ? snapHeading(after, big) : after;
  if (node.type === 'camera') {
    const before = cameraAngles(node), read = cameraAnglesFromOrientation(pose.quaternion, before);
    return { ...pose, quaternion: cameraOrientation({ angle: heading(before.angle, read.angle), pitch: tilt(before.pitch, read.pitch), roll: roll(before.roll, read.roll) }) };
  }
  const before = nodeAngles(node), read = nodeAnglesFromOrientation(pose.quaternion, before);
  // A space stays upright: only its heading is read back (applyNodeWorldPose), so only its heading is snapped.
  if (node.type === 'space') return { ...pose, quaternion: nodeOrientation({ ...read, rotation: snapHeading(read.rotation, big) }) };
  return { ...pose, quaternion: nodeOrientation({ rotation: heading(before.rotation, read.rotation), pitch: tilt(before.pitch, read.pitch), roll: roll(before.roll, read.roll) }) };
}

/** A stretch: each length the handle drives is a whole number (Shift: a step of `size`), never under the least a box may have. */
function snapGizmoSize(node: Exclude<BackgroundNode, { type: 'camera' }>, request: Map3DSnapRequest): NodeWorldPoseInput {
  const { pose, axis, big } = request, scale = { ...pose.scale };
  const length = (value: number, least: number) => Math.max(least, big ? stepOf(value, MAP_GIZMO_SNAP.size) : whole(value));
  const height = nodeVolumeHeight(node);
  if (axis.includes('X') && node.width > 0) scale.x = length(node.width * pose.scale.x, LEAST_LENGTH) / node.width;
  if (axis.includes('Z') && node.height > 0) scale.z = length(node.height * pose.scale.z, LEAST_LENGTH) / node.height;
  // A road has no walls: its box height is never written (applyNodeWorldPose), so it is not snapped either.
  if (axis.includes('Y') && !(node.type === 'space' && isRoadSpace(node)) && height > 0) scale.y = length(height * pose.scale.y, MAP_SPATIAL_LIMITS.volumeHeight.min) / height;
  return { ...pose, scale };
}
