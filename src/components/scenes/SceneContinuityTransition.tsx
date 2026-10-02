import { useEffect, useRef, type RefObject } from 'react';
import { continuityStartTransform } from '@/utils/sceneFlip';

import { prefersReducedMotion } from '@/utils/motion';

interface SceneContinuityTransitionProps {
  sourceElement: HTMLElement | null;
  targetRootRef: RefObject<HTMLElement>;
  onComplete?: () => void;
}

const DURATION_MS = 520;
const EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

function readVisibleRect(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return rect;
}

/**
 * 카드 자리에서 창이 커지며 열리는 시작 모습.
 * 움직임 폴리싱 14번: 가로·세로를 따로 늘리면(scale(x, y)) 카드와 창의 비율 차이 때문에 초반 글자가 납작하게
 * 눌려 보였다 → 카드 폭에 맞춘 '균등' 확대 + 위 정렬로 바꾸고, 처음 30% 동안은 투명에서 떠오르게 한다.
 */
function buildStartTransform(sourceRect: DOMRect, targetRect: DOMRect) {
  return continuityStartTransform(sourceRect, targetRect);
}

export function SceneContinuityTransition({
  sourceElement,
  targetRootRef,
  onComplete,
}: SceneContinuityTransitionProps) {
  const completedRef = useRef(false);

  useEffect(() => {
    const targetRoot = targetRootRef.current;
    // 윈도우 동작 줄이기뿐 아니라 설정 › 효과 › 움직임 '최소'도 확대 전환을 건너뛴다(움직임 폴리싱 바탕 B).
    const reduce = prefersReducedMotion();

    if (!sourceElement || !targetRoot || reduce) {
      onComplete?.();
      return;
    }

    let cancelled = false;
    let animation: Animation | null = null;

    const finish = () => {
      if (completedRef.current) return;
      completedRef.current = true;
      onComplete?.();
    };

    const previous = {
      transformOrigin: targetRoot.style.transformOrigin,
      willChange: targetRoot.style.willChange,
      overflow: targetRoot.style.overflow,
      pointerEvents: targetRoot.style.pointerEvents,
    };

    const restore = () => {
      targetRoot.classList.remove('bflow-continuity-live-root');
      sourceElement.classList.remove('bflow-continuity-source-dim');
      targetRoot.style.transformOrigin = previous.transformOrigin;
      targetRoot.style.willChange = previous.willChange;
      targetRoot.style.overflow = previous.overflow;
      targetRoot.style.pointerEvents = previous.pointerEvents;
    };

    const frameId = window.requestAnimationFrame(() => {
      const sourceRect = readVisibleRect(sourceElement);
      const targetRect = readVisibleRect(targetRoot);

      if (!sourceRect || !targetRect) {
        finish();
        return;
      }

      sourceElement.classList.add('bflow-continuity-source-dim');
      targetRoot.classList.add('bflow-continuity-live-root');
      targetRoot.style.transformOrigin = 'top left';
      targetRoot.style.willChange = 'transform, opacity';
      targetRoot.style.overflow = 'hidden';
      targetRoot.style.pointerEvents = 'none';

      // filter 는 매 프레임 다시 그리게 하므로 쓰지 않는다. 끝값은 원래 모습(none)이라 끝난 뒤 transform 이
      // 남지 않는다(fill both 로 identity 행렬이 남으면 창 안 fixed 요소의 기준 상자가 바뀐다).
      animation = targetRoot.animate(
        [
          { transform: buildStartTransform(sourceRect, targetRect), opacity: 0 },
          { opacity: 1, offset: 0.3 },
          { transform: 'none', opacity: 1 },
        ],
        {
          duration: DURATION_MS,
          easing: EASING,
          fill: 'backwards',
        },
      );

      animation.finished
        .then(() => {
          if (cancelled) return;
          restore();
          finish();
        })
        .catch(() => {
          if (cancelled) return;
          restore();
          finish();
        });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      animation?.cancel();
      restore();
    };
  }, [onComplete, sourceElement, targetRootRef]);

  return null;
}
