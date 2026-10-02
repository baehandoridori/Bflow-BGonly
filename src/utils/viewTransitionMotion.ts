import { EASE_CSS, MOTION_MS, animateEl } from './motion.ts';

/* ═══════════════════════════════════════════════════════════════
   화면·파트·에피소드 전환 (움직임 폴리싱 12번 view-transition)

   - 사이드바 화면 이동: 본문 위 배경색 덮개를 180ms 동안 걷는다(내용 자체는 움직이지 않는다).
     본문에 opacity 를 걸면 대시보드 위젯 흐림이 꺼지고(Backdrop Root), transform 을 걸면 fixed 자손의
     기준 상자가 바뀌기 때문에 덮개 한 장만 움직인다.
   - 로딩 동그라미는 250ms 를 넘길 때만 보인다.
   - 카드 차례 등장: 20ms 간격, 마지막 카드도 200ms 안에 출발.
   - 파트·에피소드 전환: 카드 묶음 한 덩어리가 방향(다음=오른쪽, 이전=왼쪽)에서 살짝 미끄러져 들어온다.
   - 300ms 안에 다시 바꾸면(연타) 미끄러지거나 다시 드러나는 연출 없이 바로 바꾼다.

   node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X).
   ═══════════════════════════════════════════════════════════════ */

/** 화면 덮개를 걷는 길이(ms). 보통 박자. */
export const VIEW_REVEAL_MS = MOTION_MS.base;
/** '동작 줄이기'에서는 덮개 페이드만 짧게. */
export const VIEW_REVEAL_REDUCED_MS = MOTION_MS.fast;
/** 이보다 오래 걸릴 때만 로딩 동그라미를 보인다. */
export const VIEW_SPINNER_DELAY_MS = 250;

/** 덮개 걷기 키프레임 — opacity 만(합성 스레드). */
export const VIEW_REVEAL_KEYFRAMES: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];

/** 덮개 걷기 타이밍. 덮개의 평소 opacity 는 0 이라 fill 없이 끝나도 그대로 사라진 상태다. */
export function viewRevealTiming(reduce: boolean): KeyframeAnimationOptions {
  return {
    duration: reduce ? VIEW_REVEAL_REDUCED_MS : VIEW_REVEAL_MS,
    easing: EASE_CSS.out,
  };
}

/** 화면이 마운트되자마자 자기 안에 창을 여는 요청(알림·딥링크·검색 점프). */
export interface PendingOpenRequests {
  /** 씬 목록: 알림·딥링크로 씬 창을 바로 연다. */
  pendingDeepLink: unknown;
  pendingSceneModalRequest: unknown;
  /** 캐릭터 현황판: 검색·위젯에서 캐릭터 상세 창을 바로 연다. */
  pendingCharacterBoardRequest?: unknown;
}

export interface ViewRevealContext extends PendingOpenRequests {
  /** 지금 들어온 화면. */
  view: string;
  /** 화면 틀(MainLayout)이 생긴 뒤 첫 화면인지 — 앱 첫 진입은 따로 연출하므로 덮지 않는다. */
  isFirstView: boolean;
}

/**
 * 덮개 연출을 건너뛸지.
 * - 첫 화면(로그인 직후·앱 시작)은 첫 진입 연출 몫.
 * - 배플레이그라운드는 몰입 화면이라 자체 진입 연출이 있다.
 * - 들어가자마자 그 화면 안에 창을 여는 경우(알림 링크로 씬 창, 검색으로 캐릭터 상세): 창이 덮개에 가렸다
 *   함께 드러나지 않고 곧바로 떠야 해서 생략.
 */
export function shouldSkipViewReveal(ctx: ViewRevealContext): boolean {
  if (ctx.isFirstView) return true;
  if (ctx.view === 'playground') return true;
  if (ctx.view === 'scenes' && (ctx.pendingDeepLink || ctx.pendingSceneModalRequest)) return true;
  if (ctx.view === 'character-board' && ctx.pendingCharacterBoardRequest) return true;
  return false;
}

export interface ViewRevealPlan {
  /** 이전 화면 스크롤이 남아 새 화면이 중간부터 보이지 않게 본문 스크롤을 맨 위로. */
  resetScroll: boolean;
  /** 덮개를 걷는 연출을 할지. */
  reveal: boolean;
}

/**
 * 화면 신호 하나를 어떻게 처리할지. 같은 화면이 다시 신호를 보내면(StrictMode 이중 실행) null — 아무것도 안 한다.
 * 첫 화면은 스크롤을 건드리지 않는다(복원된 위치 보호).
 */
export function planViewReveal(lastView: string | null, view: string, pending: PendingOpenRequests): ViewRevealPlan | null {
  if (lastView === view) return null;
  const isFirstView = lastView === null;
  return {
    resetScroll: !isFirstView,
    reveal: !shouldSkipViewReveal({ ...pending, view, isFirstView }),
  };
}

