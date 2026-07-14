import test from 'node:test';
import assert from 'node:assert/strict';

import { createArcadeStore } from '../src/features/playground/arcade/useArcadeStore.ts';
import type { ArcadePreviewGateway } from '../src/features/playground/arcade/previewGateway.ts';
import type {
  ArcadeExecuteCommand,
  ArcadeExecuteResult,
  ArcadeSnapshot,
  ArcadeWallet,
} from '../src/features/playground/arcade/types.ts';

function baseSnapshot(overrides: Partial<ArcadeSnapshot> = {}): ArcadeSnapshot {
  return {
    wallet: { walletPoints: 1000, lifetimeEarnedPoints: 5000 },
    attendance: { streakDays: 0, todayGranted: false },
    todayActivityCounts: { sceneProgress: 0, comment: 0, retakeDone: 0 },
    games: {
      snake: { myBestScore: 0, myWeeklyBestScore: 0, todayRewardedRuns: 0, totalRuns: 0, maxGoldenEaten: 0, maxLineClear: 0, maxLevel: 0, leaderboardAll: [], leaderboardWeekly: [] },
      tetris: { myBestScore: 0, myWeeklyBestScore: 0, todayRewardedRuns: 0, totalRuns: 0, maxGoldenEaten: 0, maxLineClear: 0, maxLevel: 0, leaderboardAll: [], leaderboardWeekly: [] },
    },
    achievements: [],
    aggregates: { totalRuns: 0, arcadeEarnedPoints: 0 },
    walletLeaderboard: [],
    config: { slackNotifyEnabled: false },
    ...overrides,
  };
}

interface MockGatewayConfig {
  read?: () => Promise<ArcadeSnapshot>;
  execute?: (command: ArcadeExecuteCommand) => Promise<ArcadeExecuteResult>;
}

function createMockGateway(config: MockGatewayConfig = {}): ArcadePreviewGateway & { executed: ArcadeExecuteCommand[] } {
  const executed: ArcadeExecuteCommand[] = [];
  return {
    executed,
    read: config.read ?? (async () => baseSnapshot()),
    execute: async (command) => {
      executed.push(command);
      if (config.execute) return config.execute(command);
      // 기본: kind별 그럴듯한 성공 응답
      switch (command.kind) {
        case 'game-start':
          return { wallet: { walletPoints: 990, lifetimeEarnedPoints: 5000 } };
        case 'game-finish':
          return {
            grade: 'platinum', rewardPoints: 45, rewardCapped: false,
            newAlltimeBest: true, newWeeklyBest: true, prevBestScore: null,
            myBestScore: 55, todayRewardedRuns: 1,
            wallet: { walletPoints: 1035, lifetimeEarnedPoints: 5045 }, slackNotifyEnabled: false,
          };
        case 'achievement-unlock':
          return { achievementId: command.achievementId ?? '', rewardPoints: 10, wallet: { walletPoints: 1045, lifetimeEarnedPoints: 5055 } };
        case 'config-set':
          return { config: { slackNotifyEnabled: command.slackNotifyEnabled ?? false } };
        default:
          return { wallet: { walletPoints: 0, lifetimeEarnedPoints: 0 } } as ArcadeExecuteResult;
      }
    },
  };
}

const noopSync = () => {};

test('load reflects the gateway snapshot into store state', async () => {
  const gateway = createMockGateway({ read: async () => baseSnapshot({ wallet: { walletPoints: 4200, lifetimeEarnedPoints: 9000 } }) });
  const store = createArcadeStore(gateway, noopSync);
  await store.getState().load('user-1');
  const state = store.getState();
  assert.equal(state.loading, false);
  assert.equal(state.snapshot?.wallet.walletPoints, 4200);
  assert.equal(state.sessionKey, 'user-1');
});

test('startRun surfaces an insufficient-balance error and returns null', async () => {
  const gateway = createMockGateway({
    execute: async (command) => {
      if (command.kind === 'game-start') throw new Error('포인트가 부족해 게임을 시작할 수 없어요');
      return { wallet: { walletPoints: 0, lifetimeEarnedPoints: 0 } } as ArcadeExecuteResult;
    },
  });
  const store = createArcadeStore(gateway, noopSync);
  await store.getState().load('user-1');
  const result = await store.getState().startRun('snake');
  assert.equal(result, null);
  assert.match(store.getState().error ?? '', /포인트가 부족/);
});

