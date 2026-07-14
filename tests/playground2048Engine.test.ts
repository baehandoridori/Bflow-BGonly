import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apply2048Move,
  canMove2048,
  create2048State,
  impactTier2048,
  trace2048Move,
} from '../src/features/playground/arcade/games/merge2048/engine.ts';
import type {
  Direction2048,
  RandomSource,
  State2048,
} from '../src/features/playground/arcade/games/merge2048/types.ts';

const EMPTY_BOARD = Array<number>(16).fill(0);

function withCells(cells: Readonly<Record<number, number>>): number[] {
  const board = [...EMPTY_BOARD];
  for (const [index, value] of Object.entries(cells)) board[Number(index)] = value;
  return board;
}

function runningState(board: readonly number[], overrides: Partial<State2048> = {}): State2048 {
  return {
    board: [...board],
    score: 0,
    maxTile: Math.max(0, ...board),
    status: 'running',
    reached2048: false,
    ...overrides,
  };
}

function sequenceRandom(values: readonly number[]): RandomSource {
  let index = 0;
  return () => {
    assert.ok(index < values.length, '난수 시퀀스를 예상보다 많이 소비했다');
    const value = values[index];
    index += 1;
    return value;
  };
}

test('왼쪽 이동에서 [2,2,2,2]는 [4,4,0,0]이 되고 합성 점수 8을 얻는다', () => {
  const input = withCells({ 0: 2, 1: 2, 2: 2, 3: 2 });
  const trace = trace2048Move(input, 'left');

  assert.deepEqual(trace.board.slice(0, 4), [4, 4, 0, 0]);
  assert.equal(trace.scoreGained, 8);
  assert.equal(trace.changed, true);
  assert.deepEqual(input.slice(0, 4), [2, 2, 2, 2], '입력 보드는 변경하지 않는다');
});

test('한 번 합쳐진 타일은 같은 이동에서 다시 합쳐지지 않는다', () => {
  const trace = trace2048Move(withCells({ 0: 4, 1: 4, 2: 8 }), 'left');

  assert.deepEqual(trace.board.slice(0, 4), [8, 8, 0, 0]);
  assert.equal(trace.scoreGained, 8, '[4,4]만 합쳐지고 새 8과 기존 8은 다시 합쳐지지 않는다');
});

test('left와 right는 행 안에서 올바른 가장자리로 이동·합성한다', () => {
  const source = withCells({ 1: 2, 3: 2 });

  assert.deepEqual(trace2048Move(source, 'left').board.slice(0, 4), [4, 0, 0, 0]);
  assert.deepEqual(trace2048Move(source, 'right').board.slice(0, 4), [0, 0, 0, 4]);
});

test('up과 down은 열 안에서 올바른 가장자리로 이동·합성한다', () => {
  const source = withCells({ 4: 2, 12: 2 });

  assert.deepEqual(trace2048Move(source, 'up').board, withCells({ 0: 4 }));
  assert.deepEqual(trace2048Move(source, 'down').board, withCells({ 12: 4 }));
});

test('trace는 각 원본 타일의 from/to와 합성 위치·최대 합성값을 제공한다', () => {
  const trace = trace2048Move(withCells({ 0: 2, 2: 2, 3: 4 }), 'left');

  assert.deepEqual(trace.motions, [
    { from: 0, to: 0, value: 2, merged: true },
    { from: 2, to: 0, value: 2, merged: true },
    { from: 3, to: 1, value: 4, merged: false },
  ]);
  assert.deepEqual(trace.mergedIndices, [0]);
  assert.equal(trace.maxMerged, 4);
});

test('유효하지 않은 이동은 새 타일을 만들거나 난수를 소비하지 않는다', () => {
  const state = runningState(withCells({ 0: 2 }));
  let randomCalls = 0;
  const result = apply2048Move(state, 'left', () => {
    randomCalls += 1;
    return 0;
  });

  assert.equal(result.transition.changed, false);
  assert.equal(result.spawnedIndex, null);
  assert.deepEqual(result.state, state);
  assert.equal(randomCalls, 0);
});

test('유효한 이동 뒤 주입 난수로 첫 빈 칸에 2를 생성한다', () => {
  const result = apply2048Move(
    runningState(withCells({ 0: 2 })),
    'right',
    sequenceRandom([0, 0]),
  );

  assert.equal(result.spawnedIndex, 0);
  assert.equal(result.state.board[0], 2);
  assert.equal(result.state.board[3], 2);
});

test('생성 값 난수가 0.9 이상이면 결정론적으로 4를 생성한다', () => {
  const result = apply2048Move(
    runningState(withCells({ 0: 2 })),
    'right',
    sequenceRandom([0, 0.9]),
  );

  assert.equal(result.spawnedIndex, 0);
  assert.equal(result.state.board[0], 4);
});

test('난수 exact 1은 마지막 빈 칸을 고르고 4를 생성한다', () => {
  const result = apply2048Move(
    runningState(withCells({ 0: 2 })),
    'right',
    sequenceRandom([1, 1]),
  );

  assert.equal(result.spawnedIndex, 15);
  assert.equal(result.state.board[15], 4);
});

