import { GAME_DEFINITIONS } from '@/features/playground/catalog';
import type { PreviewGame } from '@/features/playground/routes';
import { ComingSoonGame } from '../ComingSoonGame';
import { SnakeStage } from './SnakeStage';
import { TetrisStage } from './TetrisStage';

// 구현된 게임은 전용 스테이지로, 아직 준비 중인 게임(sudoku)은 기존 ComingSoon 으로 분기한다.
export function GameHost({
  game,
  returnLabel,
  onExit,
}: {
  game: PreviewGame;
  returnLabel: '게임 로비' | 'JBBJ 하우스';
  onExit: () => void;
}) {
  if (game === 'snake') {
    return <SnakeStage onExit={onExit} returnLabel={returnLabel} />;
  }
  if (game === 'tetris') {
    return <TetrisStage onExit={onExit} returnLabel={returnLabel} />;
  }
  return <ComingSoonGame game={GAME_DEFINITIONS[game]} returnLabel={returnLabel} onBack={onExit} />;
}
