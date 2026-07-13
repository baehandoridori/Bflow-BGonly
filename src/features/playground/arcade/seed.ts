import type { ArcadeSnapshot } from './types';

const SELF_NAME = '배한솔';
const SEED_AT = '2026-07-13T09:00:00+09:00';

// 프리뷰 시드 — 실제 흐름을 체험할 수 있는 그럴듯한 초기 상태.
// 팀원 리더보드 fixture 는 ranking.ts 에서 이사해 왔다.
export function createArcadePreviewSeed(userId: string): ArcadeSnapshot {
  return {
    wallet: { walletPoints: 12_500, lifetimeEarnedPoints: 48_200 },
    attendance: { streakDays: 3, todayGranted: false },
    todayActivityCounts: { sceneProgress: 4, comment: 2, retakeDone: 0 },
    games: {
      snake: {
        myBestScore: 34,
        myWeeklyBestScore: 34,
        todayRewardedRuns: 2,
        totalRuns: 11,
        leaderboardAll: [
          { userId, name: SELF_NAME, score: 34, at: SEED_AT },
          { userId: 'preview-minji', name: '민지', score: 28, at: SEED_AT },
          { userId: 'preview-doyun', name: '도윤', score: 22, at: SEED_AT },
        ],
        leaderboardWeekly: [
          { userId, name: SELF_NAME, score: 34, at: SEED_AT },
          { userId: 'preview-minji', name: '민지', score: 28, at: SEED_AT },
          { userId: 'preview-doyun', name: '도윤', score: 19, at: SEED_AT },
        ],
      },
      tetris: {
        myBestScore: 12_800,
        myWeeklyBestScore: 12_800,
        todayRewardedRuns: 1,
        totalRuns: 6,
        leaderboardAll: [
          { userId, name: SELF_NAME, score: 12_800, at: SEED_AT },
          { userId: 'preview-seoa', name: '서아', score: 9_700, at: SEED_AT },
          { userId: 'preview-yujin', name: '유진', score: 6_400, at: SEED_AT },
        ],
        leaderboardWeekly: [
          { userId, name: SELF_NAME, score: 12_800, at: SEED_AT },
          { userId: 'preview-seoa', name: '서아', score: 8_200, at: SEED_AT },
        ],
      },
    },
    achievements: [{ achievementId: 'arcade-first-run', unlockedAt: '2026-07-01T09:00:00+09:00' }],
    aggregates: { totalRuns: 17, arcadeEarnedPoints: 380 },
    walletLeaderboard: [
      { userId, name: SELF_NAME, lifetimeEarnedPoints: 48_200 },
      { userId: 'preview-minji', name: '민지', lifetimeEarnedPoints: 4_920 },
      { userId: 'preview-doyun', name: '도윤', lifetimeEarnedPoints: 3_860 },
      { userId: 'preview-seoa', name: '서아', lifetimeEarnedPoints: 2_820 },
      { userId: 'preview-yujin', name: '유진', lifetimeEarnedPoints: 2_115 },
    ],
    config: { slackNotifyEnabled: false },
  };
}
