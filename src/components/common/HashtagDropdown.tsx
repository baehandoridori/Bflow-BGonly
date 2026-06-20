import { useEffect, useRef } from 'react';
import { Image, Layers, Clapperboard } from 'lucide-react';
import type { HashCandidate } from '@/utils/hashtagCandidates';

interface Props {
  items: readonly HashCandidate[];
  index: number;
  onPick: (cand: HashCandidate) => void;
  /** 입력창마다 offset 이 달라 호출 측이 지정. */
  positionClassName?: string;
}

/**
 * #태그 자동완성 드롭다운(4c). MentionDropdown 패턴 + 종류별 아이콘 + context(중복 구분 'EP01 A').
 */
export function HashtagDropdown({ items, index, onPick, positionClassName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.querySelectorAll('button')[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  return (
    <div
      ref={containerRef}
      className={`absolute bottom-full mb-1 max-h-40 overflow-y-auto rounded-lg border border-bg-border bg-bg-card shadow-lg z-40 ${
        positionClassName ?? 'left-0 right-0'
      }`}
    >
      {items.map((cand, i) => {
        const Icon = cand.kind === 'scene' ? Image : cand.kind === 'part' ? Layers : Clapperboard;
        return (
          <button
            key={`${cand.kind}-${cand.tag.episodeNumber}-${cand.label}-${i}`}
            type="button"
            // onMouseDown + preventDefault: input blur 전에 실행돼 caret/포커스 race 방지
            onMouseDown={(e) => { e.preventDefault(); onPick(cand); }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 cursor-pointer ${
              i === index ? 'bg-accent/15' : 'hover:bg-accent/10'
            }`}
          >
            <Icon size={12} className="text-text-secondary shrink-0" />
            <span className="text-text-primary">{cand.label}</span>
            <span className="text-text-secondary/60 text-[11px] ml-auto shrink-0">{cand.context}</span>
          </button>
        );
      })}
    </div>
  );
}
