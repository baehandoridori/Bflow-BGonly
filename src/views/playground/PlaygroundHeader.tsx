import { ArrowLeft, Building2 } from 'lucide-react';

import type { PointRankingModel } from '@/features/playground/ranking';

export interface PlaygroundHeaderProps {
  titleId: string;
  title: string;
  description: string;
  backLabel?: '게임 로비' | 'JBBJ 하우스';
  onBack?: () => void;
  showHouse: boolean;
  onOpenHouse?: () => void;
  ranking: PointRankingModel;
}

export function PlaygroundHeader({
  titleId,
  title,
  description,
  backLabel,
  onBack,
  showHouse,
  onOpenHouse,
  ranking,
}: PlaygroundHeaderProps) {
  return (
    <header className="pg-header" data-pg-header>
      <div className="pg-header__identity">
        {backLabel && onBack && (
          <button type="button" className="pg-header__back" onClick={onBack}>
            <ArrowLeft aria-hidden="true" size={16} />
            <span>{backLabel}</span>
          </button>
        )}
        <div className="pg-header__copy">
          <h2 id={titleId} tabIndex={-1}>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="pg-header__actions">
        {showHouse && onOpenHouse && (
          <button type="button" className="pg-header__house" onClick={onOpenHouse}>
            <span className="pg-online-dot" aria-hidden="true" />
            <Building2 aria-hidden="true" size={16} />
            <strong>JBBJ 하우스</strong>
            <span className="pg-header__online-copy">4명 접속 중</span>
          </button>
        )}
        <div
          className="pg-header__balance"
          aria-label={`현재 보유 포인트 ${ranking.balanceLabel}, ${ranking.rankLabel}`}
        >
          <strong>{ranking.balanceLabel} · {ranking.rankLabel}</strong>
          <span>현재 보유 포인트</span>
        </div>
      </div>
    </header>
  );
}
