import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCADE_ACHIEVEMENTS,
  ARCADE_BALANCE,
} from '../src/features/playground/arcade/constants.ts';
import {
  evaluateAchievements,
  gradeForScore,
  nextGradeInfo,
  rewardForGrade,
} from '../src/features/playground/arcade/domain.ts';

test('gradeForScore uses inclusive (>=) snake boundaries', () => {
  assert.equal(gradeForScore('snake', 14), 'none');
  assert.equal(gradeForScore('snake', 15), 'bronze');
  assert.equal(gradeForScore('snake', 24), 'bronze');
  assert.equal(gradeForScore('snake', 25), 'silver');
  assert.equal(gradeForScore('snake', 39), 'silver');
  assert.equal(gradeForScore('snake', 40), 'gold');
  assert.equal(gradeForScore('snake', 54), 'gold');
  assert.equal(gradeForScore('snake', 55), 'platinum');
  assert.equal(gradeForScore('snake', 441), 'platinum');
});

test('gradeForScore uses inclusive (>=) tetris boundaries', () => {
  assert.equal(gradeForScore('tetris', 2999), 'none');
  assert.equal(gradeForScore('tetris', 3000), 'bronze');
  assert.equal(gradeForScore('tetris', 9999), 'bronze');
  assert.equal(gradeForScore('tetris', 10000), 'silver');
  assert.equal(gradeForScore('tetris', 24999), 'silver');
  assert.equal(gradeForScore('tetris', 25000), 'gold');
  assert.equal(gradeForScore('tetris', 49999), 'gold');
  assert.equal(gradeForScore('tetris', 50000), 'platinum');
});

test('rewardForGrade matches the balance table', () => {
  assert.equal(rewardForGrade('snake', 'none'), 0);
  assert.equal(rewardForGrade('snake', 'bronze'), 8);
  assert.equal(rewardForGrade('snake', 'silver'), 18);
  assert.equal(rewardForGrade('snake', 'gold'), 30);
  assert.equal(rewardForGrade('snake', 'platinum'), 45);
  assert.equal(rewardForGrade('tetris', 'none'), 0);
  assert.equal(rewardForGrade('tetris', 'bronze'), 12);
  assert.equal(rewardForGrade('tetris', 'silver'), 30);
  assert.equal(rewardForGrade('tetris', 'gold'), 55);
  assert.equal(rewardForGrade('tetris', 'platinum'), 80);
});

test('nextGradeInfo reports the remaining distance and returns null past platinum', () => {
  assert.deepEqual(nextGradeInfo('snake', 0), { grade: 'bronze', remaining: 15 });
  assert.deepEqual(nextGradeInfo('snake', 20), { grade: 'silver', remaining: 5 });
  assert.deepEqual(nextGradeInfo('snake', 54), { grade: 'platinum', remaining: 1 });
  assert.equal(nextGradeInfo('snake', 55), null);
  assert.equal(nextGradeInfo('snake', 100), null);
  assert.deepEqual(nextGradeInfo('tetris', 100), { grade: 'bronze', remaining: 2900 });
  assert.deepEqual(nextGradeInfo('tetris', 3000), { grade: 'silver', remaining: 7000 });
});

const emptyUnlocked = (): ReadonlySet<string> => new Set<string>();

test('evaluateAchievements unlocks the first-run common achievement', () => {
  const result = evaluateAchievements({
    gameId: 'snake',
    runMeta: { score: 10 },
    runRewardPoints: 0,
    aggregates: { totalRuns: 0, arcadeEarnedPoints: 0 },
    attendanceStreakDays: 0,
    unlockedIds: emptyUnlocked(),
  });
  assert.ok(result.includes('arcade-first-run'));
  // score 10 earns no snake milestone
  assert.ok(!result.includes('snake-30'));
});

test('evaluateAchievements respects cumulative run boundaries (this run included)', () => {
  const at49 = evaluateAchievements({
    gameId: 'tetris',
    runMeta: { score: 100 },
    runRewardPoints: 0,
    aggregates: { totalRuns: 49, arcadeEarnedPoints: 0 },
    attendanceStreakDays: 0,
    unlockedIds: new Set(['arcade-first-run']),
  });
  assert.ok(at49.includes('arcade-runs-50'));

  const at48 = evaluateAchievements({
    gameId: 'tetris',
    runMeta: { score: 100 },
    runRewardPoints: 0,
    aggregates: { totalRuns: 48, arcadeEarnedPoints: 0 },
    attendanceStreakDays: 0,
    unlockedIds: new Set(['arcade-first-run']),
  });
  assert.ok(!at48.includes('arcade-runs-50'));
});

test('evaluateAchievements folds this run reward into the earned-points boundary', () => {
  const crossing = evaluateAchievements({
    gameId: 'snake',
    runMeta: { score: 10 },
    runRewardPoints: 20,
    aggregates: { totalRuns: 5, arcadeEarnedPoints: 4980 },
    attendanceStreakDays: 0,
    unlockedIds: new Set(['arcade-first-run']),
  });
  assert.ok(crossing.includes('arcade-earned-5k'));

  const shy = evaluateAchievements({
    gameId: 'snake',
    runMeta: { score: 10 },
    runRewardPoints: 20,
    aggregates: { totalRuns: 5, arcadeEarnedPoints: 4979 },
    attendanceStreakDays: 0,
    unlockedIds: new Set(['arcade-first-run']),
  });
  assert.ok(!shy.includes('arcade-earned-5k'));
});

