import { containsPoint } from './mapGeometry.ts';
import { isRoadSpace, nodeElevation, nodePlanOutline, nodeVolumeHeight, spaceWallHeight } from './mapSpatial.ts';
import type { BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace } from './types.ts';

/** Plan area of a space as the plan draws it: what "smaller" means for stacking. */
export function spacePlanArea(space: BackgroundSpace): number {
  const box = space.width * space.height;
  if (space.shape === 'ellipse') return box * Math.PI / 4;
  // With fewer than three points the plan draws the box (`spaceOutline` in `mapSpatial.ts`).
  if (space.shape !== 'polygon' || space.points.length < 3) return box;
  // The absolute value: signed, a polygon whose points run the other way round would be the smallest space and cover the rooms inside it.
  return Math.abs(space.points.reduce((sum, point, index) => {
    const next = space.points[(index + 1) % space.points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2 * box;
}

/** The spaces of a map from the bottom of the stack to the top: a road lies under every room, then a larger plan area lies below, and of two equal areas the earlier in the map. */
export function stackedSpaces(map: BackgroundMap): BackgroundSpace[] {
  const entries = map.nodes.filter((node): node is BackgroundSpace => node.type === 'space').map((space, index) => {
    const area = spacePlanArea(space);
    // An area that is no number lies at the bottom of its layer.
    return { space, index, layer: isRoadSpace(space) ? 0 : 1, area: Number.isFinite(area) ? area : Infinity };
  });
  return entries.sort((a, b) => a.layer !== b.layer ? a.layer - b.layer : a.area === b.area ? a.index - b.index : b.area - a.area).map(entry => entry.space);
}

/** Stack position of every space id: 0 is the bottom. */
export function spaceStackRanks(map: BackgroundMap): Map<string, number> {
  return new Map(stackedSpaces(map).map((space, rank) => [space.id, rank]));
}

/** The spaces that hold a plan point, the topmost first: the rooms from the smallest, then the roads from the smallest. */
export function spacesAt(map: BackgroundMap, point: BackgroundPoint): BackgroundSpace[] {
  return stackedSpaces(map).filter(space => containsPoint(space, point)).reverse();
}

/** Slack of the overlap test, in plan units: outlines that only share an edge or a corner, or miss each other by rounding, do not overlap. */
const OVERLAP_SLACK = 1e-6;
/**
 * Whether two spaces share ground on the plan: an area, not only an edge or a corner. Read from the outlines the 3D
 * floors and the companion plan are drawn with (an ellipse as its 48-gon; the plan itself draws the true ellipse);
 * where an outline crosses itself, inside is counted the way containsPoint counts it.
 */
export function spacesOverlap(a: BackgroundSpace, b: BackgroundSpace): boolean {
  const first = nodePlanOutline(a), second = nodePlanOutline(b);
  if (first.length < 3 || second.length < 3 || ![...first, ...second].every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return false;
  const sides = (outline: BackgroundPoint[]) => outline.map((from, index) => [from, outline[(index + 1) % outline.length]] as const);
  const sidesA = sides(first), sidesB = sides(second), all = [...sidesA, ...sidesB];
  // Between two neighbouring xs of this list no outline turns and no two sides cross, of one outline or of both: one vertical line tells the whole strip.
  const xs = [...first, ...second].map(point => point.x);
  // Every pair of sides, two of one outline as well: an outline may cross itself. Neighbouring sides only add their shared corner again.
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const [p, q] = all[i], [r, s] = all[j];
    const cross = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
    if (cross === 0) continue;     // parallel sides add nothing: their ends are in the list
    const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / cross, u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / cross;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) xs.push(p.x + t * (q.x - p.x));
  }
  xs.sort((left, right) => left - right);
  // Where the vertical line at x crosses an outline, lowest first: inside from the 1st crossing to the 2nd, from the 3rd to the 4th, and on.
  const cuts = (list: ReturnType<typeof sides>, x: number) =>
    list.filter(([p, q]) => (p.x > x) !== (q.x > x)).map(([p, q]) => p.y + (x - p.x) * (q.y - p.y) / (q.x - p.x)).sort((low, high) => low - high);
  for (let index = 1; index < xs.length; index++) {
    if (xs[index] - xs[index - 1] <= OVERLAP_SLACK) continue;
    const x = (xs[index] + xs[index - 1]) / 2, ya = cuts(sidesA, x), yb = cuts(sidesB, x);
    for (let m = 0; m + 1 < ya.length; m += 2) for (let n = 0; n + 1 < yb.length; n += 2)
      if (Math.min(ya[m + 1], yb[n + 1]) - Math.max(ya[m], yb[n]) > OVERLAP_SLACK) return true;
  }
  return false;
}

/** Slack of the hold test: a share of the way from a corner towards the middle of its two neighbours, plan units around a camera or a corner, and level units. What stands flush against a wall, on the floor or up to the top is inside. */
const HOLD_SLACK = 1e-6;
/** The eight directions around a plan point. */
const AROUND: readonly (readonly [number, number])[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
/** No node is held: one set for every time, so nothing that reads it by identity is woken. */
const NONE_HELD: ReadonlySet<string> = new Set();
/**
 * Whether a room holds a node whole: its plan outline (every corner of a space or a symbol, and the middle of its box
 * where that middle is a point of the node; the position of a camera) lies inside the outline of the room or on it, and
 * it stands between the floor and the top of the walls, both included. A road has no volume, and a room does not hold itself.
 */
export function spaceHoldsNode(space: BackgroundSpace, node: BackgroundNode): boolean {
  if (node.id === space.id || isRoadSpace(space)) return false;
  const floor = nodeElevation(space), top = floor + spaceWallHeight(space), level = nodeElevation(node);
  // A camera is a point: it has no height of its own.
  const height = node.type === 'camera' ? 0 : node.type === 'space' ? spaceWallHeight(node) : nodeVolumeHeight(node);
  if (!(level >= floor - HOLD_SLACK && level + height <= top + HOLD_SLACK)) return false;
  // A camera on a wall line is inside, whatever the shape of the room: containsPoint reads the edges of a polygon half open, so the point is asked a hair away on every side.
  if (node.type === 'camera') return AROUND.some(([dx, dy]) => containsPoint(space, { x: node.x + dx * HOLD_SLACK, y: node.y + dy * HOLD_SLACK }));
  const middle = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  // Inside an outline or on it: a hair away on one side or another is inside, as a camera is asked.
  const near = (area: BackgroundSpace, point: BackgroundPoint) => AROUND.some(([dx, dy]) => containsPoint(area, { x: point.x + dx * HOLD_SLACK, y: point.y + dy * HOLD_SLACK }));
  // The middle of the box is asked where it is a point of the node. A space may not hold it: it lies outside an L or a U
  // (not asked) and on the long side of a right triangle (asked, and then it may lie on a wall of the room).
  if (!containsPoint(space, middle) && (node.type !== 'space' || (near(node, middle) && !near(space, middle)))) return false;
  // Each corner is asked a hair towards the middle of its two neighbours (for a rectangle, its middle), or on the outline:
  // a wall the node stands flush against does not put it outside, whatever its shape. The first finds the inside at a
  // sharp corner, the second at a corner that turns inwards or lies on a straight stretch of outline.
  return nodePlanOutline(node).every((point, index, outline) => {
    const before = outline[(index + outline.length - 1) % outline.length], after = outline[(index + 1) % outline.length];
    return containsPoint(space, { x: point.x + ((before.x + after.x) / 2 - point.x) * HOLD_SLACK, y: point.y + ((before.y + after.y) / 2 - point.y) * HOLD_SLACK }) || near(space, point);
  });
}
/**
 * The nodes that rooms drawn closed in 3D hold whole: what is not drawn there. `boxes`: those rooms. Two of them that
 * hold each other (the same outline on the same levels) are told apart by the map: the earlier one, which lies below on
 * the plan, holds the later one. The one empty set when there is no such room.
 */
export function nodesHeldBy(map: BackgroundMap, boxes: readonly BackgroundSpace[]): ReadonlySet<string> {
  if (!boxes.length) return NONE_HELD;
  const order = new Map(map.nodes.map((node, index) => [node.id, index])), at = (id: string) => order.get(id) ?? -1;
  const held = new Set<string>();
  for (const node of map.nodes)
    if (boxes.some(box => spaceHoldsNode(box, node) && !(node.type === 'space' && boxes.includes(node) && at(node.id) < at(box.id) && spaceHoldsNode(node, box)))) held.add(node.id);
  return held.size ? held : NONE_HELD;
}
