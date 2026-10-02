import { useEffect, useRef } from 'react';
import { SlidingIndicator } from '@/components/ui/SlidingIndicator';
import { revealInList } from '@/utils/slidingIndicator';

interface MentionUser { id: string; name: string }

interface Props {
  items: readonly MentionUser[];
  index: number;
  onPick: (name: string) => void;
  /** 컨테이너 좌우 위치 클래스 — 입력창마다 offset 이 달라 호출 측이 지정 */
  positionClassName?: string;
}

/**
 * @멘션 자동완성 드롭다운(공통). 위치는 호출 측이 positionClassName 으로 제어.
 * 활성 항목 스크롤은 내부에서 처리(드롭다운 UI 책임 응집).
 * z-40: 입력 영역의 다른 오버레이(예: CommentPanel 드래그 오버레이 z-20) 위에 확실히 표시.
 */
export function MentionDropdown({ items, index, onPick, positionClassName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 고른 줄이 보이게 드롭다운 상자 하나만 즉시 스크롤한다(브라우저 기본 '보이게 스크롤'은 바깥 상자까지 움직인다).
  useEffect(() => {
    const container = containerRef.current;
    revealInList(container, container?.querySelectorAll('button')[index]);
  }, [index]);

  return (
    <div
      ref={containerRef}
      className={`absolute bottom-full mb-1 max-h-32 overflow-y-auto rounded-lg border border-bg-border bg-bg-card shadow-lg z-40 ${
        positionClassName ?? 'left-0 right-0'
      }`}
    >
      {/* 강조 막대 하나가 ↑↓ 를 0.12초 만에 따라간다(움직임 폴리싱 7번). 후보가 바뀌면 바로 놓인다. */}
      <SlidingIndicator
        activeKey={items.length > 0 ? index : null}
        axis="y"
        timing="list"
        resetKey={items.map((user) => user.id).join('|')}
        deps={[items]}
        className="left-0 right-0 bg-accent/15"
      />
      {items.map((user, i) => (
        <button
          key={user.id}
          data-slide-key={i}
          type="button"
          // onMouseDown + preventDefault: input blur 전에 실행돼 caret/포커스 race 방지
          onMouseDown={(e) => { e.preventDefault(); onPick(user.name); }}
          className={`relative w-full text-left px-3 py-1.5 text-xs text-text-primary transition-colors flex items-center gap-2 cursor-pointer ${
            i === index ? '' : 'hover:bg-accent/10'
          }`}
        >
          <span className="text-accent text-[11px]">@</span>
          <span>{user.name}</span>
        </button>
      ))}
    </div>
  );
}
