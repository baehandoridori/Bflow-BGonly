import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMarketLocalStorageGateway,
  MarketStorageReadError,
} from '../src/features/playground/market/localStorageGateway.ts';
import { writeSharedPreviewWallet } from '../src/features/playground/previewSharedWallet.ts';
import type {
  Holding,
  MarketNews,
  MarketSnapshot,
  MarketStock,
} from '../src/features/playground/market/types.ts';

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

interface PersistedFixture {
  version: 2;
  snapshot: MarketSnapshot;
  requestFingerprints: Record<string, string>;
  updatedAtMs: number;
}

function createGateway(storage: Storage) {
  return createMarketLocalStorageGateway({
    userId: 'hansol-preview',
    storage,
    now: () => 1_720_000_000_000,
    latencyMs: 0,
  });
}

function isRetryableStorageError(error: unknown): boolean {
  return (
    error instanceof MarketStorageReadError
    && error.message === '저장된 시장 정보를 읽지 못했어요. 다시 시도해 주세요.'
    && error.retryable === true
  );
}

async function assertJsonValidCorruptionRejected(
  mutate: (persisted: PersistedFixture) => void,
): Promise<void> {
  const storage = new FakeStorage();
  const gateway = createGateway(storage);
  await gateway.read();
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!) as PersistedFixture;
  mutate(persisted);
  const corruptedRaw = JSON.stringify(persisted);
  storage.setItem(STORAGE_KEY, corruptedRaw);
  const originalLength = storage.length;

  await assert.rejects(() => gateway.read(), isRetryableStorageError);
  assert.equal(storage.getItem(STORAGE_KEY), corruptedRaw, 'corrupt payload must not be replaced by a new grant');
  assert.equal(storage.length, originalLength, 'failed read must not add another account key');
}

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
  // v2 계좌 키 + 아케이드와 공유하는 프리뷰 지갑 키(단일 지갑 계약 반영)
  assert.equal(storage.length, 2);
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

test('JSON-valid null holding is rejected without overwriting storage or regranting points', async () => {
  await assertJsonValidCorruptionRejected((persisted) => {
    persisted.snapshot.account.holdings = [null as unknown as Holding];
  });
});

test('unknown stock holdings and duplicate holdings are rejected', async () => {
  const cases: Array<(persisted: PersistedFixture) => void> = [
    (persisted) => {
      persisted.snapshot.account.holdings = [{
        stockId: 'unknown-stock', quantityShares: 1, costBasisWon: 100,
      }];
    },
    (persisted) => {
      persisted.snapshot.account.holdings = [
        { stockId: 'jbbj', quantityShares: 1, costBasisWon: 100 },
        { stockId: 'jbbj', quantityShares: 2, costBasisWon: 200 },
      ];
    },
  ];
  for (const mutate of cases) await assertJsonValidCorruptionRejected(mutate);
});

test('nonpositive, fractional and unsafe holding quantities are rejected', async () => {
  for (const quantityShares of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assertJsonValidCorruptionRejected((persisted) => {
      persisted.snapshot.account.holdings = [{
        stockId: 'jbbj', quantityShares, costBasisWon: 100,
      }];
    });
  }
});

test('negative, fractional and unsafe account balances are rejected', async () => {
  const cases: Array<(persisted: PersistedFixture) => void> = [
    (persisted) => { persisted.snapshot.account.walletPoints = -1; },
    (persisted) => { persisted.snapshot.account.lifetimeEarnedPoints = Number.MAX_SAFE_INTEGER + 1; },
    (persisted) => { persisted.snapshot.account.cashWon = 0.5; },
    (persisted) => { persisted.snapshot.account.realizedPnlThisMonthWon = Number.MAX_SAFE_INTEGER + 1; },
    (persisted) => { persisted.snapshot.account.unrealizedPnlAtMonthStartWon = 1.5; },
  ];
  for (const mutate of cases) await assertJsonValidCorruptionRejected(mutate);
});

test('negative safe PnL remains a valid persisted account state', async () => {
  const storage = new FakeStorage();
  const gateway = createGateway(storage);
  await gateway.read();
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!) as PersistedFixture;
  persisted.snapshot.account.realizedPnlThisMonthWon = -100;
  persisted.snapshot.account.unrealizedPnlAtMonthStartWon = -50;
  storage.setItem(STORAGE_KEY, JSON.stringify(persisted));

  const restored = await gateway.read();
  assert.equal(restored.account.realizedPnlThisMonthWon, -100);
  assert.equal(restored.account.unrealizedPnlAtMonthStartWon, -50);
});

