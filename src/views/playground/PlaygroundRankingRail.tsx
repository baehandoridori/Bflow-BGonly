import type { PointRankingModel } from '@/features/playground/ranking';

export interface PlaygroundRankingRailProps {
  ranking: PointRankingModel;
  onOpenHouse: () => void;
}

export function PlaygroundRankingRail({
  ranking,
  onOpenHouse,
}: PlaygroundRankingRailProps) {
  return (
    <aside className="pg-ranking" data-pg-ranking aria-labelledby="pg-ranking-title">
      <div className="pg-ranking__head">
        <h3 id="pg-ranking-title">포인트 랭킹</h3>
        <span>현재 잔액 기준</span>
      </div>
      <div className="pg-wallet">
        <small>MY BALANCE</small>
        <strong>{ranking.balanceLabel}</strong>
        <p>{ranking.statusText}</p>
      </div>
      <ol className="pg-ranking__list">
        {ranking.entries.map((entry) => (
          <li key={entry.id} className={entry.isCurrentUser ? 'is-me' : ''}>
            <b>{entry.rank === null ? '—' : String(entry.rank).padStart(2, '0')}</b>
            <span>{entry.name}{entry.isCurrentUser ? ' · 나' : ''}</span>
            <span>{entry.points === null ? '—' : entry.points.toLocaleString('ko-KR')}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="pg-house-teaser" onClick={onOpenHouse}>
        <span>
          <b>JBBJ 하우스에서 진행 중</b>
          <i className="pg-online-dot" aria-hidden="true" />
        </span>
        <small>테트리스 팀 챌린지 68%<br />현재 4명이 쉬고 있어요.</small>
      </button>
    </aside>
  );
}
