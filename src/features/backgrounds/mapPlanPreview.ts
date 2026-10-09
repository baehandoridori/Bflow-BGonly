import { stackedMapNodeIds } from './mapGeometry.ts';
import { MAP_SPATIAL_DEFAULTS, cameraAngles, cameraPitchLabel, mapPlanBounds, nodeElevation, nodePlanOutline, nodeVolumeHeight, normalizeDegrees, normalizeSignedDegrees, projectCameraToPlan } from './mapSpatial.ts';
import type { CameraPlanProjection } from './mapSpatial.ts';
import { spacesAt } from './mapStack.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from './types.ts';

/**
 * Geometry and wording of the companion plan shown next to the 3D viewport.
 * Everything is derived from the draft on each call: nothing here stores or writes a node.
 */
export type PlanSize = { width: number; height: number };
export type PlanViewBox = { x: number; y: number; width: number; height: number };

/** Marker sizes in screen pixels. Multiplied by map units per pixel they stay constant on screen. */
export const PLAN_MARK = { pad: 12, dot: 4.5, ring: 9.5, arrow: 26, head: 6, fan: 44, glyph: 7.5, tickGap: 4.5, tick: 12, hit: 11 } as const;
/** Assumed stage size until the real one has been measured. */
export const PLAN_FALLBACK_SIZE: PlanSize = { width: 240, height: 160 };
export const PLAN_PREVIEW_HINT = '3D에서 고른 항목이 여기에도 표시돼요';
export const PLAN_KIND_LABELS = { space: '공간', symbol: '기호', camera: '카메라' } as const;

