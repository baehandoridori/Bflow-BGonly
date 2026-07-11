import {
  GAME_DEFINITIONS,
  QUICK_ENTRIES,
  type PlaygroundQuickEntry,
} from '@/features/playground/catalog';
import type { PointRankingModel } from '@/features/playground/ranking';
import type { PreviewGame } from '@/features/playground/routes';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { PlaygroundGameCard } from './PlaygroundGameCard';
import { PlaygroundRankingRail } from './PlaygroundRankingRail';
import { PlaygroundRecommendationHero } from './PlaygroundRecommendationHero';

export interface PlaygroundLobbyProps {
  userName: string;
  recommendation: PreviewGame;
  ranking: PointRankingModel;
  marketCashPoints: number | null;
  onShuffle: () => void;
  onPlayGame: (game: PreviewGame, origin: Point) => void;
  onOpenMarket: (origin: Point) => void;
  onOpenHouse: () => void;
}

export function PlaygroundLobby(props: PlaygroundLobbyProps) {
  const activate = (entry: PlaygroundQuickEntry, origin: Point) => {
    if (entry.kind === 'game') props.onPlayGame(entry.gameId, origin);
    else props.onOpenMarket(origin);
  };

  return (
    <div
      className="pg-lobby"
      data-pg-lobby
      role="region"
      aria-label="게임 로비와 JBBJ 하우스"
    >
      <main className="pg-lobby__main">
        <header className="pg-welcome">
          <div>
            <small>PLAY · REST · COMPETE</small>
            <h3>{props.userName}님, 잠깐 놀다 갈까요?</h3>
          </div>
          <span className="pg-rank-pill">
            포인트 랭킹 <b>{props.ranking.rankLabel}</b>
          </span>
        </header>
        <section aria-label="오늘의 추천">
          <PlaygroundRecommendationHero
            game={GAME_DEFINITIONS[props.recommendation]}
            onPlay={(origin) => props.onPlayGame(props.recommendation, origin)}
            onShuffle={props.onShuffle}
          />
        </section>
        <div
          className="pg-quick-grid"
          role="group"
          aria-label="테트리스, 스네이크, 스도쿠, JBBJ 증권 빠른 실행"
        >
          {QUICK_ENTRIES.map((entry) => (
            <PlaygroundGameCard
              key={entry.kind === 'game' ? entry.gameId : entry.id}
              entry={entry}
              marketCashPoints={props.marketCashPoints}
              onActivate={activate}
            />
          ))}
        </div>
      </main>
      <PlaygroundRankingRail ranking={props.ranking} onOpenHouse={props.onOpenHouse} />
    </div>
  );
}
