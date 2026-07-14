import { ARCADE_ACHIEVEMENTS, ARCADE_BALANCE } from './constants.ts';
import { gradeForScore, rewardForGrade, upsertLeaderboardEntry } from './domain.ts';
import { createArcadePreviewSeed } from './seed.ts';
import type {
  ArcadeActivityType,
  ArcadeExecuteCommand,
  ArcadeExecuteResult,
  ArcadeSnapshot,
} from './types';

export interface ArcadePreviewGateway {
  read(): Promise<ArcadeSnapshot>;
  execute(command: ArcadeExecuteCommand): Promise<ArcadeExecuteResult>;
}

const ACHIEVEMENT_BONUS = new Map<string, number>(
  ARCADE_ACHIEVEMENTS.map((definition) => [definition.id, definition.bonusPoints]),
);

const ACTIVITY_COUNTER: Record<ArcadeActivityType, 'sceneProgress' | 'comment' | 'retakeDone'> = {
  'scene-stage': 'sceneProgress',
  'scene-phase-done': 'sceneProgress',
  comment: 'comment',
  'retake-done': 'retakeDone',
};

// 서버 RPC 와 동일한 규칙을 로컬에서 재현하기 위한 명령 지문(멱등 판정용).
export function fingerprintArcadeCommand(command: ArcadeExecuteCommand): string {
  switch (command.kind) {
    case 'daily-login':
      return JSON.stringify([command.kind]);
    case 'activity':
      return JSON.stringify([command.kind, command.activity]);
    case 'game-start':
      return JSON.stringify([command.kind, command.runId, command.gameId]);
    case 'game-finish':
      return JSON.stringify([command.kind, command.runId, command.gameId, command.score, command.durationMs, command.meta]);
    case 'achievement-unlock':
      return JSON.stringify([command.kind, command.achievementId]);
    case 'config-set':
      return JSON.stringify([command.kind, command.slackNotifyEnabled]);
  }
  const exhaustive: never = command;
  return exhaustive;
}

// ms epoch → KST(Asia/Seoul) 날짜 문자열 'YYYY-MM-DD'. (게임 루프가 아니라 프리뷰 날짜 계산용)
export function kstDateOf(nowMs: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(nowMs));
}

function isNextKstDay(fromDate: string, toDate: string): boolean {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  return Number.isFinite(from) && Number.isFinite(to) && to - from === 86_400_000;
}

// 'YYYY-MM-DD'(KST 달력 날짜) → 그 주의 월요일 날짜. 서버의 date_trunc('week') 와 같은 ISO 주(월요일 시작).
function kstWeekStartOfDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const mondayOffset = (d.getUTCDay() + 6) % 7; // 0=일 → 6, 1=월 → 0 ...
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d.toISOString().slice(0, 10);
}

// KST 날짜가 바뀌면 일일 필드를 서버처럼 롤오버한다. 서버는 KST 로 dated 원장/런에서
// 매번 재계산하지만, 프리뷰는 dated 이력 없이 집계만 들고 있어 날짜 전환 시 직접 리셋해야 한다.
export function rollOverPreviewDailyState(
  snapshot: ArcadeSnapshot,
  fromDate: string | null,
  toDate: string,
): void {
  if (fromDate === null || toDate <= fromDate) return;
  const wasGrantedPrevDay = snapshot.attendance.todayGranted;
  const consecutive = isNextKstDay(fromDate, toDate);
  snapshot.attendance.todayGranted = false;
  snapshot.todayActivityCounts = { sceneProgress: 0, comment: 0, retakeDone: 0 };
  Object.values(snapshot.games).forEach((stats) => {
    stats.todayRewardedRuns = 0;
  });
  // 연속 출석 유지 조건: 바로 다음 날 + 직전 날 출석함. 그 외(공백)는 연속이 끊긴다.
  if (!(consecutive && wasGrantedPrevDay)) {
    snapshot.attendance.streakDays = 0;
  }
  // KST 주(월요일 시작)가 바뀌면 주간 집계도 리셋한다 — 서버는 이번 주 원장에서 주간을 재계산하므로,
  // 프리뷰도 지난주 주간 최고·순위표를 비워야 '이번 주' 탭이 서버와 같이 동작한다. 전체(all-time)는 유지.
  if (kstWeekStartOfDate(fromDate) !== kstWeekStartOfDate(toDate)) {
    Object.values(snapshot.games).forEach((stats) => {
      stats.myWeeklyBestScore = 0;
      stats.leaderboardWeekly = [];
    });
  }
}

