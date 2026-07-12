import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMarketPreviewGateway,
  fingerprintMarketCommand,
} from '../src/features/playground/market/previewGateway.ts';
import {
  createPendingMarketValueRequest,
  retryPendingMarketValueCommand,
} from '../src/features/playground/market/pendingValueRequest.ts';
import { createMarketPreviewStore } from '../src/features/playground/market/useMarketPreviewStore.ts';
import type { MarketPreviewGateway } from '../src/features/playground/market/previewGateway.ts';
import type {
  MarketAdminEventInput,
  MarketCommand,
  MarketSnapshot,
} from '../src/features/playground/market/types.ts';

test('each gateway starts from a deterministic isolated seed', async () => {
  const firstGateway = createMarketPreviewGateway({ latencyMs: 0 });
  const secondGateway = createMarketPreviewGateway({ latencyMs: 0 });
  const first = await firstGateway.read();
  const second = await secondGateway.read();

  assert.deepEqual(first, second);
  first.account.cashWon = -1;
  assert.equal((await firstGateway.read()).account.cashWon, 0);

  await firstGateway.execute({
    kind: 'favorite', requestId: 'isolated', stockId: 'adobe', wished: true,
  });
  assert.equal((await secondGateway.read()).revision, 1);
});

test('successful transfer is optimistic and converges visible and confirmed snapshots', async () => {
  const store = createMarketPreviewStore(createMarketPreviewGateway({ latencyMs: 20 }));
  await store.getState().load();

  const pending = store.getState().execute({
    kind: 'transfer', requestId: 'ok-1', direction: 'wallet-to-broker', points: 1000,
  });

  assert.equal(store.getState().visible?.account.cashWon, 1000);
  assert.equal(store.getState().confirmed?.account.cashWon, 0);
  assert.equal(store.getState().mutating, true);

  const result = await pending;
  assert.equal(result, true);
  assert.equal(store.getState().visible?.account.cashWon, 1000);
  assert.equal(store.getState().confirmed?.account.cashWon, 1000);
  assert.equal(store.getState().mutating, false);
});

test('ambiguous value mutation restores confirmed state and preserves its exact request', async () => {
  const gateway = createMarketPreviewGateway({ latencyMs: 0, failRequestIds: new Set(['fail-1']) });
  const store = createMarketPreviewStore(gateway);
  await store.getState().load();
  const before = structuredClone(store.getState().confirmed);

  const result = await store.getState().execute({
    kind: 'transfer', requestId: 'fail-1', direction: 'wallet-to-broker', points: 1000,
  });

  assert.equal(result, false);
  assert.deepEqual(store.getState().visible, before);
  assert.deepEqual(store.getState().confirmed, before);
  assert.equal(store.getState().mutating, false);
  assert.match(store.getState().error ?? '', /같은 요청|결과.*확인/);
  assert.deepEqual(store.getState().pendingValueCommand, {
    kind: 'transfer', requestId: 'fail-1', direction: 'wallet-to-broker', points: 1000,
  });
});

test('canonical quote or revision rejection refreshes authoritative events without retrying the write', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  let authoritativeOverride: MarketSnapshot | null = null;
  let readCalls = 0;
  let buyCalls = 0;
  const gateway: MarketPreviewGateway = {
    read: async () => {
      readCalls += 1;
      return authoritativeOverride
        ? structuredClone(authoritativeOverride)
        : canonical.read();
    },
    execute: async (command) => {
      if (command.kind === 'buy') {
        buyCalls += 1;
        throw new Error(
          "Error invoking remote method 'market:execute': Error: 가격이 바뀌었어요. 현재 가격을 확인하고 다시 주문해 주세요.",
        );
      }
      return canonical.execute(command);
    },
    createAdminEvent: (input) => canonical.createAdminEvent(input),
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load();
  await store.getState().execute({
    kind: 'transfer', requestId: 'fund-quote-error', direction: 'wallet-to-broker', points: 10_000,
  });
  const before = structuredClone(store.getState().confirmed);
  assert.ok(before);
  const refreshed = structuredClone(before);
  refreshed.revision += 1;
  refreshed.adminEvents.push({
    id: 'race-shock', stockId: 'jbbj', kind: 'shock-up', title: '주문 직전 호재', impactBps: 500,
    startsAt: '2026-07-11T00:00:00.000Z', endsAt: null, revision: refreshed.revision,
  });
  authoritativeOverride = refreshed;

  const result = await store.getState().execute({
    kind: 'buy', requestId: 'quote-changed', stockId: 'jbbj', quantityShares: 1,
    quotedPriceWon: 1_842, quotedRevision: before.revision,
  }, 1_842);

  assert.equal(result, false);
  assert.deepEqual(store.getState().visible, refreshed);
  assert.deepEqual(store.getState().confirmed, refreshed);
  assert.equal(readCalls, 2, 'initial load plus one authoritative rejection refresh');
  assert.equal(buyCalls, 1, 'a definite rejection must never retry the write');
  assert.equal(
    store.getState().error,
    '가격이 바뀌었어요. 현재 가격을 확인하고 다시 주문해 주세요.',
  );
});

