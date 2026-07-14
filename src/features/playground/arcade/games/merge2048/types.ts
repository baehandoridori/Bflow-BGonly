export type Direction2048 = 'up' | 'down' | 'left' | 'right';

export type ImpactTier2048 = 'none' | 'soft' | 'medium' | 'heavy';

export type Status2048 = 'running' | 'over';

export type RandomSource = () => number;

export interface TileMotion2048 {
  readonly from: number;
  readonly to: number;
  readonly value: number;
  readonly merged: boolean;
}

export interface MoveTrace2048 {
  /** 합성이 끝났지만 새 타일은 아직 생성되지 않은 보드 */
  readonly board: readonly number[];
  readonly scoreGained: number;
  readonly changed: boolean;
  readonly motions: readonly TileMotion2048[];
  readonly mergedIndices: readonly number[];
  readonly maxMerged: number;
}

export interface State2048 {
  readonly board: readonly number[];
  readonly score: number;
  readonly maxTile: number;
  readonly status: Status2048;
  readonly reached2048: boolean;
}

export interface MoveResult2048 {
  readonly state: State2048;
  readonly transition: MoveTrace2048;
  readonly spawnedIndex: number | null;
}
