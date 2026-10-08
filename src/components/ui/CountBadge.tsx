import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useMotionPref } from '@/hooks/useMotionPref';
import { EASE_CSS, animateEl } from '@/utils/motion';
import {
  BADGE_EXIT_MS,
  BADGE_EXIT_TRANSFORM,
  BADGE_POP_KEYFRAMES,
  BADGE_POP_TIMING,
  shouldPopBadge,
} from '@/utils/slidingIndicator';

interface CountBadgeProps {
  count: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/**
 * 숫자 배지 (움직임 폴리싱 7번). 숫자가 늘면 1→1.25→1 로 '톡'(220ms), 0 이 되면 작게 줄며 사라진다(120ms).
 * 움직임은 WAAPI transform·opacity 만. '동작 줄이기'면 숫자만 바뀌고 0 이면 바로 사라진다.
 * 처음 그릴 때는 톡 하지 않는다(앱을 켤 때마다 배지가 튀지 않게).
 */
export const CountBadge = memo(function CountBadge({ count, className, style, title }: CountBadgeProps) {
  const { reduce } = useMotionPref();
  const ref = useRef<HTMLSpanElement>(null);
  const previousRef = useRef<number | null>(null);
  const lastShownRef = useRef(count);
  if (count > 0) lastShownRef.current = count;

  // 0 이 되는 순간을 렌더 단계에서 잡아 마지막 숫자를 한 번 더 그린다(사라지는 움직임을 걸 요소가 있어야 한다).
  const [renderedCount, setRenderedCount] = useState(count);
  const [leaving, setLeaving] = useState(false);
  if (renderedCount !== count) {
    setRenderedCount(count);
    setLeaving(count <= 0 && renderedCount > 0 && !reduce);
  }

  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = count;
    if (!reduce && shouldPopBadge(previous, count)) {
      animateEl(ref.current, BADGE_POP_KEYFRAMES, { ...BADGE_POP_TIMING }, false);
    }
  }, [count, reduce]);

  useLayoutEffect(() => {
    if (!leaving) return undefined;
    const animation = animateEl(
      ref.current,
      [
        { opacity: 1, transform: BADGE_EXIT_TRANSFORM[0] },
        { opacity: 0, transform: BADGE_EXIT_TRANSFORM[1] },
      ],
      { duration: BADGE_EXIT_MS, easing: EASE_CSS.in, fill: 'forwards' },
      false,
    );
    if (!animation) {
      setLeaving(false);
      return undefined;
    }
    animation.onfinish = () => setLeaving(false);
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, [leaving]);

  const shown = count > 0 ? count : leaving ? lastShownRef.current : 0;
  if (shown <= 0) return null;
  return (
    <span ref={ref} className={className} style={style} title={title}>
      {shown}
    </span>
  );
});