test('evaluateAchievements only checks common achievements during a game-less load evaluation', () => {
  const result = evaluateAchievements({
    gameId: null,
    runMeta: null,
    runRewardPoints: 0,
    aggregates: { totalRuns: 3, arcadeEarnedPoints: 100 },
    attendanceStreakDays: 7,
    unlockedIds: new Set(['arcade-first-run']),
  });
  assert.ok(result.includes('attend-7'));
  // completed-run history still recovers the first-run achievement if it was missed,
  // but game-specific achievements never unlock without a matching run
  assert.ok(!result.includes('snake-30'));
  assert.ok(!result.includes('tetris-tetris'));
});

test('evaluateAchievements never re-emits an already unlocked id', () => {
  const result = evaluateAchievements({
    gameId: 'snake',
    runMeta: { score: 60, goldenEaten: 5 },
    runRewardPoints: 45,
    aggregates: { totalRuns: 0, arcadeEarnedPoints: 0 },
    attendanceStreakDays: 0,
    unlockedIds: new Set(['arcade-first-run', 'snake-30']),
  });
  assert.ok(!result.includes('arcade-first-run'));
  assert.ok(!result.includes('snake-30'));
  assert.ok(result.includes('snake-55'));
  assert.ok(result.includes('snake-golden-5'));
});

test('evaluateAchievements reads snake and tetris run metadata', () => {
  const golden = evaluateAchievements({
    gameId: 'snake',
    runMeta: { score: 30, goldenEaten: 5 },
    runRewardPoints: 0,
    aggregates: { totalRuns: 5, arcadeEarnedPoints: 0 },
    attendanceStreakDays: 0,
    unlockedIds: new Set(['arcade-first-run']),
  });
  assert.ok(golden.includes('snake-30'));
  assert.ok(golden.includes('snake-golden-5'));
  assert.ok(!golden.includes('snake-55'));

  const tetris = evaluateAchievements({
    gameId: 'tetris',
    runMeta: { score: 30000, maxLineClear: 4, levelReached: 10 },
    runRewardPoints: 0,
    aggregates: { totalRuns: 5, arcadeEarnedPoints: 0 },
    attendanceStreakDays: 0,
    unlockedIds: new Set(['arcade-first-run']),
  });
  assert.ok(tetris.includes('tetris-tetris'));
  assert.ok(tetris.includes('tetris-level-10'));
  assert.ok(tetris.includes('tetris-30k'));
  // snake achievements never leak into a tetris run
  assert.ok(!tetris.includes('snake-30'));
});

test('evaluateAchievements recovers all game achievements from cumulative peaks on load', () => {
  // load 시(gameId null, runMeta null)에도 누적 최댓값으로 게임 과제(점수·골든·라인·레벨)를 복구한다.
  const result = evaluateAchievements({
    gameId: null,
    runMeta: null,
    runRewardPoints: 0,
    aggregates: { totalRuns: 5, arcadeEarnedPoints: 0 },
    attendanceStreakDays: 0,
    gamePeaks: {
      snake: { bestScore: 60, maxGoldenEaten: 6 },
      tetris: { bestScore: 31_000, maxLineClear: 4, maxLevel: 10 },
    },
    unlockedIds: new Set(['arcade-first-run']),
  });
  assert.ok(result.includes('snake-30'));
  assert.ok(result.includes('snake-55'));
  assert.ok(result.includes('tetris-30k'));
  // per-run 최댓값 과제도 누적 최댓값으로 복구된다.
  assert.ok(result.includes('snake-golden-5'));
  assert.ok(result.includes('tetris-tetris'));
  assert.ok(result.includes('tetris-level-10'));
});

test('evaluateAchievements without peaks stays finish-only for game achievements', () => {
  const result = evaluateAchievements({
    gameId: null,
    runMeta: null,
    runRewardPoints: 0,
    aggregates: { totalRuns: 5, arcadeEarnedPoints: 0 },
    attendanceStreakDays: 7,
    unlockedIds: new Set(),
  });
  assert.ok(result.includes('attend-7'));
  assert.ok(!result.includes('snake-30'));
  assert.ok(!result.includes('snake-golden-5'));
});

test('evaluateAchievements returns newly unlocked ids in definition order', () => {
  const result = evaluateAchievements({
    gameId: 'snake',
    runMeta: { score: 55 },
    runRewardPoints: 0,
    aggregates: { totalRuns: 0, arcadeEarnedPoints: 0 },
    attendanceStreakDays: 0,
    unlockedIds: emptyUnlocked(),
  });
  assert.deepEqual(result, ['arcade-first-run', 'snake-30', 'snake-55']);
});

test('the balance table and achievement catalog stay internally consistent', () => {
  assert.equal(ARCADE_BALANCE.games.snake.entryFee, 10);
  assert.equal(ARCADE_BALANCE.games.tetris.entryFee, 15);
  assert.equal(ARCADE_BALANCE.dailyLoginPoints, 20);
  assert.equal(ARCADE_BALANCE.dailyRewardedRunsCap, 5);
  assert.equal(ARCADE_ACHIEVEMENTS.length, 10);
  const ids = ARCADE_ACHIEVEMENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'achievement ids must be unique');
});
