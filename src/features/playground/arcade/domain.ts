import { ARCADE_ACHIEVEMENTS, ARCADE_BALANCE, type ArcadeGameId, type ArcadeGrade } from './constants.ts';

// 등급 판정은 경계 이상(>=) — SQL 서버 CASE 와 동일한 수치·비교연산을 쓴다.
export function gradeForScore(gameId: ArcadeGameId, score: number): ArcadeGrade {
  let result: ArcadeGrade = 'none';
  for (const tier of ARCADE_BALANCE.games[gameId].grades) {
    if (score >= tier.min) {
      result = tier.grade;
    }
  }
  return result;
}

export function rewardForGrade(gameId: ArcadeGameId, grade: ArcadeGrade): number {
  if (grade === 'none') {
    return 0;
  }
  const tier = ARCADE_BALANCE.games[gameId].grades.find((entry) => entry.grade === grade);
  return tier ? tier.reward : 0;
}

// HUD "다음 등급까지 n". 이미 최고 등급이면 null.
export function nextGradeInfo(
  gameId: ArcadeGameId,
  score: number,
): { grade: ArcadeGrade; remaining: number } | null {
  for (const tier of ARCADE_BALANCE.games[gameId].grades) {
    if (score < tier.min) {
      return { grade: tier.grade, remaining: tier.min - score };
    }
  }
  return null;
}

interface EvaluateAchievementsInput {
  gameId: ArcadeGameId | null; // null = 게임 외 평가(스냅샷 load 후) — 공통 과제만 검사
  runMeta: { score: number; goldenEaten?: number; maxLineClear?: number; levelReached?: number } | null;
  runRewardPoints: number; // 이번 런 지급 보상 (게임 외 평가면 0)
  aggregates: { totalRuns: number; arcadeEarnedPoints: number }; // 서버 스냅샷 = 이번 런 미포함 값
  attendanceStreakDays: number;
  unlockedIds: ReadonlySet<string>;
}

// 새로 해금할 도전과제 id 목록(정의 순서). 누적형은 이번 런을 반영해 판정한다.
export function evaluateAchievements(input: EvaluateAchievementsInput): string[] {
  const { gameId, runMeta, runRewardPoints, aggregates, attendanceStreakDays, unlockedIds } = input;
  const runsAfter = aggregates.totalRuns + (runMeta ? 1 : 0);
  const earnedAfter = aggregates.arcadeEarnedPoints + runRewardPoints;

  const newlyUnlocked: string[] = [];
  for (const definition of ARCADE_ACHIEVEMENTS) {
    if (unlockedIds.has(definition.id)) {
      continue;
    }
    // 게임 과제는 해당 게임의 런을 평가할 때만 검사한다(게임 외 평가는 공통만).
    if (definition.game !== 'common' && definition.game !== gameId) {
      continue;
    }

    let earned = false;
    switch (definition.id) {
      case 'arcade-first-run':
        earned = runsAfter >= 1;
        break;
      case 'arcade-runs-50':
        earned = runsAfter >= 50;
        break;
      case 'arcade-earned-5k':
        earned = earnedAfter >= 5000;
        break;
      case 'attend-7':
        earned = attendanceStreakDays >= 7;
        break;
      case 'snake-30':
        earned = gameId === 'snake' && runMeta !== null && runMeta.score >= 30;
        break;
      case 'snake-55':
        earned = gameId === 'snake' && runMeta !== null && runMeta.score >= 55;
        break;
      case 'snake-golden-5':
        earned = gameId === 'snake' && runMeta !== null && (runMeta.goldenEaten ?? 0) >= 5;
        break;
      case 'tetris-tetris':
        earned = gameId === 'tetris' && runMeta !== null && (runMeta.maxLineClear ?? 0) >= 4;
        break;
      case 'tetris-level-10':
        earned = gameId === 'tetris' && runMeta !== null && (runMeta.levelReached ?? 0) >= 10;
        break;
      case 'tetris-30k':
        earned = gameId === 'tetris' && runMeta !== null && runMeta.score >= 30000;
        break;
      default:
        earned = false;
    }

    if (earned) {
      newlyUnlocked.push(definition.id);
    }
  }

  return newlyUnlocked;
}