test('failed rejection refresh blocks another value write until an explicit load succeeds', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  let failRefresh = false;
  let buyCalls = 0;
  const gateway: MarketPreviewGateway = {
    read: async () => {
      if (failRefresh) throw new Error('authoritative read unavailable');
      return canonical.read();
    },
    execute: async (command) => {
      if (command.kind === 'buy') {
        buyCalls += 1;
        failRefresh = true;
        throw new Error('가격이 바뀌었어요. 현재 가격을 확인하고 다시 주문해 주세요.');
      }
      return canonical.execute(command);
    },
    createAdminEvent: (input) => canonical.createAdminEvent(input),
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');
  await store.getState().execute({
    kind: 'transfer', requestId: 'fund-refresh-failure', direction: 'wallet-to-broker', points: 10_000,
  });
  const revision = store.getState().visible!.revision;
  const command = {
    kind: 'buy', requestId: 'refresh-failed-buy', stockId: 'jbbj', quantityShares: 1,
    quotedPriceWon: 1_842, quotedRevision: revision,
  } as const;

  assert.equal(await store.getState().execute(command, 1_842), false);
  assert.equal(store.getState().valueRefreshRequired, true);
  assert.equal(store.getState().pendingValueCommand, null, 'known rejection stays distinct from ambiguous response loss');
  assert.equal(await store.getState().execute({ ...command, requestId: 'must-not-write' }, 1_842), false);
  assert.equal(buyCalls, 1, 'refresh failure must block a second write');

  failRefresh = false;
  await store.getState().load('hansol');
  assert.equal(store.getState().valueRefreshRequired, false);
});

test('same-session explicit load clears mutating immediately and wins over a late execute result', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  const initial = await canonical.read();
  const staleExecuteResult = await canonical.execute({
    kind: 'transfer', requestId: 'stale-execute', direction: 'wallet-to-broker', points: 1000,
  });
  const newest = structuredClone(staleExecuteResult);
  newest.revision += 10;
  newest.account.walletPoints -= 500;
  newest.account.cashWon += 500;

  let readCalls = 0;
  let resolveExecute!: (snapshot: MarketSnapshot) => void;
  const lateExecute = new Promise<MarketSnapshot>((resolve) => {
    resolveExecute = resolve;
  });
  const gateway: MarketPreviewGateway = {
    read: async () => structuredClone(readCalls++ === 0 ? initial : newest),
    execute: async () => lateExecute,
    createAdminEvent: (input) => canonical.createAdminEvent(input),
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');

  const staleMutation = store.getState().execute({
    kind: 'transfer', requestId: 'late-response', direction: 'wallet-to-broker', points: 1000,
  });
  assert.equal(store.getState().mutating, true);

  const explicitReload = store.getState().load('hansol');
  assert.equal(store.getState().mutating, false, 'an explicit reload must release the old mutation lock');
  await explicitReload;
  resolveExecute(structuredClone(staleExecuteResult));

  assert.equal(await staleMutation, false, 'a completion from before the reload is stale');
  assert.deepEqual(store.getState().visible, newest);
  assert.deepEqual(store.getState().confirmed, newest);
  assert.equal(store.getState().mutating, false);
});

