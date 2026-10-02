import { memo, type CSSProperties, type ReactNode } from 'react';
import { useMotionPref } from '@/hooks/useMotionPref';
import { useSlidingIndicator, type SlidingIndicatorOptions } from '@/hooks/useSlidingIndicator';
import { cn } from '@/utils/cn';

interface SlidingIndicatorProps extends Omit<SlidingIndicatorOptions, 'reduce'> {
  /** 지금 선택된 항목의 data-slide-key. 없으면(null) 표시를 숨긴다. */
  activeKey: string | number | null | undefined;
  className?: string;
  style?: CSSProperties;
  /** 표시 안에 겹쳐 그릴 층(예: 상태별 색 층 — 색은 층의 opacity 로 바꾼다). */
  children?: ReactNode;
}

/**
 * 앱 공통 '미끄러지는 선택 표시' (움직임 폴리싱 7번 sliding-indicator).
 *
 *   <div className="relative flex …">
 *     <SlidingIndicator activeKey={mode} axis="both" className="rounded-md bg-accent/20" />
 *     {MODES.map((m) => <button key={m} data-slide-key={m} className="relative …">…</button>)}
 *   </div>
 *
 * - 부모(항목들의 공통 조상)는 position: relative 여야 한다. 표시는 항목보다 앞에 두고, 항목은 relative 로
 *   두어 글자가 표시 위에 그려지게 한다(표시는 absolute 라 static 항목보다 위에 칠해진다).
 * - 선택 칸의 배경(bg-…)은 지우고 글자색만 바꾼다 — 배경은 이 표시 하나가 맡는다.
 * - 축: x=가로 탭·밑줄(세로 자리는 className 의 bottom-0·h-0.5 등), y=세로 메뉴·목록(가로 자리는 left-2 right-2 등),
 *   both=칸을 통째로 덮는 알약. 박자: tab(220ms) · rail(260ms) · list(120ms).
 * - '동작 줄이기'면 미끄러짐 없이 바로 놓인다.
 */
export const SlidingIndicator = memo(function SlidingIndicator({ activeKey, className, style, children, axis = 'x', ...options }: SlidingIndicatorProps) {
  const { reduce } = useMotionPref();
  const ref = useSlidingIndicator<HTMLSpanElement>(activeKey, { ...options, axis, reduce });
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-slide-indicator=""
      className={cn('pointer-events-none absolute block', className)}
      style={{
        // 움직이는 축의 기준점은 0 — 자리는 transform 이 맡는다. 나머지 축은 className 이 정한다.
        left: axis === 'y' ? undefined : 0,
        top: axis === 'x' ? undefined : 0,
        transformOrigin: '0 0',
        // 첫 측정 전에는 숨긴다(측정 뒤 훅이 보이게 바꾼다).
        visibility: 'hidden',
        ...style,
      }}
    >
      {children}
    </span>
  );
});

/**
 * 표시 안에 겹쳐 그리는 색 층 — 선택에 따라 색이 다른 알약(상태 필터 등)에 쓴다.
 * 배경색을 애니메이션하지 않고, 미리 칠해 둔 층의 opacity 만 바꾼다(움직임 규칙: 색 변화는 겹친 층의 opacity).
 */
export function SlideToneLayers({ active, tones, className }: { active: string; tones: Record<string, string>; className?: string }) {
  return (
    <>
      {Object.entries(tones).map(([key, tone]) => (
        <span
          key={key}
          className={cn(
            'absolute inset-0 transition-opacity duration-base',
            tone,
            className,
            active === key ? 'opacity-100' : 'opacity-0',
          )}
        />
      ))}
    </>
  );
}
