import { Shuffle } from 'lucide-react';

import type { PlaygroundGameDefinition } from '@/features/playground/catalog';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { PlaygroundGameArt } from './PlaygroundGameArt';
import { pointFromButtonActivation } from './playgroundActivation';

export interface PlaygroundRecommendationHeroProps {
  game: PlaygroundGameDefinition;
  onPlay: (origin: Point) => void;
  onShuffle: () => void;
}

export function PlaygroundRecommendationHero({
  game,
  onPlay,
  onShuffle,
}: PlaygroundRecommendationHeroProps) {
  return (
    <section
      className={`pg-hero pg-tone--${game.tone}`}
      data-pg-hero
      aria-labelledby="pg-hero-title"
    >
      <div className="pg-hero__copy">
        <span className="pg-tag pg-tag--live">RANDOM PICK</span>
        <h3 id="pg-hero-title">
          <span>{game.heroTitle[0]}</span>
          <span>{game.heroTitle[1]}</span>
        </h3>
        <p>{game.heroMeta}<br />{game.heroReward}</p>
        <div className="pg-hero__actions">
          <button
            type="button"
            className="pg-hero__play"
            onClick={(event) => onPlay(pointFromButtonActivation(event))}
          >
            바로 플레이
          </button>
          <button type="button" className="pg-hero__shuffle" onClick={onShuffle}>
            <Shuffle aria-hidden="true" size={14} />
            다른 추천
          </button>
        </div>
        <span className="sr-only" aria-live="polite">현재 추천 {game.koName}</span>
      </div>
      <PlaygroundGameArt game={game.id} variant="hero" />
    </section>
  );
}
