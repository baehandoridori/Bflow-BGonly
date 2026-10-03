import type { BezierDefinition, TargetAndTransition, Transition } from 'framer-motion';
import { EASE, EASE_CSS, MOTION_MS, SWAP_MS, bezierCss, transformPreset, type MotionPreset } from './motion.ts';

/* ═══════════════════════════════════════════════════════════════
   씬 상세 창 움직임 (움직임 폴리싱 14번 scene-detail-flow, 2026-10)

   한솔 결정(2026-10-03): 다음·이전 씬 넘김은 카드가 왼쪽·오른쪽으로 '지나가는' 느낌.
   - 다음(→): 지금 씬은 왼쪽으로 약 96px 지나가며 살짝 작아지고(0.985) 흐려지며 빠지고,
     다음 씬은 오른쪽(+96px)에서 지나 들어온다. 두 장이 겹쳐 0.3초 안팎에 자리 잡는다. 이전(←)은 거울.
   - 창 틀(머리줄·닫기·댓글 패널)은 제자리, 씬 번호·제목만 같은 방향으로 짧게 굴러 바뀐다.
   - 빠르게 연타·키를 누르고 있으면 움직임을 없애지 않고 약 0.14초로 이어 붙인다. 방향이 바뀌면 즉시 반대로.
   - 맨 끝에서 더 넘기면 살짝 튕겨 돌아온다(고무줄). ←/→ 에 마우스를 올리면 그쪽 가장자리에 다음 카드 모서리가 비친다.
   - 동작 줄이기: 이동 없이 0.12초 투명도 교차만.

   나가는 씬은 React 가 아니라 DOM 복제본(고스트)으로 그린다 — 무거운 내용 두 벌을 React 로 유지하지 않고,
   연타·방향 전환 때 지금 보이는 위치에서 바로 이어 갈 수 있다(src/hooks/useSceneFlip.ts).
   여기 함수들은 node --test 가 그대로 import 하도록 DOM·React 런타임 의존이 없다(preloadImage 는 호출 때만 Image 를 쓴다).
   ═══════════════════════════════════════════════════════════════ */

export type FlipDir = 1 | -1;

/** 넘김 곡선 — 한솔 결정 수치 cubic-bezier(.22,1,.36,1). */
export const SCENE_FLIP_EASE: BezierDefinition = [0.22, 1, 0.36, 1];
export const SCENE_FLIP_EASE_CSS = bezierCss(SCENE_FLIP_EASE);

export const SCENE_FLIP = Object.freeze({
  /** 한 번 넘길 때 이동 거리(px). */
  distancePx: 96,
  /** 이어 붙여 넘길 때(연타·키 누르고 있기) 이동 거리 — 0.14초에 96px 를 다 가면 번쩍여 보여 줄인다. */
  chainDistancePx: 64,
  /** 지나가는 카드의 크기. */
  scale: 0.985,
  /** 한 번 넘김 길이(ms). */
  durationMs: 300,
  /** 이어 붙인 넘김 길이(ms) — 약 0.14초. */
  chainMs: SWAP_MS,
  /** 동작 줄이기 — 투명도 교차 길이(ms). */
  reduceMs: MOTION_MS.fast,
  /** 씬 번호·제목 굴림 거리(px). */
  titleDistancePx: 14,
  /** 씬 번호·제목 굴림은 본문보다 짧게 끝낸다(ms). */
  titleMaxMs: 220,
  /** 앞 넘김이 끝난 직후 이 시간(ms) 안에 다시 넘기면 이어 붙인 것으로 본다. */
  chainGraceMs: 60,
  /** 키를 누르고 있을 때(자동 반복) 다음 넘김까지 최소 간격(ms) — 넘김 한 번이 보일 만큼. */
  repeatGapMs: SWAP_MS,
  /** 맨 끝 고무줄 튕김 거리(px)·길이(ms). */
  rubberPx: 16,
  rubberMs: 320,
  /** 넘김을 준비했는데 이 시간(ms) 안에 씬이 안 바뀌면 준비를 버린다. */
  staleMs: 900,
  /** 동시에 남겨 둘 나가는 카드(고스트) 수. */
  maxGhosts: 2,
});