test('create2048State는 서로 다른 빈 칸에 결정론적 시작 타일 두 개를 만든다', () => {
  const state = create2048State(sequenceRandom([0, 0, 0, 0.9]));

  assert.deepEqual(state.board.slice(0, 4), [2, 4, 0, 0]);
  assert.equal(state.board.filter((value) => value !== 0).length, 2);
  assert.deepEqual(state, {
    board: state.board,
    score: 0,
    maxTile: 4,
    status: 'running',
    reached2048: false,
  });
});

test('빈 칸이나 동일한 인접 타일이 있으면 계속 이동할 수 있다', () => {
  const locked = [
    2, 4, 2, 4,
    4, 8, 4, 8,
    2, 4, 2, 4,
    4, 8, 4, 8,
  ];

  assert.equal(canMove2048(withCells({ 0: 2 })), true, '빈 칸이 있으면 이동 가능');
  assert.equal(canMove2048(locked), false, '빈 칸과 동일 인접 타일이 없으면 종료');
  assert.equal(canMove2048(locked.map((value, index) => (index === 1 ? 2 : value))), true, '가로 합성 가능');
  assert.equal(canMove2048(locked.map((value, index) => (index === 4 ? 2 : value))), true, '세로 합성 가능');
});

test('가득 찬 보드에서 이동도 합성도 불가능하면 over가 되고 난수를 쓰지 않는다', () => {
  const locked = [
    2, 4, 2, 4,
    4, 8, 4, 8,
    2, 4, 2, 4,
    4, 8, 4, 8,
  ];
  let randomCalls = 0;
  const result = apply2048Move(runningState(locked), 'left', () => {
    randomCalls += 1;
    return 0;
  });

  assert.equal(result.transition.changed, false);
  assert.equal(result.spawnedIndex, null);
  assert.equal(result.state.status, 'over');
  assert.equal(randomCalls, 0);
});

test('impact 단계는 128, 512, 2048 합성값에서 각각 상승한다', () => {
  assert.equal(impactTier2048(64), 'none');
  assert.equal(impactTier2048(128), 'soft');
  assert.equal(impactTier2048(256), 'soft');
  assert.equal(impactTier2048(512), 'medium');
  assert.equal(impactTier2048(1024), 'medium');
  assert.equal(impactTier2048(2048), 'heavy');
  assert.equal(impactTier2048(4096), 'heavy');
});

test('2048 최초 달성은 기록하되 게임을 끝내지 않아 계속 합칠 수 있다', () => {
  const result = apply2048Move(
    runningState(withCells({ 0: 1024, 1: 1024 }), { score: 100 }),
    'left',
    sequenceRandom([0.999, 0]),
  );

  assert.equal(result.transition.maxMerged, 2048);
  assert.equal(result.state.score, 2148);
  assert.equal(result.state.maxTile, 2048);
  assert.equal(result.state.reached2048, true);
  assert.equal(result.state.status, 'running');

  const continued = apply2048Move(result.state, 'right', sequenceRandom([0, 0]));
  assert.equal(continued.state.reached2048, true);
  assert.equal(continued.state.status, 'running');
});

test('모든 공개 보드 진입점은 정확히 16칸이 아닌 보드를 명시적으로 거부한다', () => {
  for (const board of [Array<number>(15).fill(0), Array<number>(17).fill(0)]) {
    assert.throws(
      () => trace2048Move(board, 'left'),
      /2048 board must contain exactly 16 cells/,
    );
    assert.throws(
      () => canMove2048(board),
      /2048 board must contain exactly 16 cells/,
    );
    assert.throws(
      () => apply2048Move(runningState(board, { status: 'over' }), 'left', () => 0),
      /2048 board must contain exactly 16 cells/,
    );
  }
});

test('모든 공개 보드 진입점은 0이나 safe integer 2의 거듭제곱이 아닌 값을 거부한다', () => {
  const invalidValues = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -2,
    3,
    2.5,
    2 ** 52 - 1,
    Number.MAX_SAFE_INTEGER,
    2 ** 53,
  ];

  for (const value of invalidValues) {
    const board = withCells({ 0: value });
    assert.throws(
      () => trace2048Move(board, 'left'),
      /2048 board\[0\] must be 0 or a finite safe integer power of two/,
    );
    assert.throws(
      () => canMove2048(board),
      /2048 board\[0\] must be 0 or a finite safe integer power of two/,
    );
    assert.throws(
      () => apply2048Move(runningState(board, { status: 'over' }), 'left', () => 0),
      /2048 board\[0\] must be 0 or a finite safe integer power of two/,
    );
  }
});

test('방향 공개 진입점은 런타임 allow-list 밖의 방향을 명시적으로 거부한다', () => {
  const invalidDirection = 'diagonal' as Direction2048;
  const board = withCells({ 0: 2 });

  assert.throws(
    () => trace2048Move(board, invalidDirection),
    /Unsupported 2048 direction: diagonal/,
  );
  assert.throws(
    () => apply2048Move(runningState(board, { status: 'over' }), invalidDirection, () => 0),
    /Unsupported 2048 direction: diagonal/,
  );
});
