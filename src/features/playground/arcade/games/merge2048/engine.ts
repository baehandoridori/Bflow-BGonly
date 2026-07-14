import type {
  Direction2048,
  ImpactTier2048,
  MoveResult2048,
  MoveTrace2048,
  RandomSource,
  State2048,
  TileMotion2048,
} from './types.ts';

const BOARD_SIDE = 4;
const BOARD_SIZE = BOARD_SIDE * BOARD_SIDE;
const VALID_DIRECTIONS = new Set<string>(['up', 'down', 'left', 'right']);

const MOVE_LINES: Record<Direction2048, readonly (readonly number[])[]> = {
  left: Array.from({ length: BOARD_SIDE }, (_, row) => (
    Array.from({ length: BOARD_SIDE }, (_, column) => row * BOARD_SIDE + column)
  )),
  right: Array.from({ length: BOARD_SIDE }, (_, row) => (
    Array.from({ length: BOARD_SIDE }, (_, column) => row * BOARD_SIDE + (BOARD_SIDE - 1 - column))
  )),
  up: Array.from({ length: BOARD_SIDE }, (_, column) => (
    Array.from({ length: BOARD_SIDE }, (_, row) => row * BOARD_SIDE + column)
  )),
  down: Array.from({ length: BOARD_SIDE }, (_, column) => (
    Array.from({ length: BOARD_SIDE }, (_, row) => (BOARD_SIDE - 1 - row) * BOARD_SIDE + column)
  )),
};

function normalizeRandom(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1 - Number.EPSILON;
  return value;
}

function assertValid2048Board(board: readonly number[]): void {
  if (!Array.isArray(board) || board.length !== BOARD_SIZE) {
    throw new Error('2048 board must contain exactly 16 cells.');
  }
  board.forEach((value, index) => {
    const validTile = value === 0 || (
      Number.isSafeInteger(value)
      && value > 0
      && value === 2 ** Math.round(Math.log2(value))
    );
    if (!validTile) {
      throw new Error(
        `2048 board[${index}] must be 0 or a finite safe integer power of two.`,
      );
    }
  });
}

function assertValid2048Direction(direction: Direction2048): void {
  if (!VALID_DIRECTIONS.has(direction)) {
    throw new Error(`Unsupported 2048 direction: ${String(direction)}`);
  }
}

function spawnTile(
  board: readonly number[],
  random: RandomSource,
): { board: readonly number[]; index: number | null } {
  const emptyIndices: number[] = [];
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    if (board[index] === 0) emptyIndices.push(index);
  }
  if (emptyIndices.length === 0) return { board, index: null };

  const selected = Math.floor(normalizeRandom(random()) * emptyIndices.length);
  const index = emptyIndices[selected];
  const value = normalizeRandom(random()) < 0.9 ? 2 : 4;
  const nextBoard = [...board];
  nextBoard[index] = value;
  return { board: nextBoard, index };
}

function stationaryTrace(board: readonly number[]): MoveTrace2048 {
  return {
    board: [...board],
    scoreGained: 0,
    changed: false,
    motions: [],
    mergedIndices: [],
    maxMerged: 0,
  };
}

function trace2048MoveUnchecked(
  board: readonly number[],
  direction: Direction2048,
): MoveTrace2048 {
  const nextBoard = Array<number>(BOARD_SIZE).fill(0);
  const motions: TileMotion2048[] = [];
  const mergedIndices: number[] = [];
  let scoreGained = 0;
  let maxMerged = 0;

  for (const line of MOVE_LINES[direction]) {
    const tiles = line
      .filter((index) => board[index] !== 0)
      .map((index) => ({ from: index, value: board[index] }));

    let readIndex = 0;
    let writeIndex = 0;
    while (readIndex < tiles.length) {
      const tile = tiles[readIndex];
      const nextTile = tiles[readIndex + 1];
      const destination = line[writeIndex];

      if (nextTile && nextTile.value === tile.value) {
        const mergedValue = tile.value * 2;
        nextBoard[destination] = mergedValue;
        motions.push(
          { from: tile.from, to: destination, value: tile.value, merged: true },
          { from: nextTile.from, to: destination, value: nextTile.value, merged: true },
        );
        mergedIndices.push(destination);
        scoreGained += mergedValue;
        maxMerged = Math.max(maxMerged, mergedValue);
        readIndex += 2;
      } else {
        nextBoard[destination] = tile.value;
        motions.push({ from: tile.from, to: destination, value: tile.value, merged: false });
        readIndex += 1;
      }
      writeIndex += 1;
    }
  }

  return {
    board: nextBoard,
    scoreGained,
    changed: board.some((value, index) => value !== nextBoard[index]),
    motions,
    mergedIndices,
    maxMerged,
  };
}

export function trace2048Move(
  board: readonly number[],
  direction: Direction2048,
): MoveTrace2048 {
  assertValid2048Board(board);
  assertValid2048Direction(direction);
  return trace2048MoveUnchecked(board, direction);
}

function canMove2048Unchecked(board: readonly number[]): boolean {
  if (board.some((value) => value === 0)) return true;

  for (let row = 0; row < BOARD_SIDE; row += 1) {
    for (let column = 0; column < BOARD_SIDE; column += 1) {
      const index = row * BOARD_SIDE + column;
      if (column + 1 < BOARD_SIDE && board[index] === board[index + 1]) return true;
      if (row + 1 < BOARD_SIDE && board[index] === board[index + BOARD_SIDE]) return true;
    }
  }
  return false;
}

export function canMove2048(board: readonly number[]): boolean {
  assertValid2048Board(board);
  return canMove2048Unchecked(board);
}

export function create2048State(random: RandomSource): State2048 {
  const first = spawnTile(Array<number>(BOARD_SIZE).fill(0), random);
  const second = spawnTile(first.board, random);
  const maxTile = Math.max(0, ...second.board);
  const state: State2048 = {
    board: second.board,
    score: 0,
    maxTile,
    status: 'running',
    reached2048: false,
  };
  assertValid2048Board(state.board);
  return state;
}

export function apply2048Move(
  state: State2048,
  direction: Direction2048,
  random: RandomSource,
): MoveResult2048 {
  assertValid2048Board(state.board);
  assertValid2048Direction(direction);
  if (state.status === 'over') {
    return { state, transition: stationaryTrace(state.board), spawnedIndex: null };
  }

  const transition = trace2048MoveUnchecked(state.board, direction);
  if (!transition.changed) {
    if (canMove2048Unchecked(state.board)) {
      return { state, transition, spawnedIndex: null };
    }
    return {
      state: { ...state, status: 'over' },
      transition,
      spawnedIndex: null,
    };
  }

  const spawned = spawnTile(transition.board, random);
  const maxTile = Math.max(state.maxTile, ...spawned.board);
  const nextState: State2048 = {
    board: spawned.board,
    score: state.score + transition.scoreGained,
    maxTile,
    status: canMove2048Unchecked(spawned.board) ? 'running' : 'over',
    reached2048: state.reached2048 || maxTile >= 2048,
  };
  return { state: nextState, transition, spawnedIndex: spawned.index };
}

export function impactTier2048(mergedValue: number): ImpactTier2048 {
  if (mergedValue >= 2048) return 'heavy';
  if (mergedValue >= 512) return 'medium';
  if (mergedValue >= 128) return 'soft';
  return 'none';
}