// game-entry 지문(["game-start", runId, gameId])에서 시작 게임을 되읽는다.
export function startedGameIdFromEntryFingerprint(fingerprint: string | undefined): string | null {
  if (fingerprint === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(fingerprint);
    return Array.isArray(parsed) && typeof parsed[2] === 'string' ? parsed[2] : null;
  } catch {
    return null;
  }
}

export interface ArcadePreviewApplyContext {
  now: number;
  userId: string;
  // 서버 RPC 와 동일하게, game-finish 는 선행 game-start 가 있어야 하고 그 게임 종류와 일치해야 한다.
  // 시작하지 않았으면 null, 시작했으면 시작 시의 gameId 를 돌려준다.
  startedGameId(runId: string): string | null;
}

export interface ArcadePreviewApplyResult {
  snapshot: ArcadeSnapshot;
  result: ArcadeExecuteResult;
  persistKey: boolean; // 서버가 원장을 기록하는(멱등 키를 소비하는) 명령만 true
}

function syncSelfWallet(snapshot: ArcadeSnapshot, userId: string): void {
  const entry = snapshot.walletLeaderboard.find((row) => row.userId === userId);
  if (!entry) return;
  entry.lifetimeEarnedPoints = snapshot.wallet.lifetimeEarnedPoints;
  snapshot.walletLeaderboard.sort(
    (a, b) => b.lifetimeEarnedPoints - a.lifetimeEarnedPoints || a.name.localeCompare(b.name, 'ko'),
  );
}

