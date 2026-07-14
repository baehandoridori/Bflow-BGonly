import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCADE_ACHIEVEMENTS,
  ARCADE_BALANCE,
} from '../src/features/playground/arcade/constants.ts';
import {
  evaluateAchievements,
  gradeForScore,
  gradeProgress,
  nextGradeInfo,
  rewardForGrade,
  upsertLeaderboardEntry,
} from '../src/features/playground/arcade/domain.ts';

test('gradeProgress reports the next-grade label and progress toward it', () => {
  // 스네이크: bronze 15 / silver 25 / gold 40 / platinum 55
  assert.deepEqual(gradeProgress('snake', 0), { label: '다음 등급 BRONZE', pct: 0 });
  assert.equal(gradeProgress('snake', 10).label, '다음 등급 BRONZE');
  assert.equal(gradeProgress('snake', 10).pct, 67); // 10/15
  assert.deepEqual(gradeProgress('snake', 20), { label: '다음 등급 SILVER', pct: 50 }); // (20-15)/(25-15)
  assert.deepEqual(gradeProgress('snake', 55), { label: '최고 등급', pct: 100 }); // 최고 도달
  // 테트리스: bronze 3000
  assert.deepEqual(gradeProgress('tetris', 1500), { label: '다음 등급 BRONZE', pct: 50 });
});

test('upsertLeaderboardEntry replaces my row, sorts by score then time, and caps to the limit', () => {
  const at = (day: string) => `2026-01-${day}T00:00:00Z`;
  const base = [
    { userId: 'a', name: 'A', score: 30, at: at('01') },
    { userId: 'me', name: '나', score: 10, at: at('01') },
    { userId: 'b', name: 'B', score: 20, at: at('02') },
  ];
  const next = upsertLeaderboardEntry(base, { userId: 'me', name: '나' }, 25, at('03'));
  assert.deepEqual(next.map((entry) => entry.userId), ['a', 'me', 'b']); // 30 > 25 > 20
  assert.equal(next.find((entry) => entry.userId === 'me')?.score, 25);
  assert.equal(next.filter((entry) => entry.userId === 'me').length, 1); // 중복 없음

  // 동점은 먼저 달성한 쪽(at 오름차순)이 위
  const tie = upsertLeaderboardEntry(
    [{ userId: 'x', name: 'X', score: 25, at: at('01') }],
    { userId: 'me', name: '나' },
    25,
    at('03'),
  );
  assert.deepEqual(tie.map((entry) => entry.userId), ['x', 'me']);

  // limit 초과분은 잘린다
  const many = Array.from({ length: 60 }, (_, i) => ({ userId: `u${i}`, name: `U${i}`, score: 1000 - i, at: at('01') }));
  assert.equal(upsertLeaderboardEntry(many, { userId: 'me', name: '나' }, 5, at('03'), 50).length, 50);
});

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

test('gradeForScore uses inclusive (>=) 2048 boundaries', () => {
  assert.equal(gradeForScore('2048', 2999), 'none');
  assert.equal(gradeForScore('2048', 3000), 'bronze');
  assert.equal(gradeForScore('2048', 7999), 'bronze');
  assert.equal(gradeForScore('2048', 8000), 'silver');
  assert.equal(gradeForScore('2048', 17999), 'silver');
  assert.equal(gradeForScore('2048', 18000), 'gold');
  assert.equal(gradeForScore('2048', 34999), 'gold');
  assert.equal(gradeForScore('2048', 35000), 'platinum');
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
  assert.equal(rewardForGrade('2048', 'none'), 0);
  assert.equal(rewardForGrade('2048', 'bronze'), 5);
  assert.equal(rewardForGrade('2048', 'silver'), 12);
  assert.equal(rewardForGrade('2048', 'gold'), 25);
  assert.equal(rewardForGrade('2048', 'platinum'), 40);
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
  assert.equal(ARCADE_BALANCE.games['2048'].entryFee, 10);
  assert.equal(ARCADE_BALANCE.games['2048'].maxScore, 10_000_000);
  assert.equal(ARCADE_BALANCE.dailyLoginPoints, 20);
  assert.equal(ARCADE_BALANCE.dailyRewardedRunsCap, 5);
  assert.equal(ARCADE_ACHIEVEMENTS.length, 10);
  const ids = ARCADE_ACHIEVEMENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'achievement ids must be unique');
});
