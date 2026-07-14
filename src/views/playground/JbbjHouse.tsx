import { Landmark } from 'lucide-react';

import {
  GAME_DEFINITIONS,
  HOUSE_DOCK_ENTRIES,
  type PlaygroundDockEntry,
} from '@/features/playground/catalog';
import type { PointRankingEntry, PointRankingModel } from '@/features/playground/ranking';
import type { PreviewGame } from '@/features/playground/routes';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { PlaygroundGameArt } from './PlaygroundGameArt';
import { pointFromButtonActivation } from './playgroundActivation';

export interface JbbjHouseProps {
  ranking: PointRankingModel;
  onPlayGame: (game: PreviewGame, origin: Point) => void;
  onOpenMarket: (origin: Point) => void;
}

export function JbbjHouse({ ranking, onPlayGame, onOpenMarket }: JbbjHouseProps) {
  const rankedPodium = ranking.entries
    .filter((entry) => entry.points !== null)
    .slice(0, 3);
  const podium = [rankedPodium[1], rankedPodium[0], rankedPodium[2]]
    .filter((entry): entry is PointRankingEntry => entry !== undefined);

  const activate = (entry: PlaygroundDockEntry, origin: Point) => {
    if (entry.kind === 'game') {
      onPlayGame(entry.gameId, origin);
      return;
    }
    if (entry.kind === 'market') onOpenMarket(origin);
  };

  return (
    <section className="pg-house" data-pg-house>
      <header className="pg-house__intro">
        <div>
          <small>WELCOME TO JBBJ HOUSE</small>
          <h3>지금, 네 명이 놀고 있어요.</h3>
        </div>
        <span className="pg-house__online">
          <i className="pg-online-dot" aria-hidden="true" />
          4 PLAYERS ONLINE
        </span>
      </header>

      <div className="pg-house__grid">
        <article className="pg-challenge" data-pg-challenge>
          <span className="pg-tag pg-tag--live">TEAM CHALLENGE</span>
          <h3>오늘 안에 테트리스<br />합계 100,000점</h3>
          <p>
            팀원들의 기록을 합쳐 목표를 달성하면 참여자 전원에게
            60 포인트를 지급합니다.
          </p>
          <span className="pg-challenge__preview">프리뷰 챌린지</span>
          <div className="pg-challenge__progress">
            <span>현재 68,400점</span>
            <span>68%</span>
          </div>
          <div
            className="pg-challenge__track"
            role="progressbar"
            aria-label="프리뷰 챌린지 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={68}
          >
            <i />
          </div>
        </article>

        <aside className="pg-podium" data-pg-podium aria-label="포인트 명예의 전당">
          <h3>포인트 명예의 전당</h3>
          <ol>
            {podium.map((entry) => (
              <li key={entry.id} className={entry.rank === 1 ? 'is-first' : ''}>
                <span className="sr-only">{entry.rank}위</span>
                <span aria-hidden="true">{entry.name.slice(0, 1)}</span>
                <b>{entry.name}</b>
                <small>{entry.points!.toLocaleString('ko-KR')} P</small>
              </li>
            ))}
          </ol>
          <div className="pg-podium__me">
            <b>
              {ranking.current.rank === null
                ? '—'
                : String(ranking.current.rank).padStart(2, '0')}
            </b>
            <span>{ranking.current.name} · 나</span>
            <span>
              {ranking.current.points === null
                ? '— P'
                : `${ranking.current.points.toLocaleString('ko-KR')} P`}
            </span>
          </div>
        </aside>
      </div>

      <div className="pg-house__dock" aria-label="JBBJ 하우스 게임 도크">
        {HOUSE_DOCK_ENTRIES.map((entry) => {
          const key = entry.kind === 'game' ? entry.gameId : entry.id;

          if (entry.kind === 'disabled') {
            return (
              <div
                key={key}
                data-pg-dock-entry
                className="pg-dock is-disabled"
                aria-disabled="true"
              >
                <span className="pg-dock__icon" aria-hidden="true">777</span>
                <span>
                  <b>{entry.label}</b>
                  <small>{entry.status}</small>
                </span>
              </div>
            );
          }

          const game = entry.kind === 'game' ? GAME_DEFINITIONS[entry.gameId] : null;
          const label = entry.kind === 'game' ? game!.koName : entry.label;
          // 구현된 게임(스네이크)은 '바로 플레이', 아직 준비 중인 게임은 '플레이 준비 중'.
          const status = entry.kind === 'game'
            ? (entry.gameId === 'snake' ? '바로 플레이' : '플레이 준비 중')
            : '시장 열기';

          return (
            <button
              key={key}
              type="button"
              data-pg-dock-entry
              className="pg-dock"
              onClick={(event) => activate(entry, pointFromButtonActivation(event))}
            >
              <span className="pg-dock__icon">
                {game
                  ? <PlaygroundGameArt game={game.id} variant="icon" />
                  : <Landmark aria-hidden="true" size={21} />}
              </span>
              <span>
                <b>{label}</b>
                <small>{status}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
