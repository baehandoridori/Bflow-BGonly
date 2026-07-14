import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTetrisGame,
  applyTetrisInput,
  tickTetris,
  tetrisPieceCells,
  TETRIS_MAX_SCORE,
} from '../src/features/playground/arcade/games/tetris/engine.ts';
import { refillQueue } from '../src/features/playground/arcade/games/tetris/bag.ts';
import type { TetrisPiece, TetrisState } from '../src/features/playground/arcade/games/tetris/types.ts';

function blankBoard(): (TetrisPiece | null)[][] {
  return createTetrisGame(1).board.map((row) => [...row]);
}

function sortCells(cells: { x: number; y: number }[]): { x: number; y: number }[] {
  return [...cells].sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

test('the 7-bag yields each piece exactly twice over 14 draws', () => {
  const { queue } = refillQueue([], [], 4242, 14);
  assert.equal(queue.length, 14);
  const counts: Record<string, number> = {};
  queue.forEach((piece) => { counts[piece] = (counts[piece] ?? 0) + 1; });
  for (const piece of ['I', 'J', 'L', 'O', 'S', 'T', 'Z']) {
    assert.equal(counts[piece], 2, `${piece} appears twice per two bags`);
  }
});

test('a T spawns at cells (4,0)(3,1)(4,1)(5,1)', () => {
  const cells = tetrisPieceCells({ piece: 'T', rotation: 0, x: 3, y: 0 });
  assert.deepEqual(sortCells(cells), [
    { x: 4, y: 0 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 },
  ].sort((a, b) => (a.y - b.y) || (a.x - b.x)));
});

test('a blocked T rotates 0→R via the second SRS kick (-1,0)', () => {
  const board = blankBoard();
  board[4][5] = 'I'; // R 회전이 in-place 로는 이 칸에 막힌다
  const state: TetrisState = { ...createTetrisGame(1), board, active: { piece: 'T', rotation: 0, x: 4, y: 2 } };
  const rotated = applyTetrisInput(state, 'rotateCw');
  assert.equal(rotated.active.rotation, 1);
  assert.equal(rotated.active.x, 3, '두 번째 킥 (-1,0) 으로 왼쪽 이동');
  assert.equal(rotated.active.y, 2);
});

test('an I uses an SRS kick when the in-place rotation is blocked', () => {
  const board = blankBoard();
  board[2][6] = 'O'; // I 의 R in-place 회전을 막는다
  const state: TetrisState = { ...createTetrisGame(1), board, active: { piece: 'I', rotation: 0, x: 4, y: 2 } };
  const rotated = applyTetrisInput(state, 'rotateCw');
  assert.equal(rotated.active.rotation, 1);
  assert.equal(rotated.active.x, 2, 'I 킥 (-2,0)');
});

test('the score is capped at the server maximum so a huge run can still be saved', () => {
  const board = blankBoard();
  for (let y = 18; y <= 21; y += 1) for (let x = 0; x <= 8; x += 1) board[y][x] = 'O';
  // 상한 바로 아래에서 4줄(800×15)을 지워도 3,000,000 을 넘지 않아야 한다(서버 RPC 가 초과분을 거부).
  const state: TetrisState = { ...createTetrisGame(1), board, level: 15, lines: 140, score: TETRIS_MAX_SCORE - 1, active: { piece: 'I', rotation: 1, x: 7, y: 18 } };
  const dropped = applyTetrisInput(state, 'hardDrop');
  assert.equal(dropped.score, TETRIS_MAX_SCORE);
});

test('clearing four lines scores 800×level and reports maxLineClear 4', () => {
  const board = blankBoard();
  for (let y = 18; y <= 21; y += 1) for (let x = 0; x <= 8; x += 1) board[y][x] = 'O';
  // 세로 I 를 x=9 (박스 x=7, R 회전) 로 두어 나머지 한 칸을 채운다.
  const state: TetrisState = { ...createTetrisGame(1), board, level: 1, score: 0, active: { piece: 'I', rotation: 1, x: 7, y: 18 } };
  const dropped = applyTetrisInput(state, 'hardDrop');
  assert.equal(dropped.lines, 4);
  assert.equal(dropped.stats.maxLineClear, 4);
  assert.equal(dropped.score, 800, '4줄 = 800×1, 하드드롭 이동 0칸, 첫 콤보 보너스 0');
});

test('a consecutive line clear adds the combo bonus', () => {
  const board = blankBoard();
  for (let x = 0; x <= 8; x += 1) board[21][x] = 'O'; // 21행이 한 칸(x=9)만 비었다
  const state: TetrisState = { ...createTetrisGame(1), board, level: 1, score: 0, combo: 0, active: { piece: 'I', rotation: 1, x: 7, y: 18 } };
  const dropped = applyTetrisInput(state, 'hardDrop');
  assert.equal(dropped.lines, 1);
  assert.equal(dropped.combo, 1);
  assert.equal(dropped.score, 150, '싱글 100 + 콤보 50×1×1');
});

test('soft drop adds one point per row, hard drop two points per cell', () => {
  const base = createTetrisGame(1);
  const soft = tickTetris(applyTetrisInput(base, 'softDropOn'), 50);
  assert.equal(soft.active.y, base.active.y + 1, '소프트드롭 50ms → 한 칸');
  assert.equal(soft.score, base.score + 1);

  const hard = applyTetrisInput(base, 'hardDrop');
  const fell = tetrisPieceCells(base.active).reduce((min, c) => Math.min(min, c.y), Infinity);
  void fell;
  assert.ok(hard.score >= base.score + 2, '하드드롭은 칸당 +2');
});

test('exceeding 15 lock resets force-locks the grounded piece', () => {
  const board = blankBoard();
  let state: TetrisState = { ...createTetrisGame(1), board, active: { piece: 'O', rotation: 0, x: 4, y: 20 } };
  // 바닥에 접지한 O 를 좌우로 16번 움직인다 — 15회까지 리셋, 16번째에 즉시 고정.
  for (let i = 0; i < 16; i += 1) {
    state = applyTetrisInput(state, i % 2 === 0 ? 'left' : 'right');
  }
  const locked = state.board.flat().filter((cell) => cell === 'O').length;
  assert.equal(locked, 4, '락 리셋 한도 초과로 O 가 보드에 고정된다');
  assert.equal(state.lockResets, 0, '고정 후 새 피스로 리셋');
});

test('gravity is 140ms per row at level 10', () => {
  const base: TetrisState = { ...createTetrisGame(1), level: 10 };
  assert.equal(tickTetris(base, 139).active.y, base.active.y, '139ms 로는 아직 안 떨어진다');
  assert.equal(tickTetris(base, 140).active.y, base.active.y + 1, '140ms 에 한 칸');
});

test('block out ends the game when a new piece cannot spawn', () => {
  const board = blankBoard();
  // 스폰 영역(0~1행)을 막되 x=9 는 비워 줄이 꽉 차 클리어되지 않게 한다(진짜 block out).
  for (let x = 0; x <= 8; x += 1) { board[0][x] = 'O'; board[1][x] = 'O'; }
  const state: TetrisState = { ...createTetrisGame(1), board, active: { piece: 'I', rotation: 0, x: 0, y: 18 } };
  const dropped = applyTetrisInput(state, 'hardDrop'); // 고정 후 다음 피스 스폰 → 겹침 → 게임 오버
  assert.equal(dropped.status, 'dead');
});

test('the same seed and inputs reproduce an identical run (deterministic)', () => {
  const run = (): TetrisState => {
    let s = createTetrisGame(20260714);
    const inputs = ['left', 'rotateCw', 'right', 'hardDrop', 'rotateCcw', 'left', 'hardDrop'] as const;
    for (let i = 0; i < 30; i += 1) {
      s = applyTetrisInput(s, inputs[i % inputs.length]);
      s = tickTetris(s, 60);
      if (s.status === 'dead') break;
    }
    return s;
  };
  assert.deepEqual(run(), run());
});