test('finishRun unlocks each newly earned achievement exactly once', async () => {
  const gateway = createMockGateway();
  const store = createArcadeStore(gateway, noopSync);
  // totalRuns 0 + 첫 완주 + snake 길이 55 → arcade-first-run / snake-30 / snake-55 (3종)
  await store.getState().load('user-1');
  const result = await store.getState().finishRun({ runId: 'run-1', gameId: 'snake', score: 55, durationMs: 60_000, meta: {} });
  assert.ok(result);
  const unlockCommands = gateway.executed.filter((command) => command.kind === 'achievement-unlock');
  assert.deepEqual(unlockCommands.map((command) => command.achievementId), ['arcade-first-run', 'snake-30', 'snake-55']);
  assert.deepEqual(result?.unlockedAchievements.map((a) => a.id), ['arcade-first-run', 'snake-30', 'snake-55']);
});

function finishResult(overrides: Partial<ArcadeExecuteResult> = {}): ArcadeExecuteResult {
  return {
    grade: 'platinum', rewardPoints: 45, rewardCapped: false,
    newAlltimeBest: true, newWeeklyBest: true, prevBestScore: null,
    myBestScore: 55, todayRewardedRuns: 1,
    wallet: { walletPoints: 2000, lifetimeEarnedPoints: 6000 }, slackNotifyEnabled: false,
    ...overrides,
  };
}

test('finishRun applies a replayed finish that is not yet reflected locally (main retry)', async () => {
  // main 이 재시도로 커밋됐지만 응답만 유실 → 첫 finishRun 이 replayed 를 받는다. 로컬 미반영이므로 적용해야 한다.
  const gateway = createMockGateway({
    execute: async (command) => {
      if (command.kind === 'game-finish') return finishResult({ replayed: true });
      if (command.kind === 'achievement-unlock') return { achievementId: command.achievementId, rewardPoints: 10, wallet: { walletPoints: 2010, lifetimeEarnedPoints: 6010 } };
      return { wallet: { walletPoints: 0, lifetimeEarnedPoints: 0 } } as ArcadeExecuteResult;
    },
  });
  const store = createArcadeStore(gateway, noopSync);
  await store.getState().load('user-1');
  const runsBefore = store.getState().snapshot?.aggregates.totalRuns ?? 0;
  const result = await store.getState().finishRun({ runId: 'r-lost', gameId: 'snake', score: 55, durationMs: 60_000, meta: {} });
  assert.equal(store.getState().snapshot?.aggregates.totalRuns, runsBefore + 1);
  assert.ok((result?.unlockedAchievements.length ?? 0) > 0, '아직 미반영 판이므로 도전과제 평가·해금을 수행');
});

test('finishRun does not double-apply a genuine duplicate finish', async () => {
  // 같은 runId 로 두 번 finish — 첫 번째는 신규 적용, 두 번째(replayed)는 이미 반영됐으므로 재적용 안 함.
  let firstFinish = true;
  const gateway = createMockGateway({
    execute: async (command) => {
      if (command.kind === 'game-finish') {
        const result = firstFinish ? finishResult() : finishResult({ replayed: true });
        firstFinish = false;
        return result;
      }
      if (command.kind === 'achievement-unlock') return { achievementId: command.achievementId, rewardPoints: 10, wallet: { walletPoints: 2010, lifetimeEarnedPoints: 6010 } };
      return { wallet: { walletPoints: 0, lifetimeEarnedPoints: 0 } } as ArcadeExecuteResult;
    },
  });
  const store = createArcadeStore(gateway, noopSync);
  await store.getState().load('user-1');
  const runsBefore = store.getState().snapshot?.aggregates.totalRuns ?? 0;
  await store.getState().finishRun({ runId: 'r-dup', gameId: 'snake', score: 55, durationMs: 60_000, meta: {} });
  const afterFirst = store.getState().snapshot?.aggregates.totalRuns ?? 0;
  const replay = await store.getState().finishRun({ runId: 'r-dup', gameId: 'snake', score: 55, durationMs: 60_000, meta: {} });
  const afterSecond = store.getState().snapshot?.aggregates.totalRuns ?? 0;
  assert.equal(afterFirst, runsBefore + 1);
  assert.equal(afterSecond, afterFirst, '두 번째(재생)는 재적용하지 않는다');
  assert.deepEqual(replay?.unlockedAchievements, []);
});

