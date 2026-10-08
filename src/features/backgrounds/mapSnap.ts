import type { BackgroundPoint } from './types.ts';

/** A line things stick to: x = at ('x', a vertical line) or y = at. `from`/`to` is its extent along the other axis. */
export type SnapLine = { axis: 'x' | 'y'; at: number; from: number; to: number };
export type SnapGuide = SnapLine;
export type SnapBox = { left: number; right: number; top: number; bottom: number };
export type SnapCandidates = { x: readonly SnapLine[]; y: readonly SnapLine[]; points: readonly BackgroundPoint[] };
