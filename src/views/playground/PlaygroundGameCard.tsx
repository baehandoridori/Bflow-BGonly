import { TrendingUp } from 'lucide-react';

import {
  GAME_DEFINITIONS,
  type PlaygroundQuickEntry,
} from '@/features/playground/catalog';
import { formatWon } from '@/features/playground/market/format';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { PlaygroundGameArt } from './PlaygroundGameArt';
import { pointFromButtonActivation } from './playgroundActivation';

export interface PlaygroundGameCardProps {
  entry: PlaygroundQuickEntry;
  marketCashWon: number | null;
  onActivate: (entry: PlaygroundQuickEntry, origin: Point) => void;
}

export function PlaygroundGameCard({
  entry,
  marketCashWon,
  onActivate,
}: PlaygroundGameCardProps) {
  const game = entry.kind === 'game' ? GAME_DEFINITIONS[entry.gameId] : null;
  const tone = entry.kind === 'game' ? game!.tone : entry.tone;
  const label = entry.kind === 'game' ? game!.koName : entry.label;
  const badge = entry.kind === 'game' ? game!.quickReward : 'OPEN';
  const detail = entry.kind === 'game'
    ? game!.quickRecord
    : marketCashWon === null
      ? '예수금 확인 중'
      : `예수금 ${formatWon(marketCashWon)}`;

  return (
    <button
      type="button"
      data-pg-quick-card
      className={`pg-quick-card pg-tone--${tone}`}
      onClick={(event) => onActivate(entry, pointFromButtonActivation(event))}
    >
      <span className="pg-quick-card__top">
        <span className="pg-quick-card__icon">
          {game
            ? <PlaygroundGameArt game={game.id} variant="icon" />
            : <TrendingUp aria-hidden="true" size={22} />}
        </span>
        <span className={game ? 'pg-reward' : 'pg-tag pg-tag--open'}>{badge}</span>
      </span>
      <strong>{label}</strong>
      <span>{detail}</span>
    </button>
  );
}
