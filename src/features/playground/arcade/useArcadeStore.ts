import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { ARCADE_ACHIEVEMENTS, type ArcadeAchievementDefinition } from './constants.ts';
import { evaluateAchievements } from './domain.ts';
import { createArcadeGateway } from './gateway.ts';
import type { ArcadePreviewGateway } from './previewGateway.ts';
import { useMarketPreviewStore } from '../market/useMarketPreviewStore.ts';
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

interface ArcadeState {
  snapshot: ArcadeSnapshot | null;
  loading: boolean;
  mutating: boolean;
  error: string | null;
  sessionKey: string | null;
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
): ArcadeSnapshot {
  const stats = snapshot.games[input.gameId];
  return {
    ...snapshot,
    wallet: result.wallet ?? snapshot.wallet,
    games: {
      ...snapshot.games,
      [input.gameId]: {
        ...stats,
        myBestScore: result.myBestScore ?? Math.max(stats.myBestScore, input.score),
        myWeeklyBestScore: Math.max(stats.myWeeklyBestScore, input.score),
        todayRewardedRuns: result.todayRewardedRuns ?? stats.todayRewardedRuns,
        totalRuns: stats.totalRuns + 1,
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
): UseBoundStore<StoreApi<ArcadeState>> {
  let generation = 0;
  // 이미 로컬 스냅샷에 반영한 runId. 재생 응답이 왔을 때 "진짜 중복 제출"과
  // "main 재시도로 응답만 유실된 첫 반영"을 구분한다.
  const appliedRuns = new Set<string>();

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

      async load(requestedSessionKey = DEFAULT_SESSION_KEY) {
        const gen = ++generation;
        const sessionChanged = get().sessionKey !== requestedSessionKey;
        if (sessionChanged) appliedRuns.clear();
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
        const runId = crypto.randomUUID();
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
          return { runId };
        } catch (error) {
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
          set({ snapshot: applyFinishToSnapshot(before, input, result), mutating: false });
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
