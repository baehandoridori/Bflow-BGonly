import type { BackgroundMap, BackgroundNode } from './types.ts';
import { MAP_SPATIAL_LIMITS, cameraAngles, isRoadSpace, nodeAngles, nodeElevation, nodeVolumeHeight, normalizeDegrees } from './mapSpatial.ts';
import { placeMapNode, replaceMapNode, transformMapSpace } from './mapGeometry.ts';

/** A number of a map node that the inspector shows as a field. */
export type MapNumberKey = 'elevation' | 'volumeHeight' | 'angle' | 'pitch' | 'roll' | 'fov' | 'x' | 'y' | 'width' | 'height' | 'rotation';
/**
 * `min`/`max`: what typing accepts and a slide stops at (infinite for a direction). `step`/`big`: one step of a slide, and one with
 * Shift held. `wrap`: a direction, kept at 0 or more and under 360. `track`: the two ends of the bar, or null for no bar.
 */
export type MapNumberRule = { min: number; max: number; step: number; big: number; wrap: boolean; track: { min: number; max: number } | null };
/** Saved limits of a plan box, as in mapGeometry.ts: no position and no side beyond the first, no side under the second. */
const PLAN_LIMIT = 100000, MIN_PLAN_SIZE = 10;
/** The one table the fourteen number fields of the inspector read. Every limit is inside what a map may store. */
export const MAP_NUMBER_FIELDS: Readonly<Record<MapNumberKey, MapNumberRule>> = {
  elevation: { min: MAP_SPATIAL_LIMITS.elevation.min, max: MAP_SPATIAL_LIMITS.elevation.max, step: 1, big: 10, wrap: false, track: null },
  volumeHeight: { min: MAP_SPATIAL_LIMITS.volumeHeight.min, max: MAP_SPATIAL_LIMITS.volumeHeight.max, step: 1, big: 10, wrap: false, track: null },
  x: { min: -PLAN_LIMIT, max: PLAN_LIMIT, step: 1, big: 10, wrap: false, track: null },
  y: { min: -PLAN_LIMIT, max: PLAN_LIMIT, step: 1, big: 10, wrap: false, track: null },
  width: { min: MIN_PLAN_SIZE, max: PLAN_LIMIT, step: 1, big: 10, wrap: false, track: null },
  height: { min: MIN_PLAN_SIZE, max: PLAN_LIMIT, step: 1, big: 10, wrap: false, track: null },
  angle: { min: -Infinity, max: Infinity, step: 1, big: 15, wrap: true, track: { min: 0, max: 359 } },
  rotation: { min: -Infinity, max: Infinity, step: 1, big: 15, wrap: true, track: { min: 0, max: 359 } },
  pitch: { min: MAP_SPATIAL_LIMITS.pitch.min, max: MAP_SPATIAL_LIMITS.pitch.max, step: 1, big: 15, wrap: false, track: { min: -90, max: 90 } },
  roll: { min: MAP_SPATIAL_LIMITS.roll.min, max: MAP_SPATIAL_LIMITS.roll.max, step: 1, big: 15, wrap: false, track: { min: -180, max: 180 } },
  fov: { min: 10, max: 170, step: 1, big: 10, wrap: false, track: { min: 10, max: 170 } },
};
/** Screen pixels of a slide. Tuned by eye in the app: tests read these names, never the numbers. `thumbPx` is the width of the dot in the stylesheet too: the two change together. */
export const MAP_NUMBER_SCRUB = { slopPx: 4, stepPx: 2, bigStepPx: 6, grabPx: 7, thumbPx: 10 } as const;

/** The number as the inspector shows it (a missing optional key reads as its default). Null: this kind of node has no such number. */
export function mapNodeNumber(node: BackgroundNode, key: MapNumberKey): number | null {
  switch (key) {
    case 'elevation': return nodeElevation(node);
    // A road has no walls, so no height of its own: one stored while it was a room is not shown.
    case 'volumeHeight': return node.type === 'camera' || (node.type === 'space' && isRoadSpace(node)) ? null : nodeVolumeHeight(node);
    case 'angle': case 'fov': return node.type === 'camera' ? node[key] : null;
    // A space stays upright: only a camera and an object have a tilt to show.
    case 'pitch': case 'roll': return node.type === 'camera' ? cameraAngles(node)[key] : node.type === 'symbol' ? nodeAngles(node)[key] : null;
    case 'x': case 'y': return node[key];
    case 'width': case 'height': case 'rotation': return node.type === 'camera' ? null : node[key];
  }
}
/** A value as it may be stored: a direction wrapped, anything else held inside its limits. NaN for a value that is no number. */
export function settleNumber(value: number, key: MapNumberKey): number {
  const rule = MAP_NUMBER_FIELDS[key];
  if (!Number.isFinite(value)) return Number.NaN;
  return (rule.wrap ? normalizeDegrees(value) : Math.min(rule.max, Math.max(rule.min, value))) + 0;
}
/** The map with that number set, or the SAME map object when nothing is to be written: no optional key is invented. */
export function setMapNodeNumber(map: BackgroundMap, id: string, key: MapNumberKey, value: number): BackgroundMap {
  const node = map.nodes.find(item => item.id === id), current = node && !node.locked ? mapNodeNumber(node, key) : null;
  // Asked before the value is settled: a number stored outside the limits (a field of view of 175) is not rewritten by a drag that never moved.
  if (!node || current === null || !Number.isFinite(value) || value === current) return map;
  const next = settleNumber(value, key);
  if (next === current) return map;
  // A space carries its cameras and objects along, here as when the number is typed.
  if (key === 'x' || key === 'y') return placeMapNode(map, id, key === 'x' ? { x: next, y: node.y } : { x: node.x, y: next });
  const changed = { ...node, [key]: next } as BackgroundNode;
  return changed.type === 'space' ? transformMapSpace(map, changed) : replaceMapNode(map, changed);
}

