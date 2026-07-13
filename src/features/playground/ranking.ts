export interface RankingTeammate {
  id: string;
  name: string;
  lifetimeEarnedPoints: number | null;
}

export interface PointRankingEntry {
  id: string;
  name: string;
  points: number | null;
  rank: number | null;
  isCurrentUser: boolean;
}
export interface PointRankingModel {
  status: 'ready' | 'unavailable';
  entries: readonly PointRankingEntry[];
  current: PointRankingEntry;
  balanceLabel: string;
  rankLabel: string;
  statusText: string;
}

const collator = new Intl.Collator('ko-KR');

// 점수가 있는 지갑 리더보드 행을 먼저 보존하고(디렉터리에 없는 팀원도 유지), 그다음
// 지갑이 없는 디렉터리 사용자를 점수 null 로 이어붙인다. 현재 사용자는 양쪽에서 제외한다.
export function mergeRankingTeammates(
  currentUserId: string | null,
  walletLeaderboard: readonly { userId: string; name: string; lifetimeEarnedPoints: number }[],
  directoryUsers: readonly { id: string; name: string }[],
): RankingTeammate[] {
  const seen = new Set<string>();
  const result: RankingTeammate[] = [];
  for (const entry of walletLeaderboard) {
    if (entry.userId === currentUserId || seen.has(entry.userId)) continue;
    seen.add(entry.userId);
    result.push({ id: entry.userId, name: entry.name, lifetimeEarnedPoints: entry.lifetimeEarnedPoints });
  }
  for (const user of directoryUsers) {
    if (user.id === currentUserId || seen.has(user.id)) continue;
    seen.add(user.id);
    result.push({ id: user.id, name: user.name, lifetimeEarnedPoints: null });
  }
  return result;
}

interface RankingSeed {
  id: string;
  name: string;
  points: number | null;
  isCurrentUser: boolean;
}

// 적립 포인트가 있는 사람은 포인트 내림차순(동점은 id 순), 아직 지갑이 없는 사람은
// 최하단에 이름순으로 이어 붙인다. null 이 comparator 에 섞이면 NaN 정렬이 되므로 분리한다.
function rankEntries(seeds: readonly RankingSeed[]): PointRankingEntry[] {
  const scored = seeds
    .filter((seed) => seed.points !== null)
    .sort((left, right) => (right.points as number) - (left.points as number) || collator.compare(left.id, right.id));
  const unscored = seeds
    .filter((seed) => seed.points === null)
    .sort((left, right) => collator.compare(left.name, right.name));
  return [
    ...scored.map((seed, index) => ({ ...seed, rank: index + 1 })),
    ...unscored.map((seed) => ({ ...seed, rank: null })),
  ];
}

export function buildPointRanking(
  user: {
    id: string;
    name: string;
    walletPoints: number | null;
    lifetimeEarnedPoints: number | null;
  },
  teammates: readonly RankingTeammate[],
): PointRankingModel {
  const balanceLabel = user.walletPoints === null
    ? '— P'
    : `${user.walletPoints.toLocaleString('ko-KR')} P`;

  const entries = rankEntries([
    ...teammates.map((teammate) => ({
      id: teammate.id,
      name: teammate.name,
      points: teammate.lifetimeEarnedPoints,
      isCurrentUser: false,
    })),
    { id: user.id, name: user.name, points: user.lifetimeEarnedPoints, isCurrentUser: true },
  ]);
  const current = entries.find((entry) => entry.isCurrentUser)!;

  if (user.lifetimeEarnedPoints === null) {
    return {
      status: 'unavailable',
      entries,
      current,
      balanceLabel,
      rankLabel: '순위 계산 중',
      statusText: '순위 계산 중',
    };
  }

  const currentRank = current.rank!;
  const previous = currentRank === 1 ? null : entries[currentRank - 2];
  const tied = entries.some((entry) => !entry.isCurrentUser && entry.points === current.points);
  const statusText = currentRank === 1
    ? '현재 포인트 1위예요'
    : tied
      ? '동점이에요 · 이름순으로 표시 중'
      : `앞 순위까지 ${((previous!.points as number) - (current.points as number)).toLocaleString('ko-KR')}P 남았어요`;
  return {
    status: 'ready',
    entries,
    current,
    balanceLabel,
    rankLabel: `#${currentRank}`,
    statusText,
  };
}