const RADIANS = Math.PI / 180;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const usable = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;
const finitePoint = (point: BackgroundPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const along = (origin: BackgroundPoint, unit: BackgroundPoint, distance: number): BackgroundPoint =>
  ({ x: origin.x + unit.x * distance, y: origin.y + unit.y * distance });
/** Apex ahead of `tip`, then the two corners of the base on it. */
function arrowHead(tip: BackgroundPoint, unit: BackgroundPoint, length: number): BackgroundPoint[] {
  const half = length * 0.55, side = { x: -unit.y, y: unit.x };
  return [along(tip, unit, length), along(tip, side, half), along(tip, side, -half)];
}

/**
 * mapPlanBounds plus a margin that is `PLAN_MARK.pad` pixels on a stage of the given size,
 * so a marker on the edge of the map is not cut off however large the map is.
 */
export function planViewBox(map: BackgroundMap, size: PlanSize = PLAN_FALLBACK_SIZE): PlanViewBox {
  const bounds = mapPlanBounds(map);
  const width = usable(size.width, PLAN_FALLBACK_SIZE.width), height = usable(size.height, PLAN_FALLBACK_SIZE.height);
  const pad = Math.min(PLAN_MARK.pad, width / 4, height / 4);
  const margin = pad * Math.max(bounds.width / (width - pad * 2), bounds.height / (height - pad * 2));
  return { x: bounds.x - margin, y: bounds.y - margin, width: bounds.width + margin * 2, height: bounds.height + margin * 2 };
}
/** Map units covered by one screen pixel when the view box is fitted into the stage. */
export function planUnitsPerPixel(viewBox: PlanViewBox, size: PlanSize = PLAN_FALLBACK_SIZE): number {
  return Math.max(viewBox.width / usable(size.width, PLAN_FALLBACK_SIZE.width), viewBox.height / usable(size.height, PLAN_FALLBACK_SIZE.height));
}

const fixed = (value: number) => Math.round(value * 100) / 100 + 0;
/** `points` attribute of the real outline (rect, ellipse, polygon or tilted box), or null when it cannot be drawn. */
export function planOutlinePoints(node: BackgroundSpace | BackgroundSymbol): string | null {
  const outline = nodePlanOutline(node);
  if (outline.length < 3 || !outline.every(finitePoint)) return null;
  return outline.map(point => `${fixed(point.x)},${fixed(point.y)}`).join(' ');
}

/** What stands for the line of sight on the plan. A vertical camera never gets a horizontal arrow. */
export type PlanSightMark = 'arrow' | 'up' | 'down' | 'none';
export function planSightMark(projection: CameraPlanProjection): PlanSightMark {
  if (projection.vertical) return projection.vertical;
  const reach = Math.hypot(projection.direction.x, projection.direction.y);
  return Number.isFinite(reach) && reach > 0 ? 'arrow' : 'none';
}
/** Unit heading and horizontal share (cos pitch) of a non-vertical line of sight. */
function sight(projection: CameraPlanProjection): { unit: BackgroundPoint; reach: number } | null {
  if (planSightMark(projection) !== 'arrow' || !finitePoint(projection.position)) return null;
  const length = Math.hypot(projection.direction.x, projection.direction.y);
  return { unit: { x: projection.direction.x / length, y: projection.direction.y / length }, reach: length };
}
/**
 * End of the arrow shaft. It leaves the edge of the camera dot and its length follows the
 * horizontal share of the line of sight, so a steep camera has a short arrow and a vertical one none.
 */
export function planArrowTip(projection: CameraPlanProjection, unitsPerPixel: number): BackgroundPoint | null {
  const line = sight(projection);
  return line && along(projection.position, line.unit, (PLAN_MARK.dot + PLAN_MARK.arrow * line.reach) * unitsPerPixel);
}

export type PlanCameraGlyph = {
  position: BackgroundPoint;
  vertical: 'up' | 'down' | null;
  /** Horizontal share of the line of sight: cos(pitch), 0 when vertical. */
  reach: number;
  /** Line of sight on the plan; null when vertical. */
  arrow: { start: BackgroundPoint; tip: BackgroundPoint; head: BackgroundPoint[] } | null;
  /** Horizontal field of view shrunk by `reach`: a direction hint, not the visible floor area. Null once it would hide under the dot. */
  fan: { from: BackgroundPoint; to: BackgroundPoint; radius: number; largeArc: boolean } | null;
  /** Stored yaw of a vertical camera: where it will face once tilted back. Never a line of sight. */
  tick: { from: BackgroundPoint; to: BackgroundPoint } | null;
};
/** Everything needed to draw one camera, in map units. Null when its position cannot be drawn. */
export function planCameraGlyph(camera: BackgroundCamera, unitsPerPixel: number): PlanCameraGlyph | null {
  const projection = projectCameraToPlan(camera), position = projection.position;
  if (!finitePoint(position) || !Number.isFinite(unitsPerPixel)) return null;
  const mark = planSightMark(projection), line = sight(projection), tip = planArrowTip(projection, unitsPerPixel);
  if (line && tip) {
    const heading = Math.atan2(line.unit.y, line.unit.x), radius = PLAN_MARK.fan * line.reach * unitsPerPixel;
    const half = Number.isFinite(camera.fov) && PLAN_MARK.fan * line.reach > PLAN_MARK.dot * 1.5 ? clamp(camera.fov, 1, 359) / 2 * RADIANS : null;
    const edge = (turn: number): BackgroundPoint => ({ x: position.x + Math.cos(turn) * radius, y: position.y + Math.sin(turn) * radius });
    return { position, vertical: null, reach: line.reach, tick: null,
      arrow: { start: along(position, line.unit, PLAN_MARK.dot * unitsPerPixel), tip, head: arrowHead(tip, line.unit, PLAN_MARK.head * unitsPerPixel) },
      fan: half === null ? null : { from: edge(heading - half), to: edge(heading + half), radius, largeArc: half * 2 > Math.PI } };
  }
  if (mark !== 'up' && mark !== 'down') return { position, vertical: null, reach: 0, arrow: null, fan: null, tick: null };
  const yaw = cameraAngles(camera).angle * RADIANS, unit = { x: Math.cos(yaw), y: Math.sin(yaw) }, start = PLAN_MARK.glyph + PLAN_MARK.tickGap;
  return { position, vertical: mark, reach: 0, arrow: null, fan: null,
    tick: finitePoint(unit) ? { from: along(position, unit, start * unitsPerPixel), to: along(position, unit, (start + PLAN_MARK.tick) * unitsPerPixel) } : null };
}

export function planSelectedNode(map: BackgroundMap, selectedId: string | null): BackgroundNode | null {
  return selectedId === null ? null : map.nodes.find(node => node.id === selectedId) ?? null;
}
/**
 * Whether a plan point lies on a camera or symbol as a plan draws it: within `reach` of its anchor (the camera's body),
 * inside the symbol's own box, or in the camera's fan of radius `fan` (0 when the plan draws none).
 * Spaces do not stack, so they never count.
 */
export function planNodeCovers(node: BackgroundNode, point: BackgroundPoint, reach: number, fan = 0): boolean {
  if (node.type === 'space') return false;
  const anchor = node.type === 'symbol' ? { x: node.x + node.width / 2, y: node.y + node.height / 2 } : node;
  const dx = point.x - anchor.x, dy = point.y - anchor.y, distance = Math.hypot(dx, dy);
  if (distance <= reach) return true;
  if (node.type === 'symbol') {
    const turn = -node.rotation * RADIANS, x = dx * Math.cos(turn) - dy * Math.sin(turn), y = dx * Math.sin(turn) + dy * Math.cos(turn);
    return Math.abs(x) <= node.width / 2 && Math.abs(y) <= node.height / 2;
  }
  // The fan shrinks with the horizontal share of the line of sight; a vertical camera has none.
  const line = sight(projectCameraToPlan(node));
  if (!line || !(fan > 0) || distance > fan * line.reach) return false;
  return Math.abs(normalizeSignedDegrees(Math.atan2(dy, dx) / RADIANS - Math.atan2(line.unit.y, line.unit.x) / RADIANS)) <= node.fov / 2;
}
/**
 * Members of the stack on `hitId` that take turns on a click, in map order. With `covers`, only what really lies
 * under the pointer takes part: a camera stacked on the centre of a table is no part of a click on the table's corner.
 */
export function planStackUnder(map: BackgroundMap, hitId: string, tolerance?: number, covers?: (node: BackgroundNode) => boolean): string[] {
  const stack = stackedMapNodeIds(map, hitId, tolerance);
  if (!covers) return stack;
  return stack.filter(id => id === hitId || map.nodes.some(node => node.id === id && covers(node)));
}
/**
 * The nodes that take turns on a click at `point`, the first picked one first. Kinds are not mixed: on a camera or
 * symbol it is the stack of planStackUnder; on a space it is every space that holds the point, the smallest first.
 */
export function planPileAt(map: BackgroundMap, hitId: string, point: BackgroundPoint, tolerance?: number, covers?: (node: BackgroundNode) => boolean): string[] {
  if (map.nodes.find(node => node.id === hitId)?.type !== 'space') return planStackUnder(map, hitId, tolerance, covers);
  const pile = spacesAt(map, point).map(space => space.id);
  // The outer half of an outline is pressed without the space holding the point.
  return pile.includes(hitId) ? pile : [hitId];
}
/**
 * Selection after a click on `hitId`. When the current selection already sits in the same stack,
 * the click moves on to the next item, so cameras created on the same spot can each be picked.
 * A clicked space is taken as it is, unless the same spot is clicked again (`again`, with the clicked `point`): then the
 * click moves on to the space under the selected one, and a repeated click of its click sequence (`repeat`) leaves that one selected.
 */
export function nextPlanSelection(map: BackgroundMap, hitId: string, selectedId: string | null, tolerance?: number, covers?: (node: BackgroundNode) => boolean, point?: BackgroundPoint, again = false, repeat = false): string {
  if (map.nodes.find(node => node.id === hitId)?.type === 'space') {
    // A space has a pile only on the same spot again: a first click takes the pressed one, which is on top there.
    if (!point || !again) return hitId;
    const pile = planPileAt(map, hitId, point, tolerance, covers);
    if (selectedId === null || !pile.includes(selectedId)) return hitId;
    // A repeated click neither steps on nor goes back to the top one.
    if (repeat) return selectedId;
    return pile[(pile.indexOf(selectedId) + 1) % pile.length];
  }
  const stack = planStackUnder(map, hitId, tolerance, covers), at = selectedId === null ? -1 : stack.indexOf(selectedId);
  return at < 0 || stack.length < 2 ? hitId : stack[(at + 1) % stack.length];
}

/** Display only: rounded text never goes back into the map. */
export function planNumber(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value) + 0) : '–';
}
export function planDegrees(value: number): string {
  return Number.isFinite(value) ? `${Math.round(normalizeDegrees(value)) % 360}°` : '–';
}
export function planNodeName(node: BackgroundNode): string {
  return node.name.trim() || '이름 없음';
}
/** Accessible name of a node on the plan: its name and what it is. */
export function planNodeLabel(node: BackgroundNode): string {
  return `${planNodeName(node)}, ${PLAN_KIND_LABELS[node.type]}`;
}

