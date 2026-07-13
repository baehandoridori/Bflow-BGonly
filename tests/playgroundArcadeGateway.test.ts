import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createArcadeLocalStorageGateway } from '../src/features/playground/arcade/localStorageGateway.ts';
import { createArcadeGateway } from '../src/features/playground/arcade/gateway.ts';
import { createMarketLocalStorageGateway } from '../src/features/playground/market/localStorageGateway.ts';
import { createArcadePreviewSeed } from '../src/features/playground/arcade/seed.ts';
import type {
  ArcadeActivityResult,
  ArcadeExecuteResult,
  ArcadeGameFinishResult,
  ArcadeGameStartResult,
  ArcadeSnapshot,
} from '../src/features/playground/arcade/types.ts';

const USER_ID = 'preview-user-1';
const NOW = Date.parse('2026-07-13T12:00:00+09:00');

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as Storage;
}

function seededStorage(mutate?: (snapshot: ArcadeSnapshot) => void): Storage {
  const storage = createMemoryStorage();
  const snapshot = createArcadePreviewSeed(USER_ID);
  mutate?.(snapshot);
  storage.setItem(
    `bflow-arcade-preview-v1:${USER_ID}`,
    JSON.stringify({ version: 1, snapshot, requestFingerprints: {}, requestResponses: {}, updatedAtMs: 0 }),
  );
  return storage;
}

function gateway(storage: Storage) {
  return createArcadeLocalStorageGateway({ userId: USER_ID, storage, now: () => NOW });
}

test('localStorage gateway seeds a fresh snapshot on first read', async () => {
  const snapshot = await gateway(createMemoryStorage()).read();
  assert.equal(snapshot.wallet.walletPoints, 1_000_000);
  assert.equal(snapshot.wallet.lifetimeEarnedPoints, 1_000_000);
  assert.equal(snapshot.attendance.streakDays, 3);
  assert.deepEqual(
    snapshot.achievements.map((a) => a.achievementId),
    ['arcade-first-run'],
  );
  assert.equal(snapshot.config.slackNotifyEnabled, false);
  // the seed self entry tops the wallet ranking
  assert.equal(snapshot.walletLeaderboard[0]?.userId, USER_ID);
});

test('game-start deducts the entry fee and persists it', async () => {
  const storage = seededStorage();
  const gw = gateway(storage);
  const result = (await gw.execute({
    kind: 'game-start',
    requestId: 'game-entry:run-1',
    runId: 'run-1',
    gameId: 'snake',
  })) as ArcadeGameStartResult;
  assert.equal(result.wallet.walletPoints, 999_990);
  const after = await gw.read();
  assert.equal(after.wallet.walletPoints, 999_990);
});

test('re-executing the same request id replays the stored response without re-applying it', async () => {
  const storage = seededStorage();
  const gw = gateway(storage);
  const command = {
    kind: 'game-start' as const,
    requestId: 'game-entry:run-1',
    runId: 'run-1',
    gameId: 'snake' as const,
  };
  await gw.execute(command);
  const replay = (await gw.execute(command)) as ArcadeGameStartResult;
  assert.equal(replay.replayed, true);
  assert.equal(replay.wallet.walletPoints, 999_990);
  const after = await gw.read();
  // fee is only charged once
  assert.equal(after.wallet.walletPoints, 999_990);
});

test('a mismatched fingerprint on the same request id is a conflict', async () => {
  const gw = gateway(seededStorage());
  await gw.execute({ kind: 'game-start', requestId: 'game-entry:run-1', runId: 'run-1', gameId: 'snake' });
  await assert.rejects(
    gw.execute({ kind: 'game-start', requestId: 'game-entry:run-1', runId: 'run-1', gameId: 'tetris' }),
    /이미 처리/,
  );
});

test('game-start rejects when the wallet cannot cover the entry fee', async () => {
  const storage = seededStorage((snapshot) => {
    snapshot.wallet.walletPoints = 5;
  });
  await assert.rejects(
    gateway(storage).execute({ kind: 'game-start', requestId: 'game-entry:run-9', runId: 'run-9', gameId: 'snake' }),
    /포인트가 부족/,
  );
});

test('game-finish rejects a run that was never started', async () => {
  const gw = gateway(seededStorage());
  await assert.rejects(
    gw.execute({ kind: 'game-finish', requestId: 'game-finish:ghost', runId: 'ghost', gameId: 'snake', score: 40, durationMs: 60_000, meta: {} }),
    /시작되지 않은 게임/,
  );
});

