import type { BackgroundMap, BackgroundPoint, BackgroundSpace } from './types.ts';
import { insertPolygonVertex, moveMapNode, movePolygonVertex, nodeResizeCorner, placeMapNode, replaceMapNode, resizeSpace, resizeSpaceTo, transformMapSpace } from './mapGeometry.ts';
import { nodePlanOutline, normalizeDegrees } from './mapSpatial.ts';
import { collectSnapCandidates, snapMove, snapPoint, snapResize, snapRotation, snapTravellingIds, withVertexNeighbours } from './mapSnap.ts';
import type { SnapCandidates, SnapGuide } from './mapSnap.ts';

export type PlanGesture =
  | { mode: 'move' | 'resize' | 'rotate'; nodeId: string }
  | { mode: 'draw'; node: BackgroundSpace }
  /** A point of a polygon, or with `insert` the new point pulled out of the edge from `index` to the next point. */
  | { mode: 'vertex'; nodeId: string; index: number; insert: boolean };
export type PlanGestureSnap = { candidates: SnapCandidates; /** map units */ tolerance: number;
  /** Map units: how far away on the other axis a target may be and still count (move and resize). */ reach: number };
export type PlanGesturePreview = { map: BackgroundMap; guides: SnapGuide[] };

/** Plan angle in degrees of the direction from `center` to `point`. */
const bearing = (point: BackgroundPoint, center: BackgroundPoint) => Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI;

/**
 * What a point handle of a polygon stands for and the two points beside it: a point between its neighbours,
 * or the middle of an edge between its two ends. Null when the gesture names no point the point edits would take:
 * then nothing is beside it either, and no line is collected for a drag that shows nothing.
 */
function vertexHandle(gesture: Extract<PlanGesture, { mode: 'vertex' }>, initial: BackgroundMap): { space: BackgroundSpace; base: BackgroundPoint; beside: BackgroundPoint[] } | null {
  const space = initial.nodes.find(item => item.id === gesture.nodeId), { index } = gesture;
  // Locked it does not change, and with fewer than three stored points the plan outline is that of the box, not of those points.
  if (space?.type !== 'space' || space.shape !== 'polygon' || space.locked || space.points.length < 3) return null;
  const outline = nodePlanOutline(space), count = outline.length;
  if (!Number.isInteger(index) || index < 0 || index >= count) return null;
  const point = outline[index], next = outline[(index + 1) % count];
  return gesture.insert ? { space, base: { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }, beside: [point, next] }
    : { space, base: point, beside: [outline[(index + count - 1) % count], next] };
}

/** Snap targets of one gesture, from the map as it was at the press. */
export function planGestureCandidates(gesture: PlanGesture, initial: BackgroundMap): SnapCandidates {
  // Drawing is not snapped, and a turn is caught by its stops alone: neither uses a line.
  if (gesture.mode === 'draw' || gesture.mode === 'rotate') return { x: [], y: [], points: [] };
  // A point sticks to two things only: the corners of the other spaces, and the x and y of the points beside it.
  // No edge or centre line of another node and no border of the plan, or it would catch on every chair in the room.
  if (gesture.mode === 'vertex') return withVertexNeighbours(
    { x: [], y: [], points: collectSnapCandidates(initial, new Set([gesture.nodeId])).points }, vertexHandle(gesture, initial)?.beside ?? []);
  // Everything but the node and what travels with it. What is near is told apart at each pointer position.
  return collectSnapCandidates(initial, snapTravellingIds(initial, [gesture.nodeId]));
}

/**
 * The draft a gesture shows for one pointer position. Pure: the same arguments give the same result whatever
 * was previewed before. `snap` null is the free drag: nothing sticks and nothing is rounded. Returns null when
 * this position cannot be shown (the caller keeps the last preview).
 */
export function previewPlanGesture(gesture: PlanGesture, initial: BackgroundMap, start: BackgroundPoint,
  point: BackgroundPoint, snap: PlanGestureSnap | null): PlanGesturePreview | null {
  const delta = { x: point.x - start.x, y: point.y - start.y };
  // Drawing is the press and the pointer as they are, whatever `snap` is.
  if (gesture.mode === 'draw') {
    const drawn = { ...gesture.node, x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.max(10, Math.abs(delta.x)), height: Math.max(10, Math.abs(delta.y)) };
    return { map: { ...initial, nodes: [...initial.nodes, drawn] }, guides: [] };
  }
  if (gesture.mode === 'vertex') {
    const handle = vertexHandle(gesture, initial);
    if (!handle) return null;
    // The point travels as far as the pointer did, from where its handle stands: where the handle was pressed
    // does not enter the result, so a point that was lined up is not put off by the press alone.
    const free = { x: handle.base.x + delta.x, y: handle.base.y + delta.y }, stuck = snap && snapPoint(free, snap.candidates, snap.tolerance);
    const target = stuck ? stuck.point : free;
    const shaped = gesture.insert ? insertPolygonVertex(handle.space, gesture.index, target) : movePolygonVertex(handle.space, gesture.index, target);
    // Only the space is swapped: its members stay where they are, which the whole-space transform would not do.
    return shaped && { map: replaceMapNode(initial, shaped), guides: stuck ? stuck.guides : [] };
  }
  const node = initial.nodes.find(item => item.id === gesture.nodeId);
  if (!node) return null;
  if (gesture.mode === 'move') {
    // A locked node does not move, so it is not snapped: no guide shows for a node that stayed where it was.
    const stuck = snap && !node.locked && snapMove(initial, [node.id], node.id, delta, snap.candidates, snap.tolerance, snap.reach);
    // A snapped position is stored as it is, not reached by adding the travel: a stuck edge keeps the very
    // value of its target, and the other axis is an exact whole number.
    return stuck ? { map: placeMapNode(initial, node.id, stuck.position), guides: stuck.guides } : { map: moveMapNode(initial, node.id, delta), guides: [] };
  }
  if (gesture.mode === 'resize') {
    if (node.type === 'camera') return { map: initial, guides: [] };
    // The handle stands for the bottom-right corner, which travels as far as the pointer did: where the handle
    // was pressed does not enter the result, so the corner never jumps to the pointer.
    const handle = nodeResizeCorner(node), corner = { x: handle.x + delta.x, y: handle.y + delta.y };
    // A locked node is not snapped here either.
    const stuck = snap && !node.locked && snapResize(node, corner, snap.candidates, snap.tolerance, snap.reach);
    // A free drag of an unturned node adds the travel to its stored size: `x + width + travel - x` can lose the
    // last digit, and then a drag that came back, or the length that was not dragged, would stay as a change.
    const resized = stuck ? stuck.node : node.rotation === 0 ? resizeSpaceTo(node, node.width + delta.x, node.height + delta.y) : resizeSpace(node, corner);
    return { map: resized.type === 'space' ? transformMapSpace(initial, resized) : replaceMapNode(initial, resized), guides: stuck ? stuck.guides : [] };
  }
  // Snapping, a turn within reach of a quarter turn is that quarter turn; any other angle stays as it was computed.
  const turn = (degrees: number) => snap ? snapRotation(normalizeDegrees(degrees)) : normalizeDegrees(degrees);
  // Only the horizontal direction changes: height, tilt and frame of a camera stay as they are.
  if (node.type === 'camera') return { map: replaceMapNode(initial, { ...node, angle: turn(bearing(point, node)) }), guides: [] };
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  const rotation = turn(node.rotation + bearing(point, center) - bearing(start, center));
  return { map: node.type === 'space' ? transformMapSpace(initial, { ...node, rotation }) : replaceMapNode(initial, { ...node, rotation }), guides: [] };
}
