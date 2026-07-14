import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSnakeGame,
  enqueueDirection,
  stepSnake,
} from '../src/features/playground/arcade/games/snake/engine.ts';
import type { SnakeState } from '../src/features/playground/arcade/games/snake/types.ts';

// 사과를 경로 밖(0,0)에 두어 취식 없이 이동만 검사할 때 쓴다.
function withAppleAway(state: SnakeState): SnakeState {
  return { ...state, apple: { pos: { x: 0, y: 0 }, golden: false } };
}

test('createSnakeGame produces the documented start state', () => {
  const s = createSnakeGame(12345);
  assert.equal(s.grid, 21);
  assert.deepEqual(s.body, [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
    { x: 7, y: 10 },
  ]);
  assert.deepEqual(s.dir, { x: 1, y: 0 }); // 동쪽
  assert.equal(s.length, 4);
  assert.equal(s.tickMs, 160);
  assert.equal(s.status, 'running');
  assert.equal(s.eaten, 0);
  assert.equal(s.goldenEaten, 0);
  assert.equal(s.queue.length, 0);
  // 사과는 몸이 아닌 칸에 있다.
  const onBody = s.body.some((p) => p.x === s.apple.pos.x && p.y === s.apple.pos.y);
  assert.equal(onBody, false);
});

test('four straight ticks move the head east to (14,10)', () => {
  let s = withAppleAway(createSnakeGame(1));
  for (let i = 0; i < 4; i += 1) s = stepSnake(s);
  assert.deepEqual(s.body[0], { x: 14, y: 10 });
  assert.equal(s.length, 4);
  assert.equal(s.status, 'running');
});

test('a reverse-direction input is ignored (no instant U-turn)', () => {
  let s = withAppleAway(createSnakeGame(1));
  s = enqueueDirection(s, 'left'); // 동쪽의 정반대
  s = stepSnake(s);
  assert.deepEqual(s.dir, { x: 1, y: 0 }, '방향은 동쪽 유지');
  assert.deepEqual(s.body[0], { x: 11, y: 10 }, '머리는 계속 동쪽으로');
  assert.equal(s.status, 'running');
});

test('eating a normal apple grows length by 1 and speeds up by 4ms', () => {
  const base = createSnakeGame(1);
  const s = stepSnake({ ...base, apple: { pos: { x: 11, y: 10 }, golden: false } });
  assert.equal(s.length, 5);
  assert.equal(s.tickMs, 156);
  assert.equal(s.eaten, 1);
  assert.equal(s.goldenEaten, 0);
});

test('the fifth apple spawns golden, and eating a golden apple grows length by 2', () => {
  const base = createSnakeGame(1);
  // 4번째(eaten=3 상태)를 먹으면 5번째가 스폰되며 골든이어야 한다.
  const afterFourth = stepSnake({ ...base, eaten: 3, apple: { pos: { x: 11, y: 10 }, golden: false } });
  assert.equal(afterFourth.eaten, 4);
  assert.equal(afterFourth.apple.golden, true, '5번째 사과는 골든으로 스폰');

  // 골든 사과를 먹으면 길이 +2, goldenEaten +1.
  const eatGolden = stepSnake({ ...base, apple: { pos: { x: 11, y: 10 }, golden: true } });
  assert.equal(eatGolden.length, 6);
  assert.equal(eatGolden.goldenEaten, 1);
});

test('running into a wall kills the snake', () => {
  const base = createSnakeGame(1);
  const atWall: SnakeState = withAppleAway({
    ...base,
    body: [
      { x: 20, y: 10 },
      { x: 19, y: 10 },
      { x: 18, y: 10 },
      { x: 17, y: 10 },
    ],
  });
  const s = stepSnake(atWall); // 동쪽 → x=21 벽 밖
  assert.equal(s.status, 'dead');
});

test('running into its own body kills the snake', () => {
  const base = createSnakeGame(1);
  const coiled: SnakeState = withAppleAway({
    ...base,
    // 정사각 코일: 머리 (10,10), 아래로 진행하면 (10,11)=body[1] 충돌
    body: [
      { x: 10, y: 10 },
      { x: 10, y: 11 },
      { x: 11, y: 11 },
      { x: 11, y: 10 },
    ],
    dir: { x: 0, y: 1 }, // 아래
  });
  const s = stepSnake(coiled);
  assert.equal(s.status, 'dead');
});

test('moving into the cell the tail vacates this tick survives', () => {
  const base = createSnakeGame(1);
  const loop: SnakeState = withAppleAway({
    ...base,
    body: [
      { x: 10, y: 10 }, // 머리
      { x: 11, y: 10 },
      { x: 11, y: 11 },
      { x: 10, y: 11 }, // 꼬리 — 이번 틱에 빠지는 칸
    ],
    dir: { x: 0, y: 1 }, // 아래 → nextHead (10,11) = 현재 꼬리
    grow: 0,
  });
  const s = stepSnake(loop);
  assert.equal(s.status, 'running', '꼬리가 빠지는 칸으로 이동하면 생존');
  assert.deepEqual(s.body[0], { x: 10, y: 11 });
});

test('eating the last free cell fills the board and ends the run without crashing', () => {
  const base = createSnakeGame(1);
  // (20,20) 한 칸만 비우고 나머지 440칸을 몸으로 채운다. 머리는 (19,20), 동쪽으로 이동해 마지막 칸을 먹는다.
  const body: { x: number; y: number }[] = [{ x: 19, y: 20 }];
  for (let y = 0; y < 21; y += 1) {
    for (let x = 0; x < 21; x += 1) {
      if (x === 20 && y === 20) continue; // 사과 칸(비움)
      if (x === 19 && y === 20) continue; // 이미 머리로 넣음
      body.push({ x, y });
    }
  }
  assert.equal(body.length, 440);
  const s = stepSnake({
    ...base,
    body,
    dir: { x: 1, y: 0 },
    grow: 0,
    length: 440,
    apple: { pos: { x: 20, y: 20 }, golden: true }, // 마지막 칸이 골든(+2)이어도
  });
  assert.equal(s.status, 'dead', '보드를 가득 채우면 판이 끝난다(승리)');
  assert.equal(s.body.length, 441);
  assert.equal(s.length, 441, '점수는 보드 칸 수(441)를 넘지 않는다(골든 +2 여도 만점 441)');
  assert.ok(s.apple && typeof s.apple.pos.x === 'number', '사과가 undefined 로 깨지지 않는다');
});

test('the same seed and inputs reproduce an identical run (deterministic)', () => {
  const run = (): SnakeState => {
    let s = createSnakeGame(987654);
    const dirs = ['down', 'right', 'up', 'left', 'down'] as const;
    for (let i = 0; i < 40; i += 1) {
      if (i % 8 === 0) s = enqueueDirection(s, dirs[(i / 8) % dirs.length]);
      s = stepSnake(s);
      if (s.status === 'dead') break;
    }
    return s;
  };
  assert.deepEqual(run(), run());
});
