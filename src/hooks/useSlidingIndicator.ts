import { useLayoutEffect, useRef, type DependencyList, type RefObject } from 'react';
import {
  SLIDE_TIMING,
  insetRect,
  measureWithin,
  rectWithin,
  planSlide,
  restingStyle,
  visualSlideRect,
  type SlideAxis,
  type SlideRect,
  type SlideTiming,
  type SlideTimingName,
} from '@/utils/slidingIndicator';

/**
 * 미끄러지는 선택 표시 하나를 활성 칸으로 옮긴다 (움직임 폴리싱 7번).
 *
 * 사용법: 표시 요소(ref)를 항목들과 같은 부모 안에 두고, 부모는 position: relative, 항목에는
 * `data-slide-key` 를 단다(인덱스가 아니라 키 — 숨김·필터로 순서가 바뀌어도 맞는다). 보통은
 * `<SlidingIndicator>` 컴포넌트로 쓴다.
 *
 * - activeKey 가 바뀌면 이전 자리에서 새 자리로 미끄러진다(WAAPI transform, 합성 스레드).
 * - 창 크기·라벨 축약 등으로 칸 크기·자리가 바뀌면(ResizeObserver) 미끄러짐 없이 바로 맞춘다.
 *   단, 미끄러지는 중이면 보이는 자리에서 새 목표로 이어 간다.
 * - 처음 그릴 때, 표시가 숨어 있다 나타날 때, resetKey 가 바뀔 때(검색어 변경 등), 동작 줄이기면 바로 놓인다.
 * - 클래스를 넣었다 빼지 않는다(끝날 때 깜빡임). 쉬는 자리는 인라인 transform, 움직임은 WAAPI 하나.
 * - 칸 자리를 재는 일(offset 읽기)은 커밋 직후(layout effect)에 하지 않는다. 그때 읽으면 방금 바뀐 화면 전체
 *   (필터로 바뀐 카드 수십 장, 새 화면)의 스타일·레이아웃을 클릭 처리 안에서 강제로 계산한다(최종 성능 측정 지적).
 *   대신 크기 감시를 다시 걸어, 브라우저가 이번 프레임의 레이아웃을 끝낸 뒤(그리기 전) 오는 알림에서 잰다 —
 *   같은 프레임에 그려지므로 보이는 모습·박자는 그대로다.
 */
export interface SlidingIndicatorOptions {
  axis?: SlideAxis;
  timing?: SlideTimingName | SlideTiming;
  /** 칸보다 안쪽에 그릴 때(px). 예: 좌우 12px 들여 쓴 밑줄 → { x: 12 } */
  inset?: { x?: number; y?: number };
  /**
   * 바뀌면 미끄러짐 없이 바로 놓는다(검색어가 바뀌어 목록이 통째로 바뀐 경우).
   * 같은 프레임 안에서 이어지는 선택 이동(예: 목록이 바뀐 뒤 effect 가 선택을 0 으로 되돌림)도 미끄러지지 않는다.
   */
  resetKey?: string | number | null;
  /** 항목 묶음이 바뀌는 값(항목 목록 등). 바뀌면 다시 재고 크기 감시 대상을 갱신한다. 길이는 고정할 것. */
  deps?: DependencyList;
  reduce?: boolean;
}

interface SlideState {
  key: string | null;
  resetKey: string | number | null | undefined;
  layout: SlideRect | null;
  shown: boolean;
  anim: Animation | null;
  /** resetKey 가 바뀐 프레임이 화면에 나가기 전까지 true. */
  holdSlide: boolean;
  /**
   * 다음 크기 감시 알림에서 할 자리 맞춤. 한 프레임 안의 여러 변경은 하나로 모은다 —
   * 키가 한 번이라도 바뀌었으면 미끄러지고(slide), 목록 교체가 끼었으면 막는다(block).
   */
  pending: { slide: boolean; block: boolean } | null;
}

function findItem(container: HTMLElement, key: string): HTMLElement | null {
  const items = container.querySelectorAll<HTMLElement>('[data-slide-key]');
  for (const item of items) {
    if (item.dataset.slideKey === key) return item;
  }
  return null;
}

const NO_DEPS: DependencyList = [];

