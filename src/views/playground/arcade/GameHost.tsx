import { GAME_DEFINITIONS } from '@/features/playground/catalog';
import type { PreviewGame } from '@/features/playground/routes';
import { ComingSoonGame } from '../ComingSoonGame';
import { SnakeStage } from './SnakeStage';

// 구현된 게임은 전용 스테이지로, 아직 준비 중인 게임은 기존 ComingSoon 으로 분기한다.
// PR C: snake 구현. tetris 는 PR D 에서 추가되기 전까지 ComingSoon.
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
    return <SnakeStage onExit={onExit} />;
  }
  return <ComingSoonGame game={GAME_DEFINITIONS[game]} returnLabel={returnLabel} onBack={onExit} />;
}
