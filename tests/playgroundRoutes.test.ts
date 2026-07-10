import test from 'node:test';
import assert from 'node:assert/strict';

import { initialPlaygroundRoute, navigatePlayground } from '../src/features/playground/routes.ts';
import { pickRecommendation } from '../src/features/playground/recommendation.ts';

test('A lobby is the default and the dedicated button opens C house', () => {
  assert.deepEqual(initialPlaygroundRoute, { kind: 'lobby' });
  assert.deepEqual(navigatePlayground(initialPlaygroundRoute, { kind: 'open-house' }), { kind: 'house' });
});

test('market remains one local route with three pages', () => {
  const market = navigatePlayground(initialPlaygroundRoute, { kind: 'open-market' });
  assert.deepEqual(market, { kind: 'market', page: { kind: 'home' } });
  assert.deepEqual(navigatePlayground(market, { kind: 'open-stock', stockId: 'jbbj' }), {
    kind: 'market', page: { kind: 'stock', stockId: 'jbbj' },
  });
  assert.deepEqual(navigatePlayground(market, { kind: 'open-account' }), {
    kind: 'market', page: { kind: 'account' },
  });
  assert.deepEqual(navigatePlayground(market, {
    kind: 'market-home', focusRequest: { target: 'all-stocks', id: 7 },
  }), {
    kind: 'market', page: { kind: 'home', focusRequest: { target: 'all-stocks', id: 7 } },
  });
});

test('recommendation accepts deterministic randomness', () => {
  const items = ['tetris', 'sudoku', 'snake', 'market'] as const;
  assert.equal(pickRecommendation(items, () => 0), 'tetris');
  assert.equal(pickRecommendation(items, () => 0.99), 'market');
});
