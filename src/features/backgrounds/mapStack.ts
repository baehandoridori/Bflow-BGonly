import { containsPoint } from './mapGeometry.ts';
import { isRoadSpace, nodePlanOutline } from './mapSpatial.ts';
import type { BackgroundMap, BackgroundPoint, BackgroundSpace } from './types.ts';

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
