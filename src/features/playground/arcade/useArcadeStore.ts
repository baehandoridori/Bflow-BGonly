import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { ARCADE_ACHIEVEMENTS, type ArcadeAchievementDefinition } from './constants.ts';
import { evaluateAchievements, upsertLeaderboardEntry } from './domain.ts';
import { createArcadeGateway } from './gateway.ts';
import type { ArcadePreviewGateway } from './previewGateway.ts';
import { useMarketPreviewStore } from '../market/useMarketPreviewStore.ts';
import { useAuthStore } from '../../../stores/useAuthStore.ts';
import type {
  ArcadeAchievementUnlockResult,
  ArcadeConfigSetResult,
  ArcadeGameFinishResult,
  ArcadeGameId,
  ArcadeGameStartResult,
  ArcadeSnapshot,
  ArcadeWallet,
  ArcadeWalletPush,
  ArcadeFinishResult,
} from './types';

const DEFAULT_SESSION_KEY = '__default-arcade-session__';
const ACHIEVEMENT_BY_ID = new Map<string, ArcadeAchievementDefinition>(
  ARCADE_ACHIEVEMENTS.map((definition) => [definition.id, definition]),
);

export interface ArcadeFinishInput {
  runId: string;
  gameId: ArcadeGameId;
  score: number;
  durationMs: number;
  meta: Record<string, number>;
}

// 순위표 내 행 즉시 반영에 쓰는 나의 신원(id·이름). 없으면(미로그인) 순위표는 그대로 둔다.
export interface ArcadeSelf {
  userId: string;
  name: string;
}