test('applyWalletPush updates the arcade snapshot and syncs the market wallet', async () => {
  const synced: ArcadeWallet[] = [];
  const gateway = createMockGateway();
  const store = createArcadeStore(gateway, (wallet) => synced.push(wallet));
  await store.getState().load('user-1');
  store.getState().applyWalletPush({ wallet: { walletPoints: 7777, lifetimeEarnedPoints: 8888 }, delta: 5, reason: 'comment' });
  assert.equal(store.getState().snapshot?.wallet.walletPoints, 7777);
  assert.deepEqual(synced.at(-1), { walletPoints: 7777, lifetimeEarnedPoints: 8888 });
});

test('applyMarketWallet reflects market wallet changes without syncing back to market', async () => {
  const synced: ArcadeWallet[] = [];
  const gateway = createMockGateway();
  const store = createArcadeStore(gateway, (wallet) => synced.push(wallet));
  await store.getState().load('user-1');
  const syncedBefore = synced.length;
  store.getState().applyMarketWallet({ walletPoints: 3333, lifetimeEarnedPoints: 5000 });
  assert.equal(store.getState().snapshot?.wallet.walletPoints, 3333);
  // 마켓으로 되돌려 동기화하지 않는다(무한 루프 방지).
  assert.equal(synced.length, syncedBefore);
});

test('setSlackNotify persists the config through the gateway', async () => {
  const gateway = createMockGateway();
  const store = createArcadeStore(gateway, noopSync);
  await store.getState().load('user-1');
  const ok = await store.getState().setSlackNotify(true);
  assert.equal(ok, true);
  assert.equal(store.getState().snapshot?.config.slackNotifyEnabled, true);
  assert.ok(gateway.executed.some((command) => command.kind === 'config-set' && command.slackNotifyEnabled === true));
});

test('a same-key reload keeps a valid snapshot without wiping it to null', async () => {
  let reads = 0;
  const gateway = createMockGateway({
    read: async () => {
      reads += 1;
      return baseSnapshot({ wallet: { walletPoints: 100 * reads, lifetimeEarnedPoints: 1000 } });
    },
  });
  const store = createArcadeStore(gateway, noopSync);
  await store.getState().load('user-1');
  await store.getState().load('user-1');
  assert.equal(store.getState().snapshot?.wallet.walletPoints, 200);
  assert.equal(store.getState().error, null);
});

test('a failed paid start reuses the same runId on the next start (no double entry-fee charge)', async () => {
  let attempt = 0;
  const gateway = createMockGateway({
    execute: async (command) => {
      if (command.kind === 'game-start') {
        attempt += 1;
        if (attempt === 1) throw new Error('response lost after charge');
        return { wallet: { walletPoints: 990, lifetimeEarnedPoints: 5000 } };
      }
      return { wallet: { walletPoints: 0, lifetimeEarnedPoints: 0 } } as ArcadeExecuteResult;
    },
  });
  const store = createArcadeStore(gateway, noopSync);
  await store.getState().load();

  const first = await store.getState().startRun('snake');
  assert.equal(first, null, '첫 시작은 응답 유실로 실패');

  const second = await store.getState().startRun('snake');
  assert.ok(second, '두 번째 시작은 성공');

  const starts = gateway.executed.filter((command) => command.kind === 'game-start');
  assert.equal(starts.length, 2);
  assert.equal(starts[0].runId, starts[1].runId, '실패 후 재시도는 같은 runId 를 재사용(멱등 재생)');
  assert.equal(starts[0].requestId, starts[1].requestId);

  // 성공 뒤에는 보류가 풀려 새 시작은 새 runId 를 발급한다.
  await store.getState().startRun('snake');
  const startsAfter = gateway.executed.filter((command) => command.kind === 'game-start');
  assert.notEqual(startsAfter[2].runId, starts[0].runId, '성공 뒤 새 시작은 다른 runId');
});
