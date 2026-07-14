import { refillQueue } from './bag.ts';
import { PIECE_CELLS } from './pieces.ts';
import { kicksFor } from './srs.ts';
import {
  TETRIS_COLS as COLS,
  TETRIS_ROWS as ROWS,
  type TetrisActive,
  type TetrisInput,
  type TetrisPiece,
  type TetrisPoint,
  type TetrisRotation,
  type TetrisState,
} from './types.ts';

// 테트리스 순수 엔진 — 규칙은 계획서 §Task 11 이 정본. 모든 업데이트는 불변.

const GRAVITY_MS = [1000, 850, 720, 600, 490, 390, 310, 240, 180, 140, 105, 80, 60, 45, 35] as const;
const SOFT_DROP_MS = 50;
const LOCK_DELAY_MS = 500;
const MAX_LOCK_RESETS = 15;
const LINE_SCORES = [0, 100, 300, 500, 800] as const;
const COMBO_UNIT = 50;
// 서버 RPC 상한과 일치 — 초과 점수는 저장이 거부되므로(입장료 내고 결과 못 남김) 엔진에서 미리 캡한다.
export const TETRIS_MAX_SCORE = 3_000_000;
const SPAWN_X = 3;
const SPAWN_Y = 0;
const NEXT_MIN = 5;

function emptyBoard(): (TetrisPiece | null)[][] {
  return Array.from({ length: ROWS }, () => new Array<TetrisPiece | null>(COLS).fill(null));
}

function gravityFor(level: number): number {
  return GRAVITY_MS[Math.min(GRAVITY_MS.length, Math.max(1, level)) - 1];
}

function moveActive(active: TetrisActive, dx: number, dy: number): TetrisActive {
  return { ...active, x: active.x + dx, y: active.y + dy };
}

function pieceCells(active: TetrisActive): TetrisPoint[] {
  return PIECE_CELLS[active.piece][active.rotation].map(([c, r]) => ({ x: active.x + c, y: active.y + r }));
}

// 조각의 현재 보드 셀(렌더·테스트용).
export function tetrisPieceCells(active: TetrisActive): TetrisPoint[] {
  return pieceCells(active);
}

// 하드드롭 시 고정될 위치(고스트 피스 렌더용).
export function tetrisGhost(state: TetrisState): TetrisActive {
  let active = state.active;
  while (!collides(state.board, pieceCells(moveActive(active, 0, 1)))) {
    active = moveActive(active, 0, 1);
  }
  return active;
}

function collides(board: readonly (readonly (TetrisPiece | null)[])[], cells: readonly TetrisPoint[]): boolean {
  return cells.some(({ x, y }) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x] !== null));
}

function isGrounded(state: TetrisState): boolean {
  return collides(state.board, pieceCells(moveActive(state.active, 0, 1)));
}

function spawn(piece: TetrisPiece): TetrisActive {
  return { piece, rotation: 0, x: SPAWN_X, y: SPAWN_Y };
}

export function createTetrisGame(seed: number): TetrisState {
  const board = emptyBoard();
  const start = refillQueue([], [], seed, NEXT_MIN + 1); // 첫 피스 + Next 5
  const [first, ...rest] = start.queue;
  const refilled = refillQueue(rest, start.bag, start.rngState, NEXT_MIN);
  const active = spawn(first);
  return {
    board,
    active,
    hold: null,
    holdUsed: false,
    queue: refilled.queue,
    bag: refilled.bag,
    level: 1,
    lines: 0,
    score: 0,
    combo: -1,
    softDrop: false,
    gravityElapsedMs: 0,
    lockElapsedMs: 0,
    lockResets: 0,
    status: collides(board, pieceCells(active)) ? 'dead' : 'running',
    stats: { maxLineClear: 0, levelReached: 1 },
    rngState: refilled.rngState,
  };
}

// 현재 피스를 보드에 고정하고, 꽉 찬 줄 제거·점수·콤보·레벨을 갱신한 뒤 다음 피스를 스폰한다.
function lockPiece(state: TetrisState): TetrisState {
  const board = state.board.map((row) => [...row]);
  for (const cell of pieceCells(state.active)) {
    if (cell.y >= 0 && cell.y < ROWS && cell.x >= 0 && cell.x < COLS) {
      board[cell.y][cell.x] = state.active.piece;
    }
  }
  const survivors = board.filter((row) => row.some((cell) => cell === null));
  const cleared = ROWS - survivors.length;
  while (survivors.length < ROWS) survivors.unshift(new Array<TetrisPiece | null>(COLS).fill(null));

  let score = state.score;
  let combo = state.combo;
  if (cleared > 0) {
    score += LINE_SCORES[cleared] * state.level;
    combo += 1;
    score += COMBO_UNIT * combo * state.level; // 첫 클리어 combo=0 → 보너스 0
  } else {
    combo = -1;
  }
  const lines = state.lines + cleared;
  const level = Math.min(15, Math.floor(lines / 10) + 1);
  const stats = {
    maxLineClear: Math.max(state.stats.maxLineClear, cleared),
    levelReached: Math.max(state.stats.levelReached, level),
  };

  const [next, ...rest] = state.queue;
  const refilled = refillQueue(rest, state.bag, state.rngState, NEXT_MIN);
  const active = spawn(next);
  const dead = collides(survivors, pieceCells(active)); // block out

  return {
    ...state,
    board: survivors,
    active,
    holdUsed: false,
    queue: refilled.queue,
    bag: refilled.bag,
    rngState: refilled.rngState,
    level,
    lines,
    score: Math.min(TETRIS_MAX_SCORE, score),
    combo,
    gravityElapsedMs: 0,
    lockElapsedMs: 0,
    lockResets: 0,
    status: dead ? 'dead' : 'running',
    stats,
  };
}