/* ─── 카드 차례 등장 ─────────────────────────────────────────── */

export const CARD_CASCADE_STEP_MS = 20;
export const CARD_CASCADE_MAX_DELAY_MS = 200;
export const CARD_CASCADE_DURATION_MS = 200;

/** i 번째 카드의 출발 지연(ms). 20ms 간격, 최대 200ms. */
export function cardCascadeDelayMs(index: number): number {
  const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  return Math.min(i * CARD_CASCADE_STEP_MS, CARD_CASCADE_MAX_DELAY_MS);
}

/** 카드 래퍼 style — CSS(.bf-card-cascade)가 이 지연으로 마운트 때 한 번만 떠오른다. */
export function cardCascadeStyle(index: number): { animationDelay: string } {
  return { animationDelay: `${cardCascadeDelayMs(index)}ms` };
}

/* ─── 연타 판정 ──────────────────────────────────────────────── */

/** 이 시간 안에 다시 바꾸면 연타로 보고 바로 바꾼다(캘린더 기간 넘김과 같은 값). */
export const RAPID_SWAP_MS = 300;

/** 직전 전환(lastAt)과 windowMs 안이면 연타. 처음(-Infinity)은 연타가 아니다. */
export function isRapidSwap(now: number, lastAt: number, windowMs: number = RAPID_SWAP_MS): boolean {
  return now - lastAt < windowMs;
}

export interface RapidGate {
  /** 이번 전환을 기록하고, 직전 전환과 RAPID_SWAP_MS 안이면 true(=연출 생략). */
  hit(now: number): boolean;
}

/** 버튼을 누를 때마다 부르는 연타 판정기(휴가 달 넘김). 연타 중에는 마지막 전환 기준. */
export function createRapidGate(windowMs: number = RAPID_SWAP_MS): RapidGate {
  let last = Number.NEGATIVE_INFINITY;
  return {
    hit(now: number) {
      const rapid = isRapidSwap(now, last, windowMs);
      last = now;
      return rapid;
    },
  };
}

/* ─── 키가 바뀔 때의 전환 판정 (묶음 미끄러짐·대시보드 내용) ──────── */

export interface SwapGate {
  /** 마지막으로 본 키. */
  key: string | null;
  /** 마지막 전환 시각. */
  at: number;
}

export const INITIAL_SWAP_GATE: SwapGate = Object.freeze({ key: null, at: Number.NEGATIVE_INFINITY });

/**
 * - none: 아무것도 하지 않는다(키 그대로, 처음 정해지는 키, 키가 사라짐). 돌던 움직임도 그대로 둔다.
 * - instant: 돌던 움직임을 끊고 연출 없이 바로 바꾼다(연타·skip).
 * - animate: 돌던 움직임을 끊고 새로 연출한다. from·to 는 이전·새 키.
 */
export type SwapStep =
  | { gate: SwapGate; decision: 'none' }
  | { gate: SwapGate; decision: 'instant' }
  | { gate: SwapGate; decision: 'animate'; from: string; to: string };

/**
 * 키가 바뀔 때마다(layout effect) 한 번 부른다. 돌려준 gate 를 다음 판정에 넘긴다.
 * - 처음 마운트·처음 정해지는 키(null → 값)는 움직이지 않는다 — 처음 그려지는 화면은 덮개·첫 진입 연출 몫.
 * - 300ms 안에 다시 바뀌면(연타) 바로. 연타 중에는 마지막 전환 기준.
 * - skip 은 연타가 아닐 때만 묻는다(씬 창이 열린 중·알림으로 여는 중 등).
 */
export function stepSwapGate(gate: SwapGate, nextKey: string | null, now: number, skip?: () => boolean): SwapStep {
  const prevKey = gate.key;
  if (prevKey === nextKey) return { gate, decision: 'none' };
  if (prevKey === null || nextKey === null) return { gate: { key: nextKey, at: gate.at }, decision: 'none' };
  const next: SwapGate = { key: nextKey, at: now };
  if (isRapidSwap(now, gate.at) || skip?.()) return { gate: next, decision: 'instant' };
  return { gate: next, decision: 'animate', from: prevKey, to: nextKey };
}

/* ─── 컴포지팅 카드 cascade 켜짐 ─────────────────────────────── */

export interface CascadeArm {
  /** ↻ 를 누를 때마다 바뀌는 키. */
  key: number;
  /** 켜진 뒤 처음 본 에피소드. */
  ep: number | null;
  /** 카드 cascade 가 돌아도 되는지. */
  armed: boolean;
}

