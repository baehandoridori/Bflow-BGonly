import type { BackgroundMap, BackgroundPoint, BackgroundSpace } from './types.ts';
import { moveMapNode, nodeResizeCorner, replaceMapNode, resizeSpace, resizeSpaceTo, transformMapSpace } from './mapGeometry.ts';
import { normalizeDegrees } from './mapSpatial.ts';
import type { SnapCandidates, SnapGuide } from './mapSnap.ts';

export type PlanGesture =
  | { mode: 'move' | 'resize' | 'rotate'; nodeId: string }
  | { mode: 'draw'; node: BackgroundSpace };
export type PlanGestureSnap = { candidates: SnapCandidates; /** map units */ tolerance: number;
  /** Map units: how far away on the other axis a target may be and still count (move and resize). */ reach: number };
export type PlanGesturePreview = { map: BackgroundMap; guides: SnapGuide[] };

/** Plan angle in degrees of the direction from `center` to `point`. */
const bearing = (point: BackgroundPoint, center: BackgroundPoint) => Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI;

/**
 * The draft a gesture shows for one pointer position. Pure: the same arguments give the same result whatever
 * was previewed before. `snap` null is the free drag: nothing sticks and nothing is rounded. Returns null when
 * this position cannot be shown (the caller keeps the last preview).
 */
export function previewPlanGesture(gesture: PlanGesture, initial: BackgroundMap, start: BackgroundPoint,
  point: BackgroundPoint, snap: PlanGestureSnap | null): PlanGesturePreview | null {
  const delta = { x: point.x - start.x, y: point.y - start.y };
  if (gesture.mode === 'draw') {
    const drawn = { ...gesture.node, x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.max(10, Math.abs(delta.x)), height: Math.max(10, Math.abs(delta.y)) };
    return { map: { ...initial, nodes: [...initial.nodes, drawn] }, guides: [] };
  }
  const node = initial.nodes.find(item => item.id === gesture.nodeId);
  if (!node) return null;
  if (gesture.mode === 'move') return { map: moveMapNode(initial, node.id, delta), guides: [] };
  if (gesture.mode === 'resize') {
    if (node.type === 'camera') return { map: initial, guides: [] };
    // The handle stands for the bottom-right corner, which travels as far as the pointer did: where the handle
    // was pressed does not enter the result, so the corner never jumps to the pointer.
    const handle = nodeResizeCorner(node), corner = { x: handle.x + delta.x, y: handle.y + delta.y };
    // An unturned node takes the travel on its stored size: `x + width + travel - x` can lose the last digit,
    // and then a drag that came back, or the length that was not dragged, would stay as a change.
    const resized = node.rotation === 0 ? resizeSpaceTo(node, node.width + delta.x, node.height + delta.y) : resizeSpace(node, corner);
    return { map: resized.type === 'space' ? transformMapSpace(initial, resized) : replaceMapNode(initial, resized), guides: [] };
  }
  // Only the horizontal direction changes: height, tilt and frame of a camera stay as they are.
  if (node.type === 'camera') return { map: replaceMapNode(initial, { ...node, angle: normalizeDegrees(bearing(point, node)) }), guides: [] };
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  const rotation = normalizeDegrees(node.rotation + bearing(point, center) - bearing(start, center));
  return { map: node.type === 'space' ? transformMapSpace(initial, { ...node, rotation }) : replaceMapNode(initial, { ...node, rotation }), guides: [] };
}