// 이동/회전 성공 후 락 타이머 처리: 공중이면 리셋, 접지면 리셋(최대 15회)·초과 시 즉시 고정.
function afterSuccessfulMove(state: TetrisState): TetrisState {
  if (!isGrounded(state)) return { ...state, lockElapsedMs: 0 };
  if (state.lockResets >= MAX_LOCK_RESETS) return lockPiece(state);
  return { ...state, lockElapsedMs: 0, lockResets: state.lockResets + 1 };
}

function tryMove(state: TetrisState, dx: number, dy: number): TetrisState {
  const moved = moveActive(state.active, dx, dy);
  if (collides(state.board, pieceCells(moved))) return state;
  return afterSuccessfulMove({ ...state, active: moved });
}

function tryRotate(state: TetrisState, dir: 1 | -1): TetrisState {
  const from = state.active.rotation;
  const to = (((from + dir) % 4) + 4) % 4 as TetrisRotation;
  for (const [kx, ky] of kicksFor(state.active.piece, from, to)) {
    const candidate: TetrisActive = { ...state.active, rotation: to, x: state.active.x + kx, y: state.active.y + ky };
    if (!collides(state.board, pieceCells(candidate))) {
      return afterSuccessfulMove({ ...state, active: candidate });
    }
  }
  return state; // 5개 오프셋 전부 실패 → 회전 취소
}

function hardDrop(state: TetrisState): TetrisState {
  let active = state.active;
  let cells = 0;
  while (!collides(state.board, pieceCells(moveActive(active, 0, 1)))) {
    active = moveActive(active, 0, 1);
    cells += 1;
  }
  return lockPiece({ ...state, active, score: state.score + cells * 2 }); // 즉시 고정(락 딜레이 무시)
}

function holdPiece(state: TetrisState): TetrisState {
  if (state.holdUsed) return state;
  const current = state.active.piece;
  if (state.hold === null) {
    const [next, ...rest] = state.queue;
    const refilled = refillQueue(rest, state.bag, state.rngState, NEXT_MIN);
    const active = spawn(next);
    return {
      ...state,
      hold: current,
      holdUsed: true,
      active,
      queue: refilled.queue,
      bag: refilled.bag,
      rngState: refilled.rngState,
      gravityElapsedMs: 0,
      lockElapsedMs: 0,
      lockResets: 0,
      status: collides(state.board, pieceCells(active)) ? 'dead' : state.status,
    };
  }
  const active = spawn(state.hold);
  return {
    ...state,
    hold: current,
    holdUsed: true,
    active,
    gravityElapsedMs: 0,
    lockElapsedMs: 0,
    lockResets: 0,
    status: collides(state.board, pieceCells(active)) ? 'dead' : state.status,
  };
}

export function applyTetrisInput(state: TetrisState, input: TetrisInput): TetrisState {
  if (state.status !== 'running') return state;
  switch (input) {
    case 'left': return tryMove(state, -1, 0);
    case 'right': return tryMove(state, 1, 0);
    case 'softDropOn': return { ...state, softDrop: true, gravityElapsedMs: 0 };
    case 'softDropOff': return { ...state, softDrop: false };
    case 'rotateCw': return tryRotate(state, 1);
    case 'rotateCcw': return tryRotate(state, -1);
    case 'hardDrop': return hardDrop(state);
    case 'hold': return holdPiece(state);
    default: return state;
  }
}

export function tickTetris(state: TetrisState, elapsedMs: number): TetrisState {
  if (state.status !== 'running' || elapsedMs <= 0) return state;

  // 접지 상태면 락 딜레이를 진행하고 500ms 넘으면 고정한다.
  if (isGrounded(state)) {
    const lockElapsedMs = state.lockElapsedMs + elapsedMs;
    if (lockElapsedMs >= LOCK_DELAY_MS) return lockPiece(state);
    return { ...state, lockElapsedMs };
  }

  // 공중이면 중력(소프트드롭 50ms)으로 낙하한다.
  const interval = state.softDrop ? SOFT_DROP_MS : gravityFor(state.level);
  let gravityElapsedMs = state.gravityElapsedMs + elapsedMs;
  let active = state.active;
  let score = state.score;
  while (gravityElapsedMs >= interval) {
    const moved = moveActive(active, 0, 1);
    if (collides(state.board, pieceCells(moved))) break; // 접지 — 남은 시간은 다음 틱 락 딜레이로
    active = moved;
    gravityElapsedMs -= interval;
    if (state.softDrop) score += 1;
  }
  return { ...state, active, gravityElapsedMs, score: Math.min(TETRIS_MAX_SCORE, score), lockElapsedMs: 0 };
}