/** 지금 보이는 모습(넘기는 중이면 움직이던 그 자리)에서 출발한다. */
export interface FlipFrom {
  transform: string;
  opacity: number;
}

export interface FlipPlan {
  durationMs: number;
  easing: string;
  /** 나가는 씬(고스트) 키프레임. */
  outgoing: Keyframe[];
  /** 들어오는 씬(실제 내용) 키프레임. 끝값은 transform none·opacity 1 = 원래 모습이라 채움(fill forwards)이 필요 없다. */
  incoming: Keyframe[];
}

/** 앞 넘김이 아직 진행 중이면(또는 막 끝났으면) 이어 붙인 넘김이다. */
export function isChainedFlip(now: number, lastStartAt: number, lastDurationMs: number): boolean {
  if (!Number.isFinite(lastStartAt)) return false;
  return now - lastStartAt < lastDurationMs + SCENE_FLIP.chainGraceMs;
}

/** 키 자동 반복이 너무 촘촘하면 건너뛴다 — 누르고 있을 때 약 0.14초마다 한 장씩 착착. */
export function shouldSkipRepeatedKey(isRepeat: boolean, now: number, lastNavAt: number): boolean {
  return isRepeat && now - lastNavAt < SCENE_FLIP.repeatGapMs;
}

function restingFrom(from: FlipFrom | null | undefined): FlipFrom {
  return from ?? { transform: 'none', opacity: 1 };
}

function reducedPlan(start: FlipFrom): FlipPlan {
  return {
    durationMs: SCENE_FLIP.reduceMs,
    easing: EASE_CSS.std,
    outgoing: [{ opacity: start.opacity }, { opacity: 0 }],
    incoming: [{ opacity: 0 }, { opacity: 1 }],
  };
}

/**
 * 본문 넘김 계획. dir 1 = 다음(지금 씬이 왼쪽으로 지나감), -1 = 이전(오른쪽으로 지나감).
 * reduce 면 이동 없이 투명도만 0.12초.
 */
export function planSceneFlip({ dir, chained, reduce, from }: { dir: FlipDir; chained: boolean; reduce: boolean; from?: FlipFrom | null }): FlipPlan {
  const start = restingFrom(from);
  if (reduce) return reducedPlan(start);
  const distance = chained ? SCENE_FLIP.chainDistancePx : SCENE_FLIP.distancePx;
  const passed = (sign: number) => `translateX(${sign * distance}px) scale(${SCENE_FLIP.scale})`;
  return {
    durationMs: chained ? SCENE_FLIP.chainMs : SCENE_FLIP.durationMs,
    easing: SCENE_FLIP_EASE_CSS,
    outgoing: [{ transform: start.transform, opacity: start.opacity }, { transform: passed(-dir), opacity: 0 }],
    incoming: [{ transform: passed(dir), opacity: 0 }, { transform: 'none', opacity: 1 }],
  };
}

