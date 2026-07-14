export type TetrisPiece = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';
// 회전 상태: 0=spawn, 1=R(시계), 2=180, 3=L(반시계)
export type TetrisRotation = 0 | 1 | 2 | 3;

export interface TetrisPoint {
  readonly x: number;
  readonly y: number;
}

export type TetrisStatus = 'running' | 'dead';

export interface TetrisActive {
  readonly piece: TetrisPiece;
  readonly rotation: TetrisRotation;
  readonly x: number; // 박스 원점 열(보드 좌표)
  readonly y: number; // 박스 원점 행(보드 좌표)
}

export interface TetrisStats {
  readonly maxLineClear: number; // 한 번에 지운 최대 라인 수
  readonly levelReached: number; // 도달 최고 레벨
}

export interface TetrisState {
  readonly board: readonly (readonly (TetrisPiece | null)[])[]; // [y][x], 22행 × 10열
  readonly active: TetrisActive;
  readonly hold: TetrisPiece | null;
  readonly holdUsed: boolean; // 이번 피스에 홀드를 이미 썼는지
  readonly queue: readonly TetrisPiece[]; // 다음 조각(Next 5 보장)
  readonly bag: readonly TetrisPiece[]; // 현재 7-bag 잔여
  readonly level: number;
  readonly lines: number;
  readonly score: number;
  readonly combo: number; // -1=콤보 없음, 0=첫 클리어, 1,2,…
  readonly softDrop: boolean;
  readonly gravityElapsedMs: number; // 중력 누적기
  readonly lockElapsedMs: number; // 접지 후 경과(락 딜레이)
  readonly lockResets: number; // 이번 피스 락 리셋 횟수(최대 15)
  readonly status: TetrisStatus;
  readonly stats: TetrisStats;
  readonly rngState: number;
}

export type TetrisInput =
  | 'left'
  | 'right'
  | 'softDropOn'
  | 'softDropOff'
  | 'rotateCw'
  | 'rotateCcw'
  | 'hardDrop'
  | 'hold';

export const TETRIS_COLS = 10;
export const TETRIS_ROWS = 22; // y 0~1 숨김, 가시 2~21
export const TETRIS_HIDDEN_ROWS = 2;
