interface RankingFixture { id: string; name: string; points: number }
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

const TEAMMATES: readonly RankingFixture[] = [
  { id: 'minji', name: '민지', points: 4920 },
  { id: 'doyoon', name: '도윤', points: 3860 },
  { id: 'seoa', name: '서아', points: 2820 },
  { id: 'yujin', name: '유진', points: 2115 },
];
const collator = new Intl.Collator('ko-KR');

export function buildPointRanking(user: {
  id: string;
  name: string;
  points: number | null;
}): PointRankingModel {
  if (user.points === null) {
    const teammates = TEAMMATES.map((entry, index) => ({
      ...entry, rank: index + 1, isCurrentUser: false,
    }));
    const current: PointRankingEntry = {
      ...user, rank: null, isCurrentUser: true,
    };
    return {
      status: 'unavailable', entries: [...teammates, current], current,
      balanceLabel: '— P', rankLabel: '순위 계산 중', statusText: '순위 계산 중',
    };
  }

  const sorted = [
    ...TEAMMATES.map((entry) => ({ ...entry, isCurrentUser: false })),
    { ...user, points: user.points, isCurrentUser: true },
  ].sort((left, right) => (
    right.points - left.points || collator.compare(left.id, right.id)
  ));
  const entries = sorted.map((entry, index) => ({ ...entry, rank: index + 1 }));
  const current = entries.find((entry) => entry.isCurrentUser)!;
  const previous = current.rank === 1 ? null : entries[current.rank - 2];
  const tied = entries.some((entry) => !entry.isCurrentUser && entry.points === current.points);
  const statusText = current.rank === 1
    ? '현재 포인트 1위예요'
    : tied
      ? '동점이에요 · 이름순으로 표시 중'
      : `앞 순위까지 ${(previous!.points! - current.points!).toLocaleString('ko-KR')}P 남았어요`;
  return {
    status: 'ready', entries, current,
    balanceLabel: `${user.points.toLocaleString('ko-KR')} P`,
    rankLabel: `#${current.rank}`,
    statusText,
  };
}