/**
 * 컴포지팅 카드 cascade 는 처음 들어왔을 때(첫 EP)와 ↻ 직후에만 돈다.
 * EP 가 바뀌면 카드 영역 전체가 한 덩어리로 미끄러져 들어오므로, 새로 생긴 카드만 따로 떠오르지 않게 끈다.
 * 한 번 꺼지면 ↻(key 변경)·화면 재진입 전까지 꺼져 있다. 바뀐 게 없으면 같은 객체를 돌려준다.
 */
export function nextCascadeArm(prev: CascadeArm | null, key: number, ep: number | null): CascadeArm {
  if (!prev || prev.key !== key) return { key, ep, armed: true };
  if (prev.ep === null) return ep === null ? prev : { ...prev, ep };
  if (ep !== prev.ep && prev.armed) return { ...prev, armed: false };
  return prev;
}

/* ─── 파트·에피소드 묶음 미끄러짐 ─────────────────────────────── */

export interface SceneLocation {
  episode: number | null | undefined;
  part: string | null | undefined;
}

/** 다음(뒤)으로 가면 1, 이전(앞)으로 가면 -1, 같거나 알 수 없으면 0. 에피소드 번호 → 파트 이름 순. */
export function compareSceneLocation(prev: SceneLocation, next: SceneLocation): -1 | 0 | 1 {
  const pe = prev.episode ?? null;
  const ne = next.episode ?? null;
  if (pe !== null && ne !== null && pe !== ne) return ne > pe ? 1 : -1;
  const pp = prev.part ?? '';
  const np = next.part ?? '';
  if (pp && np && pp !== np) {
    const c = pp.localeCompare(np, 'ko', { numeric: true, sensitivity: 'base' });
    if (c !== 0) return c < 0 ? 1 : -1;
  }
  return 0;
}

/** 씬 목록 묶음 키 — 에피소드가 아직 없으면 null(움직이지 않음). */
export function sceneGroupKey(episode: number | null | undefined, part: string | null | undefined): string | null {
  if (episode === null || episode === undefined) return null;
  return `${episode}|${part ?? ''}`;
}

export function parseSceneGroupKey(key: string): SceneLocation {
  const at = key.indexOf('|');
  const head = at < 0 ? key : key.slice(0, at);
  const episode = head === '' ? null : Number(head);
  return {
    episode: episode !== null && Number.isFinite(episode) ? episode : null,
    part: at < 0 ? null : (key.slice(at + 1) || null),
  };
}

/** 에피소드 번호 비교 — 다음 에피소드 1, 이전 -1. */
export function episodeDirection(prev: number | null | undefined, next: number | null | undefined): -1 | 0 | 1 {
  if (prev === null || prev === undefined || next === null || next === undefined || prev === next) return 0;
  return next > prev ? 1 : -1;
}

/**
 * 묶음이 들어오는 키프레임. 다음(dir 1)은 오른쪽에서, 이전(-1)은 왼쪽에서, 방향을 모르면(0) 아래에서 6px.
 * 끝값은 남기지 않는다(fill 없음) — transform 이 남으면 fixed 자손의 기준 상자가 바뀐다.
 */
export function groupSwapKeyframes(dir: -1 | 0 | 1, distancePx: number): Keyframe[] {
  const from = dir === 0 ? 'translateY(6px)' : `translateX(${dir * distancePx}px)`;
  const to = dir === 0 ? 'translateY(0px)' : 'translateX(0px)';
  return [
    { opacity: 0, transform: from },
    { opacity: 1, transform: to },
  ];
}

export interface ScrollBoxMetrics {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * 묶음이 미끄러져 들어오는 동안 스크롤 상자에서 잠깐 숨길 넘침 축.
 * 묶음이 오른쪽(+X)·아래(+Y)로 밀려 있는 만큼 스크롤 상자에 새 넘침이 생겨, 패딩 없는 상자면 그동안 스크롤바가
 * 번쩍 나타났다 사라진다(본문 높이도 출렁). 왼쪽·위로 밀린 부분은 스크롤 영역이 아니라 괜찮다.
 * 이미 그 축으로 넘쳐 스크롤바가 있는 상자(넓은 시트)는 숨기지 않는다 — 숨기면 오히려 스크롤바가 사라졌다 돌아온다.
 * '동작 줄이기'에서는 위치가 움직이지 않으니 숨길 필요가 없다.
 */
export function swapOverflowGuard(dir: -1 | 0 | 1, metrics: ScrollBoxMetrics, reduce: boolean): 'x' | 'y' | null {
  if (reduce) return null;
  if (dir === 1) return metrics.scrollWidth <= metrics.clientWidth ? 'x' : null;
  if (dir === 0) return metrics.scrollHeight <= metrics.clientHeight ? 'y' : null;
  return null;
}

/** 넘침을 잠깐 숨길 수 있는 스크롤 상자(HTMLElement 가 그대로 맞는다). */
export interface OverflowBox extends ScrollBoxMetrics {
  style: { overflowX: string; overflowY: string };
}

/** 스크롤 상자의 한 축 넘침을 잠깐 숨긴다. 원래 인라인 값으로 되돌리는 함수를 돌려준다(여러 번 불러도 한 번만). */
export function holdOverflowHidden(box: OverflowBox, axis: 'x' | 'y'): () => void {
  const prop = axis === 'x' ? 'overflowX' : 'overflowY';
  const prev = box.style[prop];
  box.style[prop] = 'hidden';
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    box.style[prop] = prev;
  };
}

