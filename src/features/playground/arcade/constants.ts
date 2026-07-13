export type ArcadeGameId = 'snake' | 'tetris';
export type ArcadeGrade = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum';

export const ARCADE_BALANCE = {
  dailyLoginPoints: 20,
  activity: {
    'scene-stage': { points: 5, dailyCap: 30, capKind: 'scene-progress' },
    'scene-phase-done': { points: 10, dailyCap: 30, capKind: 'scene-progress' },
    comment: { points: 5, dailyCap: 5, capKind: 'comment' },
    'retake-done': { points: 30, dailyCap: 5, capKind: 'retake-done' },
  },
  games: {
    snake: {
      entryFee: 10,
      scoreLabel: '길이',
      maxScore: 441,
      grades: [
        { grade: 'bronze', min: 15, reward: 8 },
        { grade: 'silver', min: 25, reward: 18 },
        { grade: 'gold', min: 40, reward: 30 },
        { grade: 'platinum', min: 55, reward: 45 },
      ],
    },
    tetris: {
      entryFee: 15,
      scoreLabel: '점수',
      maxScore: 3_000_000,
      grades: [
        { grade: 'bronze', min: 3_000, reward: 12 },
        { grade: 'silver', min: 10_000, reward: 30 },
        { grade: 'gold', min: 25_000, reward: 55 },
        { grade: 'platinum', min: 50_000, reward: 80 },
      ],
    },
  },
  dailyRewardedRunsCap: 5,
} as const;

export interface ArcadeAchievementDefinition {
  id: string;
  name: string;
  description: string;
  bonusPoints: number;
  game: ArcadeGameId | 'common';
}

export const ARCADE_ACHIEVEMENTS: readonly ArcadeAchievementDefinition[] = [
  { id: 'arcade-first-run', name: '첫 판', description: '아케이드 게임을 처음 완주했어요', bonusPoints: 10, game: 'common' },
  { id: 'arcade-runs-50', name: '단골 손님', description: '누적 50판을 플레이했어요', bonusPoints: 30, game: 'common' },
  { id: 'arcade-earned-5k', name: '티끌 모아', description: '적립 포인트 누적 5,000P를 모았어요', bonusPoints: 50, game: 'common' },
  { id: 'attend-7', name: '개근상', description: '7일 연속 출석했어요', bonusPoints: 50, game: 'common' },
  { id: 'snake-30', name: '몸집 불리기', description: '스네이크 길이 30을 달성했어요', bonusPoints: 15, game: 'snake' },
  { id: 'snake-55', name: '전설의 뱀', description: '스네이크 길이 55를 달성했어요', bonusPoints: 40, game: 'snake' },
  { id: 'snake-golden-5', name: '황금 미식가', description: '한 판에 골든 사과 5개를 먹었어요', bonusPoints: 20, game: 'snake' },
  { id: 'tetris-tetris', name: '테트리스!', description: '한 번에 4줄을 지웠어요', bonusPoints: 20, game: 'tetris' },
  { id: 'tetris-level-10', name: '고속 낙하', description: '레벨 10에 도달했어요', bonusPoints: 30, game: 'tetris' },
  { id: 'tetris-30k', name: '3만 클럽', description: '한 판에 30,000점을 넘겼어요', bonusPoints: 40, game: 'tetris' },
] as const;
