import { MAP_EDIT_MARK } from './mapPlanEdit.ts';
import { planNodeCovers } from './mapPlanPreview.ts';
import { nodePlanOutline, projectCameraToPlan } from './mapSpatial.ts';
import type { BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace } from './types.ts';

/**
 * Decisions of the plan's 'select' tool, without the DOM: the selection box and what lies under the pointer.
 * A box is closed and in plan coordinates: what lies on its very edge is touched.
 */
export type PlanRect = { left: number; top: number; right: number; bottom: number };

const RADIANS = Math.PI / 180;
const finitePoint = (point: BackgroundPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const rotate = (point: BackgroundPoint, degrees: number): BackgroundPoint => {
  const radians = degrees * RADIANS, cos = Math.cos(radians), sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
};

/** Whether anything is left of the segment once it is cut to the box (Liang-Barsky). */
function segmentMeetsRect(a: BackgroundPoint, b: BackgroundPoint, rect: PlanRect): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  let enter = 0, leave = 1;
  for (const [step, room] of [[-dx, a.x - rect.left], [dx, rect.right - a.x], [-dy, a.y - rect.top], [dy, rect.bottom - a.y]]) {
    // Parallel to this side of the box: beyond it for its whole length, or not cut by it at all.
    if (step === 0) { if (room < 0) return false; continue; }
    if (step < 0) enter = Math.max(enter, room / step); else leave = Math.min(leave, room / step);
    if (enter > leave) return false;
  }
  return true;
}

function originToSegment(a: BackgroundPoint, b: BackgroundPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  // A box dragged straight along one axis has two sides of no length.
  const along = length > 0 ? Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / length)) : 0;
  return Math.hypot(a.x + dx * along, a.y + dy * along);
}
/** Exact, without a many-sided stand-in: in the ellipse's own frame its outline is the unit circle around the origin. */
function ellipseMeetsRect(space: BackgroundSpace, rect: PlanRect): boolean {
  const centre = { x: space.x + space.width / 2, y: space.y + space.height / 2 };
  const corners = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]].map(([x, y]) => {
    const own = rotate({ x: x - centre.x, y: y - centre.y }, -space.rotation);
    return { x: own.x / (space.width / 2), y: own.y / (space.height / 2) };
  });
  if (!corners.every(finitePoint)) return false;
  // The origin is inside the box as the ellipse sees it exactly when the centre is inside the box.
  const inside = centre.x >= rect.left && centre.x <= rect.right && centre.y >= rect.top && centre.y <= rect.bottom;
  const near = inside ? 0 : Math.min(...corners.map((from, index) => originToSegment(from, corners[(index + 1) % corners.length])));
  const far = Math.max(...corners.map(corner => Math.hypot(corner.x, corner.y)));
  return near <= 1 && far >= 1;
}

/** The box between two plan points, whichever way it was dragged. */
export function planRect(a: BackgroundPoint, b: BackgroundPoint): PlanRect {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

/** Whether the box touches a node. */
export function planRectTouches(node: BackgroundNode, rect: PlanRect): boolean {
  if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)) return false;
  if (node.type === 'camera') {
    // The body only (the ring of a camera that looks straight up or down). The fan takes presses, but a box over it is after
    // what stands next to the camera. A position that is no finite number is within no distance.
    const dx = Math.max(rect.left - node.x, 0, node.x - rect.right), dy = Math.max(rect.top - node.y, 0, node.y - rect.bottom);
    return Math.hypot(dx, dy) <= (projectCameraToPlan(node).vertical ? MAP_EDIT_MARK.cameraRing : MAP_EDIT_MARK.cameraBody);
  }
  if (node.type === 'space' && node.shape === 'ellipse') return ellipseMeetsRect(node, rect);
  // A symbol counts by the box the plan draws and takes presses on, not by the outline it casts when tilted.
  const outline = nodePlanOutline(node.type === 'space' ? node : { ...node, pitch: 0, roll: 0 });
  if (!outline.every(finitePoint)) return false;
  // A space is touched by its walls alone: a box drawn inside a room is after what stands in it, not the room.
  if (outline.some((from, index) => segmentMeetsRect(from, outline[(index + 1) % outline.length], rect))) return true;
  // A symbol also by its area: a box inside it crosses none of its sides.
  return node.type === 'symbol' && planNodeCovers(node, { x: rect.left, y: rect.top }, 0);
}

/** Ids of the nodes a box touches, in map order. */
export function planMarqueeIds(map: BackgroundMap, rect: PlanRect): string[] {
  return map.nodes.filter(node => planRectTouches(node, rect)).map(node => node.id);
}

/** Whether a plan point lies on a camera or symbol as the main plan draws it (the editor's former onPlanMark). */
export function planMarkCovers(node: BackgroundNode, point: BackgroundPoint): boolean {
  return planNodeCovers(node, point, node.type !== 'camera' ? 0 : projectCameraToPlan(node).vertical ? MAP_EDIT_MARK.cameraRing : MAP_EDIT_MARK.cameraBody, MAP_EDIT_MARK.cameraFan);
}
