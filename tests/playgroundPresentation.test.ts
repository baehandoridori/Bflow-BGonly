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
import { buildPointRanking } from '../src/features/playground/ranking.ts';

test('approved catalog recommends only the three playable games', () => {
  assert.deepEqual(PLAYABLE_GAMES.map((game) => game.id), ['tetris', 'snake', 'sudoku']);
  assert.deepEqual(QUICK_ENTRIES.map((entry) => entry.kind === 'game' ? entry.gameId : entry.id), [
    'tetris', 'snake', 'sudoku', 'market',
  ]);
  assert.deepEqual(HOUSE_DOCK_ENTRIES.map((entry) => entry.kind === 'game' ? entry.gameId : entry.id), [
    'tetris', 'snake', 'sudoku', 'slots', 'market',
  ]);
  assert.equal(GAME_DEFINITIONS.tetris.heroMeta, '평균 4분 · 현재 최고 기록 18,420점');
  assert.equal(GAME_DEFINITIONS.snake.heroReward, '실버 등급부터 45 포인트를 획득합니다.');
  assert.equal(GAME_DEFINITIONS.sudoku.quickReward, 'PLATINUM +120 P');
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
  const fourth = buildPointRanking({ id: 'me', name: '한솔', points: 2480 });
  assert.equal(fourth.current.rank, 4);
  assert.equal(fourth.statusText, '앞 순위까지 340P 남았어요');

  const first = buildPointRanking({ id: 'me', name: '한솔', points: 5000 });
  assert.equal(first.current.rank, 1);
  assert.equal(first.statusText, '현재 포인트 1위예요');

  const tied = buildPointRanking({ id: 'me', name: '한솔', points: 2820 });
  assert.match(tied.statusText, /동점이에요/);

  const unavailable = buildPointRanking({ id: 'me', name: '한솔', points: null });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.balanceLabel, '— P');
  assert.equal(unavailable.current.rank, null);
  assert.equal(unavailable.entries.filter((entry) => entry.points !== null).length, 4);
});
