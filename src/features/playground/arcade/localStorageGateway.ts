import {
  applyArcadePreviewCommand,
  fingerprintArcadeCommand,
  kstDateOf,
  rollOverPreviewDailyState,
  startedGameIdFromEntryFingerprint,
  type ArcadePreviewGateway,
} from './previewGateway.ts';
import { createArcadePreviewSeed } from './seed.ts';
import {
  reconcileSharedPreviewWallet,
  writeSharedPreviewWallet,
} from '../previewSharedWallet.ts';
import type {
  ArcadeAchievementUnlock,
  ArcadeExecuteCommand,
  ArcadeExecuteResult,
  ArcadeGameId,
  ArcadeGameStats,
  ArcadeLeaderboardEntry,
  ArcadeSnapshot,
  ArcadeWallet,
  ArcadeWalletLeaderboardEntry,
} from './types';

const STORAGE_KEY_PREFIX = 'bflow-arcade-preview-v1:';

interface PersistedArcadePreview {
  version: 1;
  snapshot: ArcadeSnapshot;
  requestFingerprints: Record<string, string>;
  requestResponses: Record<string, ArcadeExecuteResult>;
  dailyDate: string; // 일일 필드(출석/오늘활동/보상판수)가 대응하는 KST 날짜
  updatedAtMs: number;
}

export interface ArcadeLocalStorageGatewayOptions {
  userId: string;
  storage: Storage;
  now: () => number;
  latencyMs?: number;
}

