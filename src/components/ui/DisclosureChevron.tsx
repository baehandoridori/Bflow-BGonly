import { ChevronRight, type LucideProps } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * 펼침/접힘 화살표 — ▶ 하나를 펼칠 때 90° 돌린다 (움직임 폴리싱 1번 '화살표 통일').
 *
 * 그림을 ▶ / ▼ 로 바꿔 끼우면 새 그림이 들어설 뿐 돌지 않는다('뚝'). 같은 svg 하나를 두고
 * transform 만 0.2초 · 작은 반응 곡선(ease-snap = cubic-bezier(.2,0,0,1))으로 돌린다.
 * 색도 함께 전환해 테마 전환·hover 때 아이콘 색이 끊기지 않게 한다.
 * '동작 줄이기'면 회전 없이 상태만 즉시 바뀐다(motion-reduce:transition-none + 전역 reduce 규칙).
 */
export function DisclosureChevron({ expanded, className, ...props }: LucideProps & { expanded: boolean }) {
  return (
    <ChevronRight
      aria-hidden="true"
      {...props}
      data-expanded={expanded ? 'true' : 'false'}
      className={cn(
        'transition-[transform,color] duration-200 ease-snap motion-reduce:transition-none',
        expanded && 'rotate-90',
        className,
      )}
    />
  );
}
