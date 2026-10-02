import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { animateEl } from '@/utils/motion';
import {
  SAVED_CHIP_MS,
  SCENE_FLIP,
  isChainedFlip,
  planSceneFlip,
  planTitleRoll,
  rubberBandKeyframes,
  shouldSkipRepeatedKey,
  type FlipDir,
  type FlipFrom,
  type FlipPlan,
} from '@/utils/sceneFlip';

/* ═══════════════════════════════════════════════════════════════
   씬 상세 창 '카드 넘기기' (움직임 폴리싱 14번, 한솔 결정 2026-10-03)

   쓰는 법
     const flip = useSceneFlip({ identity, reduce, layerRef, viewportRef, titleRef, hasPrev, hasNext });
     // 넘기기 직전(부모에게 다음 씬을 달라고 하기 전에)
     flip.prepare(1); onNavigate('next');
     // 맨 끝에서 더 넘기려 할 때
     flip.bounce(1);
     // 키 자동 반복 걸러내기
     if (!flip.allowKey(e.repeat)) return;
     // ←/→ 버튼 hover
     onMouseEnter={() => flip.peek('next')} onMouseLeave={() => flip.peek(null)}

   어떻게 움직이나
   - prepare 가 지금 본문·제목을 DOM 복제본(고스트)으로 떠 둔다. 부모가 다음 씬을 그리면(identity 가 바뀌면)
     layout effect 에서 고스트를 같은 자리 뒤쪽(z-index -1, 움직이는 동안 칸이 isolation:isolate)에 깔고
     고스트는 지나가며 빠지고, 새 내용은 반대쪽에서 지나 들어온다. 둘 다 transform·opacity 만(WAAPI, 합성 스레드).
   - 넘기는 중에 또 넘기면 지금 움직이던 그 자리(계산된 transform·opacity)에서 고스트를 떠 이어 가고,
     0.14초짜리 짧은 넘김으로 바꾼다. 방향이 바뀌면 그 자리에서 바로 반대로 간다.
   - 동작 줄이기면 투명도만 0.12초.
   - React 가 무거운 내용을 두 벌 들고 있지 않는다(고스트는 그림만 있는 DOM 이고 끝나면 지운다).
   ═══════════════════════════════════════════════════════════════ */

