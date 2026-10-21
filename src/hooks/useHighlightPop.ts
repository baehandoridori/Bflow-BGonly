import { useEffect, type RefObject } from 'react';
import { animateEl, EASE_CSS, prefersReducedMotion } from '@/utils/motion';

/** 카드가 이만큼 화면에 들어와 있어야 띄운다 */
const VISIBLE_RATIO = 0.5;
/** 마지막 스크롤 뒤 이만큼 조용하면 스크롤이 멈춘 것으로 본다 */
const SCROLL_SETTLE_MS = 140;
/** 스크롤이 필요 없을 때 처음 살펴보는 시점 */
const FIRST_CHECK_MS = 180;
/** 스크롤이 끝까지 안 멈춰도 이때는 띄운다 */
const GIVE_UP_MS = 1_600;

/**
 * 검색·알림으로 이동해 강조된 카드를 '잠깐 크게 띄웠다가 제자리로' 돌려놓는다(2026-10-21).
 *
 * 예전에는 카드가 처음 그려질 때(framer initial) 한 번만 커졌다가 줄어서, 부드러운 스크롤로 화면에 들어올 즈음엔
 * 이미 끝나 있었고 테두리 빛도 세 번 깜빡이는 정도라 잘 안 보였다. 이제는 스크롤이 멈추고 카드가 화면에 들어온
 * 뒤에 띄운다. transform 만 쓰고(합성 스레드), 띄우는 동안만 옆 카드 위로 올린다.
 * '동작 줄이기'·'움직임: 최소'면 띄우지 않는다 — 대신 .scene-highlight 의 정적 테두리가 남는다.
 */
export function useHighlightPop(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    let done = false;
    let animation: Animation | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
    const previousZIndex = el.style.zIndex;

    const stopWatching = () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      if (settleTimer) clearTimeout(settleTimer);
      if (giveUpTimer) clearTimeout(giveUpTimer);
    };
    const restoreZIndex = () => { el.style.zIndex = previousZIndex; };

    const play = () => {
      if (done) return;
      done = true;
      stopWatching();
      el.style.zIndex = '30';
      animation = animateEl(el, [
        { transform: 'scale(1)', easing: EASE_CSS.out },
        { transform: 'scale(1.07)', offset: 0.3, easing: EASE_CSS.std },
        { transform: 'scale(1)' },
      ], { duration: 760 });
      if (!animation) { restoreZIndex(); return; }
      animation.onfinish = restoreZIndex;
      animation.oncancel = restoreZIndex;
    };

    const isVisibleEnough = () => {
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) return false;
      const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      return visible / rect.height >= VISIBLE_RATIO;
    };
    const check = () => { if (isVisibleEnough()) play(); };
    function onScroll() {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(check, SCROLL_SETTLE_MS);
    }

    // 스크롤 이벤트는 거품처럼 올라오지 않으므로 캡처로 받는다(어느 목록이 스크롤돼도).
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    settleTimer = setTimeout(check, FIRST_CHECK_MS);
    giveUpTimer = setTimeout(play, GIVE_UP_MS);

    return () => {
      done = true;
      stopWatching();
      animation?.cancel();
      restoreZIndex();
    };
  }, [active, ref]);
}
