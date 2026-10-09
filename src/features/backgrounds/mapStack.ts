import { containsPoint } from './mapGeometry.ts';
import { isRoadSpace } from './mapSpatial.ts';
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
