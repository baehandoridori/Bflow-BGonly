/**
 * 글로벌 툴팁 — title 속성 자동 인터셉트
 *
 * 앱 전체의 [title] 요소에 빠른 말풍선을 띄운다. 이벤트 위임으로 동작하므로 기존 코드 수정 없이 적용된다.
 *
 * 움직임 폴리싱 2번(tooltip-anchor, 2026-10):
 * - 한솔 결정대로 마우스를 따라가되, 자리는 '커서 위 가운데'(위에 자리가 없으면 커서 아래)로 바로잡았다.
 *   예전에는 framer 의 scale 애니메이션이 style.transform 을 덮어 가운데 정렬 이동이 한 번도 적용되지 않았고,
 *   그래서 말풍선 왼쪽 위 모서리가 커서에 붙어 방금 가리킨 버튼을 덮었다.
 * - 위치는 바깥 상자(posRef)가 transform 하나로 맡고, 등장·퇴장(투명도 + 0.92배→1)은 안쪽 상자(boxRef)가 맡는다.
 *   바깥 상자는 화면 왼쪽 위(0,0)에 붙어 있어 폭이 화면 전체 기준으로 정해진다 — 오른쪽 끝에서 폭이 줄어
 *   글자가 몇 자씩 접히던 문제가 없다. 가장자리 8px 안쪽으로 밀어 넣는다.
 * - 마우스가 움직이면 React 상태를 바꾸지 않고 다음 프레임에 transform 만 고친다(앱 전체 재렌더 없음).
 * - 말풍선 크기는 크기 감시(ResizeObserver)로만 안다. 새 글자가 들어오면 이번 프레임 레이아웃이 끝난 뒤(그리기 전)
 *   오는 알림에서 재고 그때 자리 잡고 보인다 — offsetWidth 를 그 자리에서 읽으면 방금 누른 단계 버튼 등으로 바뀐
 *   화면 전체의 레이아웃을 강제로 계산했다(최종 성능 측정 지적). 같은 프레임에 그려지므로 보이는 모습은 같다.
 * - 웜업: 떠 있는 중이거나 숨긴 지 300ms 안에 옆 버튼으로 옮기면 기다림·등장 효과 없이 바로 그 위로
 *   120ms 미끄러져 간다. 미끄러짐은 대상이 바뀌는 순간에만 켠다(상시로 켜 두면 따라가기가 끈적해진다).
 * - 동작 줄이기: 등장·퇴장은 투명도만 100ms, 위치 이동은 즉시.
 * - 헤더처럼 data-tooltip-placement="below" 안쪽 요소는 자리가 있으면 가리킨 버튼 아래에 띄운다
 *   (버튼 아래 끝 + 6px, 가로는 커서를 따라감) — 종 아이콘과 그 빨간 배지를 덮지 않는다.
 *   단, 헤더 막대 안에서 시작하는 버튼만이다. 헤더 안에 붙어 그려지는 알림 창 내용은 평소대로 가리킨 곳 위에 뜬다
 *   (창 높이만큼 긴 너비 조절 손잡이의 말풍선이 커서에서 수백 px 아래 창 바닥에 뜨던 문제).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useMotionPref } from '@/hooks/useMotionPref';
import { animateEl, EASE_CSS, MOTION_MS } from '@/utils/motion';
import { createTooltipWarmth, inBelowTooltipZone, placeFollowTooltip, tooltipTransform } from '@/utils/tooltipPosition';

const SHOW_DELAY = 120;  // ms — 네이티브(~500ms) 대비 훨씬 빠름
const HIDE_DELAY = 60;
/** 등장·퇴장 길이(빠름 박자). */
const POP_MS = MOTION_MS.fast;
/** 동작 줄이기: 투명도만 이 길이로. */
const REDUCED_FADE_MS = 100;
/** 웜업 때 다음 대상 위로 미끄러지는 길이. */
const SLIDE_MS = MOTION_MS.fast;

interface TipState {
  text: string;
  /** 보일 때마다 늘어난다 — 같은 글자로 다시 떠도 자리 잡기를 다시 한다. */
  seq: number;
  /** 웜업으로 뜨는지(기다림·등장 효과 없음). */
  warm: boolean;
}

