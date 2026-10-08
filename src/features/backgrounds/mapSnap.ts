import type { BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from './types.ts';
import { nodeLocalPoint, resizeSpaceTo } from './mapGeometry.ts';
import { MAP_PLAN_EXTENT, nodeAngles, nodePlanOutline, normalizeDegrees, normalizeSignedDegrees } from './mapSpatial.ts';

/**
 * Pure snapping for plan gestures: what a dragged node may stick to, and where it lands. Lengths are map units.
 * A stuck axis takes the value of its target as it is; an axis that did not stick becomes a whole number.
 */

/** The two pixel values are screen distances: the caller turns them into map units. The rest are degrees. */
export const MAP_SNAP = { tolerancePx: 6, reachPx: 48, quarterTurn: 0.01, rotationStops: [0, 90, 180, 270], rotationCapture: 3 } as const;

/**
 * A line things stick to: x = at ('x', a vertical line) or y = at. `from`/`to` is its extent along the other axis:
 * the stretch the target really covers. A moving box farther than the reach from that stretch does not stick to
 * the line, and the guide is drawn over it.
 */
export type SnapLine = { axis: 'x' | 'y'; at: number; from: number; to: number };
export type SnapGuide = SnapLine;
export type SnapBox = { left: number; right: number; top: number; bottom: number };
export type SnapCandidates = { x: readonly SnapLine[]; y: readonly SnapLine[]; points: readonly BackgroundPoint[] };

type Axis = 'x' | 'y';
type Stretch = { from: number; to: number };
const AXES: readonly Axis[] = ['x', 'y'];
/** Lines whose values differ by no more than this are one line to a guide. */
const SAME_LINE = 1e-6;
const MIN_LENGTH = 10;

const across = (axis: Axis): Axis => axis === 'x' ? 'y' : 'x';
/** Nearest whole number, never -0. */
const whole = (value: number) => Math.round(value) + 0;
const pointBox = (point: BackgroundPoint): SnapBox => ({ left: point.x, right: point.x, top: point.y, bottom: point.y });
const unite = (boxes: readonly SnapBox[]): SnapBox => ({
  left: Math.min(...boxes.map(box => box.left)), right: Math.max(...boxes.map(box => box.right)),
  top: Math.min(...boxes.map(box => box.top)), bottom: Math.max(...boxes.map(box => box.bottom)),
});
const shift = (box: SnapBox, by: BackgroundPoint): SnapBox => ({ left: box.left + by.x, right: box.right + by.x, top: box.top + by.y, bottom: box.bottom + by.y });
/** The part of an axis a box takes up. */
const stretch = (box: SnapBox, axis: Axis): Stretch => axis === 'x' ? { from: box.left, to: box.right } : { from: box.top, to: box.bottom };
/** What a stretch offers on its axis: start, middle and end, or the one value of a point. */
const stops = ({ from, to }: Stretch): number[] => from === to ? [from] : [from, (from + to) / 2, to];

export function isQuarterTurn(rotation: number): boolean {
  const turn = normalizeDegrees(rotation) % 90;
  return Math.min(turn, 90 - turn) < MAP_SNAP.quarterTurn;
}
/** How many quarter turns a rotation at a quarter turn is: 0..3. */
const quarterTurns = (rotation: number) => Math.round(normalizeDegrees(rotation) / 90) % 4;
/** Whether the plan shape is a box along the screen axes: at a quarter turn and, for a symbol, not tilted. */
function isAxisAligned(node: BackgroundSpace | BackgroundSymbol): boolean {
  const angles = nodeAngles(node);
  return isQuarterTurn(node.rotation) && angles.pitch === 0 && angles.roll === 0;
}

/** What a node offers to snapping: its box at quarter turns, a single point otherwise. */
export function nodeSnapBox(node: BackgroundNode): SnapBox {
  if (node.type === 'camera') return pointBox(node);
  const centre = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  if (!isAxisAligned(node)) return pointBox(centre);
  // Unturned or half turned: straight from the stored values, so an edge is the very number that was saved.
  if (quarterTurns(node.rotation) % 2 === 0) return { left: node.x, right: node.x + node.width, top: node.y, bottom: node.y + node.height };
  return { left: centre.x - node.height / 2, right: centre.x + node.height / 2, top: centre.y - node.width / 2, bottom: centre.y + node.width / 2 };
}

/**
 * The plan area a node covers: what "near" is measured against and what the guides are drawn over.
 * The snap box at quarter turns, the bounds of the plan outline of a turned or tilted node, the point of a camera.
 */
export function nodeSnapSpan(node: BackgroundNode): SnapBox {
  if (node.type === 'camera' || isAxisAligned(node)) return nodeSnapBox(node);
  return unite(nodePlanOutline(node).map(pointBox));
}

/** The moving nodes plus what travels with them: unlocked members of an unlocked moving space. */
export function snapTravellingIds(map: BackgroundMap, movingIds: readonly string[]): Set<string> {
  const ids = new Set(movingIds);
  const carrying = new Set(map.nodes.filter(node => node.type === 'space' && !node.locked && ids.has(node.id)).map(node => node.id));
  for (const node of map.nodes) if (node.type !== 'space' && node.spaceId !== null && carrying.has(node.spaceId) && !node.locked) ids.add(node.id);
  return ids;
}

/**
 * Every line and corner a drag may stick to: the border of the base extent, then each node that is not excluded,
 * in map order. Nothing is left out for being far away here: what is near changes with every pointer position.
 */
export function collectSnapCandidates(map: BackgroundMap, excluded: ReadonlySet<string>): SnapCandidates {
  const { width, height } = MAP_PLAN_EXTENT;
  const x: SnapLine[] = [0, width].map((at): SnapLine => ({ axis: 'x', at, from: 0, to: height }));
  const y: SnapLine[] = [0, height].map((at): SnapLine => ({ axis: 'y', at, from: 0, to: width }));
  const points: BackgroundPoint[] = [];
  for (const node of map.nodes) {
    if (excluded.has(node.id)) continue;
    // A turned node offers its centre lines only, but they run over the box around what is seen of it.
    const box = nodeSnapBox(node), span = nodeSnapSpan(node);
    for (const at of stops(stretch(box, 'x'))) x.push({ axis: 'x', at, from: span.top, to: span.bottom });
    for (const at of stops(stretch(box, 'y'))) y.push({ axis: 'y', at, from: span.left, to: span.right });
    if (node.type === 'space' && node.shape !== 'ellipse') points.push(...nodePlanOutline(node));
  }
  return { x, y, points };
}

/** Adds the x and y of neighbouring polygon points as lines. */
export function withVertexNeighbours(candidates: SnapCandidates, neighbours: readonly BackgroundPoint[]): SnapCandidates {
  return {
    x: [...candidates.x, ...neighbours.map((point): SnapLine => ({ axis: 'x', at: point.x, from: point.y, to: point.y }))],
    y: [...candidates.y, ...neighbours.map((point): SnapLine => ({ axis: 'y', at: point.y, from: point.x, to: point.x }))],
    points: candidates.points,
  };
}

/**
 * The lines of each axis whose own stretch is within `reach` of the box, measured along the line. A reach that
 * is not a distance counts as none: only what overlaps or touches the box is left.
 */
function nearLines(candidates: SnapCandidates, box: SnapBox, reach: number): Record<Axis, SnapLine[]> {
  const limit = Number.isFinite(reach) && reach > 0 ? reach : 0;
  const near = (line: SnapLine) => {
    const { from, to } = stretch(box, across(line.axis));
    return Math.max(0, line.from - to, from - line.to) <= limit;
  };
  return { x: candidates.x.filter(near), y: candidates.y.filter(near) };
}

/** The line closest to any of the values and within `tolerance` of it. On a tie the earlier value wins, then the earlier line. */
function closestLine(values: readonly number[], lines: readonly SnapLine[], tolerance: number): { index: number; line: SnapLine } | null {
  if (!(tolerance > 0)) return null;
  let best: { index: number; line: SnapLine } | null = null, least = Infinity;
  for (let index = 0; index < values.length; index++) for (const line of lines) {
    const distance = Math.abs(line.at - values[index]);
    if (distance <= tolerance && distance < least) { best = { index, line }; least = distance; }
  }
  return best;
}

/** The guide of a stuck line: over `over` and over every one of `lines` at the same value. */
function guideOver(line: SnapLine, lines: readonly SnapLine[], over: Stretch): SnapGuide {
  let { from, to } = over;
  for (const other of lines) if (Math.abs(other.at - line.at) <= SAME_LINE) { from = Math.min(from, other.from); to = Math.max(to, other.to); }
  return { axis: line.axis, at: line.at, from, to };
}

/**
 * `tolerance`: how close on the snapping axis. `reach`: how far away on the other axis a line may be and still count. Map units.
 * `position` is what the stored x/y of the anchor node become, and `delta` takes them there. Null without an anchor
 * among the moving nodes or without a finite delta: the caller moves freely then.
 */
export function snapMove(map: BackgroundMap, movingIds: readonly string[], anchorId: string, delta: BackgroundPoint,
  candidates: SnapCandidates, tolerance: number, reach: number): { position: BackgroundPoint; delta: BackgroundPoint; guides: SnapGuide[] } | null {
  const anchor = map.nodes.find(node => node.id === anchorId);
  if (!anchor || !movingIds.includes(anchorId) || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return null;
  const moving = map.nodes.filter(node => movingIds.includes(node.id));
  const offered = unite(moving.map(nodeSnapBox)), covered = unite(moving.map(nodeSnapSpan));
  // Near is judged where the drag is before anything sticks: one axis sticking does not change the other.
  const near = nearLines(candidates, shift(covered, delta), reach);
  const position = { x: 0, y: 0 }, stuck: SnapLine[] = [];
  for (const axis of AXES) {
    // Moving lines are held as offsets from the stored coordinate of the anchor: an edge that is that coordinate
    // has offset 0 and lands on the very value of its target.
    const free = anchor[axis] + delta[axis], offsets = stops(stretch(offered, axis)).map(value => value - anchor[axis]);
    const hit = closestLine(offsets.map(offset => free + offset), near[axis], tolerance);
    position[axis] = hit ? hit.line.at - offsets[hit.index] : whole(free);
    if (hit) stuck.push(hit.line);
  }
  const landed = shift(shift(covered, { x: -anchor.x, y: -anchor.y }), position);
  return { position, delta: { x: position.x - anchor.x, y: position.y - anchor.y },
    guides: stuck.map(line => guideOver(line, near[line.axis], stretch(landed, across(line.axis)))) };
}

/** Every given line and point counts, whatever its distance on the other axis: the caller passes only what a point may stick to. */
export function snapPoint(point: BackgroundPoint, candidates: SnapCandidates, tolerance: number): { point: BackgroundPoint; guides: SnapGuide[] } {
  if (tolerance > 0) {
    let corner: BackgroundPoint | null = null, least = Infinity;
    for (const candidate of candidates.points) {
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance <= tolerance && distance < least) { corner = candidate; least = distance; }
    }
    // A corner is taken as it is. Its two guides have no length: drawn, they make a small cross.
    if (corner) return { point: { x: corner.x, y: corner.y },
      guides: [{ axis: 'x', at: corner.x, from: corner.y, to: corner.y }, { axis: 'y', at: corner.y, from: corner.x, to: corner.x }] };
  }
  const result = { x: 0, y: 0 }, stuck: SnapLine[] = [];
  for (const axis of AXES) {
    const hit = closestLine([point[axis]], candidates[axis], tolerance);
    result[axis] = hit ? hit.line.at : whole(point[axis]);
    if (hit) stuck.push(hit.line);
  }
  return { point: result, guides: stuck.map(line => {
    const at = result[across(line.axis)];
    return guideOver(line, candidates[line.axis], { from: at, to: at });
  }) };
}

/** `corner`: the plan point the bottom-right corner is dragged to. */
export function snapResize<T extends BackgroundSpace | BackgroundSymbol>(node: T, corner: BackgroundPoint,
  candidates: SnapCandidates, tolerance: number, reach: number): { node: T; guides: SnapGuide[] } {
  if (!isAxisAligned(node)) {
    const local = nodeLocalPoint(node, corner);
    return { node: resizeSpaceTo(node, whole(local.x), whole(local.y)), guides: [] };
  }
  // At a quarter turn the node's own axes are the screen axes, swapped and signed: a stuck length needs no trigonometry.
  const turns = quarterTurns(node.rotation), box = nodeSnapBox(node);
  const grows = { x: turns === 0 || turns === 3 ? 1 : -1, y: turns < 2 ? 1 : -1 };
  // The rotated top-left corner, which a resize keeps where it is.
  const fixed = { x: grows.x > 0 ? box.left : box.right, y: grows.y > 0 ? box.top : box.bottom };
  const dragged = { left: Math.min(fixed.x, corner.x), right: Math.max(fixed.x, corner.x), top: Math.min(fixed.y, corner.y), bottom: Math.max(fixed.y, corner.y) };
  const near = nearLines(candidates, dragged, reach), lengths = { x: 0, y: 0 }, stuck: SnapLine[] = [];
  for (const axis of AXES) {
    const length = (value: number) => grows[axis] * (value - fixed[axis]);
    const hit = closestLine([corner[axis]], near[axis], tolerance);
    // A line that would leave less than the minimum length does not count.
    const line = hit && length(hit.line.at) >= MIN_LENGTH ? hit.line : null;
    lengths[axis] = line ? length(line.at) : whole(length(corner[axis]));
    if (line) stuck.push(line);
  }
  // Odd quarter turns: the screen y sets the width and the screen x the height.
  const resized = turns % 2 === 0 ? resizeSpaceTo(node, lengths.x, lengths.y) : resizeSpaceTo(node, lengths.y, lengths.x);
  const landed = nodeSnapBox(resized);
  return { node: resized, guides: stuck.map(line => guideOver(line, near[line.axis], stretch(landed, across(line.axis)))) };
}

/** Degrees in [0, 360): a stop when within `capture` of it, else the normalised input. */
export function snapRotation(degrees: number, capture: number = MAP_SNAP.rotationCapture): number {
  if (!Number.isFinite(degrees)) return degrees;
  const turn = normalizeDegrees(degrees);
  for (const stop of MAP_SNAP.rotationStops) if (Math.abs(normalizeSignedDegrees(turn - stop)) <= capture) return stop;
  return turn;
}

export function sameSnapGuides(a: readonly SnapGuide[], b: readonly SnapGuide[]): boolean {
  return a.length === b.length && a.every((guide, index) => {
    const other = b[index];
    return guide.axis === other.axis && guide.at === other.at && guide.from === other.from && guide.to === other.to;
  });
}
