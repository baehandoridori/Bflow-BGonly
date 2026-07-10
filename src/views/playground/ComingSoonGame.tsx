import { ArrowLeft, Gamepad2 } from 'lucide-react';

import type { PreviewGame } from '@/features/playground/routes';

const GAME_LABELS: Record<PreviewGame, string> = {
  tetris: '테트리스',
  sudoku: '스도쿠',
  snake: '스네이크',
};

interface ComingSoonGameProps {
  game: PreviewGame;
  onBack(): void;
}

export function ComingSoonGame({ game, onBack }: ComingSoonGameProps) {
  return (
    <div className="flex h-full overflow-y-auto px-5 py-8 sm:px-8">
      <div className="m-auto w-full max-w-xl rounded-3xl border border-bg-border bg-bg-card p-8 text-center shadow-xl sm:p-12">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent-sub">
          <Gamepad2 aria-hidden="true" size={32} />
        </span>
        <p className="mt-7 text-sm font-semibold text-text-secondary">{GAME_LABELS[game]}</p>
        <h2 id="playground-game-title" tabIndex={-1} className="mt-2 text-3xl font-bold text-text-primary outline-none">
          준비 중이에요
        </h2>
        <p className="mx-auto mt-4 max-w-md text-base leading-7 text-text-secondary">
          기록과 보상 규칙을 다듬고 있어요. 조금만 기다려 주세요.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-8 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card"
        >
          <ArrowLeft aria-hidden="true" size={18} />
          놀이터로 돌아가기
        </button>
      </div>
    </div>
  );
}