// 서버 execute 규칙(입장료/등급/상한/도전과제 보너스)을 로컬 스냅샷에 재현한다.
export function applyArcadePreviewCommand(
  snapshot: ArcadeSnapshot,
  command: ArcadeExecuteCommand,
  ctx: ArcadePreviewApplyContext,
): ArcadePreviewApplyResult {
  const next = structuredClone(snapshot);

  switch (command.kind) {
    case 'daily-login': {
      const points = ARCADE_BALANCE.dailyLoginPoints;
      if (!next.attendance.todayGranted) {
        next.attendance.streakDays += 1;
      }
      next.attendance.todayGranted = true;
      next.wallet.walletPoints += points;
      next.wallet.lifetimeEarnedPoints += points;
      next.aggregates.arcadeEarnedPoints += points;
      syncSelfWallet(next, ctx.userId);
      return {
        snapshot: next,
        result: {
          granted: true,
          wallet: { ...next.wallet },
          attendance: { ...next.attendance },
        },
        persistKey: true,
      };
    }

    case 'activity': {
      const config = ARCADE_BALANCE.activity[command.activity];
      const counterKey = ACTIVITY_COUNTER[command.activity];
      if (next.todayActivityCounts[counterKey] >= config.dailyCap) {
        return {
          snapshot: next,
          result: { awarded: false, points: 0, capped: true, wallet: { ...next.wallet } },
          persistKey: false,
        };
      }
      next.todayActivityCounts[counterKey] += 1;
      next.wallet.walletPoints += config.points;
      next.wallet.lifetimeEarnedPoints += config.points;
      next.aggregates.arcadeEarnedPoints += config.points;
      syncSelfWallet(next, ctx.userId);
      return {
        snapshot: next,
        result: { awarded: true, points: config.points, capped: false, wallet: { ...next.wallet } },
        persistKey: true,
      };
    }

    case 'game-start': {
      const fee = ARCADE_BALANCE.games[command.gameId].entryFee;
      if (next.wallet.walletPoints < fee) {
        throw new Error('포인트가 부족해 게임을 시작할 수 없어요');
      }
      next.wallet.walletPoints -= fee;
      return { snapshot: next, result: { wallet: { ...next.wallet } }, persistKey: true };
    }

    case 'game-finish': {
      const balance = ARCADE_BALANCE.games[command.gameId];
      if (!Number.isInteger(command.score) || command.score < 0 || command.score > balance.maxScore) {
        throw new Error(`${command.gameId} score is out of range`);
      }
      if (!Number.isInteger(command.durationMs) || command.durationMs < 1_000 || command.durationMs > 14_400_000) {
        throw new Error('game duration is out of range');
      }
      const startedGame = ctx.startedGameId(command.runId);
      if (startedGame === null) {
        throw new Error('시작되지 않은 게임은 기록할 수 없어요');
      }
      if (startedGame !== command.gameId) {
        throw new Error('시작한 게임과 종료한 게임이 달라요');
      }
      const stats = next.games[command.gameId];
      const grade = gradeForScore(command.gameId, command.score);
      const rewardCapped = stats.todayRewardedRuns >= ARCADE_BALANCE.dailyRewardedRunsCap;
      const reward = grade === 'none' || rewardCapped ? 0 : rewardForGrade(command.gameId, grade);
      const hadRuns = stats.totalRuns > 0;
      const prevBestScore = hadRuns ? stats.myBestScore : null;
      const prevWeeklyBest = hadRuns ? stats.myWeeklyBestScore : null;
      const newAlltimeBest = prevBestScore === null || command.score > prevBestScore;
      const newWeeklyBest = prevWeeklyBest === null || command.score > prevWeeklyBest;

      stats.totalRuns += 1;
      next.aggregates.totalRuns += 1;
      if (reward > 0) {
        stats.todayRewardedRuns += 1;
        next.wallet.walletPoints += reward;
        next.wallet.lifetimeEarnedPoints += reward;
        next.aggregates.arcadeEarnedPoints += reward;
      }
      const myBestScore = Math.max(prevBestScore ?? 0, command.score);
      stats.myBestScore = myBestScore;
      stats.myWeeklyBestScore = Math.max(stats.myWeeklyBestScore, command.score);
      stats.maxGoldenEaten = Math.max(stats.maxGoldenEaten, command.meta.goldenEaten ?? 0);
      stats.maxLineClear = Math.max(stats.maxLineClear, command.meta.maxLineClear ?? 0);
      stats.maxLevel = Math.max(stats.maxLevel, command.meta.levelReached ?? 0);
      // 최고 기록을 새로 세운 판만 순위표에 반영한다 — read() 재로드 시에도 방금 판이 남도록(서버 RPC 와 동일 의미).
      // 기록을 못 깬 판은 순위가 그대로라 손대지 않는다(옛 점수에 새 시각이 붙어 정렬·달성일이 틀어지지 않게).
      const selfName = next.walletLeaderboard.find((row) => row.userId === ctx.userId)?.name ?? '나';
      const at = new Date(ctx.now).toISOString();
      // 신기록이면 이번 판 점수(command.score)를 올린다 — 주 경계에서 캐시된 주간 최고가 아니라 실제 이번 판이 정답.
      if (newAlltimeBest && command.score > 0) {
        stats.leaderboardAll = upsertLeaderboardEntry(stats.leaderboardAll, { userId: ctx.userId, name: selfName }, command.score, at);
      }
      if (newWeeklyBest && command.score > 0) {
        stats.leaderboardWeekly = upsertLeaderboardEntry(stats.leaderboardWeekly, { userId: ctx.userId, name: selfName }, command.score, at);
      }
      syncSelfWallet(next, ctx.userId);

      return {
        snapshot: next,
        result: {
          grade,
          rewardPoints: reward,
          rewardCapped,
          newAlltimeBest,
          newWeeklyBest,
          prevBestScore,
          myBestScore,
          todayRewardedRuns: stats.todayRewardedRuns,
          wallet: { ...next.wallet },
          slackNotifyEnabled: next.config.slackNotifyEnabled,
        },
        persistKey: true,
      };
    }

    case 'achievement-unlock': {
      const bonus = ACHIEVEMENT_BONUS.get(command.achievementId);
      if (bonus === undefined) {
        throw new Error('알 수 없는 도전과제예요');
      }
      const already = next.achievements.some((entry) => entry.achievementId === command.achievementId);
      if (!already) {
        next.achievements.push({
          achievementId: command.achievementId,
          unlockedAt: new Date(ctx.now).toISOString(),
        });
        next.wallet.walletPoints += bonus;
        next.wallet.lifetimeEarnedPoints += bonus;
        next.aggregates.arcadeEarnedPoints += bonus;
        syncSelfWallet(next, ctx.userId);
      }
      return {
        snapshot: next,
        result: {
          achievementId: command.achievementId,
          rewardPoints: already ? 0 : bonus,
          wallet: { ...next.wallet },
        },
        persistKey: true,
      };
    }

    case 'config-set': {
      next.config.slackNotifyEnabled = command.slackNotifyEnabled;
      return {
        snapshot: next,
        result: { config: { slackNotifyEnabled: command.slackNotifyEnabled } },
        persistKey: false,
      };
    }
  }

  const exhaustive: never = command;
  return exhaustive;
}

