import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    containerRef.current?.querySelectorAll('button')[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  return (
    <div
      ref={containerRef}
      className={`absolute bottom-full mb-1 max-h-32 overflow-y-auto rounded-lg border border-bg-border bg-bg-card shadow-lg z-40 ${
        positionClassName ?? 'left-0 right-0'
      }`}
    >
      {items.map((user, i) => (
        <button
          key={user.id}
          type="button"
          // onMouseDown + preventDefault: input blur 전에 실행돼 caret/포커스 race 방지
          onMouseDown={(e) => { e.preventDefault(); onPick(user.name); }}
          className={`w-full text-left px-3 py-1.5 text-xs text-text-primary transition-colors flex items-center gap-2 cursor-pointer ${
            i === index ? 'bg-accent/15' : 'hover:bg-accent/10'
          }`}
        >
          <span className="text-accent text-[11px]">@</span>
          <span>{user.name}</span>
        </button>
      ))}
    </div>
  );
}
