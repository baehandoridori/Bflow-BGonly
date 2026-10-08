import { useLayoutEffect, useRef, useState } from 'react';
import { useMotionPref } from '@/hooks/useMotionPref';
import {
  CARD_POP_EASE,
  CARD_POP_KEYFRAMES,
  CARD_POP_MS,
  CELEBRATE_GLOW_EASE,
  CELEBRATE_GLOW_KEYFRAMES,
  rectWithin,
  type GlowRect,
} from './celebrateMotion';
import { CELEBRATE_GLOW_MS } from '@/components/ui/confettiMotion';

interface SceneCompletionFxProps {
  /** 방금 내 체크로 씬이 완료됐다(ScenesView 의 축하 대상). */
  celebrating: boolean;
  /** 완료 색 표시를 켤지(설정 '씬 완료 색상 표시' + 완료 상태). */
  tinted: boolean;
}

/**
 * 씬 카드 완료 연출 (움직임 폴리싱 17번). 카드 루트의 첫 자식으로 둔다 — 부모 요소가 곧 카드다.
 *
 * - 초록 틴트: 그라데이션 바탕은 이어 바꿀 수 없어서, 카드 안쪽에 깐 층(z-index -1)의 opacity 를 0.4초 동안 올린다.
 *   (카드 루트 .scene-card-interactive 는 isolation: isolate 로 쌓임 맥락이라, 층은 카드 바탕 위·내용 아래에 그려진다.)
 * - 카드 '톡': 축하가 켜지는 순간 카드에 개별 transform 속성(translate·scale) WAAPI 를 건다.
 *   hover 떠오름(transform)과 더해지므로 덜컹 내려앉지 않는다.
 * - 동작 줄이기: 톡 없이 완료 칸(data-celebrate-cell — PNG 칸·액팅 '완료' 칩, 없으면 카드 테두리)이 한 번 빛난다.
 */
export function SceneCompletionFx({ celebrating, tinted }: SceneCompletionFxProps) {
  const { reduce } = useMotionPref();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const glowLayerRef = useRef<HTMLSpanElement>(null);
  const prevCelebratingRef = useRef(celebrating);
  const [glows, setGlows] = useState<GlowRect[] | null>(null);

  // 켜지는 순간(꺼짐 → 켜짐)만 반응한다. 카드가 축하 도중 다시 마운트돼도 두 번 튀지 않는다.
  useLayoutEffect(() => {
    const was = prevCelebratingRef.current;
    prevCelebratingRef.current = celebrating;
    if (!celebrating || was) return;
    const card = anchorRef.current?.parentElement;
    if (!card || typeof card.animate !== 'function') return;
    if (!reduce) {
      card.animate(CARD_POP_KEYFRAMES, { duration: CARD_POP_MS, easing: CARD_POP_EASE });
      return;
    }
    const cardRect = card.getBoundingClientRect();
    const border = { left: card.clientLeft, top: card.clientTop };
    const cells = Array.from(card.querySelectorAll<HTMLElement>('[data-celebrate-cell="true"]'));
    if (cells.length === 0) {
      setGlows([{ left: 0, top: 0, width: card.clientWidth, height: card.clientHeight, radius: getComputedStyle(card).borderRadius }]);
      return;
    }
    setGlows(cells.map((cell) => rectWithin(cell.getBoundingClientRect(), cardRect, border, getComputedStyle(cell).borderRadius)));
  }, [celebrating, reduce]);

  // 빛 테두리는 WAAPI opacity(.7→0) — 전역 '동작 줄이기' CSS 가 길이를 0 으로 만들지 않는다. 끝나면 지운다.
  useLayoutEffect(() => {
    const layer = glowLayerRef.current;
    if (!glows || !layer) return;
    const animations = Array.from(layer.children, (el) =>
      typeof el.animate === 'function'
        ? el.animate(CELEBRATE_GLOW_KEYFRAMES, { duration: CELEBRATE_GLOW_MS, easing: CELEBRATE_GLOW_EASE })
        : null,
    );
    const timer = window.setTimeout(() => setGlows(null), CELEBRATE_GLOW_MS);
    return () => {
      window.clearTimeout(timer);
      animations.forEach((animation) => animation?.cancel());
    };
  }, [glows]);

  return (
    <>
      <span ref={anchorRef} aria-hidden="true" className="scene-completion-tint-layer" data-on={tinted} />
      {glows && (
        <span ref={glowLayerRef} aria-hidden="true" className="contents">
          {glows.map((glow, index) => (
            <span
              key={index}
              className="scene-celebrate-glow"
              style={{ left: glow.left, top: glow.top, width: glow.width, height: glow.height, borderRadius: glow.radius }}
            />
          ))}
        </span>
      )}
    </>
  );
}
