import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createArcadeLocalStorageGateway } from '../src/features/playground/arcade/localStorageGateway.ts';
import { createArcadeGateway } from '../src/features/playground/arcade/gateway.ts';
import { createMarketLocalStorageGateway } from '../src/features/playground/market/localStorageGateway.ts';
import { createArcadePreviewSeed } from '../src/features/playground/arcade/seed.ts';
import { rollOverPreviewDailyState } from '../src/features/playground/arcade/previewGateway.ts';
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
  assert.equal(snapshot.games['2048'].totalRuns, 0);
  assert.ok(snapshot.games['2048'].leaderboardAll.length > 0, '2048 preview 순위 fixture를 제공한다');
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

test('2048 game-start deducts the 10P entry fee', async () => {
  const gw = gateway(seededStorage());
  const result = (await gw.execute({
    kind: 'game-start',
    requestId: 'game-entry:merge-entry',
    runId: 'merge-entry',
    gameId: '2048',
  })) as ArcadeGameStartResult;
  assert.equal(result.wallet.walletPoints, 999_990);
  assert.equal((await gw.read()).wallet.walletPoints, 999_990);
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

test('2048 game-finish pays the configured platinum reward', async () => {
  const gw = gateway(seededStorage());
  await gw.execute({ kind: 'game-start', requestId: 'game-entry:merge-reward', runId: 'merge-reward', gameId: '2048' });
  const result = (await gw.execute({
    kind: 'game-finish',
    requestId: 'game-finish:merge-reward',
    runId: 'merge-reward',
    gameId: '2048',
    score: 35_000,
    durationMs: 60_000,
    meta: {},
  })) as ArcadeGameFinishResult;
  assert.equal(result.grade, 'platinum');
  assert.equal(result.rewardPoints, 40);
  assert.equal(result.rewardCapped, false);
  assert.equal(result.wallet.walletPoints, 1_000_030); // 10P 입장료 차감 후 40P 지급
});

test('2048 game-finish rejects out-of-range values without mutating the snapshot', async () => {
  const gw = gateway(seededStorage());
  await gw.execute({ kind: 'game-start', requestId: 'game-entry:merge-invalid', runId: 'merge-invalid', gameId: '2048' });
  const before = await gw.read();

  const invalidResults = [
    { score: 10_000_001, durationMs: 60_000 },
    { score: 3_000, durationMs: 999 },
    { score: 3_000, durationMs: 14_400_001 },
  ];
  for (const invalid of invalidResults) {
    await assert.rejects(
      gw.execute({
        kind: 'game-finish',
        requestId: 'game-finish:merge-invalid',
        runId: 'merge-invalid',
        gameId: '2048',
        score: invalid.score,
        durationMs: invalid.durationMs,
        meta: {},
      }),
      /out of range/,
    );
    assert.deepEqual(await gw.read(), before, '거부된 결과는 지갑·기록·보상 횟수를 바꾸면 안 된다');
  }
});

test('a preview KST week rollover clears weekly bests and boards but keeps all-time', () => {
  const snap = createArcadePreviewSeed(USER_ID);
  const allTimeBefore = snap.games.snake.leaderboardAll.length;
  snap.games['2048'].todayRewardedRuns = 5;
  // 같은 주 안의 날짜 변화(월→화, 주 시작 07-13 동일) → 주간 유지
  rollOverPreviewDailyState(snap, '2026-07-13', '2026-07-14');
  assert.ok(snap.games.snake.leaderboardWeekly.length > 0, '같은 주는 주간 순위표를 유지한다');
  assert.equal(snap.games['2048'].todayRewardedRuns, 0, '2048 일일 보상 횟수도 새 날에 초기화한다');
  // 다음 주 월요일(주 시작 07-20)로 넘어가면 주간만 리셋
  rollOverPreviewDailyState(snap, '2026-07-14', '2026-07-20');
  assert.deepEqual(snap.games.snake.leaderboardWeekly, []);
  assert.deepEqual(snap.games.tetris.leaderboardWeekly, []);
  assert.deepEqual(snap.games['2048'].leaderboardWeekly, []);
  assert.equal(snap.games.snake.myWeeklyBestScore, 0);
  assert.equal(snap.games.tetris.myWeeklyBestScore, 0);
  assert.equal(snap.games['2048'].myWeeklyBestScore, 0);
  assert.equal(snap.games.snake.leaderboardAll.length, allTimeBefore, '전체 순위표는 유지된다');
});

test('game-finish upserts my new best into both game leaderboards', async () => {
  const gw = gateway(seededStorage());
  await gw.execute({ kind: 'game-start', requestId: 'game-entry:lb', runId: 'lb', gameId: 'snake' });
  await gw.execute({ kind: 'game-finish', requestId: 'game-finish:lb', runId: 'lb', gameId: 'snake', score: 90, durationMs: 60_000, meta: {} });
  const snap = await gw.read();
  const all = snap.games.snake.leaderboardAll;
  assert.equal(all[0]?.userId, USER_ID); // 90 이 최상단
  assert.equal(all[0]?.score, 90);
  assert.equal(all.filter((entry) => entry.userId === USER_ID).length, 1); // 내 행 중복 없음
  assert.equal(snap.games.snake.leaderboardWeekly[0]?.score, 90);
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

test('2048 game-finish caps rewards after five rewarded runs', async () => {
  const storage = seededStorage((snapshot) => {
    snapshot.games['2048'].todayRewardedRuns = 5;
  });
  const gw = gateway(storage);
  await gw.execute({ kind: 'game-start', requestId: 'game-entry:merge-cap', runId: 'merge-cap', gameId: '2048' });
  const result = (await gw.execute({
    kind: 'game-finish',
    requestId: 'game-finish:merge-cap',
    runId: 'merge-cap',
    gameId: '2048',
    score: 35_000,
    durationMs: 60_000,
    meta: {},
  })) as ArcadeGameFinishResult;
  assert.equal(result.grade, 'platinum');
  assert.equal(result.rewardCapped, true);
  assert.equal(result.rewardPoints, 0);
  assert.equal(result.todayRewardedRuns, 5);
});

test('legacy preview v1 hydration preserves wallet, stats, and replay records while adding 2048 defaults', async () => {
  const storage = createMemoryStorage();
  const legacySeed = createArcadePreviewSeed(USER_ID);
  const legacySnapshot = {
    ...legacySeed,
    wallet: { walletPoints: 777, lifetimeEarnedPoints: 8_888 },
    games: {
      snake: { ...legacySeed.games.snake, myBestScore: 77 },
      tetris: { ...legacySeed.games.tetris, myBestScore: 42_424 },
    },
  };
  const replayResponse: ArcadeGameStartResult = {
    wallet: { walletPoints: 767, lifetimeEarnedPoints: 8_888 },
  };
  storage.setItem(
    `bflow-arcade-preview-v1:${USER_ID}`,
    JSON.stringify({
      version: 1,
      snapshot: legacySnapshot,
      requestFingerprints: {
        'game-entry:legacy-run': JSON.stringify(['game-start', 'legacy-run', 'snake']),
      },
      requestResponses: { 'game-entry:legacy-run': replayResponse },
      dailyDate: '2026-07-13',
      updatedAtMs: 123,
    }),
  );

  const gw = gateway(storage);
  const hydrated = await gw.read();
  assert.deepEqual(hydrated.wallet, legacySnapshot.wallet);
  assert.equal(hydrated.games.snake.myBestScore, 77);
  assert.equal(hydrated.games.tetris.myBestScore, 42_424);
  assert.deepEqual(hydrated.games['2048'], createArcadePreviewSeed(USER_ID).games['2048']);

  const replay = (await gw.execute({
    kind: 'game-start',
    requestId: 'game-entry:legacy-run',
    runId: 'legacy-run',
    gameId: 'snake',
  })) as ArcadeGameStartResult;
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.wallet, replayResponse.wallet);
  assert.deepEqual((await gw.read()).wallet, legacySnapshot.wallet, 'replay는 저장된 지갑을 다시 차감하지 않는다');
});

test('malformed preview v1 fields are normalized without losing valid legacy values', async () => {
  const storage = createMemoryStorage();
  const defaults = createArcadePreviewSeed(USER_ID);
  const validFingerprint = JSON.stringify(['game-start', 'legacy-safe', 'snake']);
  const validResponse: ArcadeGameStartResult = {
    wallet: { walletPoints: 767, lifetimeEarnedPoints: 8_888 },
  };
  storage.setItem(
    `bflow-arcade-preview-v1:${USER_ID}`,
    JSON.stringify({
      version: 1,
      snapshot: {
        wallet: { walletPoints: 777, lifetimeEarnedPoints: 8_888 },
        games: {
          snake: {
            ...defaults.games.snake,
            myBestScore: 88,
            todayRewardedRuns: -99,
            leaderboardAll: 'not-an-array',
          },
        },
      },
      requestFingerprints: {
        'game-entry:legacy-safe': validFingerprint,
        invalid: 42,
        orphan: 'fingerprint-without-response',
      },
      requestResponses: {
        'game-entry:legacy-safe': validResponse,
        invalid: 'not-an-object',
        responseOnly: { wallet: { walletPoints: 1, lifetimeEarnedPoints: 1 } },
      },
      dailyDate: '2026-07-13',
      updatedAtMs: 'invalid',
    }),
  );

  const gw = gateway(storage);
  const normalized = await gw.read();
  assert.deepEqual(normalized.wallet, { walletPoints: 777, lifetimeEarnedPoints: 8_888 });
  assert.deepEqual(normalized.attendance, defaults.attendance);
  assert.deepEqual(normalized.todayActivityCounts, defaults.todayActivityCounts);
  assert.deepEqual(normalized.aggregates, defaults.aggregates);
  assert.deepEqual(normalized.config, defaults.config);
  assert.equal(normalized.games.snake.myBestScore, 88, '유효한 기존 기록은 보존한다');
  assert.equal(normalized.games.snake.todayRewardedRuns, defaults.games.snake.todayRewardedRuns);
  assert.deepEqual(normalized.games.snake.leaderboardAll, defaults.games.snake.leaderboardAll);
  assert.deepEqual(normalized.games.tetris, defaults.games.tetris);
  assert.deepEqual(normalized.games['2048'], defaults.games['2048']);

  const persisted = JSON.parse(storage.getItem(`bflow-arcade-preview-v1:${USER_ID}`) ?? '{}');
  assert.deepEqual(persisted.requestFingerprints, { 'game-entry:legacy-safe': validFingerprint });
  assert.deepEqual(persisted.requestResponses, { 'game-entry:legacy-safe': validResponse });
  assert.equal(persisted.updatedAtMs, NOW);

  const replay = (await gw.execute({
    kind: 'game-start', requestId: 'game-entry:legacy-safe', runId: 'legacy-safe', gameId: 'snake',
  })) as ArcadeGameStartResult;
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.wallet, validResponse.wallet);
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