function wait(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function integerOr(value: unknown, fallback: number): number {
  return isNonNegativeInteger(value) ? value : fallback;
}

function isWallet(value: unknown): value is ArcadeWallet {
  return isRecord(value)
    && isNonNegativeInteger(value.walletPoints)
    && isNonNegativeInteger(value.lifetimeEarnedPoints);
}

function normalizeLeaderboard(
  value: unknown,
  fallback: readonly ArcadeLeaderboardEntry[],
): ArcadeLeaderboardEntry[] {
  if (!Array.isArray(value)) return fallback.map((entry) => ({ ...entry }));
  return value.flatMap((entry): ArcadeLeaderboardEntry[] => (
    isRecord(entry)
      && typeof entry.userId === 'string'
      && typeof entry.name === 'string'
      && typeof entry.at === 'string'
      && isNonNegativeInteger(entry.score)
      ? [{ userId: entry.userId, name: entry.name, score: entry.score, at: entry.at }]
      : []
  ));
}

function normalizeWalletLeaderboard(
  value: unknown,
  fallback: readonly ArcadeWalletLeaderboardEntry[],
): ArcadeWalletLeaderboardEntry[] {
  if (!Array.isArray(value)) return fallback.map((entry) => ({ ...entry }));
  return value.flatMap((entry): ArcadeWalletLeaderboardEntry[] => (
    isRecord(entry)
      && typeof entry.userId === 'string'
      && typeof entry.name === 'string'
      && isNonNegativeInteger(entry.lifetimeEarnedPoints)
      ? [{
        userId: entry.userId,
        name: entry.name,
        lifetimeEarnedPoints: entry.lifetimeEarnedPoints,
      }]
      : []
  ));
}

function normalizeAchievements(
  value: unknown,
  fallback: readonly ArcadeAchievementUnlock[],
): ArcadeAchievementUnlock[] {
  if (!Array.isArray(value)) return fallback.map((entry) => ({ ...entry }));
  return value.flatMap((entry): ArcadeAchievementUnlock[] => (
    isRecord(entry)
      && typeof entry.achievementId === 'string'
      && typeof entry.unlockedAt === 'string'
      ? [{ achievementId: entry.achievementId, unlockedAt: entry.unlockedAt }]
      : []
  ));
}

function normalizeGameStats(value: unknown, fallback: ArcadeGameStats): ArcadeGameStats {
  const source = isRecord(value) ? value : {};
  return {
    myBestScore: integerOr(source.myBestScore, fallback.myBestScore),
    myWeeklyBestScore: integerOr(source.myWeeklyBestScore, fallback.myWeeklyBestScore),
    todayRewardedRuns: integerOr(source.todayRewardedRuns, fallback.todayRewardedRuns),
    totalRuns: integerOr(source.totalRuns, fallback.totalRuns),
    maxGoldenEaten: integerOr(source.maxGoldenEaten, fallback.maxGoldenEaten),
    maxLineClear: integerOr(source.maxLineClear, fallback.maxLineClear),
    maxLevel: integerOr(source.maxLevel, fallback.maxLevel),
    leaderboardAll: normalizeLeaderboard(source.leaderboardAll, fallback.leaderboardAll),
    leaderboardWeekly: normalizeLeaderboard(source.leaderboardWeekly, fallback.leaderboardWeekly),
  };
}

function isExecuteResult(value: unknown): value is ArcadeExecuteResult {
  if (!isRecord(value)) return false;
  if (isRecord(value.config)) return typeof value.config.slackNotifyEnabled === 'boolean';
  if (!isWallet(value.wallet)) return false;
  if (typeof value.grade === 'string') {
    return ['none', 'bronze', 'silver', 'gold', 'platinum'].includes(value.grade)
      && isNonNegativeInteger(value.rewardPoints)
      && typeof value.rewardCapped === 'boolean'
      && typeof value.newAlltimeBest === 'boolean'
      && typeof value.newWeeklyBest === 'boolean'
      && (value.prevBestScore === null || isNonNegativeInteger(value.prevBestScore))
      && isNonNegativeInteger(value.myBestScore)
      && isNonNegativeInteger(value.todayRewardedRuns)
      && typeof value.slackNotifyEnabled === 'boolean';
  }
  if (typeof value.achievementId === 'string') {
    return isNonNegativeInteger(value.rewardPoints);
  }
  if (typeof value.granted === 'boolean') {
    return isRecord(value.attendance)
      && isNonNegativeInteger(value.attendance.streakDays)
      && typeof value.attendance.todayGranted === 'boolean';
  }
  if (typeof value.awarded === 'boolean') {
    return isNonNegativeInteger(value.points) && typeof value.capped === 'boolean';
  }
  // game-start 응답은 지갑 하나만 가진다.
  return Object.keys(value).every((field) => field === 'wallet' || field === 'replayed');
}

export function createArcadeLocalStorageGateway(
  options: ArcadeLocalStorageGatewayOptions,
): ArcadePreviewGateway {
  const userId = options.userId.trim();
  if (!userId) throw new Error('arcade preview user id is required');
  const key = `${STORAGE_KEY_PREFIX}${userId}`;
  const latencyMs = options.latencyMs ?? 0;

  function save(state: PersistedArcadePreview): void {
    options.storage.setItem(key, JSON.stringify(state));
  }

  // KST 날짜가 바뀌었으면 일일 필드를 롤오버하고 저장한다(다중일 프리뷰가 서버와 일치하도록).
  function rollOver(state: PersistedArcadePreview): PersistedArcadePreview {
    const today = kstDateOf(options.now());
    if (state.dailyDate !== today) {
      rollOverPreviewDailyState(state.snapshot, state.dailyDate ?? null, today);
      state.dailyDate = today;
      save(state);
    }
    return state;
  }

  // 공유 프리뷰 지갑을 단일 진실로 반영한다(모의투자와 잔액을 공유하도록).
  function reconcileWallet(state: PersistedArcadePreview): PersistedArcadePreview {
    const wallet = reconcileSharedPreviewWallet(options.storage, userId, state.snapshot.wallet);
    if (
      wallet.walletPoints !== state.snapshot.wallet.walletPoints
      || wallet.lifetimeEarnedPoints !== state.snapshot.wallet.lifetimeEarnedPoints
    ) {
      state.snapshot.wallet = { walletPoints: wallet.walletPoints, lifetimeEarnedPoints: wallet.lifetimeEarnedPoints };
      save(state);
    }
    return state;
  }

  // v1 저장본은 출시 당시 게임 목록만 담고 있고, 브라우저 저장값은 사용자가 임의로 바꿀 수 있다.
  // 유효한 기존 값만 보존하고 누락·오염 필드는 seed 기본값으로 되돌려 UI와 보상 상한을 보호한다.
  function normalizePersisted(value: Record<string, unknown>): PersistedArcadePreview {
    const defaults = createArcadePreviewSeed(userId);
    const source = isRecord(value.snapshot) ? value.snapshot : {};
    const persistedGames: Record<string, unknown> = isRecord(source.games)
      ? source.games
      : {};
    const games = {} as ArcadeSnapshot['games'];
    const gameIds = Object.keys(defaults.games) as ArcadeGameId[];

    for (const gameId of gameIds) {
      games[gameId] = normalizeGameStats(persistedGames[gameId], defaults.games[gameId]);
    }

    const fingerprintsSource = isRecord(value.requestFingerprints) ? value.requestFingerprints : {};
    const responsesSource = isRecord(value.requestResponses) ? value.requestResponses : {};
    const requestFingerprints: Record<string, string> = {};
    const requestResponses: Record<string, ArcadeExecuteResult> = {};
    for (const [requestId, fingerprint] of Object.entries(fingerprintsSource)) {
      const response = responsesSource[requestId];
      if (typeof fingerprint !== 'string' || !isExecuteResult(response)) continue;
      requestFingerprints[requestId] = fingerprint;
      requestResponses[requestId] = structuredClone(response);
    }

    const wallet = isWallet(source.wallet) ? structuredClone(source.wallet) : structuredClone(defaults.wallet);
    const attendance = isRecord(source.attendance) ? source.attendance : {};
    const activity = isRecord(source.todayActivityCounts) ? source.todayActivityCounts : {};
    const aggregates = isRecord(source.aggregates) ? source.aggregates : {};
    const config = isRecord(source.config) ? source.config : {};
    return {
      version: 1,
      snapshot: {
        wallet,
        attendance: {
          streakDays: integerOr(attendance.streakDays, defaults.attendance.streakDays),
          todayGranted: typeof attendance.todayGranted === 'boolean'
            ? attendance.todayGranted
            : defaults.attendance.todayGranted,
        },
        todayActivityCounts: {
          sceneProgress: integerOr(activity.sceneProgress, defaults.todayActivityCounts.sceneProgress),
          comment: integerOr(activity.comment, defaults.todayActivityCounts.comment),
          retakeDone: integerOr(activity.retakeDone, defaults.todayActivityCounts.retakeDone),
        },
        games,
        achievements: normalizeAchievements(source.achievements, defaults.achievements),
        aggregates: {
          totalRuns: integerOr(aggregates.totalRuns, defaults.aggregates.totalRuns),
          arcadeEarnedPoints: integerOr(aggregates.arcadeEarnedPoints, defaults.aggregates.arcadeEarnedPoints),
        },
        walletLeaderboard: normalizeWalletLeaderboard(source.walletLeaderboard, defaults.walletLeaderboard),
        config: {
          slackNotifyEnabled: typeof config.slackNotifyEnabled === 'boolean'
            ? config.slackNotifyEnabled
            : defaults.config.slackNotifyEnabled,
        },
      },
      requestFingerprints,
      requestResponses,
      dailyDate: typeof value.dailyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dailyDate)
        ? value.dailyDate
        : kstDateOf(options.now()),
      updatedAtMs: typeof value.updatedAtMs === 'number' && Number.isFinite(value.updatedAtMs)
        ? value.updatedAtMs
        : options.now(),
    };
  }

  function readOrCreate(): PersistedArcadePreview {
    let raw: string | null;
    try {
      raw = options.storage.getItem(key);
    } catch {
      raw = null;
    }
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isRecord(parsed) && parsed.version === 1 && isRecord(parsed.snapshot)) {
          const normalized = normalizePersisted(parsed);
          if (JSON.stringify(parsed) !== JSON.stringify(normalized)) save(normalized);
          return reconcileWallet(rollOver(normalized));
        }
      } catch {
        /* 손상된 프리뷰 저장본은 시드로 되돌린다. */
      }
    }
    const seeded: PersistedArcadePreview = {
      version: 1,
      snapshot: createArcadePreviewSeed(userId),
      requestFingerprints: {},
      requestResponses: {},
      dailyDate: kstDateOf(options.now()),
      updatedAtMs: options.now(),
    };
    save(seeded);
    return reconcileWallet(seeded);
  }

  return {
    async read() {
      await wait(latencyMs);
      return structuredClone(readOrCreate().snapshot);
    },
    async execute(command: ArcadeExecuteCommand): Promise<ArcadeExecuteResult> {
      await wait(latencyMs);
      const persisted = readOrCreate();
      const fingerprint = fingerprintArcadeCommand(command);
      const hasPrevious = Object.prototype.hasOwnProperty.call(
        persisted.requestFingerprints,
        command.requestId,
      );
      if (hasPrevious) {
        if (persisted.requestFingerprints[command.requestId] !== fingerprint) {
          throw new Error('같은 요청이 다른 내용으로 이미 처리되었어요');
        }
        const stored = persisted.requestResponses[command.requestId];
        return { ...(stored ?? {}), replayed: true } as ArcadeExecuteResult;
      }

      const applied = applyArcadePreviewCommand(persisted.snapshot, command, {
        now: options.now(),
        userId,
        startedGameId: (runId) => startedGameIdFromEntryFingerprint(persisted.requestFingerprints[`game-entry:${runId}`]),
      });
      save({
        version: 1,
        snapshot: applied.snapshot,
        requestFingerprints: applied.persistKey
          ? { ...persisted.requestFingerprints, [command.requestId]: fingerprint }
          : { ...persisted.requestFingerprints },
        requestResponses: applied.persistKey
          ? { ...persisted.requestResponses, [command.requestId]: applied.result }
          : { ...persisted.requestResponses },
        dailyDate: persisted.dailyDate,
        updatedAtMs: options.now(),
      });
      // 공유 지갑에 기록해 모의투자 프리뷰가 재로딩해도 같은 잔액을 보게 한다.
      writeSharedPreviewWallet(options.storage, userId, applied.snapshot.wallet);
      return applied.result;
    },
  };
}
