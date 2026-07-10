import { useState, type MouseEvent } from 'react';
import { Building2, Gamepad2, Landmark, Puzzle, Route } from 'lucide-react';

import { pickRecommendation } from '@/features/playground/recommendation';
import type { PlaygroundAction } from '@/features/playground/routes';
import { originFromActivation, type Point } from '@/features/playground/transition/dotWipeMath';

const GAME_ITEMS = [
  { id: 'market', label: 'JBBJ 증권', description: '포인트로 천천히 투자 흐름을 익혀요' },
  { id: 'tetris', label: '테트리스', description: '블록을 쌓고 점수를 모아요' },
  { id: 'sudoku', label: '스도쿠', description: '차분하게 숫자 퍼즐을 풀어요' },
  { id: 'snake', label: '스네이크', description: '꼬리를 늘리며 기록에 도전해요' },
] as const;

type GameItem = (typeof GAME_ITEMS)[number];

const GAME_ICONS = {
  market: Landmark,
  tetris: Gamepad2,
  sudoku: Puzzle,
  snake: Route,
} as const;

interface PlaygroundLobbyProps {
  onMove(action: PlaygroundAction, origin?: Point): void;
}

function actionFor(item: GameItem): PlaygroundAction {
  return item.id === 'market'
    ? { kind: 'open-market' }
    : { kind: 'open-game', game: item.id };
}

function activationOrigin(event: MouseEvent<HTMLButtonElement>): Point {
  return originFromActivation(
    event.clientX,
    event.clientY,
    event.detail,
    event.currentTarget.getBoundingClientRect(),
  );
}

export function PlaygroundLobby({ onMove }: PlaygroundLobbyProps) {
  const [recommendation] = useState(() => pickRecommendation(GAME_ITEMS));
  const RecommendationIcon = GAME_ICONS[recommendation.id];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-8 sm:px-8 lg:py-12">
        <header className="text-center">
          <p className="text-sm font-semibold tracking-[0.16em] text-text-secondary">BREAK TIME</p>
          <h2
            id="playground-lobby-title"
            tabIndex={-1}
            className="mt-3 text-3xl font-bold tracking-tight text-text-primary outline-none sm:text-4xl"
          >
            지금은 쉬는 시간!
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-text-secondary">
            가볍게 머리를 식히고, 오늘의 포인트 놀이터를 둘러보세요.
          </p>
        </header>

        <section className="mx-auto mt-9 w-full max-w-2xl" aria-labelledby="recommendation-heading">
          <p id="recommendation-heading" className="text-center text-sm font-semibold text-text-secondary">
            오늘의 추천
          </p>
          <button
            type="button"
            onClick={(event) => onMove(actionFor(recommendation), activationOrigin(event))}
            className="group mt-3 flex min-h-44 w-full min-w-0 cursor-pointer flex-col items-center justify-center whitespace-normal rounded-3xl border border-accent/35 bg-accent/10 px-6 py-8 text-center shadow-lg transition-colors duration-200 hover:border-accent/70 hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/30 bg-bg-card text-accent-sub">
              <RecommendationIcon aria-hidden="true" size={28} />
            </span>
            <span className="mt-4 text-2xl font-bold text-text-primary">{recommendation.label}</span>
            <span className="mt-2 text-sm leading-6 text-text-secondary">{recommendation.description}</span>
          </button>
        </section>

        <section className="mt-9" aria-labelledby="playground-games-heading">
          <h3 id="playground-games-heading" className="text-base font-semibold text-text-primary">
            골라서 시작하기
          </h3>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {GAME_ITEMS.map((item) => {
              const Icon = GAME_ICONS[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={(event) => onMove(actionFor(item), activationOrigin(event))}
                  className="flex min-h-36 min-w-0 cursor-pointer flex-col items-start whitespace-normal rounded-2xl border border-bg-border bg-bg-card p-5 text-left transition-colors duration-200 hover:border-accent/60 hover:bg-bg-border/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
                >
                  <Icon aria-hidden="true" size={24} className="text-accent-sub" />
                  <span className="mt-5 text-lg font-semibold text-text-primary">{item.label}</span>
                  <span className="mt-1 text-sm leading-6 text-text-secondary">{item.description}</span>
                </button>
              );
            })}
          </div>
        </section>

        <button
          type="button"
          onClick={(event) => onMove({ kind: 'open-house' }, activationOrigin(event))}
          className="mt-5 flex min-h-14 w-full cursor-pointer items-center justify-center gap-3 rounded-2xl border border-bg-border bg-bg-card px-5 py-3 text-base font-semibold text-text-primary transition-colors duration-200 hover:border-accent/60 hover:bg-bg-border/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
        >
          <Building2 aria-hidden="true" size={20} className="text-accent-sub" />
          JBBJ 하우스 둘러보기
        </button>
      </div>
    </div>
  );
}