test('game-finish rejects finishing a run as a different game than it was started', async () => {
  const gw = gateway(seededStorage());
  await gw.execute({ kind: 'game-start', requestId: 'game-entry:mixup', runId: 'mixup', gameId: 'snake' });
  await assert.rejects(
    gw.execute({ kind: 'game-finish', requestId: 'game-finish:mixup', runId: 'mixup', gameId: 'tetris', score: 40, durationMs: 60_000, meta: {} }),
    /시작한 게임과/,
  );
});

test('game-finish grades the score, pays the reward, and flags an all-time best', async () => {
  const gw = gateway(seededStorage());
  await gw.execute({ kind: 'game-start', requestId: 'game-entry:run-2', runId: 'run-2', gameId: 'snake' });
  const result = (await gw.execute({
    kind: 'game-finish',
    requestId: 'game-finish:run-2',
    runId: 'run-2',
    gameId: 'snake',
    score: 40,
    durationMs: 60_000,
    meta: {},
  })) as ArcadeGameFinishResult;
  assert.equal(result.grade, 'gold');
  assert.equal(result.rewardPoints, 30);
  assert.equal(result.rewardCapped, false);
  assert.equal(result.prevBestScore, 34);
  assert.equal(result.newAlltimeBest, true); // 40 > seed best 34
  assert.equal(result.myBestScore, 40);
});

test('game-finish caps the reward after the daily rewarded-run limit', async () => {
  const storage = seededStorage((snapshot) => {
    snapshot.games.snake.todayRewardedRuns = 5;
  });
  const gw = gateway(storage);
  await gw.execute({ kind: 'game-start', requestId: 'game-entry:run-3', runId: 'run-3', gameId: 'snake' });
  const result = (await gw.execute({
    kind: 'game-finish',
    requestId: 'game-finish:run-3',
    runId: 'run-3',
    gameId: 'snake',
    score: 60,
    durationMs: 60_000,
    meta: {},
  })) as ArcadeGameFinishResult;
  assert.equal(result.grade, 'platinum');
  assert.equal(result.rewardCapped, true);
  assert.equal(result.rewardPoints, 0);
});

test('activity awards points until the daily cap, then reports capped without paying', async () => {
  const storage = seededStorage((snapshot) => {
    snapshot.todayActivityCounts.comment = 4; // one under the cap of 5
  });
  const gw = gateway(storage);
  const first = (await gw.execute({ kind: 'activity', requestId: 'comment:c1', activity: 'comment' })) as ArcadeActivityResult;
  assert.equal(first.awarded, true);
  assert.equal(first.points, 5);
  const capped = (await gw.execute({ kind: 'activity', requestId: 'comment:c2', activity: 'comment' })) as ArcadeActivityResult;
  assert.equal(capped.awarded, false);
  assert.equal(capped.capped, true);
  assert.equal(capped.points, 0);
});

test('preview daily state rolls over on a new KST day and continues a consecutive streak', async () => {
  const storage = createMemoryStorage();
  let clock = Date.parse('2026-07-13T12:00:00+09:00');
  const gw = createArcadeLocalStorageGateway({ userId: USER_ID, storage, now: () => clock });
  await gw.execute({ kind: 'daily-login', requestId: 'daily-login:2026-07-13' });
  await gw.execute({ kind: 'activity', requestId: 'comment:x1', activity: 'comment' });
  let snap = await gw.read();
  assert.equal(snap.attendance.streakDays, 4); // 시드 3 + 오늘
  assert.equal(snap.attendance.todayGranted, true);

  clock = Date.parse('2026-07-14T09:00:00+09:00'); // 다음 날(연속)
  await gw.execute({ kind: 'daily-login', requestId: 'daily-login:2026-07-14' });
  snap = await gw.read();
  assert.equal(snap.attendance.streakDays, 5); // 연속 유지 후 +1
  assert.equal(snap.attendance.todayGranted, true);
  assert.equal(snap.todayActivityCounts.comment, 0); // 오늘 카운트가 새 날에 롤오버
});