export type PlanReadoutItem = { key: 'direction' | 'pitch' | 'elevation' | 'fov' | 'floor' | 'volume'; label: string; value: string };
export type PlanReadout = { name: string; kind: string; vertical: 'up' | 'down' | null; items: PlanReadoutItem[] };
export function planReadoutText(item: PlanReadoutItem): string {
  return item.label ? `${item.label} ${item.value}` : item.value;
}
/** Name, horizontal direction, up/down view, lens height and field of view of a camera. Roll is not part of it. */
export function planCameraReadout(camera: BackgroundCamera): PlanReadout {
  const projection = projectCameraToPlan(camera);
  return { name: planNodeName(camera), kind: PLAN_KIND_LABELS.camera, vertical: projection.vertical, items: [
    { key: 'direction', label: '방향', value: planDegrees(cameraAngles(camera).angle) },
    { key: 'pitch', label: '', value: cameraPitchLabel(projection.pitch) },
    { key: 'elevation', label: '높이', value: planNumber(projection.elevation) },
    { key: 'fov', label: '화각', value: `${planNumber(camera.fov)}°` },
  ] };
}
/** Floor level and vertical size of a space or symbol. The plan depth (`height`) is never shown as a height. */
export function planVolumeReadout(node: BackgroundSpace | BackgroundSymbol): PlanReadout {
  return { name: planNodeName(node), kind: PLAN_KIND_LABELS[node.type], vertical: null, items: [
    { key: 'floor', label: '바닥 높이', value: planNumber(nodeElevation(node)) },
    { key: 'volume', label: '입체 높이', value: planNumber(nodeVolumeHeight(node)) },
  ] };
}
export function planNodeReadout(node: BackgroundNode): PlanReadout {
  return node.type === 'camera' ? planCameraReadout(node) : planVolumeReadout(node);
}
/** One line for the collapsed header, e.g. `카메라 1 · 방향 137° · 아래 45° · 높이 120`. */
export function planNodeSummary(node: BackgroundNode): string {
  const readout = planNodeReadout(node);
  return [readout.name, ...readout.items.filter(item => item.key !== 'fov').map(planReadoutText)].join(' · ');
}

