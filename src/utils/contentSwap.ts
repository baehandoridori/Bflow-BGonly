import { EASE, MOTION_MS, SWAP_MS, fadePreset, transformPreset, type MotionPreset } from './motion.ts';

/* ═══════════════════════════════════════════════════════════════
   항목을 바꿔 볼 때 창 틀은 제자리, 내용만 스르륵 (움직임 폴리싱 11번 content-swap-in-place, 2026-10)

   - 옆 상세 창(캘린더 일정·리테이크): 처음 열릴 때만 오른쪽 24px 에서 250ms 에 밀려 들어오고,
     닫힐 때 24px 오른쪽으로 180ms 에 빠진다(sidePanelPreset).
   - 이미 열린 창에서 다른 항목을 누르면 창 틀(바깥 셸)은 그대로 두고, 안쪽 내용만 key 로 새로 그리며
     '.bf-swap-in'(140ms, 4px 아래에서 떠오름)을 붙인다. 첫 열림에는 붙이지 않는다(useSwapIn → nextSwapState).
     맨 위 색 띠처럼 내용 밖에 있는 것은 새 값으로 바로 바뀐다.
   - 캐릭터 그림: 옛 그림을 아래층에 두고, 새 그림이 다 준비(decode)된 다음 누른 쪽에서 6px 밀려 들어오며
     160ms 에 떠오른다. 끝나면 아래층을 지운다(imageLayersOn*).
   - 동작 줄이기: 창·내용·그림 모두 움직임 없이 opacity 만 100ms.

   CSS 클래스(.bf-swap-in 등)는 src/styles/motion-popups-panels.css 에 있다.
   이 파일은 node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X).
   ═══════════════════════════════════════════════════════════════ */

/** 박자(ms). CSS 의 같은 이름 클래스와 값이 같아야 한다(tests/motion/popups-panels-content-swap-in-place.test.ts). */
export const CONTENT_SWAP_MS = Object.freeze({
  /** 옆 상세 창 첫 열림 */
  panelOpen: 250,
  /** 옆 상세 창 닫힘 */
  panelClose: 180,
  /** 열린 창의 내용 교체 */
  content: SWAP_MS,
  /** 휴가 '선택한 날짜' 카드 내용 교체 — 작은 카드라 조금 더 짧게 */
  contentQuick: 120,
  /** 타임라인 상세 창 첫 열림 */
  inspector: 200,
  /** 캐릭터 그림 교체 */
  image: 160,
  /** 동작 줄이기 — opacity 만 */
  reduced: 100,
});

/** 움직이는 거리(px). */
export const CONTENT_SWAP_SHIFT = Object.freeze({ panel: 24, inspector: 16, content: 4, image: 6 });

const SIDE_PANEL_FULL = transformPreset({
  from: `translateX(${CONTENT_SWAP_SHIFT.panel}px)`,
  duration: CONTENT_SWAP_MS.panelOpen,
  ease: EASE.out,
  exitDuration: CONTENT_SWAP_MS.panelClose,
  exitEase: EASE.in,
});
const SIDE_PANEL_REDUCED = fadePreset(CONTENT_SWAP_MS.reduced);

/**
 * 오른쪽 옆 상세 창의 바깥 셸 프리셋(첫 열림·닫힘만). 항목 교체 때는 셸의 key 를 바꾸지 않아 다시 재생되지 않는다.
 *   <motion.div key="..." {...sidePanelPreset(reduce)} />
 */
export function sidePanelPreset(reduce: boolean): MotionPreset {
  return reduce ? SIDE_PANEL_REDUCED : SIDE_PANEL_FULL;
}

const DATE_CARD_FULL = transformPreset({
  from: 'translateY(6px)',
  exitTo: 'translateY(-4px)',
  duration: MOTION_MS.base,
  exitDuration: MOTION_MS.fast,
});
const DATE_CARD_REDUCED = fadePreset(CONTENT_SWAP_MS.reduced);

/** 휴가 '선택한 날짜' 카드 셸 — 날짜를 처음 고를 때만 떠오르고, 닫을 때 살짝 올라가며 사라진다. */
export function dateCardPreset(reduce: boolean): MotionPreset {
  return reduce ? DATE_CARD_REDUCED : DATE_CARD_FULL;
}

/** 안쪽 내용 교체 클래스. 첫 열림이면 빈 문자열(바깥 셸만 움직인다). */
export function swapInClassName(swapIn: boolean, quick = false): string {
  if (!swapIn) return '';
  return quick ? 'bf-swap-in bf-swap-quick' : 'bf-swap-in';
}

/* ─── 첫 열림 / 교체 구분 ─────────────────────────────────────── */

export interface SwapState {
  /** 지금 보이는 항목. 닫혀 있으면 null. */
  key: string | null;
  /** 이번에 열린 뒤로 한 번이라도 다른 항목으로 바뀌었는가 — 그 뒤로 새로 그려지는 내용은 모두 '교체'다. */
  swapped: boolean;
}

export const INITIAL_SWAP_STATE: SwapState = Object.freeze({ key: null, swapped: false });

/**
 * 다음 상태. 닫히면(null) 처음으로 돌아가고, 열린 채 다른 항목이 오면 swapped 가 켜져 계속 켜져 있다.
 * 같은 key 로 여러 번 불러도 같은 값을 돌려준다(렌더가 두 번 돌아도 안전).
 */