interface Snapshot {
  node: HTMLElement;
  from: FlipFrom;
  scrollTop: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PendingFlip {
  dir: FlipDir;
  stepsLeft: number;
  at: number;
  layer: Snapshot | null;
  title: Snapshot | null;
}

interface GhostEntry {
  el: HTMLElement;
  anim: Animation | null;
}

export type ScenePeekSide = 'prev' | 'next' | null;

export interface SceneFlipOptions {
  /** 씬 식별자. 바뀌면 부모가 다음 씬을 그린 것으로 본다. */
  identity: string;
  reduce: boolean;
  /** 넘어가는 본문(실제 내용). */
  layerRef: RefObject<HTMLElement>;
  /** 본문을 감싼 칸(.sf-flip-viewport — position:relative, 움직이는 동안만 isolation:isolate). 고스트를 여기에 깐다. */
  viewportRef: RefObject<HTMLElement>;
  /** 씬 번호·제목. 부모가 .sf-title-slot(position:relative + isolation:isolate) 이어야 한다. */
  titleRef?: RefObject<HTMLElement>;
  /** ←/→ hover 때 카드 모서리가 비칠 칸(.sf-peek 두 개를 자식으로 가진 요소). 기본은 viewportRef. */
  peekHostRef?: RefObject<HTMLElement>;
  /** 칸이 스크롤 상자 안에 있어 옆으로 밀린 내용이 가로 스크롤을 만들 수 있으면 true — 움직이는 동안만 가로를 자른다. */
  clipX?: boolean;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface SceneFlipControls {
  /** 넘기기 직전에 부른다. steps: 여러 칸을 한 번에 건너뛸 때(도트) 마지막 칸에서 한 번만 움직인다. */
  prepare: (dir: FlipDir, steps?: number) => void;
  /** 맨 끝에서 더 넘기려 할 때 고무줄 튕김. */
  bounce: (dir: FlipDir) => void;
  /** 키 자동 반복이 너무 촘촘하면 false. */
  allowKey: (isRepeat: boolean) => boolean;
  /** ←/→ hover 카드 모서리. */
  peek: (side: ScenePeekSide) => void;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function readFrom(el: HTMLElement): FlipFrom {
  const cs = getComputedStyle(el);
  const opacity = Number.parseFloat(cs.opacity);
  return {
    transform: cs.transform && cs.transform !== '' ? cs.transform : 'none',
    opacity: Number.isFinite(opacity) ? opacity : 1,
  };
}

/** 지금 보이는 그대로 떠 둔다(넘기는 중이면 움직이던 그 자리·투명도 포함). */
function snapshot(el: HTMLElement | null | undefined): Snapshot | null {
  if (!el || !el.isConnected) return null;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  if (width < 1 || height < 1) return null;
  const node = el.cloneNode(true) as HTMLElement;
  // 고스트는 그림일 뿐 — 같은 id 로 다른 코드(getElementById)를 헷갈리게 하지 않고, 포커스·보조기기에서도 뺀다.
  node.removeAttribute('id');
  node.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));
  node.removeAttribute('data-continuity-target');
  node.classList.remove('sf-tab-fade');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('inert', '');
  return {
    node,
    from: readFrom(el),
    scrollTop: el.scrollTop,
    left: el.offsetLeft,
    top: el.offsetTop,
    width,
    height,
  };
}

function canAnimate(el: Element | null | undefined): el is HTMLElement {
  return !!el && typeof (el as { animate?: unknown }).animate === 'function';
}

export function useSceneFlip(options: SceneFlipOptions): SceneFlipControls {
  const optsRef = useRef(options);
  optsRef.current = options;

  const pendingRef = useRef<PendingFlip | null>(null);
  const identityRef = useRef(options.identity);
  const lastRef = useRef({ startAt: Number.NEGATIVE_INFINITY, durationMs: 0, navAt: Number.NEGATIVE_INFINITY });
  const liveRef = useRef<Animation[]>([]);
  const ghostsRef = useRef<{ layer: GhostEntry[]; title: GhostEntry[] }>({ layer: [], title: [] });
  const bounceRef = useRef<Animation | null>(null);
  const clipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 움직이는 동안만 칸을 무대로 만든다.
   * - isolation:isolate — 고스트(z-index:-1)가 이 칸 안에서만 새 내용 뒤에 깔린다(창 배경 뒤로 숨지 않게).
   *   평소에는 풀어 두어, 칸 안 펼침 메뉴가 머리줄 같은 바깥 요소와 겹치는 순서가 예전과 같다.
   * - clipX 면 overflow-x:clip — 옆으로 밀린 내용이 스크롤 상자에 가로 스크롤바를 만들지 않게.
   */
  const stageFor = useCallback((viewport: HTMLElement, ms: number, clipX: boolean) => {
    viewport.style.isolation = 'isolate';
    if (clipX) viewport.style.overflowX = 'clip';
    if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
    clipTimerRef.current = setTimeout(() => {
      clipTimerRef.current = null;
      viewport.style.isolation = '';
      viewport.style.overflowX = '';
    }, ms + 40);
  }, []);

  const addGhost = useCallback((kind: 'layer' | 'title', parent: HTMLElement, snap: Snapshot, plan: FlipPlan, heightCap: number | null) => {
    const ghost = snap.node;
    const style = ghost.style;
    style.position = 'absolute';
    style.left = `${snap.left}px`;
    style.top = `${snap.top}px`;
    style.width = `${snap.width}px`;
    style.height = `${heightCap != null ? Math.max(0, Math.min(snap.height, heightCap)) : snap.height}px`;
    style.margin = '0';
    style.zIndex = '-1';
    style.pointerEvents = 'none';
    if (kind === 'layer') {
      style.overflow = 'hidden';
      style.contain = 'layout paint';
    } else {
      style.whiteSpace = 'nowrap';
    }
    parent.insertBefore(ghost, parent.firstChild);
    if (snap.scrollTop > 0) ghost.scrollTop = snap.scrollTop;

    const list = ghostsRef.current[kind];
    const entry: GhostEntry = { el: ghost, anim: null };
    const remove = () => {
      ghost.remove();
      const at = ghostsRef.current[kind].indexOf(entry);
      if (at >= 0) ghostsRef.current[kind].splice(at, 1);
    };
    if (canAnimate(ghost)) {
      const anim = ghost.animate(plan.outgoing, { duration: plan.durationMs, easing: plan.easing, fill: 'forwards' });
      entry.anim = anim;
      anim.onfinish = remove;
      anim.oncancel = remove;
    } else {
      setTimeout(remove, plan.durationMs);
    }
    list.push(entry);
    // 연타로 쌓이면 가장 오래된(가장 흐려진) 카드부터 걷는다(cancel 이벤트는 비동기라 여기서 바로 뺀다).
    while (list.length > SCENE_FLIP.maxGhosts) {
      const oldest = list.shift();
      if (!oldest) break;
      oldest.anim?.cancel();
      oldest.el.remove();
    }
  }, []);

  const run = useCallback((pending: PendingFlip) => {
    const { viewportRef, layerRef, titleRef, reduce, clipX } = optsRef.current;
    const viewport = viewportRef.current;
    const live = layerRef.current;
    if (!viewport || !canAnimate(live)) return;

    const startAt = now();
    const chained = isChainedFlip(startAt, lastRef.current.startAt, lastRef.current.durationMs);
    const plan = planSceneFlip({ dir: pending.dir, chained, reduce, from: pending.layer?.from });

    // 앞 넘김에서 들어오던 움직임은 끊고(고스트가 그 자리를 이어받았다) 새로 시작한다.
    liveRef.current.forEach((anim) => anim.cancel());
    liveRef.current = [];
    bounceRef.current?.cancel();
    bounceRef.current = null;

    stageFor(viewport, plan.durationMs, !!clipX && !reduce);
    if (pending.layer) addGhost('layer', viewport, pending.layer, plan, viewport.clientHeight);
    const anims: Animation[] = [
      live.animate(plan.incoming, { duration: plan.durationMs, easing: plan.easing, fill: 'backwards' }),
    ];

    const title = titleRef?.current;
    if (canAnimate(title)) {
      const titlePlan = planTitleRoll({ dir: pending.dir, durationMs: plan.durationMs, reduce, from: pending.title?.from });
      if (pending.title && title.parentElement) addGhost('title', title.parentElement, pending.title, titlePlan, null);
      anims.push(title.animate(titlePlan.incoming, { duration: titlePlan.durationMs, easing: titlePlan.easing, fill: 'backwards' }));
    }

    liveRef.current = anims;
    lastRef.current.startAt = startAt;
    lastRef.current.durationMs = plan.durationMs;
  }, [addGhost, stageFor]);

  const prepare = useCallback((dir: FlipDir, steps = 1) => {
    const { layerRef, titleRef } = optsRef.current;
    const at = now();
    lastRef.current.navAt = at;
    pendingRef.current = {
      dir,
      stepsLeft: Math.max(1, Math.floor(steps)),
      at,
      layer: snapshot(layerRef.current),
      title: snapshot(titleRef?.current),
    };
  }, []);

  const allowKey = useCallback((isRepeat: boolean) => !shouldSkipRepeatedKey(isRepeat, now(), lastRef.current.navAt), []);

  const bounce = useCallback((dir: FlipDir) => {
    const { layerRef, viewportRef, reduce, clipX } = optsRef.current;
    const live = layerRef.current;
    if (!live || reduce) return;
    if (bounceRef.current && bounceRef.current.playState === 'running') return;
    if (now() - lastRef.current.startAt < lastRef.current.durationMs) return;
    const anim = animateEl(live, rubberBandKeyframes(dir), { duration: SCENE_FLIP.rubberMs, easing: 'linear' }, reduce);
    bounceRef.current = anim;
    if (anim && viewportRef.current) stageFor(viewportRef.current, SCENE_FLIP.rubberMs, !!clipX);
  }, [stageFor]);

  const peekHost = () => (optsRef.current.peekHostRef ?? optsRef.current.viewportRef).current;

  const peek = useCallback((side: ScenePeekSide) => {
    const host = peekHost();
    if (!host) return;
    const { hasPrev, hasNext } = optsRef.current;
    const allowed = side === 'next' ? hasNext : side === 'prev' ? hasPrev : false;
    if (side && allowed) host.dataset.scenePeek = side;
    else delete host.dataset.scenePeek;
  }, []);

  // 씬이 바뀌면(부모가 다음 씬을 그렸으면) 준비해 둔 넘김을 실행한다 — 그리기 전에(깜빡임 없이).
  useLayoutEffect(() => {
    if (identityRef.current === options.identity) return;
    identityRef.current = options.identity;
    const pending = pendingRef.current;
    if (!pending) return;
    if (now() - pending.at > SCENE_FLIP.staleMs) {
      pendingRef.current = null;
      return;
    }
    pending.stepsLeft -= 1;
    if (pending.stepsLeft > 0) return;
    pendingRef.current = null;
    run(pending);
  }, [options.identity, run]);

  // 맨 끝에 닿으면 그쪽 카드 모서리는 걷는다.
  useLayoutEffect(() => {
    const host = peekHost();
    const side = host?.dataset.scenePeek;
    if (!host || !side) return;
    if ((side === 'next' && !options.hasNext) || (side === 'prev' && !options.hasPrev)) delete host.dataset.scenePeek;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.identity, options.hasPrev, options.hasNext]);

  useEffect(() => () => {
    liveRef.current.forEach((anim) => anim.cancel());
    liveRef.current = [];
    bounceRef.current?.cancel();
    for (const kind of ['layer', 'title'] as const) {
      for (const entry of ghostsRef.current[kind].slice()) {
        entry.anim?.cancel();
        entry.el.remove();
      }
      ghostsRef.current[kind] = [];
    }
    if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
  }, []);

  return useMemo(() => ({ prepare, bounce, allowKey, peek }), [prepare, bounce, allowKey, peek]);
}

/**
 * 이미지 저장이 끝난 시각(savedAt)을 받아 '저장됨 ✓' 칩을 1.2초 보여 줄지 정한다.
 * 칩을 지우는 건 타이머라 '동작 줄이기'(애니메이션 0.01ms)에서도 1.2초 동안 읽을 수 있다.
 * 다시 그려져도(씬 넘김 등) 이미 지난 시간만큼만 남는다.
 */
export function useSavedFlash(savedAt: number | undefined): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!savedAt) {
      setVisible(false);
      return;
    }
    const left = SAVED_CHIP_MS - (Date.now() - savedAt);
    if (left <= 0) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), left);
    return () => clearTimeout(timer);
  }, [savedAt]);
  return visible;
}
