import { MAP_EDIT_MARK } from './mapPlanEdit.ts';
import { planNodeCovers } from './mapPlanPreview.ts';
import { nodePlanOutline, projectCameraToPlan } from './mapSpatial.ts';
import type { MapSelection } from './mapDocument.ts';
import type { BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace } from './types.ts';

/**
 * Decisions of the plan's 'select' tool, without the DOM: the selection box, what lies under the pointer and what a press does.
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

export type PlanPressClick =
  | { kind: 'none' }
  /** That node alone, or nothing (null). */
  | { kind: 'select'; id: string | null }
  /** Into the selection, or out of it. */
  | { kind: 'toggle'; id: string }
  /** On to the next of the pile, which the SVG's click carries out. `spaces`: the pile is one of spaces, which a repeated click never steps through. */
  | { kind: 'step'; ids: readonly string[]; from: string; spaces: boolean };
export type PlanPressPlan = {
  /** What a drag past the threshold does. */
  drag: 'pan' | 'marquee' | 'move';
  /** `move`: the node the drag is anchored on. */
  nodeId: string | null;
  /** `move`: every selected node that travels along, or null for that one node. */
  groupIds: readonly string[] | null;
  /** A node to select at the press itself. Absent: the selection is left as it is. */
  selectAtPress?: string;
  /** What a release without movement does. */
  click: PlanPressClick;
  /** The node this press counts as for a double-click: the pile member that was already picked, else the node under it. Null on empty canvas. */
  targetId: string | null;
  /** False: the press is no half of a double-click (the press log is emptied). */
  logged: boolean;
};
/**
 * What a left press of the select tool does when it is off the handles and does not move the view. While viewing,
 * every tool but the hand presses like this.
 */
export function resolvePlanPress(input: {
  canEdit: boolean; shift: boolean;
  /** Topmost node under the press, from the live draft. Null on empty canvas. */
  hit: BackgroundNode | null;
  /** The nodes that take turns at this point (planPileAt). Empty on empty canvas. */
  pile: readonly string[];
  /** The live selection. */
  selection: MapSelection;
  /**
   * The same spot pressed again: the select tool pressed this same topmost node last, and the one node that press
   * left selected is still the selection. Only a pile of spaces asks: without it a space under the top one is no target.
   */
  again: boolean;
  /** A node of the live map. */
  node(id: string): BackgroundNode | undefined;
}): PlanPressPlan {
  const { canEdit, shift, hit, pile, selection, again } = input;
  const plan = (drag: PlanPressPlan['drag'], click: PlanPressClick, targetId: string | null, rest: Partial<PlanPressPlan> = {}): PlanPressPlan =>
    ({ drag, nodeId: null, groupIds: null, click, targetId, logged: true, ...rest });
  const pick = (id: string | null): PlanPressClick => ({ kind: 'select', id });
  // Shift pressed twice adds and removes again: such a press is no half of a double-click.
  const unlogged = { logged: false };
  if (!hit) {
    if (!canEdit) return plan('pan', pick(null), null);
    return shift ? plan('marquee', { kind: 'none' }, null, unlogged) : plan('marquee', pick(null), null);
  }
  // The pile member already picked on this spot: the one selected node, when the pile holds it. A pile of spaces is every
  // space around the point, so there it counts only on a spot pressed again: a first press is after the space on top.
  const from = selection.ids.length === 1 && selection.primaryId !== null && pile.length > 1 && pile.includes(selection.primaryId)
    && (hit.type !== 'space' || again) ? selection.primaryId : null;
  const step = from === null ? null : { kind: 'step' as const, ids: pile, from, spaces: hit.type === 'space' };
  // Viewing: every drag moves the view, and Shift means nothing.
  if (!canEdit) return step ? plan('pan', step, step.from) : plan('pan', pick(hit.id), hit.id);
  // Shift comes first and means the node on top: a node of the group is taken out of it, not dragged with it.
  if (shift) return plan('marquee', { kind: 'toggle', id: hit.id }, null, unlogged);
  // A drag never moves a locked node: without an unlocked one to take, it draws a box.
  if (selection.ids.length > 1 && selection.ids.includes(hit.id)) {
    // The group is kept at the press so that a drag moves all of it, and folds to the pressed node on release.
    return hit.locked ? plan('marquee', pick(hit.id), hit.id) : plan('move', pick(hit.id), hit.id, { nodeId: hit.id, groupIds: selection.ids });
  }
  const grab = { nodeId: hit.id, selectAtPress: hit.id };
  if (step) {
    if (!input.node(step.from)?.locked) return plan('move', step, step.from, { nodeId: step.from });
    // The picked one is locked: the drag takes the node on top, and the step still goes on from the picked one.
    return hit.locked ? plan('marquee', step, step.from) : plan('move', step, hit.id, grab);
  }
  return hit.locked ? plan('marquee', pick(hit.id), hit.id) : plan('move', { kind: 'none' }, hit.id, grab);
}

/** What the select tool's last press on a node left behind: the topmost node there, and the one node it left selected (null: none, or several). */
export type PlanSpot = { mapId: string; hitId: string; pickedId: string | null };
/** Whether a press on the topmost node `hitId` of a map is the same spot pressed again: the remembered spot is that node, and the node left selected then is still the one selection. */
export function sameSpotAgain(spot: PlanSpot | null, mapId: string, hitId: string | null, selection: MapSelection): boolean {
  return spot !== null && hitId !== null && spot.mapId === mapId && spot.hitId === hitId
    && selection.ids.length === 1 && selection.primaryId === spot.pickedId;
}