test('an execute started after an old same-user load keeps its newer snapshot and error', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  const initial = await canonical.read();
  let readCalls = 0;
  let resolveOldLoad!: (snapshot: MarketSnapshot) => void;
  const oldLoadResult = new Promise<MarketSnapshot>((resolve) => {
    resolveOldLoad = resolve;
  });
  const gateway: MarketPreviewGateway = {
    read: async () => {
      readCalls += 1;
      return readCalls === 1 ? structuredClone(initial) : oldLoadResult;
    },
    execute: (command) => canonical.execute(command),
    createAdminEvent: (input) => canonical.createAdminEvent(input),
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');

  const oldLoad = store.getState().load('hansol');
  assert.equal(await store.getState().execute({
    kind: 'favorite', requestId: 'favorite-after-old-load', stockId: 'adobe', wished: true,
  }), true);
  const committed = structuredClone(store.getState().confirmed);
  assert.ok(committed);
  assert.equal(committed.favoriteStockIds.includes('adobe'), true);

  assert.equal(await store.getState().execute({
    kind: 'transfer', requestId: 'invalid-after-favorite', direction: 'wallet-to-broker', points: 0,
  }), false);
  const mutationError = store.getState().error;
  assert.ok(mutationError);

  resolveOldLoad(structuredClone(initial));
  await oldLoad;
  assert.deepEqual(store.getState().confirmed, committed);
  assert.deepEqual(store.getState().visible, committed);
  assert.equal(store.getState().error, mutationError, 'a stale load must not clear a newer error');
  assert.equal(store.getState().loading, false);
});

test('an admin mutation started after an old same-user load keeps its event and error', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  const initial = await canonical.read();
  const input: MarketAdminEventInput = {
    stockId: 'jbbj', kind: 'news', title: '오래된 로드 뒤 저장', impactBps: 90,
    startsAt: '2026-07-12T00:00:00.000Z', endsAt: '2026-07-12T01:00:00.000Z',
  };
  let readCalls = 0;
  let resolveOldLoad!: (snapshot: MarketSnapshot) => void;
  const oldLoadResult = new Promise<MarketSnapshot>((resolve) => {
    resolveOldLoad = resolve;
  });
  const gateway: MarketPreviewGateway = {
    read: async () => {
      readCalls += 1;
      return readCalls === 1 ? structuredClone(initial) : oldLoadResult;
    },
    execute: (command) => canonical.execute(command),
    createAdminEvent: (eventInput) => canonical.createAdminEvent(eventInput),
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');

  const oldLoad = store.getState().load('hansol');
  assert.equal(await store.getState().createAdminEvent(input), true);
  const committed = structuredClone(store.getState().confirmed);
  assert.ok(committed?.adminEvents.some((event) => event.title === input.title));

  assert.equal(await store.getState().deleteAdminEvent('missing-event'), false);
  const mutationError = store.getState().error;
  assert.match(mutationError ?? '', /찾지 못했어요/);

  resolveOldLoad(structuredClone(initial));
  await oldLoad;
  assert.deepEqual(store.getState().confirmed, committed);
  assert.deepEqual(store.getState().visible, committed);
  assert.equal(store.getState().error, mutationError, 'a stale load must not clear a newer admin error');
  assert.equal(store.getState().loading, false);
});

test('canonical halt rejection survives an Electron or database error prefix', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  const gateway: MarketPreviewGateway = {
    read: () => canonical.read(),
    execute: async (command) => {
      if (command.kind === 'buy') {
        throw new Error(
          "Error invoking remote method 'market:execute': Error: market trading is halted for this stock",
        );
      }
      return canonical.execute(command);
    },
    createAdminEvent: (input) => canonical.createAdminEvent(input),
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load();
  await store.getState().execute({
    kind: 'transfer', requestId: 'fund-halt-error', direction: 'wallet-to-broker', points: 10_000,
  });

  assert.equal(await store.getState().execute({
    kind: 'buy', requestId: 'halt-error', stockId: 'jbbj', quantityShares: 1,
    quotedPriceWon: 1_842, quotedRevision: store.getState().visible!.revision,
  }, 1_842), false);
  assert.equal(store.getState().error, '현재 거래가 정지되어 주문할 수 없어요.');
  assert.equal(store.getState().pendingValueCommand, null);
});

