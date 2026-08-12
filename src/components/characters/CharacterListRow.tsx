import { memo, type MouseEvent as ReactMouseEvent } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { Character, CharacterCostume } from '@/types';
import { CharacterImageFrame } from '@/components/characters/CharacterImageFrame';
import { DESIGN_STAGE_META, RIGGING_STAGE_META, characterStageColor } from '@/constants/characterStages';
import { useCostumeEditingPresence, useCostumeCollisionWarn } from '@/stores/useEditingPresenceStore';
import { editingBeamClass } from '@/utils/editingPresence';
import { EditingNameLabels } from '@/components/scenes/EditingNameLabels';
import { cn } from '@/utils/cn';

/** 리스트 보기 행 (피드백 40) — 한 줄에 썸네일·이름·복장/EP 수·단계 요약. 클릭/우클릭 동작은 카드와 동일. */
export const CharacterListRow = memo(function CharacterListRow({
  character,
  costumes,
  onOpen,
  onContextMenu,
}: {
  character: Character;
  costumes: CharacterCostume[];
  onOpen: (characterId: string, costumeId?: string) => void;
  onContextMenu: (characterId: string, event: ReactMouseEvent<HTMLButtonElement>, costumeId?: string) => void;
}) {
  const designDone = costumes.filter((c) => c.designStage === 'done').length;
  const riggingDone = costumes.filter((c) => c.riggingStage === 'done').length;
  const presenceEditors = useCostumeEditingPresence(costumes.map((c) => c.id));
  const presenceWarn = useCostumeCollisionWarn(costumes.map((c) => c.id));
  const shown = costumes.find((c) => c.featuredImageUrl) ?? null;

  return (
    <button
      type="button"
      onClick={() => onOpen(character.id, shown?.id)}
      onContextMenu={(event) => onContextMenu(character.id, event, shown?.id)}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border border-bg-border bg-bg-card px-3 py-2 text-left transition-colors hover:border-accent/50 cursor-pointer',
        // 실시간 편집 프레즌스 — 행 전체 무지개 테두리(복장 유니온).
        editingBeamClass(presenceEditors.length > 0, presenceWarn),
      )}
    >
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-bg-border/30 flex items-center justify-center">
        {shown ? (
          /* fit 은 3:4 크롭 프레임 기준으로 저작된 값이라(CharacterImageFrame 헤더 주석) 1:1 썸네일에는 적용하지 않는다. */
          <CharacterImageFrame
            url={shown.featuredImageUrl}
            alt={character.name}
            background={shown.imageBackground}
            className="w-full h-full"
          />
        ) : (
          <ImageIcon size={16} className="text-text-secondary/40" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-text-primary">{character.name}</div>
        <div className="text-xs text-text-secondary">
          복장 {costumes.length}
          {character.episodeIds.length > 0 ? ` · EP ${character.episodeIds.length}` : ''}
        </div>
      </div>
      {/* 실시간 편집 프레즌스 — 인라인 이름표(씬 시트 행의 셀 내 배치와 동일한 이유: 행 높이가 낮아 절대배치 겹침). */}
      <EditingNameLabels editors={presenceEditors} max={2} className="shrink-0" />
      {costumes.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
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
      )}
    </button>
  );
});
