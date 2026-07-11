import { ArrowLeft } from 'lucide-react';

import type { PlaygroundGameDefinition } from '@/features/playground/catalog';
import { PlaygroundGameArt } from './PlaygroundGameArt';

export interface ComingSoonGameProps {
  game: PlaygroundGameDefinition;
  returnLabel: '게임 로비' | 'JBBJ 하우스';
  onBack: () => void;
}

export function ComingSoonGame({ game, returnLabel, onBack }: ComingSoonGameProps) {
  return (
    <section
      className={`pg-game-screen pg-tone--${game.tone}`}
      data-pg-game-stage
      aria-label={`${game.koName} 준비 화면`}
    >
      <div className="pg-game-screen__info">
        <small>NOW PREPARING</small>
        <h3>{game.enName}</h3>
        <p>{game.stageReward}</p>
        <span className="pg-tag pg-tag--soon">게임 준비 중</span>
        <button type="button" className="pg-game-screen__back" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={17} />
          {returnLabel}로 돌아가기
        </button>
      </div>
      <div className="pg-game-screen__stage">
        <PlaygroundGameArt game={game.id} variant="stage" />
      </div>
    </section>
  );
}
