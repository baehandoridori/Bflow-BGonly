import { memo, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
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
  onOpen: (characterId: string, costumeId?: string) => void;
  onContextMenu: (characterId: string, event: ReactMouseEvent<HTMLButtonElement>, costumeId?: string) => void;
}) {
  const designDone = costumes.filter((c) => c.designStage === 'done').length;
  const riggingDone = costumes.filter((c) => c.riggingStage === 'done').length;

  // B8: 이미지 있는 복장을 카드 위 휠로 순환 미리보기. 전환한 복장은 클릭/우클릭에도 그대로 이어진다.
  const imaged = costumes.filter((c) => c.featuredImageUrl);
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => { if (activeIdx >= imaged.length) setActiveIdx(0); }, [imaged.length, activeIdx]);
  const shown = imaged[activeIdx] ?? imaged[0] ?? null;

  const imageRef = useRef<HTMLDivElement>(null);
  const wheelAccum = useRef(0);
  const lastStepAt = useRef(0);
  useEffect(() => {
    const el = imageRef.current;
    if (!el) return;
    const count = imaged.length;
    // React onWheel 은 passive 라 preventDefault 불가 → native non-passive 로 등록.
    const onWheel = (e: WheelEvent) => {
      if (count <= 1) return; // 1장 이하면 하이재킹 없이 페이지 스크롤 그대로.
      e.preventDefault();
      wheelAccum.current += e.deltaY;
      if (Math.abs(wheelAccum.current) < 40) return; // 작은 델타 누적 — 트랙패드 과도 전환 방지.
      // 관성 스크롤 연타 억제 쿨다운.
      if (e.timeStamp - lastStepAt.current < 120) { wheelAccum.current = 0; return; }
      const dir = wheelAccum.current > 0 ? 1 : -1;
      wheelAccum.current = 0;
      lastStepAt.current = e.timeStamp;
      setActiveIdx((i) => ((i + dir) % count + count) % count);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [imaged.length]);

  return (
    <button
      type="button"
      onClick={() => onOpen(character.id, shown?.id)}
      onContextMenu={(event) => onContextMenu(character.id, event, shown?.id)}
      className="text-left bg-bg-card border border-bg-border rounded-xl overflow-hidden hover:border-accent/50 transition-colors duration-200 flex flex-col cursor-pointer"
    >
      <div ref={imageRef} className="relative aspect-[3/4] bg-bg-border/30 flex items-center justify-center overflow-hidden">
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
