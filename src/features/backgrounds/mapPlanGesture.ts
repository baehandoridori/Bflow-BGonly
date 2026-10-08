import type { BackgroundMap, BackgroundPoint, BackgroundSpace } from './types.ts';
import { moveMapNode, nodeResizeCorner, placeMapNode, replaceMapNode, resizeSpace, resizeSpaceTo, transformMapSpace } from './mapGeometry.ts';
import { normalizeDegrees } from './mapSpatial.ts';
import { collectSnapCandidates, snapMove, snapResize, snapRotation, snapTravellingIds } from './mapSnap.ts';
import type { SnapCandidates, SnapGuide } from './mapSnap.ts';

export type PlanGesture =
  | { mode: 'move' | 'resize' | 'rotate'; nodeId: string }
  | { mode: 'draw'; node: BackgroundSpace };
export type PlanGestureSnap = { candidates: SnapCandidates; /** map units */ tolerance: number;
  /** Map units: how far away on the other axis a target may be and still count (move and resize). */ reach: number };
export type PlanGesturePreview = { map: BackgroundMap; guides: SnapGuide[] };

/** Plan angle in degrees of the direction from `center` to `point`. */
const bearing = (point: BackgroundPoint, center: BackgroundPoint) => Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI;

/** Snap targets of one gesture, from the map as it was at the press. */
export function planGestureCandidates(gesture: PlanGesture, initial: BackgroundMap): SnapCandidates {
  // Drawing is not snapped, and a turn is caught by its stops alone: neither uses a line.
  if (gesture.mode === 'draw' || gesture.mode === 'rotate') return { x: [], y: [], points: [] };
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