export interface ArcadePreviewGatewayOptions {
  userId?: string;
  now?: () => number;
  latencyMs?: number;
}

// 순수 인메모리 프리뷰 게이트웨이(테스트/비영속 프리뷰용).
export function createArcadePreviewGateway(
  options: ArcadePreviewGatewayOptions = {},
): ArcadePreviewGateway {
  const userId = options.userId ?? 'preview-self';
  const now = options.now ?? (() => 0);
  const latencyMs = options.latencyMs ?? 0;
  let snapshot = createArcadePreviewSeed(userId);
  let dailyDate = kstDateOf(now());
  const fingerprintByRequestId = new Map<string, string>();
  const responseByRequestId = new Map<string, ArcadeExecuteResult>();

  function wait(): Promise<void> {
    return latencyMs <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, latencyMs));
  }

  function rollOverIfNeeded(): void {
    const today = kstDateOf(now());
    if (today !== dailyDate) {
      rollOverPreviewDailyState(snapshot, dailyDate, today);
      dailyDate = today;
    }
  }

  return {
    async read() {
      await wait();
      rollOverIfNeeded();
      return structuredClone(snapshot);
    },
    async execute(command) {
      await wait();
      rollOverIfNeeded();
      const fingerprint = fingerprintArcadeCommand(command);
      if (fingerprintByRequestId.has(command.requestId)) {
        if (fingerprintByRequestId.get(command.requestId) !== fingerprint) {
          throw new Error('같은 요청이 다른 내용으로 이미 처리되었어요');
        }
        return { ...(responseByRequestId.get(command.requestId) ?? {}), replayed: true } as ArcadeExecuteResult;
      }
      const applied = applyArcadePreviewCommand(snapshot, command, {
        now: now(),
        userId,
        startedGameId: (runId) => startedGameIdFromEntryFingerprint(fingerprintByRequestId.get(`game-entry:${runId}`)),
      });
      snapshot = applied.snapshot;
      if (applied.persistKey) {
        fingerprintByRequestId.set(command.requestId, fingerprint);
        responseByRequestId.set(command.requestId, applied.result);
      }
      return applied.result;
    },
  };
}
