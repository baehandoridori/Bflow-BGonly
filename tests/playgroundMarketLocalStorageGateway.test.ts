import test from 'node:test';
import assert from 'node:assert/strict';

import { createMarketLocalStorageGateway } from '../src/features/playground/market/localStorageGateway.ts';

class FakeStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const STORAGE_KEY = 'bflow:playground-market:v2:hansol-preview';

test('first read creates the approved account under the user-scoped v2 key', async () => {
  const storage = new FakeStorage();
  const gateway = createMarketLocalStorageGateway({
    userId: 'hansol-preview',
    storage,
    now: () => 1_720_000_000_000,
    latencyMs: 0,
  });

  const snapshot = await gateway.read();

  assert.deepEqual(snapshot.account, {
    walletPoints: 1_000_000,
    lifetimeEarnedPoints: 1_000_000,
    cashWon: 0,
    realizedPnlThisMonthWon: 0,
    unrealizedPnlAtMonthStartWon: 0,
    holdings: [],
  });
  assert.equal(storage.length, 1);
  assert.equal(storage.key(0), STORAGE_KEY);
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!);
  assert.deepEqual(persisted.snapshot, snapshot);
  assert.deepEqual(persisted.requestFingerprints, {});
  assert.equal(persisted.updatedAtMs, 1_720_000_000_000);
});

test('a transfer survives creation of a second gateway over the same storage', async () => {
  const storage = new FakeStorage();
  const options = {
    userId: 'hansol-preview',
    storage,
    now: () => 1_720_000_000_000,
    latencyMs: 0,
  };
  const first = createMarketLocalStorageGateway(options);
  await first.execute({
    kind: 'transfer',
    requestId: 'deposit-once',
    direction: 'wallet-to-broker',
    points: 10_000,
  });

  const second = createMarketLocalStorageGateway(options);
  const restored = await second.read();
  assert.equal(restored.account.walletPoints, 990_000);
  assert.equal(restored.account.lifetimeEarnedPoints, 1_000_000);
  assert.equal(restored.account.cashWon, 10_000);
});

test('persisted request fingerprints prevent duplicate execution after recreation', async () => {
  const storage = new FakeStorage();
  const options = {
    userId: 'hansol-preview',
    storage,
    now: () => 1_720_000_000_000,
    latencyMs: 0,
  };
  const command = {
    kind: 'transfer',
    requestId: 'stable-request',
    direction: 'wallet-to-broker',
    points: 2_500,
  } as const;

  await createMarketLocalStorageGateway(options).execute(command);
  const recreated = createMarketLocalStorageGateway(options);
  const retry = await recreated.execute({ ...command });
  assert.equal(retry.account.cashWon, 2_500);
  assert.equal(retry.revision, 2);

  await assert.rejects(
    () => recreated.execute({ ...command, points: 2_000 }),
    /request id conflict/,
  );
  assert.equal((await recreated.read()).account.cashWon, 2_500);
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!);
  assert.equal(typeof persisted.requestFingerprints[command.requestId], 'string');
});

test('corrupt JSON exposes a retryable read error without granting another account', async () => {
  const storage = new FakeStorage();
  storage.setItem(STORAGE_KEY, '{not-json');
  const gateway = createMarketLocalStorageGateway({
    userId: 'hansol-preview',
    storage,
    now: () => 1_720_000_000_000,
    latencyMs: 0,
  });

  await assert.rejects(
    () => gateway.read(),
    (error: unknown) => (
      error instanceof Error
      && error.message === '저장된 시장 정보를 읽지 못했어요. 다시 시도해 주세요.'
      && (error as Error & { retryable?: boolean }).retryable === true
    ),
  );
  assert.equal(storage.getItem(STORAGE_KEY), '{not-json');
});