export function useSlidingIndicator<T extends HTMLElement = HTMLElement>(
  activeKey: string | number | null | undefined,
  options: SlidingIndicatorOptions = {},
): RefObject<T> {
  const ref = useRef<T>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stateRef = useRef<SlideState>({ key: null, resetKey: undefined, layout: null, shown: false, anim: null, holdSlide: false, pending: null });
  const observerRef = useRef<ResizeObserver | null>(null);
  const key = activeKey === null || activeKey === undefined ? null : String(activeKey);
  const deps = options.deps ?? NO_DEPS;

  const placeRef = useRef((animate: boolean, block = false) => {
    const el = ref.current;
    const container = el?.parentElement;
    if (!el || !container) return;
    const opts = optionsRef.current;
    const axis = opts.axis ?? 'x';
    const state = stateRef.current;
    const item = state.key === null ? null : findItem(container, state.key);

    if (!item || (item.offsetWidth === 0 && item.offsetHeight === 0)) {
      state.anim?.cancel();
      state.anim = null;
      if (state.shown) {
        el.style.visibility = 'hidden';
        state.shown = false;
      }
      return;
    }

    const measured = measureWithin(item, container)
      ?? rectWithin(item.getBoundingClientRect(), container.getBoundingClientRect(), container);
    const target = insetRect(measured, opts.inset);
    const running = state.anim && state.anim.playState === 'running' ? state.anim : null;
    const previous = state.shown ? state.layout : null;
    const plan = planSlide({
      axis,
      target,
      previous,
      // 연타: 진행 중이면 지금 보이는 자리에서 출발한다(계산된 transform 은 애니메이션 중간값이다).
      visual: running && previous ? visualSlideRect(getComputedStyle(el).transform, previous) : null,
      running: running !== null,
      keyMoved: animate,
      blockSlide: block || state.holdSlide || Boolean(opts.reduce) || typeof el.animate !== 'function',
    });
    if (plan.kind === 'keep') return;

    running?.cancel();
    state.anim = null;
    const style = restingStyle(target, axis);
    el.style.transform = style.transform;
    if (style.width !== undefined) el.style.width = style.width;
    if (style.height !== undefined) el.style.height = style.height;
    if (!state.shown) {
      el.style.visibility = 'visible';
      state.shown = true;
    }
    state.layout = target;

    if (!plan.frames) return;
    const timing = typeof opts.timing === 'object' ? opts.timing : SLIDE_TIMING[opts.timing ?? 'tab'];
    state.anim = el.animate(plan.frames, { duration: timing.duration, easing: timing.easing });
  });

  // 활성 칸·목록이 바뀌었을 때. 키가 바뀐 경우만 미끄러진다.
  // 여기서는 재지 않고 할 일만 적어 둔 뒤 크기 감시를 다시 건다 — observe() 를 새로 걸면 이번 프레임의
  // 레이아웃이 끝난 뒤(그리기 전) 알림이 한 번 온다. 목록이 바뀌어 감시를 새로 만드는 커밋이면 그 첫 알림이 대신한다.
  useLayoutEffect(() => {
    const state = stateRef.current;
    const keyChanged = state.key !== key;
    const resetChanged = state.resetKey !== options.resetKey;
    state.key = key;
    state.resetKey = options.resetKey;
    const block = resetChanged || state.holdSlide;
    if (resetChanged && !state.holdSlide) {
      state.holdSlide = true;
      const release = () => { state.holdSlide = false; };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(release);
      else setTimeout(release, 0);
    }
    if (typeof ResizeObserver === 'undefined') {
      placeRef.current(keyChanged && !block, block);
      return;
    }
    const pending = state.pending;
    state.pending = { slide: (pending?.slide ?? false) || keyChanged, block: (pending?.block ?? false) || block };
    const observer = observerRef.current;
    const container = ref.current?.parentElement;
    if (observer && container) {
      observer.unobserve(container);
      observer.observe(container);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, options.resetKey, ...deps]);

  // 칸 크기·자리 변화(창 크기, 라벨 축약, 글꼴 로드, 사이드바 펼침) — 바로 맞춘다. 위에서 적어 둔 선택 이동도 여기서 한다.
  useLayoutEffect(() => {
    const el = ref.current;
    const container = el?.parentElement;
    if (!el || !container || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const state = stateRef.current;
      const pending = state.pending;
      state.pending = null;
      placeRef.current(pending ? pending.slide && !pending.block : false, pending?.block ?? false);
    });
    observerRef.current = observer;
    observer.observe(container);
    container.querySelectorAll('[data-slide-key]').forEach((item) => observer.observe(item));
    return () => {
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useLayoutEffect(() => () => {
    stateRef.current.anim?.cancel();
    stateRef.current.anim = null;
  }, []);

  return ref;
}
