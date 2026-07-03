import { memo, type MouseEvent as ReactMouseEvent } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { Character, CharacterCostume } from '@/types';
import { CharacterImageFrame } from '@/components/characters/CharacterImageFrame';
import { DESIGN_STAGE_META, RIGGING_STAGE_META, characterStageColor } from '@/constants/characterStages';

// 복장 없는 캐릭터에 매 렌더 새 [] 를 만들면 memo 비교가 항상 실패한다 — 안정 참조 하나를 공유 (CQ-6).
export const EMPTY_COSTUMES: CharacterCostume[] = [];

// React.memo (CQ-6): store 가 미변경 캐릭터의 character/costumes 참조를 유지하므로(rebuildByCharacter 구조적 공유)
//   콜백을 id 인자 안정 참조로 받으면 복장 하나 변경 시 다른 카드가 리렌더되지 않는다.
export const CharacterCard = memo(function CharacterCard({
  character,
  costumes,
  onOpen,
  onContextMenu,
}: {
  character: Character;
  costumes: CharacterCostume[];
  onOpen: (characterId: string) => void;
  onContextMenu: (characterId: string, event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const featured = costumes.find((c) => c.featuredImageUrl) ?? null;
  const designDone = costumes.filter((c) => c.designStage === 'done').length;
  const riggingDone = costumes.filter((c) => c.riggingStage === 'done').length;

  return (
    <button
      type="button"
      onClick={() => onOpen(character.id)}
      onContextMenu={(event) => onContextMenu(character.id, event)}
      className="text-left bg-bg-card border border-bg-border rounded-xl overflow-hidden hover:border-accent/50 transition-colors duration-200 flex flex-col cursor-pointer"
    >
      <div className="aspect-[3/4] bg-bg-border/30 flex items-center justify-center overflow-hidden">
        {featured ? (
          <CharacterImageFrame
            url={featured.featuredImageUrl}
            alt={character.name}
            background={featured.imageBackground}
            fit={featured.imageFit}
            className="w-full h-full"
          />
        ) : (
          <ImageIcon size={28} className="text-text-secondary/40" />
        )}
      </div>
      <div className="p-3 flex flex-col gap-2">
        <div className="font-semibold text-text-primary truncate">{character.name}</div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span>복장 {costumes.length}</span>
          {character.episodeIds.length > 0 && (
            <span className="text-text-secondary">· EP {character.episodeIds.length}</span>
          )}
        </div>
        {costumes.length > 0 ? (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span
              className="px-1.5 py-0.5 rounded-md"
              style={{
                backgroundColor: characterStageColor(DESIGN_STAGE_META.done, 0.14),
                color: characterStageColor(DESIGN_STAGE_META.done),
              }}
            >
              디자인 {designDone}/{costumes.length}
            </span>
            <span
              className="px-1.5 py-0.5 rounded-md"
              style={{
                backgroundColor: characterStageColor(RIGGING_STAGE_META.done, 0.14),
                color: characterStageColor(RIGGING_STAGE_META.done),
              }}
            >
              리깅 {riggingDone}/{costumes.length}
            </span>
          </div>
        ) : (
          <div className="inline-flex self-start rounded-md bg-bg-border/30 px-1.5 py-0.5 text-[11px] text-text-secondary">
            복장을 추가해주세요
          </div>
        )}
      </div>
    </button>
  );
});