/**
 * Fixed drawing box of the side view. +x is the way the camera faces, y grows downwards.
 * The lens travels between `top` and `bottom`, which leaves room for a vertical arrow at either end.
 */
export const PLAN_SIDE_VIEW = { width: 132, height: 84, left: 8, right: 124, top: 22, bottom: 62, cameraX: 44, dot: 4.5, arrow: 34, head: 7, edge: 2 } as const;
export type PlanSideView = {
  /** Level 0 of the map. */
  floorY: number;
  /** Lens: its height above the floor line is proportional to the elevation. */
  camera: BackgroundPoint;
  /** Arrow at the pitch angle: straight up or down when vertical. */
  tip: BackgroundPoint;
  head: BackgroundPoint[];
  /** Floor and top of the camera's own space, when it has one. */
  room: { top: number; bottom: number } | null;
};
/** Side elevation of one camera: how high it is and how far up or down it looks. */
export function planSideView(map: BackgroundMap, camera: BackgroundCamera): PlanSideView {
  const box = PLAN_SIDE_VIEW, projection = projectCameraToPlan(camera);
  const elevation = Number.isFinite(projection.elevation) ? projection.elevation : MAP_SPATIAL_DEFAULTS.cameraElevation;
  let low = Math.min(0, elevation), high = Math.max(0, elevation), spaces = 0, own: { floor: number; top: number } | null = null;
  for (const node of map.nodes) {
    if (node.type !== 'space') continue;
    const floor = nodeElevation(node), top = floor + nodeVolumeHeight(node);
    if (!Number.isFinite(floor) || !Number.isFinite(top)) continue;
    low = Math.min(low, floor, top); high = Math.max(high, floor, top); spaces++;
    if (node.id === camera.spaceId) own = { floor, top };
  }
  // Without any space the default room height is the yardstick, so the camera still moves as it is lifted.
  if (!spaces) high = Math.max(high, MAP_SPATIAL_DEFAULTS.spaceVolumeHeight);
  const span = Math.max(high - low, 1), y = (level: number) => box.bottom - (level - low) / span * (box.bottom - box.top);
  const lens = { x: box.cameraX, y: y(elevation) };
  const tilt = (Number.isFinite(projection.pitch) ? clamp(projection.pitch, -90, 90) : 0) * RADIANS;
  const unit = { x: Math.cos(tilt), y: -Math.sin(tilt) + 0 };
  // The angle is exact; only the length gives way so a steep arrow stays inside the box. A level one always fits.
  const reach = unit.y < 0 ? (lens.y - box.edge) / -unit.y : unit.y > 0 ? (box.height - box.edge - lens.y) / unit.y : Infinity;
  const tip = along(lens, unit, Math.min(box.arrow, reach - box.head));
  return { floorY: y(0), camera: lens, tip, head: arrowHead(tip, unit, box.head), room: own && { top: y(own.top), bottom: y(own.floor) } };
}
