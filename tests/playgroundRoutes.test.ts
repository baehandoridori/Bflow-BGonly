import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPlaygroundReturnSurface,
  initialPlaygroundRoute,
  navigatePlayground,
} from '../src/features/playground/routes.ts';

test('A lobby is the default and the dedicated button opens C house', () => {
  assert.deepEqual(initialPlaygroundRoute, { kind: 'lobby' });
  assert.deepEqual(navigatePlayground(initialPlaygroundRoute, { kind: 'open-house' }), { kind: 'house' });
});

test('market remains one local route with three pages', () => {
  const market = navigatePlayground(initialPlaygroundRoute, { kind: 'open-market' });
  assert.deepEqual(market, { kind: 'market', page: { kind: 'home' }, returnTo: 'lobby' });
  assert.deepEqual(navigatePlayground(market, { kind: 'open-stock', stockId: 'jbbj' }), {
    kind: 'market', page: { kind: 'stock', stockId: 'jbbj' }, returnTo: 'lobby',
  });
  assert.deepEqual(navigatePlayground(market, { kind: 'open-account' }), {
    kind: 'market', page: { kind: 'account' }, returnTo: 'lobby',
  });
  assert.deepEqual(navigatePlayground(market, {
    kind: 'market-home', focusRequest: { target: 'all-stocks', id: 7 },
  }), {
    kind: 'market', page: { kind: 'home', focusRequest: { target: 'all-stocks', id: 7 } }, returnTo: 'lobby',
  });
});

test('game and market remember whether lobby or house opened them', () => {
  const house = navigatePlayground(initialPlaygroundRoute, { kind: 'open-house' });
  const houseGame = navigatePlayground(house, { kind: 'open-game', game: 'tetris' });
  assert.deepEqual(houseGame, { kind: 'game', game: 'tetris', returnTo: 'house' });
  assert.equal(getPlaygroundReturnSurface(houseGame), 'house');
  assert.deepEqual(navigatePlayground(houseGame, { kind: 'return-to-source' }), { kind: 'house' });

  const houseMarket = navigatePlayground(house, { kind: 'open-market' });
  assert.deepEqual(houseMarket, { kind: 'market', page: { kind: 'home' }, returnTo: 'house' });
  assert.deepEqual(navigatePlayground(houseMarket, { kind: 'open-account' }), {
    kind: 'market', page: { kind: 'account' }, returnTo: 'house',
  });
  assert.deepEqual(navigatePlayground(houseMarket, { kind: 'return-to-source' }), { kind: 'house' });

  const lobbyMarket = navigatePlayground(initialPlaygroundRoute, { kind: 'open-market' });
  assert.deepEqual(lobbyMarket, { kind: 'market', page: { kind: 'home' }, returnTo: 'lobby' });
  const detail = navigatePlayground(lobbyMarket, { kind: 'open-stock', stockId: 'jbbj' });
  assert.deepEqual(detail, {
    kind: 'market', page: { kind: 'stock', stockId: 'jbbj' }, returnTo: 'lobby',
  });
  assert.deepEqual(navigatePlayground(detail, { kind: 'return-to-source' }), { kind: 'lobby' });
});

test('2048 is a first-class game route that preserves its return surface', () => {
  const lobbyGame = navigatePlayground(initialPlaygroundRoute, { kind: 'open-game', game: '2048' });
  assert.deepEqual(lobbyGame, { kind: 'game', game: '2048', returnTo: 'lobby' });

  const house = navigatePlayground(initialPlaygroundRoute, { kind: 'open-house' });
  assert.deepEqual(navigatePlayground(house, { kind: 'open-game', game: '2048' }), {
    kind: 'game', game: '2048', returnTo: 'house',
  });
});
