import type { ArcadeAchievementDefinition, ArcadeGameId, ArcadeGrade } from './constants';

export type { ArcadeGameId, ArcadeGrade } from './constants';

export type ArcadeActivityType = 'scene-stage' | 'scene-phase-done' | 'comment' | 'retake-done';

export interface ArcadeWallet {
  walletPoints: number;
  lifetimeEarnedPoints: number;
}

export interface ArcadeAttendance {
  streakDays: number;
  todayGranted: boolean;
}

export interface ArcadeTodayActivityCounts {
  sceneProgress: number;
  comment: number;
  retakeDone: number;
}

export interface ArcadeLeaderboardEntry {
  userId: string;
  name: string;
  score: number;
  at: string;
}

export interface ArcadeGameStats {
  myBestScore: number;
  myWeeklyBestScore: number;
  todayRewardedRuns: number;
  totalRuns: number;
  leaderboardAll: ArcadeLeaderboardEntry[];
  leaderboardWeekly: ArcadeLeaderboardEntry[];
}

export interface ArcadeAchievementUnlock {
  achievementId: string;
  unlockedAt: string;
}

export interface ArcadeAggregates {
  totalRuns: number;
  arcadeEarnedPoints: number;
}

export interface ArcadeWalletLeaderboardEntry {
  userId: string;
  name: string;
  lifetimeEarnedPoints: number;
}

export interface ArcadeConfig {
  slackNotifyEnabled: boolean;
}

export interface ArcadeSnapshot {
  wallet: ArcadeWallet;
  attendance: ArcadeAttendance;
  todayActivityCounts: ArcadeTodayActivityCounts;
  games: Record<ArcadeGameId, ArcadeGameStats>;
  achievements: ArcadeAchievementUnlock[];
  aggregates: ArcadeAggregates;
  walletLeaderboard: ArcadeWalletLeaderboardEntry[];
  config: ArcadeConfig;
}

// 실행 명령 (kind + requestId + kind별 필드). gateway 가 payload jsonb 로 조립한다.
export type ArcadeExecuteCommand =
  | { kind: 'daily-login'; requestId: string }
  | { kind: 'activity'; requestId: string; activity: ArcadeActivityType }
  | { kind: 'game-start'; requestId: string; runId: string; gameId: ArcadeGameId }
  | {
      kind: 'game-finish';
      requestId: string;
      runId: string;
      gameId: ArcadeGameId;
      score: number;
      durationMs: number;
      meta: Record<string, number>;
    }
  | { kind: 'achievement-unlock'; requestId: string; achievementId: string }
  | { kind: 'config-set'; requestId: string; slackNotifyEnabled: boolean };

export type ArcadeExecuteKind = ArcadeExecuteCommand['kind'];

// 서버 응답 (kind별). 재생일 때만 replayed: true 가 덧붙는다.
export interface ArcadeDailyLoginResult {
  granted: boolean;
  wallet: ArcadeWallet;
  attendance: ArcadeAttendance;
  replayed?: true;
}

export interface ArcadeActivityResult {
  awarded: boolean;
  points: number;
  capped: boolean;
  wallet: ArcadeWallet;
  replayed?: true;
}

export interface ArcadeGameStartResult {
  wallet: ArcadeWallet;
  replayed?: true;
}

export interface ArcadeGameFinishResult {
  grade: ArcadeGrade;
  rewardPoints: number;
  rewardCapped: boolean;
  newAlltimeBest: boolean;
  newWeeklyBest: boolean;
  prevBestScore: number | null;
  myBestScore: number;
  todayRewardedRuns: number;
  wallet: ArcadeWallet;
  slackNotifyEnabled: boolean;
  replayed?: true;
}

export interface ArcadeAchievementUnlockResult {
  achievementId: string;
  rewardPoints: number;
  wallet: ArcadeWallet;
  replayed?: true;
}

export interface ArcadeConfigSetResult {
  config: ArcadeConfig;
  replayed?: true;
}

export type ArcadeExecuteResult =
  | ArcadeDailyLoginResult
  | ArcadeActivityResult
  | ArcadeGameStartResult
  | ArcadeGameFinishResult
  | ArcadeAchievementUnlockResult
  | ArcadeConfigSetResult;

// finishRun 반환 뷰모델 = game-finish 응답 + 이번 런으로 새로 해금된 도전과제 정의
export interface ArcadeFinishResult extends ArcadeGameFinishResult {
  unlockedAchievements: ArcadeAchievementDefinition[];
}

// arcade:wallet-updated push 페이로드 (main → renderer)
export interface ArcadeWalletPush {
  wallet: ArcadeWallet;
  delta: number;
  reason: string;
}