export function nextSwapState(state: SwapState, key: string | null | undefined): SwapState {
  const next = key ?? null;
  if (next === null) return state.key === null && !state.swapped ? state : INITIAL_SWAP_STATE;
  if (state.key === null) return { key: next, swapped: false };
  if (state.key === next) return state;
  return { key: next, swapped: true };
}

/* ─── 누른 쪽 ─────────────────────────────────────────────────── */

/** -1: 왼쪽에서 들어옴(이전 ‹), 1: 오른쪽에서 들어옴(다음 ›), 0: 제자리에서 떠오르기만. */
export type SwapDirection = -1 | 0 | 1;

/** 같은 목록 안에서 앞쪽 → 뒤쪽 항목으로 바뀌면 1, 반대면 -1. 목록에 없으면(다른 묶음으로 넘어감) 0. */
export function swapDirectionBetween(order: readonly string[], previous: string | null | undefined, next: string | null | undefined): SwapDirection {
  if (!previous || !next || previous === next) return 0;
  const from = order.indexOf(previous);
  const to = order.indexOf(next);
  if (from < 0 || to < 0) return 0;
  return to > from ? 1 : -1;
}

/** 새 그림 레이어 키프레임 — 누른 쪽에서 6px 밀려 들어오며 떠오른다. 방향이 없으면 제자리에서 떠오르기만. */
export function imageSwapKeyframes(direction: SwapDirection): Keyframe[] {
  if (direction === 0) return [{ opacity: 0 }, { opacity: 1 }];
  return [
    { opacity: 0, transform: `translateX(${direction * CONTENT_SWAP_SHIFT.image}px)` },
    { opacity: 1, transform: 'none' },
  ];
}

/** 열린 창의 내용 교체 키프레임(리마운트 없이 WAAPI 로 돌릴 때) — .bf-swap-in 과 같은 모양. */
export const CONTENT_SWAP_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: `translateY(${CONTENT_SWAP_SHIFT.content}px)` },
  { opacity: 1, transform: 'none' },
];

/* ─── 캐릭터 그림 겹쳐 바꾸기 ─────────────────────────────────── */

/**
 * 그림 레이어 하나.
 * - settled: 다 보이는 그림(아래층).
 * - loading: 새 그림을 받는 중 — 보이지 않게 두고 옛 그림을 그대로 보여 준다(빈 칸이 번쩍이지 않게).
 * - entering: 준비가 끝나 떠오르는 중.
 * look 은 그 그림을 그릴 때의 배경·구도 — 위층이 바뀌어도 아래층은 자기 모습 그대로 남는다.
 */
export interface ImageSwapLayer<Look = unknown> {
  src: string;
  direction: SwapDirection;
  phase: 'settled' | 'loading' | 'entering';
  look: Look;
}

/** 처음 그리는 그림 — 기다리지 않고 바로 보인다(교체가 아니므로). */
export function initialImageLayers<Look>(src: string, look: Look): ImageSwapLayer<Look>[] {
  return [{ src, direction: 0, phase: 'settled', look }];
}

/**
 * 보여 줄 그림이 바뀌었다. 아래층은 '지금 보이는 맨 위 그림' 하나만 남기고(떠오르던 중이면 다 떠오른 것으로),
 * 아직 받는 중이던 그림은 버린 뒤 새 그림을 받는 중으로 올린다. 같은 그림으로 돌아오면 받는 중인 것만 버린다.
 */
export function imageLayersOnTarget<Look>(
  layers: readonly ImageSwapLayer<Look>[],
  src: string,
  direction: SwapDirection,
  look: Look,
): ImageSwapLayer<Look>[] {
  const visible = layers.filter((layer) => layer.phase !== 'loading');
  const top = visible[visible.length - 1];
  if (!top) return initialImageLayers(src, look);
  const base: ImageSwapLayer<Look> = top.phase === 'settled' ? top : { ...top, phase: 'settled' };
  if (base.src === src) return [{ ...base, look }];
  return [base, { src, direction, phase: 'loading', look }];
}

/** 받는 중이던 그림이 준비됐다 → 떠오르기 시작. */
export function imageLayersOnReady<Look>(layers: readonly ImageSwapLayer<Look>[], src: string): ImageSwapLayer<Look>[] {
  if (!layers.some((layer) => layer.src === src && layer.phase === 'loading')) return layers as ImageSwapLayer<Look>[];
  return layers.map((layer) => (layer.src === src && layer.phase === 'loading' ? { ...layer, phase: 'entering' } : layer));
}

/** 다 떠올랐다 → 그 아래층은 지운다. */
export function imageLayersOnSettled<Look>(layers: readonly ImageSwapLayer<Look>[], src: string): ImageSwapLayer<Look>[] {
  const at = layers.findIndex((layer) => layer.src === src && layer.phase === 'entering');
  if (at < 0) return layers as ImageSwapLayer<Look>[];
  return [{ ...layers[at], phase: 'settled' }, ...layers.slice(at + 1)];
}

/** 맨 위(지금 목표) 그림의 모습만 새 값으로 — 배경·구도를 고치면 그 자리에서 바로 바뀐다. */
export function imageLayersWithTopLook<Look>(layers: readonly ImageSwapLayer<Look>[], look: Look, same: (a: Look, b: Look) => boolean): ImageSwapLayer<Look>[] {
  const top = layers[layers.length - 1];
  if (!top || same(top.look, look)) return layers as ImageSwapLayer<Look>[];
  return [...layers.slice(0, -1), { ...top, look }];
}
