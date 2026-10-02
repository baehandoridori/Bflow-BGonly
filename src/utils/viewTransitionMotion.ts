import { EASE_CSS, MOTION_MS } from './motion.ts';

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

export interface ViewRevealContext {
  /** 지금 들어온 화면. */
  view: string;
  /** 화면 틀(MainLayout)이 생긴 뒤 첫 화면인지 — 앱 첫 진입은 따로 연출하므로 덮지 않는다. */
  isFirstView: boolean;
  /** 알림·딥링크로 씬 창을 바로 여는 중인지. */
  pendingDeepLink: unknown;
  pendingSceneModalRequest: unknown;
}

/**
 * 덮개 연출을 건너뛸지.
 * - 첫 화면(로그인 직후·앱 시작)은 첫 진입 연출 몫.
 * - 배플레이그라운드는 몰입 화면이라 자체 진입 연출이 있다.
 * - 알림 링크로 씬 목록에 들어오면서 씬 창을 바로 여는 경우: 창이 곧바로 떠야 해서 생략.
 */
export function shouldSkipViewReveal(ctx: ViewRevealContext): boolean {
  if (ctx.isFirstView) return true;
  if (ctx.view === 'playground') return true;
  if (ctx.view === 'scenes' && (ctx.pendingDeepLink || ctx.pendingSceneModalRequest)) return true;
  return false;
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

export interface RapidGate {
  /** 이번 전환을 기록하고, 직전 전환과 RAPID_SWAP_MS 안이면 true(=연출 생략). */
  hit(now: number): boolean;
}

export function createRapidGate(windowMs: number = RAPID_SWAP_MS): RapidGate {
  let last = Number.NEGATIVE_INFINITY;
  return {
    hit(now: number) {
      const rapid = now - last < windowMs;
      last = now;
      return rapid;
    },
  };
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
