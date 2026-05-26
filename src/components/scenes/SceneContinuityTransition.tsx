import { useEffect, useRef, type RefObject } from 'react';

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

function buildStartTransform(sourceRect: DOMRect, targetRect: DOMRect) {
  const scaleX = sourceRect.width / Math.max(targetRect.width, 1);
  const scaleY = sourceRect.height / Math.max(targetRect.height, 1);
  const translateX = sourceRect.left - targetRect.left;
  const translateY = sourceRect.top - targetRect.top;

  return `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`;
}

export function SceneContinuityTransition({
  sourceElement,
  targetRootRef,
  onComplete,
}: SceneContinuityTransitionProps) {
  const completedRef = useRef(false);

  useEffect(() => {
    const targetRoot = targetRootRef.current;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!sourceElement || !targetRoot || prefersReducedMotion) {
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
      targetRoot.style.willChange = 'transform, opacity, filter';
      targetRoot.style.overflow = 'hidden';
      targetRoot.style.pointerEvents = 'none';

      animation = targetRoot.animate(
        [
          {
            transform: buildStartTransform(sourceRect, targetRect),
            opacity: 0.94,
            filter: 'saturate(0.88) blur(0.2px)',
          },
          {
            transform: 'translate3d(0, 0, 0) scale(1, 1)',
            opacity: 1,
            filter: 'saturate(1) blur(0px)',
          },
        ],
        {
          duration: DURATION_MS,
          easing: EASING,
          fill: 'both',
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
