import type { PreviewGame } from '@/features/playground/routes';

const TETRIS_HERO = new Set([
  0, 1, 2, 8, 9, 15, 16, 17, 23, 24, 25, 30, 31, 38, 39, 40, 44, 45,
]);
const TETRIS_STAGE = new Set([
  92, 93, 101, 102, 103, 111, 112, 120, 121, 122, 123, 130, 131, 132, 133, 134,
]);
const SUDOKU_NUMBERS = ['4', '7', '2', '6', '1', '9', '8', '3', '5'] as const;
const MERGE_2048_HERO = ['2', '4', '8', '16'] as const;
const MERGE_2048_STAGE = [
  2, 4, 8, 16,
  0, 32, 64, 0,
  0, 128, 256, 512,
  0, 0, 1024, 2048,
] as const;
const SNAKE_SEGMENTS = [
  [18, 54],
  [26, 54],
  [34, 54],
  [42, 54],
  [50, 54],
  [58, 54],
  [58, 46],
  [58, 38],
  [66, 38],
] as const;

export interface PlaygroundGameArtProps {
  game: PreviewGame;
  variant: 'hero' | 'icon' | 'stage';
}

export function PlaygroundGameArt({ game, variant }: PlaygroundGameArtProps) {
  if (variant === 'icon') {
    if (game === 'tetris') {
      return (
        <span className="pg-icon-art pg-icon-art--tetris" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
      );
    }
    if (game === 'snake') {
      return <span className="pg-icon-art pg-icon-art--snake" aria-hidden="true" />;
    }
    if (game === '2048') {
      return (
        <span className="pg-icon-art pg-icon-art--2048" aria-hidden="true">
          {MERGE_2048_HERO.map((value) => <i key={value}>{value}</i>)}
        </span>
      );
    }
    return (
      <span className="pg-icon-art pg-icon-art--sudoku" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
      </span>
    );
  }

  if (variant === 'stage') {
    if (game === 'tetris') {
      return (
        <div className="pg-stage-art pg-stage-art--tetris" aria-hidden="true">
          {Array.from({ length: 140 }, (_, index) => (
            <i key={index} className={TETRIS_STAGE.has(index) ? 'is-on' : ''} />
          ))}
        </div>
      );
    }
    if (game === 'snake') {
      return (
        <div className="pg-stage-art pg-stage-art--snake" aria-hidden="true">
          {SNAKE_SEGMENTS.map(([left, top]) => (
            <i key={`${left}-${top}`} style={{ left: `${left}%`, top: `${top}%` }} />
          ))}
        </div>
      );
    }
    if (game === '2048') {
      return (
        <div className="pg-stage-art pg-stage-art--2048" aria-hidden="true">
          {MERGE_2048_STAGE.map((value, index) => (
            <i key={index} data-value={value}>{value || ''}</i>
          ))}
        </div>
      );
    }
    return (
      <div className="pg-stage-art pg-stage-art--sudoku" aria-hidden="true">
        {Array.from({ length: 81 }, (_, index) => (
          <i key={index} className={index % 4 === 0 ? 'is-given' : ''}>
            {index % 4 === 0 ? SUDOKU_NUMBERS[index % 9] : ''}
          </i>
        ))}
      </div>
    );
  }

  if (game === 'tetris') {
    return (
      <div className="pg-hero-art pg-hero-art--tetris" aria-hidden="true">
        {Array.from({ length: 49 }, (_, index) => (
          <i key={index} className={TETRIS_HERO.has(index) ? 'is-on' : ''} />
        ))}
      </div>
    );
  }
  if (game === 'snake') {
    return <div className="pg-hero-art pg-hero-art--snake" aria-hidden="true" />;
  }
  if (game === '2048') {
    return (
      <div className="pg-hero-art pg-hero-art--2048" aria-hidden="true">
        {MERGE_2048_HERO.map((value) => <i key={value}>{value}</i>)}
      </div>
    );
  }
  return (
    <div className="pg-hero-art pg-hero-art--sudoku" aria-hidden="true">
      {SUDOKU_NUMBERS.map((value) => <i key={value}>{value}</i>)}
    </div>
  );
}
