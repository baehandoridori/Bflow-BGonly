import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GAME_DEFINITIONS,
  HOUSE_DOCK_ENTRIES,
  PLAYABLE_GAMES,
  QUICK_ENTRIES,
} from '../src/features/playground/catalog.ts';
import {
  advanceRecommendation,
  createRecommendationSession,
} from '../src/features/playground/recommendation.ts';
import { buildPointRanking, type RankingTeammate } from '../src/features/playground/ranking.ts';

const TEAMMATES: readonly RankingTeammate[] = [
  { id: 'minji', name: '민지', lifetimeEarnedPoints: 4920 },
  { id: 'doyoon', name: '도윤', lifetimeEarnedPoints: 3860 },
  { id: 'seoa', name: '서아', lifetimeEarnedPoints: 2820 },
  { id: 'yujin', name: '유진', lifetimeEarnedPoints: 2115 },
];

test('approved catalog recommends the three implemented arcade games and exposes 2048', () => {
  assert.deepEqual(PLAYABLE_GAMES.map((game) => game.id), ['tetris', 'snake', '2048']);
  assert.deepEqual(QUICK_ENTRIES.map((entry) => entry.kind === 'game' ? entry.gameId : entry.id), [
    'tetris', 'snake', '2048', 'sudoku', 'market',
  ]);
  assert.deepEqual(HOUSE_DOCK_ENTRIES.map((entry) => entry.kind === 'game' ? entry.gameId : entry.id), [
    'tetris', 'snake', '2048', 'sudoku', 'slots', 'market',
  ]);
  assert.equal(GAME_DEFINITIONS.tetris.heroMeta, '평균 4분 · 현재 최고 기록 18,420점');
  assert.equal(GAME_DEFINITIONS.snake.heroReward, '실버 등급부터 45 포인트를 획득합니다.');
  assert.equal(GAME_DEFINITIONS.sudoku.quickReward, 'PLATINUM +120 P');
  assert.equal(GAME_DEFINITIONS['2048'].tone, 'yellow');
  assert.equal(GAME_DEFINITIONS['2048'].quickReward, 'PLATINUM +40 P');
});

test('one shuffled bag shows all three games before refill', () => {
  const randomValues = [0.99, 0, 0.5, 0.25];
  let cursor = 0;
  const random = () => randomValues[cursor++] ?? 0;
  const first = createRecommendationSession(random);
  const second = advanceRecommendation(first, random);
  const third = advanceRecommendation(second, random);
  assert.equal(new Set([first.current, second.current, third.current]).size, 3);
  const refill = advanceRecommendation(third, random);
  assert.notEqual(refill.current, third.current);
});

test('ranking is dynamic, deterministic, and never invents zero while unavailable', () => {
  const fourth = buildPointRanking({ id: 'me', name: '한솔', walletPoints: 2480, lifetimeEarnedPoints: 2480 }, TEAMMATES);
  assert.equal(fourth.current.rank, 4);
  assert.equal(fourth.statusText, '앞 순위까지 340P 남았어요');

  const first = buildPointRanking({ id: 'me', name: '한솔', walletPoints: 5000, lifetimeEarnedPoints: 5000 }, TEAMMATES);
  assert.equal(first.current.rank, 1);
  assert.equal(first.statusText, '현재 포인트 1위예요');

  const tied = buildPointRanking({ id: 'me', name: '한솔', walletPoints: 2820, lifetimeEarnedPoints: 2820 }, TEAMMATES);
  assert.match(tied.statusText, /동점이에요/);

  const unavailable = buildPointRanking({ id: 'me', name: '한솔', walletPoints: null, lifetimeEarnedPoints: null }, TEAMMATES);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.balanceLabel, '— P');
  assert.equal(unavailable.current.rank, null);
  assert.equal(unavailable.entries.filter((entry) => entry.points !== null).length, 4);
});

test('ranking uses lifetime earned points while the balance label uses the current wallet', () => {
  const beforeTransfer = buildPointRanking({
    id: 'me', name: '한솔', walletPoints: 1_000_000, lifetimeEarnedPoints: 1_000_000,
  }, TEAMMATES);
  const afterTransfer = buildPointRanking({
    id: 'me', name: '한솔', walletPoints: 990_000, lifetimeEarnedPoints: 1_000_000,
  }, TEAMMATES);

  assert.equal(afterTransfer.current.points, beforeTransfer.current.points);
  assert.equal(afterTransfer.current.rank, beforeTransfer.current.rank);
  assert.equal(beforeTransfer.balanceLabel, '1,000,000 P');
  assert.equal(afterTransfer.balanceLabel, '990,000 P');
});
