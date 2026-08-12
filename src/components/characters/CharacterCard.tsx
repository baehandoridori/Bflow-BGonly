import { memo, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react';
import type { Character, CharacterCostume } from '@/types';
import { CharacterImageFrame } from '@/components/characters/CharacterImageFrame';
import { DESIGN_STAGE_META, RIGGING_STAGE_META, characterStageColor } from '@/constants/characterStages';
import { applyDragGhost } from '@/utils/dragGhost';
import { cn } from '@/utils/cn';
import { useCostumeEditingPresence, useCostumeCollisionWarn } from '@/stores/useEditingPresenceStore';
import { editingBeamClass } from '@/utils/editingPresence';
import { EditingNameLabels } from '@/components/scenes/EditingNameLabels';

// 복장 없는 캐릭터에 매 렌더 새 [] 를 만들면 memo 비교가 항상 실패한다 — 안정 참조 하나를 공유 (CQ-6).
export const EMPTY_COSTUMES: CharacterCostume[] = [];

// React.memo (CQ-6): store 가 미변경 캐릭터의 character/costumes 참조를 유지하므로(rebuildByCharacter 구조적 공유)
//   콜백을 id 인자 안정 참조로 받으면 복장 하나 변경 시 다른 카드가 리렌더되지 않는다.
export const CharacterCard = memo(function CharacterCard({
  character,
  costumes,
  onOpen,
  onContextMenu,
  imageHeightPx,
  referenceUnset,
  compact,
  onDragStartCard,
  onDragOverCard,
  onDropCard,
  onDragEndCard,
  dragging,
  dropTarget,
  dropEdge,
}: {
  character: Character;
  costumes: CharacterCostume[];
  onOpen: (characterId: string, costumeId?: string) => void;
  onContextMenu: (characterId: string, event: ReactMouseEvent<HTMLButtonElement>, costumeId?: string) => void;
  /** '키 비교 보기' 모드에서만 지정 — 이미지 박스 높이(px). 있으면 카드가 이 높이로 표시(너비는 3:4 종속). (T2-3) */
  imageHeightPx?: number;
  /** 키 비교 보기 모드인데 이 캐릭터의 기준 키가 미설정이면 true → 배지 표시. */
  referenceUnset?: boolean;
  /** 이미지 없는 카드 보기 (피드백 40) — 이미지 박스를 생략하고 텍스트 정보만 그린다. */
  compact?: boolean;
  // 카드 드래그 재배치(F29) — 전부 optional(드래그 비활성 화면에서는 미전달). 콜백은 id 인자 안정 참조(CQ-6).
  onDragStartCard?: (characterId: string) => void;
  onDragOverCard?: (characterId: string) => void;
  onDropCard?: (characterId: string) => void;
  onDragEndCard?: () => void;
  /** 이 카드가 드래그 중. */
  dragging?: boolean;
  /** 이 카드가 현재 드롭 대상(시각 강조). */
  dropTarget?: boolean;
  /** 드래그 중 이 카드의 어느 쪽에 삽입선을 그릴지 — 대상이 아니면 null. */
  dropEdge?: 'before' | 'after' | null;
}) {
  const designDone = costumes.filter((c) => c.designStage === 'done').length;
  const riggingDone = costumes.filter((c) => c.riggingStage === 'done').length;
  // 피드백 54: 이 캐릭터의 복장 파일을 누가 열어놨나 — 복장 uuid 유니온(씬 통합 카드의 BG/ACT 유니온과 동일 패턴).
  const presenceEditors = useCostumeEditingPresence(costumes.map((c) => c.id));
  const presenceWarn = useCostumeCollisionWarn(costumes.map((c) => c.id));

  // B8→피드백 53: 이미지 있는 복장을 좌/우 버튼으로 순환 미리보기. 전환한 복장은 클릭/우클릭에도 그대로 이어진다.
  // (원래 휠로 넘겼으나 preventDefault 가 페이지 스크롤을 하이재킹해 카드가 많은 화면에서 충돌 — 버튼으로 교체.)
  const imaged = costumes.filter((c) => c.featuredImageUrl);
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => { if (activeIdx >= imaged.length) setActiveIdx(0); }, [imaged.length, activeIdx]);
  const shown = imaged[activeIdx] ?? imaged[0] ?? null;

  const stepCostume = (dir: 1 | -1) => {
    setActiveIdx((i) => {
      const count = imaged.length;
      if (count <= 1) return i;
      return ((i + dir) % count + count) % count;
    });
  };

  return (
    <button
      type="button"
      draggable={!!onDragStartCard}
      onDragStart={onDragStartCard ? (e) => {
        e.dataTransfer.effectAllowed = 'move';
        applyDragGhost(e.dataTransfer, { label: character.name, imageUrl: shown?.featuredImageUrl });
        onDragStartCard(character.id);
      } : undefined}
      onDragOver={onDropCard ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOverCard?.(character.id); } : undefined}
      onDrop={onDropCard ? (e) => { e.preventDefault(); onDropCard(character.id); } : undefined}
      onDragEnd={onDragEndCard}
      onClick={() => onOpen(character.id, shown?.id)}
      onContextMenu={(event) => onContextMenu(character.id, event, shown?.id)}
      style={{ ...(imageHeightPx ? { width: Math.round(imageHeightPx * 3 / 4) } : null), overflow: 'visible' }}
      className={cn(
        'group relative text-left bg-bg-card border border-bg-border rounded-xl hover:border-accent/50 flex flex-col cursor-pointer',
        // 실시간 편집 프레즌스 — 회전 무지개 테두리(래퍼 없이 클래스만, 복장 유니온). 씬 카드와 동일 패턴.
        editingBeamClass(presenceEditors.length > 0, presenceWarn),
        'transition-[transform,opacity,border-color] duration-200 ease-out motion-reduce:transition-none',
        // 드래그 중 소스는 살짝 작아지며 흐려져 "고스트로 들려 나갔다"는 느낌을 준다.
        dragging ? 'opacity-30 scale-[0.97] motion-reduce:scale-100' : 'scale-100',
        dropTarget && !dragging && 'border-accent/60',
      )}
    >
      {/* 실시간 편집 프레즌스 — 무지개 이름표(좌상단, 씬 카드와 동일 위치). */}
      <EditingNameLabels editors={presenceEditors} className="absolute -top-3 left-3 z-20" />
      {dropEdge && !dragging && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-2 bottom-2 z-[3] w-[3px] rounded-full bg-accent',
            'shadow-[0_0_10px_1px_rgb(var(--color-accent)/0.7)] animate-pulse motion-reduce:animate-none',
            dropEdge === 'before' ? '-left-[9px]' : '-right-[9px]',
          )}
        />
      )}
      {!compact && (
        <div style={imageHeightPx ? { height: imageHeightPx } : undefined} className="relative aspect-[3/4] bg-bg-border/30 flex items-center justify-center overflow-hidden rounded-t-xl">
          {shown ? (
            <CharacterImageFrame
              url={shown.featuredImageUrl}
              alt={character.name}
              background={shown.imageBackground}
              fit={shown.imageFit}
              className="w-full h-full"
            />
          ) : (
            <ImageIcon size={28} className="text-text-secondary/40" />
          )}
          {/* 피드백 53: 복장 넘김 좌/우 버튼 — 카드 루트가 <button> 이라 중첩 불가 → span[role=button]. hover 시에만 표시. */}
          {imaged.length > 1 && (
            <>
              <span
                role="button"
                aria-label="이전 복장"
                draggable={false}
                onClick={(e) => { e.stopPropagation(); stepCostume(-1); }}
                className="absolute left-1 top-1/2 z-[2] flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white/90 opacity-0 transition-opacity duration-150 hover:bg-black/65 group-hover:opacity-100 motion-reduce:transition-none cursor-pointer"
              >
                <ChevronLeft size={14} />
              </span>
              <span
                role="button"
                aria-label="다음 복장"
                draggable={false}
                onClick={(e) => { e.stopPropagation(); stepCostume(1); }}
                className="absolute right-1 top-1/2 z-[2] flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white/90 opacity-0 transition-opacity duration-150 hover:bg-black/65 group-hover:opacity-100 motion-reduce:transition-none cursor-pointer"
              >
                <ChevronRight size={14} />
              </span>
            </>
          )}
          {imaged.length > 1 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-1.5 flex items-center justify-center gap-1" aria-hidden="true">
              {imaged.map((c, i) => (
                <span
                  key={c.id}
                  className="h-1.5 w-1.5 rounded-full transition-colors duration-150"
                  style={{ backgroundColor: i === activeIdx ? 'rgb(var(--color-accent))' : 'rgba(255,255,255,0.4)' }}
                />
              ))}
            </div>
          )}
          {referenceUnset && (
            <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/80">키 미설정</span>
          )}
        </div>
      )}
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