test('preview streak resets after a missed KST day', async () => {
  const storage = createMemoryStorage();
  let clock = Date.parse('2026-07-13T12:00:00+09:00');
  const gw = createArcadeLocalStorageGateway({ userId: USER_ID, storage, now: () => clock });
  await gw.execute({ kind: 'daily-login', requestId: 'daily-login:2026-07-13' });
  clock = Date.parse('2026-07-15T09:00:00+09:00'); // 하루 건너뜀(공백)
  await gw.execute({ kind: 'daily-login', requestId: 'daily-login:2026-07-15' });
  const snap = await gw.read();
  assert.equal(snap.attendance.streakDays, 1); // 공백으로 리셋 후 오늘만
});

test('createArcadeGateway prefers a complete electron api over the preview context', async () => {
  const calls: string[] = [];
  const electronApi = {
    arcadeRead: async (): Promise<ArcadeSnapshot> => {
      calls.push('read');
      return createArcadePreviewSeed(USER_ID);
    },
    arcadeExecute: async (): Promise<ArcadeExecuteResult> => ({ wallet: { walletPoints: 1, lifetimeEarnedPoints: 1 } }),
    onArcadeWalletUpdated: () => () => {},
  };
  const gw = createArcadeGateway({
    getElectronAPI: () => electronApi,
    getPreviewContext: () => ({ enabled: true, userId: USER_ID, storage: createMemoryStorage(), now: () => NOW }),
  });
  await gw.read();
  assert.deepEqual(calls, ['read']);
});

test('createArcadeGateway falls back to the localStorage preview when there is no electron api', async () => {
  const gw = createArcadeGateway({
    getElectronAPI: () => undefined,
    getPreviewContext: () => ({ enabled: true, userId: USER_ID, storage: createMemoryStorage(), now: () => NOW }),
  });
  const snapshot = await gw.read();
  assert.equal(snapshot.wallet.walletPoints, 1_000_000);
});

test('the dev electron api mock exposes the arcade bridge methods', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const devApi = readFileSync(path.join(root, 'src', 'mocks', 'devElectronAPI.ts'), 'utf8');
  assert.match(devApi, /arcadeRead:/);
  assert.match(devApi, /arcadeExecute:/);
  assert.match(devApi, /onArcadeWalletUpdated:/);
  assert.match(devApi, /createArcadeLocalStorageGateway/);
});

test('preview shares one wallet between the arcade and market gateways', async () => {
  const storage = createMemoryStorage();
  const arcade = createArcadeLocalStorageGateway({ userId: USER_ID, storage, now: () => NOW });
  await arcade.execute({ kind: 'daily-login', requestId: 'daily-login:2026-07-13' }); // 아케이드 지갑 +20
  const arcadeWallet = (await arcade.read()).wallet.walletPoints;
  assert.equal(arcadeWallet, 1_000_020);
  // 같은 storage 를 쓰는 모의투자 게이트웨이가 재로딩해도 같은 잔액을 봐야 한다(스테일 복원 없음).
  const market = createMarketLocalStorageGateway({ userId: USER_ID, storage, now: () => NOW });
  const marketSnap = await market.read();
  assert.equal(marketSnap.account.walletPoints, arcadeWallet);
  // 모의투자가 다시 아케이드로 되돌려도(재로딩) 아케이드 잔액이 유지된다.
  assert.equal((await arcade.read()).wallet.walletPoints, arcadeWallet);
});

test('the wallet bridge syncs market wallet changes into the arcade store', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const bridge = readFileSync(path.join(root, 'src', 'features', 'playground', 'arcade', 'walletBridge.ts'), 'utf8');
  // 공유 지갑: 모의투자 지갑 변경(transfer 등)도 아케이드 스냅샷에 반영한다.
  assert.match(bridge, /useMarketPreviewStore\.subscribe/);
  assert.match(bridge, /applyMarketWallet/);
});

test('the dev electron api mirrors the daily-login grant on preview session', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const devApi = readFileSync(path.join(root, 'src', 'mocks', 'devElectronAPI.ts'), 'utf8');
  // 프리뷰에는 main 이 없으므로 세션 확립 시 daily-login 을 직접 미러링한다.
  assert.match(devApi, /maybeGrantPreviewDailyLogin/);
  assert.match(devApi, /kind: 'daily-login', requestId: `daily-login:\$\{today\}`/);
  // login / restore / ensure 세 확립 지점에서 호출된다.
  assert.equal((devApi.match(/maybeGrantPreviewDailyLogin\(\);/g) ?? []).length, 3);
});