test('malformed stocks, price points and duplicate stock IDs are rejected', async () => {
  const cases: Array<(persisted: PersistedFixture) => void> = [
    (persisted) => { persisted.snapshot.stocks[0] = null as unknown as MarketStock; },
    (persisted) => { persisted.snapshot.stocks[0].name = ''; },
    (persisted) => { persisted.snapshot.stocks[0].referencePriceWon = 1.5; },
    (persisted) => { persisted.snapshot.stocks[0].series.today[0].priceWon = 0; },
    (persisted) => { persisted.snapshot.stocks[0].series.today[0].at = ''; },
    (persisted) => { persisted.snapshot.stocks[1].id = persisted.snapshot.stocks[0].id; },
  ];
  for (const mutate of cases) await assertJsonValidCorruptionRejected(mutate);
});

test('malformed news and favorite stock references are rejected', async () => {
  const cases: Array<(persisted: PersistedFixture) => void> = [
    (persisted) => { persisted.snapshot.news[0] = null as unknown as MarketNews; },
    (persisted) => { persisted.snapshot.news[0].title = ''; },
    (persisted) => { persisted.snapshot.news[0].stockId = 'unknown-stock'; },
    (persisted) => { persisted.snapshot.favoriteStockIds = [null as unknown as string]; },
    (persisted) => { persisted.snapshot.favoriteStockIds = ['unknown-stock']; },
    (persisted) => { persisted.snapshot.favoriteStockIds = ['jbbj', 'jbbj']; },
  ];
  for (const mutate of cases) await assertJsonValidCorruptionRejected(mutate);
});

test('persisted metadata and request fingerprints require safe integer and string pairs', async () => {
  const cases: Array<(persisted: PersistedFixture) => void> = [
    (persisted) => { persisted.snapshot.revision = 1.5; },
    (persisted) => { persisted.updatedAtMs = -1; },
    (persisted) => {
      persisted.requestFingerprints = { bad: 42 as unknown as string };
    },
    (persisted) => {
      persisted.requestFingerprints = [] as unknown as Record<string, string>;
    },
  ];
  for (const mutate of cases) await assertJsonValidCorruptionRejected(mutate);
});

test('createAdminEvent reconciles the arcade-updated shared wallet before saving', async () => {
  const storage = new FakeStorage();
  const gateway = createGateway(storage);
  await gateway.read(); // 공유 지갑 시드 = 1,000,000
  // 마지막 시장 저장 이후 아케이드가 공유 지갑을 바꿨다고 가정.
  writeSharedPreviewWallet(storage, 'hansol-preview', { walletPoints: 999_000, lifetimeEarnedPoints: 1_000_500 });

  const snapshot = await gateway.createAdminEvent({
    stockId: 'jbbj', kind: 'news', title: '테스트 공지', impactBps: 0,
    startsAt: '2026-07-13T00:00:00.000Z', endsAt: null,
  });

  // 스테일 1,000,000 이 아니라 아케이드가 바꾼 공유 잔액을 반영해야 한다.
  assert.equal(snapshot.account.walletPoints, 999_000);
  assert.equal(snapshot.account.lifetimeEarnedPoints, 1_000_500);
  assert.equal(snapshot.adminEvents.length, 1, '이벤트도 함께 저장된다');
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!) as PersistedFixture;
  assert.equal(persisted.snapshot.account.walletPoints, 999_000, '저장된 스냅샷도 맞춰진 잔액이어야 한다');
  assert.equal(persisted.snapshot.account.lifetimeEarnedPoints, 1_000_500);
});

test('deleteAdminEvent reconciles the arcade-updated shared wallet before saving', async () => {
  const storage = new FakeStorage();
  const gateway = createGateway(storage);
  await gateway.read();
  const created = await gateway.createAdminEvent({
    stockId: 'jbbj', kind: 'news', title: '삭제할 공지', impactBps: 0,
    startsAt: '2026-07-13T00:00:00.000Z', endsAt: null,
  });
  const eventId = created.adminEvents[0]!.id;
  // 이벤트 생성 뒤 아케이드가 공유 지갑을 또 바꿨다.
  writeSharedPreviewWallet(storage, 'hansol-preview', { walletPoints: 990_000, lifetimeEarnedPoints: 1_001_000 });

  const snapshot = await gateway.deleteAdminEvent(eventId);

  assert.equal(snapshot.account.walletPoints, 990_000);
  assert.equal(snapshot.account.lifetimeEarnedPoints, 1_001_000);
  assert.equal(snapshot.adminEvents.length, 0, '이벤트가 삭제된다');
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!) as PersistedFixture;
  assert.equal(persisted.snapshot.account.walletPoints, 990_000, '저장된 스냅샷도 맞춰진 잔액이어야 한다');
});