/** 안쪽 상자 기본 모습. 처음엔 투명 — 보이고 숨는 건 animateEl 과 style.opacity 로 직접 바꾼다(React 재렌더 없음). */
const BOX_STYLE: CSSProperties = {
  opacity: 0,
  color: 'rgb(var(--color-tooltip-text))',
  // 움직이는 말풍선 뒤의 흐림(backdrop-filter)은 움직일 때마다 다시 계산된다. 배경을 거의 불투명하게 해서 대신한다.
  background: 'linear-gradient(135deg, rgb(var(--color-tooltip-bg) / 0.97) 0%, rgb(var(--color-tooltip-bg) / 0.99) 100%)',
  border: '1px solid rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha))',
  boxShadow: `
    0 4px 16px rgb(var(--color-shadow) / var(--shadow-alpha)),
    0 0 0 0.5px rgb(var(--color-glass-highlight) / 0.05) inset,
    0 1px 0 rgb(var(--color-glass-highlight) / 0.06) inset
  `,
};

const HIGHLIGHT_STYLE: CSSProperties = {
  background: 'linear-gradient(180deg, rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) 0%, transparent 100%)',
};

export function GlobalTooltipProvider() {
  const { reduce } = useMotionPref();
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;

  const [tip, setTip] = useState<TipState | null>(null);
  const [warmth] = useState(createTooltipWarmth);

  /** 위치를 맡는 바깥 상자(transform 만). */
  const posRef = useRef<HTMLDivElement | null>(null);
  /** 모양·등장을 맡는 안쪽 상자. 자리 잡기는 이 상자의 실측 크기로 한다. */
  const boxRef = useRef<HTMLDivElement | null>(null);

  /** 안쪽 상자의 실측 크기(테두리 상자) — 크기 감시 알림에서만 갱신한다. */
  const boxSize = useRef<{ width: number; height: number } | null>(null);
  /** 새 글자가 그려진 뒤 크기 감시 알림에서 할 일(자리 잡고 보이기). 숨기면 지운다. */
  const pendingShow = useRef<{ warm: boolean; slide: boolean } | null>(null);
  const sizeObserver = useRef<ResizeObserver | null>(null);
  /** 등장·퇴장 애니메이션 — getAnimations()·계산된 스타일을 읽지 않고(스타일 재계산 강제) 직접 들고 있는다. */
  const popAnimation = useRef<Animation | null>(null);

  const showTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const slideTimer = useRef<ReturnType<typeof setTimeout>>();
  const frame = useRef(0);
  const seq = useRef(0);
  const visible = useRef(false);
  const placedOnce = useRef(false);
  const cursor = useRef({ x: 0, y: 0 });
  const preferBelow = useRef(false);
  /** 아래로 띄우는 영역(헤더)에서 가리킨 버튼의 아래 끝 — 말풍선이 버튼을 덮지 않게 그 아래로 내린다. */
  const targetBottom = useRef<number | undefined>(undefined);
  const currentEl = useRef<HTMLElement | null>(null);
  const originalTitle = useRef<string>('');

  const place = useCallback(() => {
    const pos = posRef.current;
    const box = boxRef.current;
    const size = boxSize.current;
    if (!pos || !box || !size) return;
    const placement = placeFollowTooltip(
      cursor.current,
      size,
      { width: window.innerWidth, height: window.innerHeight },
      { preferBelow: preferBelow.current, targetBottom: targetBottom.current },
    );
    pos.style.transform = tooltipTransform(placement);
    // 커서 쪽 가장자리에서 피어나도록.
    box.style.transformOrigin = placement.below ? '50% 0%' : '50% 100%';
  }, []);

  const reveal = useCallback((warm: boolean) => {
    const box = boxRef.current;
    if (!box) return;
    popAnimation.current?.cancel();
    popAnimation.current = null;
    box.style.opacity = '1';
    visible.current = true;
    if (warm) return;
    const r = reduceRef.current;
    popAnimation.current = animateEl(
      box,
      [{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: r ? REDUCED_FADE_MS : POP_MS, easing: EASE_CSS.snap },
      r,
    );
  }, []);

  const conceal = useCallback(() => {
    // 아직 크기를 재기 전(그리기 전)에 숨기라는 신호가 오면 뜨지 않는다(클릭한 프레임에 말풍선이 뒤늦게 뜨지 않게).
    pendingShow.current = null;
    if (!visible.current) return;
    visible.current = false;
    const box = boxRef.current;
    if (!box) return;
    // 지금 보이는 투명도: 등장 중일 때만 계산된 값을 읽는다. 다 뜬 뒤(대부분)는 인라인 값 그대로 —
    // 누르는 순간(mousedown) 계산된 스타일을 읽으면 화면 전체 스타일 재계산을 강제한다(최종 성능 측정 지적).
    const running = popAnimation.current?.playState === 'running';
    const from = running ? getComputedStyle(box).opacity : (box.style.opacity || '1');
    popAnimation.current?.cancel();
    popAnimation.current = null;
    box.style.opacity = '0';
    const r = reduceRef.current;
    popAnimation.current = animateEl(
      box,
      [{ opacity: from, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.92)' }],
      { duration: r ? REDUCED_FADE_MS : POP_MS, easing: EASE_CSS.snap },
      r,
    );
  }, []);

  const restoreTitle = useCallback(() => {
    if (currentEl.current && originalTitle.current) {
      currentEl.current.setAttribute('title', originalTitle.current);
    }
    currentEl.current = null;
    originalTitle.current = '';
  }, []);

  const show = useCallback((text: string, warm: boolean) => {
    seq.current += 1;
    setTip({ text, seq: seq.current, warm });
  }, []);

  /** 실측 크기로 자리를 잡고 보인다(웜업이면 다음 대상 위로 미끄러져 간다). */
  const settle = useCallback((warm: boolean, slide: boolean) => {
    const pos = posRef.current;
    if (!pos) return;
    clearTimeout(slideTimer.current);
    pos.style.transition = slide ? `transform ${SLIDE_MS}ms ${EASE_CSS.snap}` : '';
    place();
    placedOnce.current = true;
    reveal(warm);
    if (slide) {
      slideTimer.current = setTimeout(() => {
        if (posRef.current) posRef.current.style.transition = '';
      }, SLIDE_MS + 20);
    }
  }, [place, reveal]);

  // 말풍선 크기 감시 — 레이아웃이 끝난 뒤(그리기 전) 알림이 온다. 새 글자를 기다리는 중이면 이때 자리 잡고 보인다.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const border = entries[entries.length - 1]?.borderBoxSize?.[0];
      boxSize.current = border
        ? { width: border.inlineSize, height: border.blockSize }
        : { width: box.offsetWidth, height: box.offsetHeight };
      const pending = pendingShow.current;
      if (!pending) return;
      pendingShow.current = null;
      settle(pending.warm, pending.slide);
    });
    sizeObserver.current = observer;
    observer.observe(box);
    return () => {
      observer.disconnect();
      if (sizeObserver.current === observer) sizeObserver.current = null;
    };
  }, [settle]);

  // 새 글자가 그려졌다 — 크기 감시를 다시 걸어 이번 프레임 레이아웃이 끝난 뒤 알림에서 재고 자리 잡는다.
  useLayoutEffect(() => {
    if (!tip) return;
    const pos = posRef.current;
    const box = boxRef.current;
    if (!pos || !box) return;
    const slide = tip.warm && placedOnce.current && !reduceRef.current;
    const observer = sizeObserver.current;
    if (!observer) {
      // 크기 감시가 없는 환경: 바로 잰다.
      boxSize.current = { width: box.offsetWidth, height: box.offsetHeight };
      settle(tip.warm, slide);
      return;
    }
    pendingShow.current = { warm: tip.warm, slide };
    observer.unobserve(box);
    observer.observe(box);
  }, [tip, settle]);

  useEffect(() => {
    const now = () => performance.now();

    // 대상에서 벗어남 — 잠깐 기다렸다 숨긴다(옆 버튼으로 바로 옮기면 취소되고 웜업으로 이어진다).
    const hide = () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        if (visible.current) warmth.markHidden(now());
        conceal();
        restoreTitle();
      }, HIDE_DELAY);
    };

    // 스크롤·클릭 — 바로 닫고 웜업도 끊는다.
    const dismiss = () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
      warmth.reset();
      conceal();
      restoreTitle();
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest?.('[title]') as HTMLElement | null;
      if (!target) return;

      const title = target.getAttribute('title');
      if (!title?.trim()) return;

      // 이미 같은 요소 → 무시
      if (target === currentEl.current) return;

      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);

      // 이전 요소의 title 복원
      restoreTitle();

      // 네이티브 툴팁 방지: title 제거
      currentEl.current = target;
      originalTitle.current = title;
      target.removeAttribute('title');

      cursor.current = { x: e.clientX, y: e.clientY };
      // 헤더 막대 안의 버튼만 아래로. 헤더 안에 그려지는 알림 창 내용은 막대 아래에서 시작하므로 평소대로 위에.
      const belowZone = target.closest('[data-tooltip-placement="below"]');
      const targetRect = belowZone ? target.getBoundingClientRect() : null;
      preferBelow.current = !!belowZone && !!targetRect
        && inBelowTooltipZone(targetRect.top, belowZone.getBoundingClientRect().bottom);
      targetBottom.current = preferBelow.current && targetRect ? targetRect.bottom : undefined;

      if (visible.current || warmth.isWarm(now())) {
        show(title, true);
        return;
      }
      showTimer.current = setTimeout(() => show(title, false), SHOW_DELAY);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest?.('[title]') as HTMLElement | null;
      const related = (e.relatedTarget as HTMLElement)?.closest?.('[title]') as HTMLElement | null;

      // 같은 title 요소 내에서 이동 → 유지
      if (target && target === related) return;
      // currentEl에서 벗어남
      if (currentEl.current && !currentEl.current.contains(e.relatedTarget as Node)) {
        hide();
      }
    };

    // 한솔 결정: 마우스 따라가는 툴팁 — 상태는 그대로 두고 다음 프레임에 transform 만 고친다.
    const handleMouseMove = (e: MouseEvent) => {
      if (!currentEl.current) return;
      const target = (e.target as HTMLElement)?.closest?.('[title]') as HTMLElement | null;
      // 같은 currentEl 안이거나 자식 요소만 처리
      if (target !== currentEl.current && !currentEl.current.contains(e.target as Node)) return;
      cursor.current = { x: e.clientX, y: e.clientY };
      if (!visible.current || frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (visible.current) place();
      });
    };

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('scroll', dismiss, true);
    document.addEventListener('mousedown', dismiss, true);

    return () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
      clearTimeout(slideTimer.current);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      pendingShow.current = null;
      restoreTitle();
      document.removeEventListener('mouseover', handleMouseOver, true);
      document.removeEventListener('mouseout', handleMouseOut, true);
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('scroll', dismiss, true);
      document.removeEventListener('mousedown', dismiss, true);
    };
  }, [conceal, place, restoreTitle, show, warmth]);

  return (
    // 위치 상자: 화면 왼쪽 위(0,0) 기준 transform 하나로 놓는다. 폭은 화면 전체 기준이라 오른쪽 끝에서도 줄지 않는다.
    <div ref={posRef} className="fixed left-0 top-0 z-[99999] pointer-events-none">
      {/* 말풍선 — 라이트/다크 모두 테마 변수로 적응 */}
      <div
        ref={boxRef}
        className="relative px-3 py-1.5 rounded-lg text-xs font-medium whitespace-normal [overflow-wrap:anywhere] max-w-[min(480px,80vw)] overflow-hidden"
        style={BOX_STYLE}
      >
        {/* 상단 하이라이트 (유리 반사) */}
        <div className="absolute inset-x-0 top-0 h-[40%] rounded-t-lg pointer-events-none" style={HIGHLIGHT_STYLE} />
        <span className="relative">{tip?.text ?? ''}</span>
      </div>
    </div>
  );
}
