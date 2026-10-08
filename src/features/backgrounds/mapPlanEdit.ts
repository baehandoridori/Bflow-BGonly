import { nodePlanOutline, projectCameraToPlan } from './mapSpatial.ts';
import type { BackgroundNode, BackgroundPoint, BackgroundSpace } from './types.ts';

/** Sizes in CSS pixels unless noted. Multiplied by the screen scale they stay constant on screen. */
export const MAP_EDIT_MARK = {
  handle: 7, spaceLift: 28, symbolLift: 25, resize: 12, resizeMinNode: 12, resizeShift: 14,
  cameraOffset: 40, cameraFan: 80 /* map units */, cameraBody: 12 /* map units */, cameraRing: 18 /* map units */,
  vertex: 5, vertexHit: 9, edge: 5, edgeMin: 28, vertexMinNode: 32,
  guideOverhang: 8, polygonDot: 4, nameBoxCameraDrop: 30,
} as const;

export type PlanNodeHandles =
  | { kind: 'camera'; distance: number; radius: number; guide: { from: number; to: number } | null }
  | { kind: 'box'; radius: number; lift: number;
      /** The resize square. `shifted`: it stands diagonally outside the corner, clear of a point handle on that corner. */
      resize: { x: number; y: number; size: number; shifted: boolean } | null };

/** Handle geometry of the selected node, in the node's own frame (the frame of its <g> transform). */
export function planNodeHandles(node: BackgroundNode, scale: number, vertexHandles: boolean): PlanNodeHandles {
  const mark = MAP_EDIT_MARK, radius = mark.handle * scale;
  if (node.type === 'camera') {
    const plan = projectCameraToPlan(node);
    // The handle sits on the fan end, but stays clear of the camera body when zoomed far out.
    const distance = Math.max(mark.cameraFan, mark.cameraOffset * scale);
    const fan = mark.cameraFan * Math.hypot(plan.direction.x, plan.direction.y), body = plan.vertical ? mark.cameraRing : mark.cameraBody;
    // A dashed guide joins a fan that ends short of the handle; a gap under a pixel gets none.
    const guide = fan < distance - (mark.handle + 1) * scale ? { from: Math.max(body, fan), to: distance - radius } : null;
    return { kind: 'camera', distance, radius, guide };
  }
  const { width, height } = node, lift = (node.type === 'space' ? mark.spaceLift : mark.symbolLift) * scale;
  // Smaller on screen than the square itself: the square would cover the body and turn a move into a resize.
  if (Math.max(width, height) / scale < mark.resizeMinNode) return { kind: 'box', radius, lift, resize: null };
  const half = mark.resize / 2 * scale, size = mark.resize * scale;
  // A point handle whose hit area reaches the square would cover it, so the square steps outside the corner.
  const reach = (mark.resize / 2 + mark.vertexHit) * scale;
  const shifted = vertexHandles && node.type === 'space' && node.shape === 'polygon'
    && node.points.some(point => (1 - point.x) * width < reach && (1 - point.y) * height < reach);
  if (!shifted) return { kind: 'box', radius, lift, resize: { x: width - half, y: height - half, size, shifted } };
  const out = (mark.resizeShift - mark.resize / 2) * scale;
  return { kind: 'box', radius, lift, resize: { x: width + out, y: height + out, size, shifted } };
}

/** `edges`: the + of an edge, in its middle. Edge `index` runs from point `index` to the next one. */
export type PlanVertexHandles = { vertices: BackgroundPoint[]; edges: { index: number; point: BackgroundPoint }[] };
/**
 * A polygon stores no more points than this: a full one gets no +, and the polygon tool takes no further point. The same
 * number as the limit of the point edits (`mapGeometry.ts`, which this module does not import) and of the saved-data
 * check (`validateBackgroundEntity` in `domain.ts`).
 */
export const POLYGON_POINT_LIMIT = 200;

/** Absolute plan positions of the point handles of a polygon space, or null when none are shown. */
export function planVertexHandles(space: BackgroundSpace, scale: number): PlanVertexHandles | null {
  const mark = MAP_EDIT_MARK;
  // Smaller on screen than this, the hit areas of the points would cover the whole body.
  if (space.shape !== 'polygon' || space.locked || space.points.length < 3 || Math.max(space.width, space.height) / scale < mark.vertexMinNode) return null;
  const vertices = nodePlanOutline(space), edges: PlanVertexHandles['edges'] = [];
  if (vertices.length < POLYGON_POINT_LIMIT) vertices.forEach((from, index) => {
    const to = vertices[(index + 1) % vertices.length];
    if (Math.hypot(to.x - from.x, to.y - from.y) / scale >= mark.edgeMin) edges.push({ index, point: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } });
  });
  return { vertices, edges };
}

/**
 * The node a double-click acts on. `firstPressId` is the node its first press acted on, `hitId` the topmost node
 * under the second press and `pile` the overlapping nodes there: the one picked from the pile before the
 * double-click wins over the topmost one.
 */
export function doubleClickNodeId(firstPressId: string | null, hitId: string, pile: readonly string[]): string {
  return firstPressId !== null && (firstPressId === hitId || pile.includes(firstPressId)) ? firstPressId : hitId;
}

/** Whether plan drags snap is remembered per device. */
export const MAP_SNAP_PREFERENCE_KEY = 'bflow.background-map.snap.v1';
/** On unless this device stored `off`: also when nothing is stored or there is no storage. */
export function readSnapPreference(): boolean {
  try { return localStorage.getItem(MAP_SNAP_PREFERENCE_KEY) !== 'off'; } catch { return true; }
}
export function storeSnapPreference(enabled: boolean): void {
  try { localStorage.setItem(MAP_SNAP_PREFERENCE_KEY, enabled ? 'on' : 'off'); } catch { /* A display preference must not block editing. */ }
}
