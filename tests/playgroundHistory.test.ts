import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPlaygroundHistory,
  requestPlaygroundBack,
} from '../src/features/playground/history.ts';
import { createBackInterceptionStack } from '../src/features/playground/backInterception.ts';
import {
  arePlaygroundRoutesSameSurface,
  shouldReplacePlaygroundNavigation,
  type PlaygroundRoute,
} from '../src/features/playground/routes.ts';

const lobby: PlaygroundRoute = { kind: 'lobby' };
const house: PlaygroundRoute = { kind: 'house' };
const marketHome: PlaygroundRoute = {
  kind: 'market',
  page: { kind: 'home' },
  returnTo: 'house',
};
const stock: PlaygroundRoute = {
  kind: 'market',
  page: { kind: 'stock', stockId: 'jbbj' },
  returnTo: 'house',
};
const account: PlaygroundRoute = {
  kind: 'market',
  page: { kind: 'account' },
  returnTo: 'house',
};

test('local history returns lobby, house and market pages in exact reverse order', () => {
  const history = createPlaygroundHistory(lobby);
  history.push(house);
  history.push(marketHome);
  history.push(stock);
  history.push(account);

  assert.equal(history.canGoBack(), true);
  assert.deepEqual(history.back(), stock);
  assert.deepEqual(history.back(), marketHome);
  assert.deepEqual(history.back(), house);
  assert.deepEqual(history.back(), lobby);
  assert.equal(history.canGoBack(), false);
  assert.equal(history.back(), null);
  assert.deepEqual(history.current(), lobby);
});

test('adjacent duplicate surfaces do not add a history step', () => {
  const history = createPlaygroundHistory(lobby);
  history.push(house);
  history.push({ kind: 'house' });

  assert.deepEqual(history.back(), lobby);
  assert.equal(history.back(), null);
});

test('a home focus request replaces the top without replaying the same surface on Back', () => {
  const history = createPlaygroundHistory(lobby);
  history.push(house);
  history.push(marketHome);
  const focusedHome: PlaygroundRoute = {
    ...marketHome,
    page: { kind: 'home', focusRequest: { target: 'all-stocks', id: 17 } },
  };

  assert.equal(
    shouldReplacePlaygroundNavigation(
      { kind: 'market-home', focusRequest: { target: 'all-stocks', id: 17 } },
      marketHome,
      focusedHome,
    ),
    true,
  );
  history.replace(focusedHome);

  assert.deepEqual(history.current(), focusedHome);
  assert.deepEqual(history.back(), house);
});

test('a focus request from stock pushes home so Back returns to the stock', () => {
  const history = createPlaygroundHistory(lobby);
  history.push(marketHome);
  history.push(stock);
  const focusedHome: PlaygroundRoute = {
    ...marketHome,
    page: { kind: 'home', focusRequest: { target: 'all-stocks', id: 18 } },
  };

  assert.equal(
    shouldReplacePlaygroundNavigation(
      { kind: 'market-home', focusRequest: { target: 'all-stocks', id: 18 } },
      stock,
      focusedHome,
    ),
    false,
  );
  history.push(focusedHome);

  assert.deepEqual(history.back(), stock);
});

test('a focus request from account pushes home so Back returns to the account', () => {
  const history = createPlaygroundHistory(lobby);
  history.push(marketHome);
  history.push(account);
  const focusedHome: PlaygroundRoute = {
    ...marketHome,
    page: { kind: 'home', focusRequest: { target: 'all-stocks', id: 19 } },
  };

  assert.equal(
    shouldReplacePlaygroundNavigation(
      { kind: 'market-home', focusRequest: { target: 'all-stocks', id: 19 } },
      account,
      focusedHome,
    ),
    false,
  );
  history.push(focusedHome);

  assert.deepEqual(history.back(), account);
});

test('route identity keeps stock and provenance differences but ignores focus commands', () => {
  const focusedHome: PlaygroundRoute = {
    ...marketHome,
    page: { kind: 'home', focusRequest: { target: 'all-stocks', id: 3 } },
  };
  const otherStock: PlaygroundRoute = {
    ...stock,
    page: { kind: 'stock', stockId: 'youtube' },
  };
  const lobbyMarket: PlaygroundRoute = { ...marketHome, returnTo: 'lobby' };

  assert.equal(arePlaygroundRoutesSameSurface(marketHome, focusedHome), true);
  assert.equal(arePlaygroundRoutesSameSurface(stock, otherStock), false);
  assert.equal(arePlaygroundRoutesSameSurface(marketHome, lobbyMarket), false);
});

test('back interception uses a token stack and consumes even when close declines', () => {
  const stack = createBackInterceptionStack();
  const calls: string[] = [];
  const disposeFirst = stack.register(() => {
    calls.push('first');
    return true;
  });
  const disposeSecond = stack.register(() => {
    calls.push('second');
    return false;
  });

  assert.equal(stack.interceptTop(), true);
  assert.deepEqual(calls, ['second']);
  disposeFirst();
  assert.equal(stack.interceptTop(), true);
  assert.deepEqual(calls, ['second', 'second']);
  disposeSecond();
  disposeSecond();
  assert.equal(stack.interceptTop(), false);
});

test('common back priority intercepts overlay, mutation and transition before history pop', () => {
  const history = createPlaygroundHistory(lobby);
  history.push(house);
  let intercept = true;

  assert.deepEqual(requestPlaygroundBack({
    history,
    interceptOverlay: () => intercept,
    mutating: true,
    transitioning: true,
  }), { kind: 'intercepted' });
  assert.deepEqual(history.current(), house);

  intercept = false;
  assert.deepEqual(requestPlaygroundBack({
    history,
    interceptOverlay: () => intercept,
    mutating: true,
    transitioning: true,
  }), { kind: 'blocked-mutation' });
  assert.deepEqual(history.current(), house);

  assert.deepEqual(requestPlaygroundBack({
    history,
    interceptOverlay: () => false,
    mutating: false,
    transitioning: true,
  }), { kind: 'blocked-transition' });
  assert.deepEqual(history.current(), house);

  assert.deepEqual(requestPlaygroundBack({
    history,
    interceptOverlay: () => false,
    mutating: false,
    transitioning: false,
  }), { kind: 'navigated', route: lobby });
});