interface ArcadeState {
  snapshot: ArcadeSnapshot | null;
  loading: boolean;
  mutating: boolean;
  error: string | null;
  sessionKey: string | null;
  // 마지막 지갑 적립 push — 헤더 배지의 "+N P" 획득 연출용. id 는 단조 증가(같은 delta 연속도 구분).
  lastGain: { id: number; delta: number } | null;
  load(sessionKey?: string): Promise<void>;
  startRun(gameId: ArcadeGameId): Promise<{ runId: string } | null>;
  finishRun(input: ArcadeFinishInput): Promise<ArcadeFinishResult | null>;
  setSlackNotify(enabled: boolean): Promise<boolean>;
  applyWalletPush(update: ArcadeWalletPush): void;
  applyMarketWallet(wallet: ArcadeWallet): void;
  clearError(): void;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function applyFinishToSnapshot(
  snapshot: ArcadeSnapshot,
  input: ArcadeFinishInput,
  result: ArcadeGameFinishResult,
  self: ArcadeSelf | null,
): ArcadeSnapshot {
  const stats = snapshot.games[input.gameId];
  const myBestScore = result.myBestScore ?? Math.max(stats.myBestScore, input.score);
  const myWeeklyBestScore = Math.max(stats.myWeeklyBestScore, input.score);
  // 최고 기록을 새로 세운 판만 순위표에 즉시 반영한다 — 서버 realtime/재로드 없이도 방금 판이 보이도록.
  // 기록을 못 깬 판은 내 순위가 그대로라 손대지 않는다(안 그러면 옛 점수에 새 시각이 붙어 정렬·달성일이 틀어짐).
  // 미로그인이거나 최고가 0이면(등급 없음 등)도 그대로 둔다. 다음 전체 로드에서 서버 정본으로 교체.
  const at = new Date().toISOString();
  const leaderboardAll = self && result.newAlltimeBest && myBestScore > 0
    ? upsertLeaderboardEntry(stats.leaderboardAll, self, myBestScore, at)
    : stats.leaderboardAll;
  const leaderboardWeekly = self && result.newWeeklyBest && myWeeklyBestScore > 0
    ? upsertLeaderboardEntry(stats.leaderboardWeekly, self, myWeeklyBestScore, at)
    : stats.leaderboardWeekly;
  return {
    ...snapshot,
    wallet: result.wallet ?? snapshot.wallet,
    games: {
      ...snapshot.games,
      [input.gameId]: {
        ...stats,
        myBestScore,
        myWeeklyBestScore,
        todayRewardedRuns: result.todayRewardedRuns ?? stats.todayRewardedRuns,
        totalRuns: stats.totalRuns + 1,
        maxGoldenEaten: Math.max(stats.maxGoldenEaten, input.meta.goldenEaten ?? 0),
        maxLineClear: Math.max(stats.maxLineClear, input.meta.maxLineClear ?? 0),
        maxLevel: Math.max(stats.maxLevel, input.meta.levelReached ?? 0),
        leaderboardAll,
        leaderboardWeekly,
      },
    },
    aggregates: {
      totalRuns: snapshot.aggregates.totalRuns + 1,
      arcadeEarnedPoints: snapshot.aggregates.arcadeEarnedPoints + (result.rewardPoints ?? 0),
    },
  };
}

export function createArcadeStore(
  gateway: ArcadePreviewGateway,
  syncMarketWallet: (wallet: ArcadeWallet) => void = (wallet) =>
    useMarketPreviewStore.getState().applyServerWallet(wallet),
  resolveSelf: () => ArcadeSelf | null = () => {
    const user = useAuthStore.getState().currentUser;
    return user ? { userId: user.id, name: user.name } : null;
  },
): UseBoundStore<StoreApi<ArcadeState>> {
  let generation = 0;
  // 이미 로컬 스냅샷에 반영한 runId. 재생 응답이 왔을 때 "진짜 중복 제출"과
  // "main 재시도로 응답만 유실된 첫 반영"을 구분한다.
  const appliedRuns = new Set<string>();
  // game-start 가 응답 유실로 실패했을 때 보류한 runId. 같은 게임을 다시 시작하면 이 runId 를
  // 재사용해 이미 결제된 시작을 멱등 재생한다(입장료 중복 차감 방지). 성공 시 해제.
  let pendingStartRun: { gameId: ArcadeGameId; runId: string } | null = null;

  function syncWallet(wallet: ArcadeWallet | undefined): void {
    if (wallet) syncMarketWallet(wallet);
  }

  return create<ArcadeState>((set, get) => {
    // 새로 해금할 도전과제를 평가해 각각 unlock execute 하고, 성공분 정의를 반환한다.
    // aggregatesOverride 는 이번 런 미포함 값(finishRun 은 갱신 전 값을 넘긴다).
    async function evaluateAndUnlock(input: {
      gameId: ArcadeGameId | null;
      runMeta: { score: number; goldenEaten?: number; maxLineClear?: number; levelReached?: number } | null;
      runRewardPoints: number;
      aggregatesOverride?: { totalRuns: number; arcadeEarnedPoints: number };
    }): Promise<ArcadeAchievementDefinition[]> {
      const snapshot = get().snapshot;
      if (!snapshot) return [];
      const unlockedIds = new Set(snapshot.achievements.map((entry) => entry.achievementId));
      const newIds = evaluateAchievements({
        gameId: input.gameId,
        runMeta: input.runMeta,
        runRewardPoints: input.runRewardPoints,
        aggregates: input.aggregatesOverride ?? snapshot.aggregates,
        attendanceStreakDays: snapshot.attendance.streakDays,
        // load 시에도 게임 과제(점수·골든·라인·레벨)를 누적 최댓값으로 복구 평가한다.
        gamePeaks: {
          snake: {
            bestScore: snapshot.games.snake.myBestScore,
            maxGoldenEaten: snapshot.games.snake.maxGoldenEaten,
          },
          tetris: {
            bestScore: snapshot.games.tetris.myBestScore,
            maxLineClear: snapshot.games.tetris.maxLineClear,
            maxLevel: snapshot.games.tetris.maxLevel,
          },
        },
        unlockedIds,
      });

      const unlockedDefs: ArcadeAchievementDefinition[] = [];
      for (const id of newIds) {
        const definition = ACHIEVEMENT_BY_ID.get(id);
        if (!definition) continue;
        try {
          const result = (await gateway.execute({
            kind: 'achievement-unlock',
            requestId: `ach:${id}`,
            achievementId: id,
          })) as ArcadeAchievementUnlockResult;
          set((state) => {
            if (!state.snapshot) return {};
            if (state.snapshot.achievements.some((entry) => entry.achievementId === id)) return {};
            const bonus = result.rewardPoints ?? definition.bonusPoints;
            return {
              snapshot: {
                ...state.snapshot,
                achievements: [
                  ...state.snapshot.achievements,
                  { achievementId: id, unlockedAt: new Date().toISOString() },
                ],
                wallet: result.wallet ?? state.snapshot.wallet,
                aggregates: {
                  ...state.snapshot.aggregates,
                  arcadeEarnedPoints: state.snapshot.aggregates.arcadeEarnedPoints + bonus,
                },
              },
            };
          });
          syncWallet(result.wallet);
          unlockedDefs.push(definition);
        } catch {
          // 해금 실패는 무시한다 — 다음 load 에서 재평가된다.
        }
      }
      return unlockedDefs;
    }

    return {
      snapshot: null,
      loading: false,
      mutating: false,
      error: null,
      sessionKey: null,
      lastGain: null,

      async load(requestedSessionKey = DEFAULT_SESSION_KEY) {
        const gen = ++generation;
        const sessionChanged = get().sessionKey !== requestedSessionKey;
        if (sessionChanged) {
          appliedRuns.clear();
          // 세션(계정)이 바뀌면 보류한 runId 를 버린다 — run id 는 전역 UUID 라, 다른 사용자가
          // 옛 runId 를 재사용하면 서로의 유료 판이 얽히거나 막힌다.
          pendingStartRun = null;
        }
        set({
          loading: true,
          error: null,
          sessionKey: requestedSessionKey,
          ...(sessionChanged ? { snapshot: null } : {}),
        });
        try {
          const snapshot = await gateway.read();
          if (gen !== generation || get().sessionKey !== requestedSessionKey) return;
          set({ snapshot, loading: false });
          syncWallet(snapshot.wallet);
          // 게임을 하지 않아도 출석·적립 공통 과제가 해금되도록 로드 후 한 번 평가한다.
          await evaluateAndUnlock({ gameId: null, runMeta: null, runRewardPoints: 0 });
        } catch {
          if (gen !== generation || get().sessionKey !== requestedSessionKey) return;
          set({ loading: false, error: '아케이드 정보를 불러오지 못했어요.' });
        }
      },

      async startRun(gameId) {
        if (!get().snapshot) {
          set({ error: '아케이드 정보를 먼저 불러와 주세요.' });
          return null;
        }
        // 이전 시도가 응답 유실로 실패했다면 같은 runId 를 재사용한다 — 서버 game-start 는
        // request_id(game-entry:runId)로 멱등이라, 이미 결제된 시작이면 재생돼 중복 차감되지 않는다.
        const runId = pendingStartRun && pendingStartRun.gameId === gameId
          ? pendingStartRun.runId
          : crypto.randomUUID();
        pendingStartRun = { gameId, runId };
        set({ mutating: true, error: null });
        try {
          const result = (await gateway.execute({
            kind: 'game-start',
            requestId: `game-entry:${runId}`,
            runId,
            gameId,
          })) as ArcadeGameStartResult;
          set((state) => ({
            mutating: false,
            snapshot: state.snapshot
              ? { ...state.snapshot, wallet: result.wallet ?? state.snapshot.wallet }
              : state.snapshot,
          }));
          syncWallet(result.wallet);
          pendingStartRun = null; // 성공 — 보류 해제
          return { runId };
        } catch (error) {
          // 실패 시 pendingStartRun 을 유지해, 다음 시작이 같은 runId 로 재시도(멱등)하게 한다.
          set({ mutating: false, error: messageOf(error, '게임을 시작할 수 없어요.') });
          return null;
        }
      },

      async finishRun(input) {
        const before = get().snapshot;
        if (!before) {
          set({ error: '아케이드 정보를 먼저 불러와 주세요.' });
          return null;
        }
        set({ mutating: true, error: null });
        try {
          const result = (await gateway.execute({
            kind: 'game-finish',
            requestId: `game-finish:${input.runId}`,
            runId: input.runId,
            gameId: input.gameId,
            score: input.score,
            durationMs: input.durationMs,
            meta: input.meta,
          })) as ArcadeGameFinishResult;
          if (result.replayed && appliedRuns.has(input.runId)) {
            // 이미 로컬에 반영한 판의 재생(중복 제출) — 재적용하면 판수/보상이 부풀려지므로
            // 지갑 절대값만 동기화하고 종료한다.
            set({ mutating: false });
            syncWallet(result.wallet);
            return { ...result, unlockedAchievements: [] };
          }
          // 신규이거나, main 재시도로 응답만 유실돼 아직 로컬 미반영인 재생 → 적용한다.
          // 도전과제 평가 입력용으로 갱신 "전" aggregates 를 캡처한다(이번 런 미포함).
          const prevAggregates = { ...before.aggregates };
          set({ snapshot: applyFinishToSnapshot(before, input, result, resolveSelf()), mutating: false });
          appliedRuns.add(input.runId);
          syncWallet(result.wallet);
          const unlockedAchievements = await evaluateAndUnlock({
            gameId: input.gameId,
            runMeta: {
              score: input.score,
              goldenEaten: input.meta.goldenEaten,
              maxLineClear: input.meta.maxLineClear,
              levelReached: input.meta.levelReached,
            },
            runRewardPoints: result.rewardPoints ?? 0,
            aggregatesOverride: prevAggregates,
          });
          return { ...result, unlockedAchievements };
        } catch (error) {
          set({ mutating: false, error: messageOf(error, '게임 결과를 저장하지 못했어요.') });
          return null;
        }
      },

      async setSlackNotify(enabled) {
        set({ mutating: true, error: null });
        try {
          const result = (await gateway.execute({
            kind: 'config-set',
            requestId: `config:${crypto.randomUUID()}`,
            slackNotifyEnabled: enabled,
          })) as ArcadeConfigSetResult;
          set((state) => ({
            mutating: false,
            snapshot: state.snapshot
              ? { ...state.snapshot, config: result.config ?? state.snapshot.config }
              : state.snapshot,
          }));
          return true;
        } catch (error) {
          set({ mutating: false, error: messageOf(error, '설정을 저장하지 못했어요.') });
          return false;
        }
      },

      applyWalletPush(update) {
        set((state) => ({
          snapshot: state.snapshot ? { ...state.snapshot, wallet: update.wallet } : state.snapshot,
          // 적립(양수 delta)만 획득 연출을 유발한다. 차감·0 은 배지 숫자만 조용히 갱신.
          lastGain: update.delta > 0
            ? { id: (state.lastGain?.id ?? 0) + 1, delta: update.delta }
            : state.lastGain,
        }));
        syncWallet(update.wallet);
      },

      // 모의투자 지갑 이동 등 마켓 쪽 변경을 아케이드 스냅샷에 반영한다.
      // 마켓으로 되돌려 동기화하지 않아(무한 루프 방지) 단방향으로만 흐른다.
      applyMarketWallet(wallet) {
        const snapshot = get().snapshot;
        if (!snapshot) return;
        if (
          snapshot.wallet.walletPoints === wallet.walletPoints
          && snapshot.wallet.lifetimeEarnedPoints === wallet.lifetimeEarnedPoints
        ) {
          return;
        }
        set({
          snapshot: {
            ...snapshot,
            wallet: { walletPoints: wallet.walletPoints, lifetimeEarnedPoints: wallet.lifetimeEarnedPoints },
          },
        });
      },

      clearError() {
        set({ error: null });
      },
    };
  });
}

export const useArcadeStore = createArcadeStore(createArcadeGateway());