export interface GroupSwapRequest {
  /** 미끄러질 묶음 래퍼. */
  el: Element | null | undefined;
  /** 다음(1)·이전(-1)·모름(0). 이전 키와 새 키를 받는다. */
  direction: (prevKey: string, nextKey: string) => -1 | 0 | 1;
  distancePx: number;
  durationMs: number;
  /** true 면 이번 전환은 연출 없이 바로. 연타가 아닐 때만 묻는다. */
  skip?: () => boolean;
  /** 묶음을 담은 스크롤 상자 — 움직일 때만 묻는다(그때만 크기를 잰다). */
  overflowBox?: () => OverflowBox | null;
  /** '동작 줄이기'. */
  reduce: boolean;
}

export interface GroupSwapController {
  /** 묶음 키가 바뀔 때(layout effect) 부른다. 이번 판정을 돌려준다. */
  update(key: string | null, now: number, request: GroupSwapRequest): SwapStep['decision'];
  /** 화면을 떠날 때 — 돌던 움직임을 끊고 숨긴 넘침을 되돌린다. */
  dispose(): void;
}

/**
 * 파트·에피소드 묶음 미끄러짐의 상태 기계(useGroupSwapMotion 이 쓴다 — React 밖이라 단위 테스트한다).
 * - 언제 움직일지는 stepSwapGate.
 * - 움직일 때 묶음이 오른쪽·아래로 밀리는 만큼 스크롤 상자 넘침을 잠깐 숨기고(swapOverflowGuard), 끝나거나
 *   끊기면 곧바로 되돌린다. cancel 이벤트는 비동기라 기다리지 않고 끊는 쪽에서 바로 되돌린다.
 * - 끝값을 남기지 않는다(fill 없음) — transform 이 남으면 fixed 자손의 기준 상자가 바뀐다.
 */
export function createGroupSwapController(): GroupSwapController {
  let gate: SwapGate = INITIAL_SWAP_GATE;
  let running: Animation | null = null;
  let release: (() => void) | null = null;
  const stop = () => {
    running?.cancel();
    running = null;
    release?.();
    release = null;
  };
  return {
    update(key, now, request) {
      const step = stepSwapGate(gate, key, now, request.skip);
      gate = step.gate;
      if (step.decision === 'none') return 'none';
      stop();
      if (step.decision !== 'animate') return step.decision;

      const dir = request.direction(step.from, step.to);
      const box = request.overflowBox?.() ?? null;
      const axis = box ? swapOverflowGuard(dir, box, request.reduce) : null;
      const held = box && axis ? holdOverflowHidden(box, axis) : null;
      const animation = animateEl(request.el, groupSwapKeyframes(dir, request.distancePx), { duration: request.durationMs }, request.reduce);
      if (!animation) {
        held?.();
        return 'instant';
      }
      running = animation;
      release = held;
      animation.onfinish = () => {
        held?.();
        if (running !== animation) return;
        running = null;
        release = null;
      };
      return 'animate';
    },
    dispose: stop,
  };
}

/** 씬 목록 파트·에피소드 전환 — 10px, 보통 박자. */
export const SCENE_GROUP_SWAP = { distancePx: 10, durationMs: MOTION_MS.base } as const;
/** 컴포지팅 에피소드 전환 — 16px, 240ms (사양). */
export const COMPOSITING_EP_SWAP = { distancePx: 16, durationMs: 240 } as const;
/** 대시보드 탭: 위젯 판은 그대로, 안쪽 내용만 다시 드러난다. */
export const DASHBOARD_CONTENT_SWAP_MS = MOTION_MS.base;
export const DASHBOARD_CONTENT_KEYFRAMES: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

/**
 * 대시보드 위젯 판의 정체성. 같은 판(같은 레이아웃)끼리 바꿀 때는 판을 다시 만들지 않고 내용만 갈아 끼운다.
 * - 에피소드 대시보드: 에피소드·탭과 상관없이 한 레이아웃.
 * - 전체 대시보드: 통합 탭은 통합 레이아웃, 배경·액팅 탭은 부서 레이아웃을 함께 쓴다.
 */
export function dashboardBoardIdentity(isEpMode: boolean, filter: string): 'ep' | 'all' | 'dept' {
  if (isEpMode) return 'ep';
  return filter === 'all' ? 'all' : 'dept';
}
