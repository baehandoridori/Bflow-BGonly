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
      snake: { myBestScore: 0, myWeeklyBestScore: 0, todayRewardedRuns: 0, totalRuns: 0, leaderboardAll: [], leaderboardWeekly: [] },
      tetris: { myBestScore: 0, myWeeklyBestScore: 0, todayRewardedRuns: 0, totalRuns: 0, leaderboardAll: [], leaderboardWeekly: [] },
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

test('applyWalletPush updates the arcade snapshot and syncs the market wallet', async () => {
  const synced: ArcadeWallet[] = [];
  const gateway = createMockGateway();
  const store = createArcadeStore(gateway, (wallet) => synced.push(wallet));
  await store.getState().load('user-1');
  store.getState().applyWalletPush({ wallet: { walletPoints: 7777, lifetimeEarnedPoints: 8888 }, delta: 5, reason: 'comment' });
  assert.equal(store.getState().snapshot?.wallet.walletPoints, 7777);
  assert.deepEqual(synced.at(-1), { walletPoints: 7777, lifetimeEarnedPoints: 8888 });
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