/** 씬 번호·제목 굴림 — 본문과 같은 방향, 짧은 거리, 본문보다 조금 빨리 끝. */
export function planTitleRoll({ dir, durationMs, reduce, from }: { dir: FlipDir; durationMs: number; reduce: boolean; from?: FlipFrom | null }): FlipPlan {
  const start = restingFrom(from);
  if (reduce) return reducedPlan(start);
  const d = SCENE_FLIP.titleDistancePx;
  return {
    durationMs: Math.min(durationMs, SCENE_FLIP.titleMaxMs),
    easing: SCENE_FLIP_EASE_CSS,
    outgoing: [{ transform: start.transform, opacity: start.opacity }, { transform: `translateX(${-dir * d}px)`, opacity: 0 }],
    incoming: [{ transform: `translateX(${dir * d}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
  };
}

/**
 * 맨 끝 씬에서 더 넘기려 할 때 — 넘기려던 쪽으로 살짝 끌렸다가 튕겨 돌아온다.
 * 효과 전체 easing 은 linear 로 두고 구간별 easing 을 쓴다(돌아올 때 spring 으로 살짝 지나쳤다 멈춤).
 */
export function rubberBandKeyframes(dir: FlipDir): Keyframe[] {
  return [
    { transform: 'none', easing: EASE_CSS.snap },
    { transform: `translateX(${-dir * SCENE_FLIP.rubberPx}px)`, offset: 0.3, easing: EASE_CSS.spring },
    { transform: 'none' },
  ];
}

/** 탭 전환 — 누른 탭이 오른쪽이면 오른쪽(+)에서, 왼쪽이면 왼쪽(-)에서 살며시 들어온다. 같은 탭·모르는 탭이면 0. */
export function tabShiftPx<T>(order: readonly T[], prev: T, next: T, px = 8): number {
  const a = order.indexOf(prev);
  const b = order.indexOf(next);
  if (a < 0 || b < 0 || a === b) return 0;
  return b > a ? px : -px;
}

/* ─── 창 열기·닫기 ─────────────────────────────────────────── */

/** 닫기: 0.16초 동안 살짝 작아지며 가라앉는다(나갈 때 곡선). */
export const SCENE_MODAL_CLOSE_MS = 160;
const OPEN_FROM = 'translateY(12px) scale(0.96)';
const CLOSE_TO = 'translateY(6px) scale(0.97)';

export interface SceneModalMotion {
  /** 본체 열기(떠오르기). 닫기는 shellExit 가 창 묶음 전체에 건다. */
  body: MotionPreset;
  /** 창 묶음(본체 + 댓글 패널)의 닫기 — 같이 가라앉는다. */
  shellExit: TargetAndTransition;
  /** 뒤 화면을 어둡게 까는 막: 열기 transition 과 닫기. */
  backdropTransition: Transition;
  backdropExit: TargetAndTransition;
}

const FULL_MODAL_MOTION: SceneModalMotion = {
  body: transformPreset({ from: OPEN_FROM, duration: MOTION_MS.base }),
  shellExit: {
    opacity: 0,
    // 'none' 에서 출발하면 framer 가 scale(0) 에서 출발시킨다 — 제자리 값을 명시한다.
    transform: ['translateY(0px) scale(1)', CLOSE_TO],
    transition: { duration: SCENE_MODAL_CLOSE_MS / 1000, ease: EASE.in },
  },
  backdropTransition: { duration: MOTION_MS.base / 1000, ease: EASE.std },
  backdropExit: { opacity: 0, transition: { duration: SCENE_MODAL_CLOSE_MS / 1000, ease: EASE.in } },
};

const REDUCED_MODAL_MOTION: SceneModalMotion = {
  body: transformPreset({ from: OPEN_FROM }, true),
  shellExit: { opacity: 0, transition: { duration: MOTION_MS.fast / 1000, ease: EASE.std } },
  backdropTransition: { duration: MOTION_MS.fast / 1000, ease: EASE.std },
  backdropExit: { opacity: 0, transition: { duration: MOTION_MS.fast / 1000, ease: EASE.std } },
};

/** 같은 객체를 돌려준다(렌더마다 새로 만들지 않는다). */
export function sceneModalMotion(reduce: boolean): SceneModalMotion {
  return reduce ? REDUCED_MODAL_MOTION : FULL_MODAL_MOTION;
}

/**
 * '전체' 보기 카드 → 상세 창 연결 확대의 시작 모습.
 * 카드와 창의 가로세로 비율이 달라도 글자가 납작해지지 않게 '균등' 확대(카드 폭/창 폭)하고 위를 맞춘다.
 * transform-origin 은 top left 를 전제로 한다.
 */
export function continuityStartTransform(
  source: { left: number; top: number; width: number },
  target: { left: number; top: number; width: number },
): string {
  const scale = source.width / Math.max(target.width, 1);
  const x = source.left - target.left;
  const y = source.top - target.top;
  return `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
}

/* ─── 이미지 저장 ──────────────────────────────────────────── */

/** '저장됨 ✓' 칩이 떠 있는 시간(ms). */
export const SAVED_CHIP_MS = 1200;

/**
 * 저장된 원격 이미지를 미리 받아 그린 다음에 미리보기를 걷는다 — 바꾸는 순간 빈 칸이 번쩍이지 않게.
 * 실패·시간 초과여도 그냥 끝낸다(저장 자체는 이미 끝났다).
 */
export function preloadImage(url: string, timeoutMs = 6000): Promise<void> {
  if (!url || typeof Image === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(finish, timeoutMs);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (typeof img.decode === 'function') img.decode().then(finish, finish);
      else finish();
    };
    img.onerror = finish;
    img.src = url;
  });
}

/*
 * 칸마다 '어느 씬의 몇 번째 저장인지'를 함께 기억한다(리뷰 반영).
 * 붙여넣고 곧바로 다음 씬으로 넘기면 앞 저장이 원격 그림을 미리 받는 동안(최대 6초) 끝나지 않는다.
 * - 다른 씬의 미리보기·저장 중·저장됨은 지금 씬에 보이지 않는다(imageSaveView 가 씬 키로 거른다).
 * - 같은 칸에 새 저장이 시작되면 앞 저장의 마무리는 무시된다(token) — 새 미리보기·저장 중을 지우지 않는다.
 */
export type ImageSlotType = 'storyboard' | 'guide';

export interface ImageSaveEntry {
  sceneKey: string;
  token: number;
  /** 저장이 끝나기 전에 바로 보여 줄 그림(data: URL). */
  preview?: string;
  /** 올리는 중이거나 원격 그림을 미리 받는 중. */
  saving: boolean;
  /** 저장이 끝난 시각 — '저장됨 ✓' 칩. */
  savedAt?: number;
}

export type ImageSaveState = Readonly<Partial<Record<ImageSlotType, ImageSaveEntry>>>;

export interface ImageSaveView {
  preview?: string;
  saving: boolean;
  savedAt?: number;
}

export const EMPTY_IMAGE_SAVE: ImageSaveState = Object.freeze({});
const IDLE_IMAGE_SAVE: ImageSaveView = Object.freeze({ saving: false });

export function beginImageSave(state: ImageSaveState, type: ImageSlotType, sceneKey: string, token: number): ImageSaveState {
  return { ...state, [type]: { sceneKey, token, saving: true } };
}

export function showImageSavePreview(state: ImageSaveState, type: ImageSlotType, token: number, preview: string): ImageSaveState {
  const entry = state[type];
  if (!entry || entry.token !== token) return state;
  return { ...state, [type]: { ...entry, preview } };
}

/** 저장 마무리(성공이면 savedAt, 실패·취소면 null). 더 새 저장이 칸을 차지했으면 아무것도 바꾸지 않는다. */
export function finishImageSave(state: ImageSaveState, type: ImageSlotType, token: number, savedAt: number | null): ImageSaveState {
  const entry = state[type];
  if (!entry || entry.token !== token) return state;
  return { ...state, [type]: { sceneKey: entry.sceneKey, token, saving: false, ...(savedAt != null ? { savedAt } : {}) } };
}

/** 지금 씬의 그 칸을 비운다(그림 지우기·주석 반영). 진행 중이던 저장의 마무리도 무효가 된다. */
export function clearImageSave(state: ImageSaveState, type: ImageSlotType, sceneKey: string): ImageSaveState {
  const entry = state[type];
  if (!entry || entry.sceneKey !== sceneKey) return state;
  const next: Partial<Record<ImageSlotType, ImageSaveEntry>> = { ...state };
  delete next[type];
  return next;
}

/** 지금 씬에서 보일 모습. 다른 씬의 저장이면 아무것도 없는 것으로 본다. */
export function imageSaveView(state: ImageSaveState, type: ImageSlotType, sceneKey: string): ImageSaveView {
  const entry = state[type];
  if (!entry || entry.sceneKey !== sceneKey) return IDLE_IMAGE_SAVE;
  return entry;
}

/* ─── 나가는 카드(고스트) 자리 ─────────────────────────────── */

/**
 * 나가는 카드를 칸 안 어디에 얼마만큼 깔지(리뷰 반영).
 * - 바깥 스크롤 상자가 있으면(BG 창) 다음 씬이 짧아 스크롤 위치가 당겨진 만큼(scrollShift, 보통 음수) 같이 옮겨
 *   보던 그 자리 그대로 지나가게 한다(맨 아래까지 내려 보다 짧은 씬으로 넘기면 나가는 카드가 위로 튀던 것).
 * - 아래 끝은 칸 높이(heightCap)를 넘지 않는다 — 고스트가 스크롤 영역을 늘리지 않게.
 */
export function ghostBox({
  top,
  height,
  scrollShift = 0,
  heightCap = null,
}: {
  top: number;
  height: number;
  scrollShift?: number;
  heightCap?: number | null;
}): { top: number; height: number } {
  const placedTop = top + scrollShift;
  if (heightCap == null) return { top: placedTop, height };
  return { top: placedTop, height: Math.max(0, Math.min(height, heightCap - placedTop)) };
}

/* ─── 넘김 준비 소비 ───────────────────────────────────────── */

/**
 * 씬이 바뀔 때마다 준비해 둔 넘김을 한 칸 소비한다.
 * - 준비가 오래됐으면(staleMs) 버린다.
 * - 도트로 여러 칸을 건너뛰면 마지막 칸에 도착했을 때 한 번만 넘긴다(그 전 칸은 keep 으로 남긴다).
 */
export function advancePendingFlip<P extends { at: number; stepsLeft: number }>(
  pending: P | null,
  now: number,
): { ready: P | null; keep: P | null } {
  if (!pending) return { ready: null, keep: null };
  if (now - pending.at > SCENE_FLIP.staleMs) return { ready: null, keep: null };
  const stepsLeft = pending.stepsLeft - 1;
  if (stepsLeft > 0) return { ready: null, keep: { ...pending, stepsLeft } };
  return { ready: { ...pending, stepsLeft: 0 }, keep: null };
}

/* ─── 닫히는 동안 단일 상세 창 대상 고정 ─────────────────────── */

export interface DetailTarget {
  sheetName: string;
  sceneIndex: number;
}

/**
 * 단일(BG/액팅) 상세 창이 가리킬 대상(리뷰 반영).
 * 카드에서 열면 detailContext 가 없어 '지금 파트의 n번째'로 찾는다. 그런데 #화·#파트 점프·뒤로 가기는
 * 파트를 바꾸는 같은 갱신에서 닫기 신호를 보낸다 — 창이 0.16초 가라앉는 동안 대상 파트의 같은 순번 씬이
 * 보이면 안 되므로, 닫기 신호를 아직 소비하지 않은 렌더(closePending)에서는 직전에 보이던 대상(pinned)을 쓴다.
 * 돌려준 pin 은 다음 렌더의 pinned 로 넘긴다(닫기 신호 effect 가 이 값을 detailContext 로 고정한다).
 */
export function resolveDetailContext({
  context,
  sceneIndex,
  currentSheetName,
  closePending,
  pinned,
}: {
  context: DetailTarget | null;
  sceneIndex: number | null;
  currentSheetName: string | null;
  closePending: boolean;
  pinned: DetailTarget | null;
}): { context: DetailTarget | null; pin: DetailTarget | null } {
  if (context) return { context, pin: context };
  if (sceneIndex === null) return { context: null, pin: null };
  if (closePending && pinned) return { context: pinned, pin: pinned };
  return { context: null, pin: currentSheetName ? { sheetName: currentSheetName, sceneIndex } : null };
}