/** Whole steps of a sideways drag of `dx` pixels: towards zero, so the first step takes a full step of travel. */
export function scrubSteps(dx: number, big: boolean): number {
  return Number.isFinite(dx) ? Math.trunc(dx / (big ? MAP_NUMBER_SCRUB.bigStepPx : MAP_NUMBER_SCRUB.stepPx)) + 0 : 0;
}
/** `start` moved by whole steps. Zero steps: `start` itself, decimals and all. */
export function stepNumber(start: number, steps: number, key: MapNumberKey, big: boolean): number {
  if (!steps || !Number.isFinite(start) || !Number.isFinite(steps)) return start;
  const rule = MAP_NUMBER_FIELDS[key], grid = big ? rule.big : rule.step;
  // Off the grid, the first step lands on the next grid value in the direction of travel.
  const base = (steps > 0 ? Math.floor(start / grid) : Math.ceil(start / grid)) * grid;
  return settleNumber(base + steps * grid, key);
}
/** Where the dot of the bar stands, 0 to 1. 0 for a field without a bar. */
export function trackFraction(value: number, key: MapNumberKey): number {
  const rule = MAP_NUMBER_FIELDS[key], track = rule.track;
  if (!track || !Number.isFinite(value)) return 0;
  // A direction stands where the bar shows it, inside the turn. A value stored beyond an end of the bar stands at that end.
  const shown = rule.wrap ? normalizeDegrees(value) : value;
  return Math.min(1, Math.max(0, (shown - track.min) / (track.max - track.min)));
}
/** The value at `fraction` of the bar: a whole step, or `start` itself where that is as near or nearer. `start` for a field without a bar. */
export function trackNumber(fraction: number, key: MapNumberKey, big: boolean, start: number): number {
  const rule = MAP_NUMBER_FIELDS[key], track = rule.track;
  if (!track || !Number.isFinite(fraction)) return start;
  const grid = big ? rule.big : rule.step, raw = track.min + Math.min(1, Math.max(0, fraction)) * (track.max - track.min);
  const rounded = Math.round(raw / grid) * grid;
  // The ends of a bar are not always on the grid (359 with steps of 15): the last grid value inside the bar stands for them.
  const snapped = (rounded > track.max ? Math.floor(track.max / grid) * grid : rounded < track.min ? Math.ceil(track.min / grid) * grid : rounded) + 0;
  const shown = rule.wrap ? normalizeDegrees(start) : start;
  return Math.abs(raw - shown) <= Math.abs(raw - snapped) ? start : snapped;
}

/** A slide of a field in progress: the pointer x its steps are counted from and the value there, the grid it is on, and the value on show. */
export type MapNumberSlide = { anchorX: number; anchorValue: number; big: boolean; value: number };
/**
 * The value of a slide with the pointer at `x`: a matter of where the pointer is, never of how its moves arrive. `slide` is
 * brought up to date in place. Shift pressed or released on the way: it goes on from the value on show, on the other grid.
 */
export function slideNumber(slide: MapNumberSlide, x: number, big: boolean, key: MapNumberKey): number {
  if (big !== slide.big) { slide.anchorX = x; slide.anchorValue = slide.value; slide.big = big; }
  return slide.value = stepNumber(slide.anchorValue, scrubSteps(x - slide.anchorX, slide.big), key, slide.big);
}
/**
 * A press on the bar at `x`, the bar standing at `left` and `width` wide on screen. On the dot (within `grabPx` of its centre)
 * the press keeps the offset it was grabbed with, and nothing changes until it is dragged. Anywhere else the value goes to the
 * press at once (`immediate`). `fraction` is where a pointer then stands on the bar, for trackNumber. Null: too narrow for its dot.
 */
export function pressNumberTrack(value: number, key: MapNumberKey, x: number, left: number, width: number): { immediate: boolean; fraction(x: number): number } | null {
  // The centre of the dot travels from half a dot inside one end to half a dot inside the other, as it is drawn (3.5).
  const half = MAP_NUMBER_SCRUB.thumbPx / 2, usable = width - MAP_NUMBER_SCRUB.thumbPx;
  if (!(usable > 0)) return null;
  const dotX = left + half + trackFraction(value, key) * usable, onDot = Math.abs(x - dotX) <= MAP_NUMBER_SCRUB.grabPx, offset = onDot ? dotX - x : 0;
  return { immediate: !onDot, fraction: pointerX => (pointerX + offset - left - half) / usable };
}
