import { useEffect, useRef } from 'react';
import { SlidingIndicator } from '@/components/ui/SlidingIndicator';
import { revealInList } from '@/utils/slidingIndicator';
import { Image, Layers, Clapperboard, Shirt } from 'lucide-react';
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

  // 고른 줄이 보이게 드롭다운 상자 하나만 즉시 스크롤한다(브라우저 기본 '보이게 스크롤'은 바깥 상자까지 움직인다).
  useEffect(() => {
    const container = containerRef.current;
    revealInList(container, container?.querySelectorAll('button')[index]);
  }, [index]);

  return (
    <div
      ref={containerRef}
      className={`absolute bottom-full mb-1 max-h-40 overflow-y-auto rounded-lg border border-bg-border bg-bg-card shadow-lg z-40 ${
        positionClassName ?? 'left-0 right-0'
      }`}
    >
      {/* 강조 막대 하나가 ↑↓ 를 0.12초 만에 따라간다(움직임 폴리싱 7번). 후보가 바뀌면 바로 놓인다. */}
      <SlidingIndicator
        activeKey={items.length > 0 ? index : null}
        axis="y"
        timing="list"
        resetKey={items.map((cand) => `${cand.kind}-${cand.tag.episodeNumber}-${cand.label}`).join('|')}
        deps={[items]}
        className="left-0 right-0 bg-accent/15"
      />
      {items.map((cand, i) => {
        const Icon = cand.kind === 'costume' ? Shirt : cand.kind === 'scene' ? Image : cand.kind === 'part' ? Layers : Clapperboard;
        return (
          <button
            key={`${cand.kind}-${cand.tag.episodeNumber}-${cand.label}-${i}`}
            type="button"
            data-slide-key={i}
            // onMouseDown + preventDefault: input blur 전에 실행돼 caret/포커스 race 방지
            onMouseDown={(e) => { e.preventDefault(); onPick(cand); }}
            className={`relative w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 cursor-pointer ${
              i === index ? '' : 'hover:bg-accent/10'
            }`}
          >
            <Icon size={12} className="text-text-secondary shrink-0" />
            <span className="text-text-primary truncate min-w-0 flex-1">{cand.label}</span>
            <span className="text-text-secondary/60 text-[11px] shrink-0 max-w-[45%] truncate">{cand.context}</span>
          </button>
        );
      })}
    </div>
  );
}