test('buy response-loss retry reuses one request id and moves cash and shares exactly once', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  await canonical.execute({
    kind: 'transfer', requestId: 'fund-buy-response-loss', direction: 'wallet-to-broker', points: 10_000,
  });
  const calls: MarketCommand[] = [];
  let loseFirstBuyResponse = true;
  const gateway: MarketPreviewGateway = {
    read: () => canonical.read(),
    execute: async (command) => {
      calls.push(structuredClone(command));
      const result = await canonical.execute(command);
      if (command.kind === 'buy' && loseFirstBuyResponse) {
        loseFirstBuyResponse = false;
        throw new Error('transport closed after buy commit');
      }
      return result;
    },
    createAdminEvent: (input) => canonical.createAdminEvent(input),
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');
  const pending = createPendingMarketValueRequest({
    kind: 'buy', requestId: 'stable-buy-request', stockId: 'jbbj', quantityShares: 2,
    quotedPriceWon: 1_842, quotedRevision: store.getState().visible!.revision,
  }, { quantityShares: 2, quotedPriceWon: 1_842 });
  const command = retryPendingMarketValueCommand(pending);

  assert.equal(await store.getState().execute(command, 1_842), false);
  assert.deepEqual(store.getState().pendingValueCommand, command);
  assert.match(store.getState().error ?? '', /같은 요청|결과.*확인/);
  assert.equal(await store.getState().execute({ ...command, requestId: 'new-buy-request' }, 1_842), false);
  assert.equal(calls.length, 1, 'a different request must be blocked while the first result is unknown');

  assert.equal(await store.getState().execute(retryPendingMarketValueCommand(pending), 1), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.equal(fingerprintMarketCommand(calls[0]), fingerprintMarketCommand(calls[1]));
  assert.equal(store.getState().pendingValueCommand, null);
  const authoritative = await canonical.read();
  assert.equal(authoritative.account.cashWon, 10_000 - (2 * 1_842));
  assert.deepEqual(authoritative.account.holdings, [{
    stockId: 'jbbj', quantityShares: 2, costBasisWon: 2 * 1_842,
  }]);
});

test('sell response-loss retry reuses one request id and moves cash and shares exactly once', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  await canonical.execute({
    kind: 'transfer', requestId: 'fund-sell-response-loss', direction: 'wallet-to-broker', points: 10_000,
  });
  await canonical.execute({
    kind: 'buy', requestId: 'seed-sell-response-loss', stockId: 'jbbj', quantityShares: 4,
    quotedPriceWon: 1_842, quotedRevision: 2,
  });
  const calls: MarketCommand[] = [];
  let loseFirstSellResponse = true;
  const gateway: MarketPreviewGateway = {
    read: () => canonical.read(),
    execute: async (command) => {
      calls.push(structuredClone(command));
      const result = await canonical.execute(command);
      if (command.kind === 'sell' && loseFirstSellResponse) {
        loseFirstSellResponse = false;
        throw new Error('transport closed after sell commit');
      }
      return result;
    },
    createAdminEvent: (input) => canonical.createAdminEvent(input),
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');
  const pending = createPendingMarketValueRequest({
    kind: 'sell', requestId: 'stable-sell-request', stockId: 'jbbj', quantityShares: 2,
    quotedPriceWon: 2_000, quotedRevision: store.getState().visible!.revision,
  }, { quantityShares: 2, quotedPriceWon: 2_000 });
  const command = retryPendingMarketValueCommand(pending);

  assert.equal(await store.getState().execute(command, 2_000), false);
  assert.deepEqual(store.getState().pendingValueCommand, command);
  assert.match(store.getState().error ?? '', /같은 요청|결과.*확인/);
  assert.equal(await store.getState().execute({ ...command, requestId: 'new-sell-request' }, 2_000), false);
  assert.equal(calls.length, 1, 'a different request must be blocked while the first result is unknown');

  assert.equal(await store.getState().execute(retryPendingMarketValueCommand(pending), 1), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.equal(fingerprintMarketCommand(calls[0]), fingerprintMarketCommand(calls[1]));
  assert.equal(store.getState().pendingValueCommand, null);
  const authoritative = await canonical.read();
  assert.equal(authoritative.account.cashWon, 6_632);
  assert.equal(authoritative.account.realizedPnlThisMonthWon, 316);
  assert.deepEqual(authoritative.account.holdings, [{
    stockId: 'jbbj', quantityShares: 2, costBasisWon: 2 * 1_842,
  }]);
});

test('point transfer response-loss retry reuses exact direction, points and request id once', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  const calls: MarketCommand[] = [];
  let loseFirstTransferResponse = true;
  const gateway: MarketPreviewGateway = {
    read: () => canonical.read(),
    execute: async (command) => {
      calls.push(structuredClone(command));
      const result = await canonical.execute(command);
      if (command.kind === 'transfer' && loseFirstTransferResponse) {
        loseFirstTransferResponse = false;
        throw new Error('transport closed after transfer commit');
      }
      return result;
    },
    createAdminEvent: (input) => canonical.createAdminEvent(input),
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');
  const pending = createPendingMarketValueRequest({
    kind: 'transfer', requestId: 'stable-transfer-request', direction: 'wallet-to-broker', points: 5_000,
  }, { direction: 'wallet-to-broker', points: 5_000 });
  const command = retryPendingMarketValueCommand(pending);

  assert.equal(await store.getState().execute(command), false);
  assert.deepEqual(store.getState().pendingValueCommand, command);
  assert.equal(await store.getState().execute(retryPendingMarketValueCommand(pending)), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.equal(fingerprintMarketCommand(calls[0]), fingerprintMarketCommand(calls[1]));
  const authoritative = await canonical.read();
  assert.equal(authoritative.account.walletPoints, 995_000);
  assert.equal(authoritative.account.cashWon, 5_000);
  assert.equal(store.getState().pendingValueCommand, null);
});

test('authoritative reload clears an ambiguous value request without resending it', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  let writeCalls = 0;
  const gateway: MarketPreviewGateway = {
    read: () => canonical.read(),
    execute: async (command) => {
      writeCalls += 1;
      await canonical.execute(command);
      throw new Error('response lost');
    },
    createAdminEvent: (input) => canonical.createAdminEvent(input),
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');
  assert.equal(await store.getState().execute({
    kind: 'transfer', requestId: 'reload-transfer-request', direction: 'wallet-to-broker', points: 1_000,
  }), false);
  assert.ok(store.getState().pendingValueCommand);

  await store.getState().load('hansol');
  assert.equal(writeCalls, 1);
  assert.equal(store.getState().pendingValueCommand, null);
  assert.equal(store.getState().visible?.account.cashWon, 1_000);
});

test('a second mutation is blocked until the first is confirmed', async () => {
  const gateway = createMarketPreviewGateway({ latencyMs: 20 });
  const store = createMarketPreviewStore(gateway);
  await store.getState().load();

  const first = store.getState().execute({
    kind: 'favorite', requestId: 'first', stockId: 'adobe', wished: true,
  });
  const second = await store.getState().execute({
    kind: 'favorite', requestId: 'second', stockId: 'netflix', wished: true,
  });

  assert.equal(second, false);
  assert.equal(store.getState().mutating, true);
  assert.equal(await first, true);
  const canonical = await gateway.read();
  assert.ok(canonical.favoriteStockIds.includes('adobe'));
  assert.equal(canonical.favoriteStockIds.includes('netflix'), false);
});

test('the same request id returns the latest canonical snapshot across A to B to A', async () => {
  const gateway = createMarketPreviewGateway({ latencyMs: 0 });
  const commandA = {
    kind: 'transfer', requestId: 'same-id', direction: 'wallet-to-broker', points: 1000,
  } as const;

  const first = await gateway.execute(commandA);
  const afterB = await gateway.execute({
    kind: 'favorite', requestId: 'different-id', stockId: 'adobe', wished: true,
  });
  const retryA = await gateway.execute({
    requestId: commandA.requestId,
    points: commandA.points,
    direction: commandA.direction,
    kind: commandA.kind,
  });

  assert.equal(first.account.cashWon, 1000);
  assert.equal(retryA.account.cashWon, 1000);
  assert.equal(retryA.revision, afterB.revision);
  assert.ok(retryA.favoriteStockIds.includes('adobe'));
  await assert.rejects(
    () => gateway.execute({ ...commandA, points: 500 }),
    /request id conflict/,
  );
  assert.deepEqual(await gateway.read(), retryA);
});

test('validation errors do not enter the mutation gate or change canonical state', async () => {
  const gateway = createMarketPreviewGateway({ latencyMs: 0 });
  const store = createMarketPreviewStore(gateway);
  await store.getState().load();
  const before = structuredClone(store.getState().confirmed);

  const result = await store.getState().execute({
    kind: 'transfer', requestId: 'invalid', direction: 'wallet-to-broker', points: 1_000_001,
  });

  assert.equal(result, false);
  assert.equal(store.getState().error, '포인트 지갑 잔액이 부족해요');
  assert.equal(store.getState().mutating, false);
  assert.deepEqual(store.getState().visible, before);
  assert.deepEqual(store.getState().confirmed, before);
  assert.deepEqual(await gateway.read(), before);
});

test('read failure exposes a retryable initial error without a fake snapshot', async () => {
  const store = createMarketPreviewStore(createMarketPreviewGateway({ latencyMs: 0, failRead: true }));

  await store.getState().load();

  assert.equal(store.getState().visible, null);
  assert.equal(store.getState().confirmed, null);
  assert.equal(store.getState().loading, false);
  assert.equal(store.getState().error, '시장 정보를 불러오지 못했어요.');
});

test('account snapshots never absorb the one-second clock or live quote map', async () => {
  const store = createMarketPreviewStore(createMarketPreviewGateway({ latencyMs: 0 }));
  await store.getState().load();

  const { confirmed, visible } = store.getState();
  assert.ok(confirmed && visible);
  assert.equal('nowMs' in confirmed, false);
  assert.equal('nowMs' in visible, false);
  assert.equal('quoteWonByStockId' in confirmed, false);
  assert.equal('quoteWonByStockId' in visible, false);
});

test('in-memory request fingerprints include whole-share quantity, quote, and quoted revision', async () => {
  const gateway = createMarketPreviewGateway({ latencyMs: 0 });
  await gateway.execute({
    kind: 'transfer', requestId: 'fund-order', direction: 'wallet-to-broker', points: 10_000,
  });
  const command = {
    kind: 'buy',
    requestId: 'whole-share-order',
    stockId: 'jbbj',
    quantityShares: 2,
    quotedPriceWon: 1_842,
    quotedRevision: 2,
  } as const;
  const bought = await gateway.execute(command);
  const retry = await gateway.execute({ ...command });
  assert.deepEqual(retry, bought);
  await assert.rejects(
    () => gateway.execute({ ...command, quotedPriceWon: 1_843 }),
    /request id conflict/,
  );
  await assert.rejects(
    () => gateway.execute({ ...command, quotedRevision: 3 }),
    /request id conflict/,
  );
});

test('an explicit current quote affects only the optimistic calculation before canonical convergence', async () => {
  const store = createMarketPreviewStore(createMarketPreviewGateway({ latencyMs: 20 }));
  await store.getState().load();
  await store.getState().execute({
    kind: 'transfer', requestId: 'fund-current-quote', direction: 'wallet-to-broker', points: 10_000,
  });

  const pending = store.getState().execute({
    kind: 'buy',
    requestId: 'buy-current-quote',
    stockId: 'jbbj',
    quantityShares: 2,
    quotedPriceWon: 1_842,
    quotedRevision: store.getState().visible!.revision,
  }, 2_000);
  assert.equal(store.getState().visible?.account.cashWon, 6_000);
  assert.equal(store.getState().confirmed?.account.cashWon, 10_000);
  assert.equal('quoteWonByStockId' in store.getState(), false);

  assert.equal(await pending, true);
  assert.equal(store.getState().visible?.account.cashWon, 6_316);
  assert.equal(store.getState().confirmed?.account.cashWon, 6_316);
});

test('admin event creation is optimistic and converges to the authoritative snapshot', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  let releaseCreate!: (snapshot: MarketSnapshot) => void;
  const gateway: MarketPreviewGateway = {
    read: () => canonical.read(),
    execute: (command) => canonical.execute(command),
    createAdminEvent: () => new Promise((resolve) => { releaseCreate = resolve; }),
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');
  const input: MarketAdminEventInput = {
    stockId: 'jbbj', kind: 'news', title: '새 소식', impactBps: 100,
    startsAt: '2026-07-11T00:00:00.000Z', endsAt: '2026-07-11T01:00:00.000Z',
  };

  assert.equal(typeof store.getState().createAdminEvent, 'function');
  const pending = store.getState().createAdminEvent(input);
  assert.equal(store.getState().mutating, true);
  assert.equal(store.getState().visible?.adminEvents.at(-1)?.title, '새 소식');
  assert.match(store.getState().visible?.adminEvents.at(-1)?.id ?? '', /^pending-event-/);

  const authoritative = await canonical.createAdminEvent(input);
  releaseCreate(authoritative);
  assert.equal(await pending, true);
  assert.deepEqual(store.getState().visible, authoritative);
  assert.deepEqual(store.getState().confirmed, authoritative);
});

test('admin event delete rolls back on failure and blocks a duplicate mutation', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  const input: MarketAdminEventInput = {
    stockId: 'jbbj', kind: 'trend', title: '상승 흐름', impactBps: 80,
    startsAt: '2026-07-11T00:00:00.000Z', endsAt: '2026-07-11T01:00:00.000Z',
  };
  const seeded = await canonical.createAdminEvent(input);
  const eventId = seeded.adminEvents[0].id;
  let rejectDelete!: (error: Error) => void;
  const gateway: MarketPreviewGateway = {
    read: () => canonical.read(),
    execute: (command) => canonical.execute(command),
    createAdminEvent: (nextInput) => canonical.createAdminEvent(nextInput),
    deleteAdminEvent: () => new Promise((_resolve, reject) => { rejectDelete = reject; }),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');

  assert.equal(typeof store.getState().deleteAdminEvent, 'function');
  const pending = store.getState().deleteAdminEvent(eventId);
  assert.equal(store.getState().visible?.adminEvents.length, 0);
  assert.equal(await store.getState().deleteAdminEvent(eventId), false);
  rejectDelete(new Error('network lost'));
  assert.equal(await pending, false);
  assert.deepEqual(store.getState().visible, seeded);
  assert.deepEqual(store.getState().confirmed, seeded);
  assert.equal(store.getState().mutating, false);
  assert.match(store.getState().error ?? '', /서버에서 종료되지 않았어요/);
});

test('admin mutation response from an old market session is ignored without retry', async () => {
  const first = await createMarketPreviewGateway({ latencyMs: 0 }).read();
  const second = structuredClone(first);
  second.revision = 99;
  let activeRead = first;
  let releaseCreate!: (snapshot: MarketSnapshot) => void;
  let createCalls = 0;
  const gateway: MarketPreviewGateway = {
    read: async () => structuredClone(activeRead),
    execute: async () => { throw new Error('unused'); },
    createAdminEvent: () => {
      createCalls += 1;
      return new Promise((resolve) => { releaseCreate = resolve; });
    },
    deleteAdminEvent: async () => { throw new Error('unused'); },
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('first-user');
  const pending = store.getState().createAdminEvent({
    stockId: 'jbbj', kind: 'halt', title: '점검', impactBps: 0,
    startsAt: '2026-07-11T00:00:00.000Z', endsAt: null,
  });
  activeRead = second;
  await store.getState().load('second-user');
  releaseCreate(first);

  assert.equal(await pending, false);
  assert.equal(createCalls, 1);
  assert.equal(store.getState().sessionKey, 'second-user');
  assert.equal(store.getState().visible?.revision, 99);
  assert.equal(store.getState().mutating, false);
});

test('admin create response loss reconciles by read without retrying the write', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  const input: MarketAdminEventInput = {
    stockId: 'jbbj', kind: 'news', title: '응답 유실 소식', impactBps: 90,
    startsAt: '2026-07-11T00:00:00.000Z', endsAt: '2026-07-11T01:00:00.000Z',
  };
  let createCalls = 0;
  let readCalls = 0;
  const gateway: MarketPreviewGateway = {
    read: async () => { readCalls += 1; return canonical.read(); },
    execute: (command) => canonical.execute(command),
    createAdminEvent: async (nextInput) => {
      createCalls += 1;
      await canonical.createAdminEvent(nextInput);
      throw new Error('response lost after commit');
    },
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');

  assert.equal(await store.getState().createAdminEvent(input), true);
  assert.equal(createCalls, 1);
  assert.equal(readCalls, 2, 'initial load plus one authoritative reconcile read');
  assert.equal(store.getState().visible?.adminEvents.filter((event) => event.title === input.title).length, 1);
  assert.equal(store.getState().error, null);
  assert.equal(store.getState().adminWriteUncertain, false);
});

test('admin delete response loss reconciles target absence without retrying the write', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  const seeded = await canonical.createAdminEvent({
    stockId: 'jbbj', kind: 'trend', title: '삭제 응답 유실', impactBps: 80,
    startsAt: '2026-07-11T00:00:00.000Z', endsAt: '2026-07-11T01:00:00.000Z',
  });
  const eventId = seeded.adminEvents[0].id;
  let deleteCalls = 0;
  let readCalls = 0;
  const gateway: MarketPreviewGateway = {
    read: async () => { readCalls += 1; return canonical.read(); },
    execute: (command) => canonical.execute(command),
    createAdminEvent: (input) => canonical.createAdminEvent(input),
    deleteAdminEvent: async (targetId) => {
      deleteCalls += 1;
      await canonical.deleteAdminEvent(targetId);
      throw new Error('response lost after delete');
    },
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');

  assert.equal(await store.getState().deleteAdminEvent(eventId), true);
  assert.equal(deleteCalls, 1);
  assert.equal(readCalls, 2);
  assert.equal(store.getState().visible?.adminEvents.some((event) => event.id === eventId), false);
  assert.equal(store.getState().error, null);
  assert.equal(store.getState().adminWriteUncertain, false);
});

test('unknown admin write result blocks duplicate writes until a successful reload', async () => {
  const canonical = createMarketPreviewGateway({ latencyMs: 0 });
  const input: MarketAdminEventInput = {
    stockId: 'jbbj', kind: 'news', title: '결과 불명 소식', impactBps: 70,
    startsAt: '2026-07-11T00:00:00.000Z', endsAt: '2026-07-11T01:00:00.000Z',
  };
  let createCalls = 0;
  let failReads = false;
  const gateway: MarketPreviewGateway = {
    read: async () => {
      if (failReads) throw new Error('reconcile read unavailable');
      return canonical.read();
    },
    execute: (command) => canonical.execute(command),
    createAdminEvent: async () => {
      createCalls += 1;
      failReads = true;
      throw new Error('write result unknown');
    },
    deleteAdminEvent: (eventId) => canonical.deleteAdminEvent(eventId),
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('hansol');

  assert.equal(await store.getState().createAdminEvent(input), false);
  assert.equal(store.getState().adminWriteUncertain, true);
  assert.match(store.getState().error ?? '', /결과를 확인할 수 없어|다시 불러/);
  assert.equal(await store.getState().createAdminEvent(input), false);
  assert.equal(createCalls, 1, 'uncertain state must block a duplicate non-idempotent write');

  await store.getState().load('hansol');
  assert.equal(store.getState().adminWriteUncertain, true, 'failed reload keeps the safety lock');
  failReads = false;
  await store.getState().load('hansol');
  assert.equal(store.getState().adminWriteUncertain, false);
  assert.equal(store.getState().error, null);
});

test('admin reconcile response from a stale session cannot replace the new session', async () => {
  const first = await createMarketPreviewGateway({ latencyMs: 0 }).read();
  const second = structuredClone(first);
  second.revision = 77;
  let activeRead = first;
  let rejectWrite!: (error: Error) => void;
  let releaseReconcile!: (snapshot: MarketSnapshot) => void;
  let writeRejected = false;
  let reconcileStarted = false;
  const gateway: MarketPreviewGateway = {
    read: async () => {
      if (writeRejected && !reconcileStarted) {
        reconcileStarted = true;
        return new Promise((resolve) => { releaseReconcile = resolve; });
      }
      return structuredClone(activeRead);
    },
    execute: async () => { throw new Error('unused'); },
    createAdminEvent: () => new Promise((_resolve, reject) => { rejectWrite = reject; }),
    deleteAdminEvent: async () => { throw new Error('unused'); },
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('first-user');
  const pending = store.getState().createAdminEvent({
    stockId: 'jbbj', kind: 'news', title: '오래된 응답', impactBps: 20,
    startsAt: '2026-07-11T00:00:00.000Z', endsAt: '2026-07-11T01:00:00.000Z',
  });
  writeRejected = true;
  rejectWrite(new Error('response lost'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reconcileStarted, true, 'failed write must begin one reconcile read');
  activeRead = second;
  await store.getState().load('second-user');
  releaseReconcile(first);

  assert.equal(await pending, false);
  assert.equal(store.getState().sessionKey, 'second-user');
  assert.equal(store.getState().visible?.revision, 77);
  assert.equal(store.getState().adminWriteUncertain, false);
});

test('failed admin reconcile cannot overwrite a newer reload in the same session', async () => {
  const first = await createMarketPreviewGateway({ latencyMs: 0 }).read();
  const refreshed = structuredClone(first);
  refreshed.revision = 88;
  let rejectWrite!: (error: Error) => void;
  let rejectReconcile!: (error: Error) => void;
  let writeRejected = false;
  let reconcileStarted = false;
  const gateway: MarketPreviewGateway = {
    read: async () => {
      if (writeRejected && !reconcileStarted) {
        reconcileStarted = true;
        return new Promise((_resolve, reject) => { rejectReconcile = reject; });
      }
      return reconcileStarted ? structuredClone(refreshed) : structuredClone(first);
    },
    execute: async () => { throw new Error('unused'); },
    createAdminEvent: () => new Promise((_resolve, reject) => { rejectWrite = reject; }),
    deleteAdminEvent: async () => { throw new Error('unused'); },
  };
  const store = createMarketPreviewStore(gateway);
  await store.getState().load('same-user');
  const pending = store.getState().createAdminEvent({
    stockId: 'jbbj', kind: 'news', title: '같은 세션 최신화', impactBps: 20,
    startsAt: '2026-07-11T00:00:00.000Z', endsAt: '2026-07-11T01:00:00.000Z',
  });
  writeRejected = true;
  rejectWrite(new Error('response lost'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reconcileStarted, true);

  await store.getState().load('same-user');
  rejectReconcile(new Error('old reconcile failed'));
  assert.equal(await pending, false);
  assert.equal(store.getState().visible?.revision, 88);
  assert.equal(store.getState().confirmed?.revision, 88);
  assert.equal(store.getState().adminWriteUncertain, false);
  assert.equal(store.getState().error, null);
});
