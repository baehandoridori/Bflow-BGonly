import test from 'node:test';
import assert from 'node:assert/strict';

import { createMarketPreviewGateway } from '../src/features/playground/market/previewGateway.ts';
import { createMarketPreviewStore } from '../src/features/playground/market/useMarketPreviewStore.ts';

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

test('failed mutation restores the confirmed snapshot', async () => {
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
  assert.equal(store.getState().error, '저장하지 못했어요. 이전 상태로 되돌렸어요.');
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

test('in-memory request fingerprints include whole-share quantity and quoted won price', async () => {
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
  } as const;
  const bought = await gateway.execute(command);
  const retry = await gateway.execute({ ...command });
  assert.deepEqual(retry, bought);
  await assert.rejects(
    () => gateway.execute({ ...command, quotedPriceWon: 1_843 }),
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
  }, 2_000);
  assert.equal(store.getState().visible?.account.cashWon, 6_000);
  assert.equal(store.getState().confirmed?.account.cashWon, 10_000);
  assert.equal('quoteWonByStockId' in store.getState(), false);

  assert.equal(await pending, true);
  assert.equal(store.getState().visible?.account.cashWon, 6_316);
  assert.equal(store.getState().confirmed?.account.cashWon, 6_316);
});
