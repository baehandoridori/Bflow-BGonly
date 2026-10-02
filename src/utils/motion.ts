import type { BezierDefinition, Target, TargetAndTransition, Transition } from 'framer-motion';
import { isMinimalMotionInDom } from './motionLevel.ts';

/* ═══════════════════════════════════════════════════════════════
   움직임 공통 박자 (움직임 폴리싱 바탕 A, 2026-10)

   - 속도는 세 가지: 빠름(누름·화살표·작은 메뉴) · 보통(창·팝오버·내용 교체) · 느림(미끄러지는 표시·카드 이동).
   - 곡선은 들어올 때 out(빠르게 출발해 부드럽게 멈춤), 나갈 때 in(부드럽게 출발해 빠르게 사라짐).
   - 같은 값이 CSS 변수(src/index.css :root 의 --motion-*·--ease-*)와 Tailwind 확장
     (duration-fast/base/slow, ease-out-expo/in-quick/spring/snap)에도 있다. 하나를 바꾸면 셋 다 바꾼다
     (tests/motion/motionTokens.test.ts 가 어긋나면 잡는다).

   framer-motion 10.18 규칙 (tasks/lessons.md 2026-10-02):
   - x·y·scale 같은 개별 값은 메인 스레드가 매 프레임 계산한다. 움직임은 transform '문자열'로 넘겨
     WAAPI(합성 스레드)로 돌리고, 끝값은 transitionEnd { transform: 'none' } 으로 비운다
     (translateY(0) 이 남으면 fixed 자손의 기준 상자가 바뀐다).
   - 'none' 에서 출발하는 transform 애니메이션은 framer 가 숫자를 전부 0 으로 바꾼 값(scale(0)!)에서
     출발시킨다. 그래서 나가는(exit) 움직임은 항상 [제자리, 목표] 두 키프레임으로 명시한다.
   - '동작 줄이기'는 MotionConfig 가 transform 문자열·WAAPI 를 막지 못한다. 프리셋을 고를 때
     useMotionPref().reduce 를 넘겨 opacity 만 쓰는 변형을 받는다.

   node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X — 같은 폴더의 .ts 상대 import 와
   타입 import 만).
   ═══════════════════════════════════════════════════════════════ */

export type MotionSpeed = 'fast' | 'base' | 'slow';
export type MotionEase = 'out' | 'in' | 'std' | 'spring' | 'snap';

/** 박자(ms). 빠름 120 · 보통 180 · 느림 260. */
export const MOTION_MS: Readonly<Record<MotionSpeed, number>> = Object.freeze({ fast: 120, base: 180, slow: 260 });

/** framer-motion 의 transition.duration 은 초 단위다. */
export const MOTION_S: Readonly<Record<MotionSpeed, number>> = Object.freeze({ fast: 0.12, base: 0.18, slow: 0.26 });

/** CSS 문자열판 — `--motion-fast/base/slow` 와 같은 값. */
export const MOTION_CSS: Readonly<Record<MotionSpeed, string>> = Object.freeze({ fast: '120ms', base: '180ms', slow: '260ms' });

/** 내용 교체(fadeSwap) 길이. 보통보다 짧게 — 바뀌는 순간이 끈적이지 않게. */
export const SWAP_MS = 140;

/**
 * 곡선. framer 의 `ease` 에 그대로 넣을 수 있다(가변 튜플이라야 framer 타입과 맞는다 — 고치지 말 것).
 * - out: 들어올 때. useStackFlip·캘린더 넘김과 같은 곡선.
 * - in: 나갈 때.
 * - std: 제자리 변화(색·크기). Tailwind 기본 transition 곡선과 같다.
 * - spring: 작은 보상 — 살짝 넘쳤다 돌아온다('톡').
 * - snap: 작은 반응 — 화살표 회전·누름.
 */
export const EASE: Readonly<Record<MotionEase, BezierDefinition>> = Object.freeze({
  out: [0.16, 1, 0.3, 1],
  in: [0.4, 0, 1, 1],
  std: [0.4, 0, 0.2, 1],
  spring: [0.34, 1.56, 0.64, 1],
  snap: [0.2, 0, 0, 1],
});

export function bezierCss([x1, y1, x2, y2]: readonly number[]): string {
  return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
}

/** CSS 문자열판 — `--ease-out/in/std/spring/snap` 과 같은 곡선. WAAPI easing·인라인 transition 에 쓴다. */
export const EASE_CSS: Readonly<Record<MotionEase, string>> = Object.freeze({
  out: bezierCss(EASE.out),
  in: bezierCss(EASE.in),
  std: bezierCss(EASE.std),
  spring: bezierCss(EASE.spring),
  snap: bezierCss(EASE.snap),
});

/**
 * 인라인 style.transition 문자열. 예: transitionCss(['opacity', 'transform'], 'base', 'out')
 * → 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 180ms cubic-bezier(0.16, 1, 0.3, 1)'
 */
export function transitionCss(properties: readonly string[], speed: MotionSpeed = 'base', ease: MotionEase = 'std'): string {
  return properties.map((property) => `${property} ${MOTION_CSS[speed]} ${EASE_CSS[ease]}`).join(', ');
}

/* ─── framer 프리셋 ───────────────────────────────────────────── */

/** `<motion.div {...preset}>` 로 펼쳐 쓰는 묶음. AnimatePresence 안에서 exit 까지 쓴다. */
export interface MotionPreset {
  initial: Target;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
}

/**
 * 시작 transform 과 같은 모양의 '제자리' 값. framer 는 모양이 같은 문자열끼리만 숫자를 이어 준다.
 * translate*·rotate*·skew* 는 0(단위 유지), scale* 은 1.
 * 예: 'translateY(6px) scale(0.98)' → 'translateY(0px) scale(1)'
 */
export function identityTransform(transform: string): string {
  return transform.replace(/([a-zA-Z0-9]+)\(([^)]*)\)/g, (_whole, fn: string, args: string) => {
    const name = fn.toLowerCase();
    if (name.startsWith('matrix') || name === 'perspective') {
      throw new Error(`identityTransform: ${fn}() 는 제자리 값을 정할 수 없다 — translate·scale·rotate·skew 로 적을 것`);
    }
    const isScale = name.startsWith('scale');
    const zeroed = args.replace(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?([a-z%]*)/gi, (_n, unit: string) => (isScale ? '1' : `0${unit}`));
    return `${fn}(${zeroed})`;
  });
}

export interface TransformPresetOptions {
  /** 들어오기 전 모습. 예: 'translateY(6px) scale(0.98)'. 요소가 자기 transform(위치 잡기용)을 갖고 있으면 쓰지 말 것 — 바깥 래퍼가 위치를 맡는다. */
  from: string;
  /** 나갈 때 도착 모습. 기본은 from. */
  exitTo?: string;
  /** 들어오는 길이(ms). 기본 보통(180). */
  duration?: number;
  ease?: BezierDefinition;
  /** 나가는 길이(ms). 기본 빠름(120). */
  exitDuration?: number;
  exitEase?: BezierDefinition;
}

/** opacity 만 쓰는 프리셋 — '동작 줄이기' 변형과 내용 교체에 쓴다. */
export function fadePreset(durationMs: number = MOTION_MS.fast, ease: BezierDefinition = EASE.std): MotionPreset {
  const transition: Transition = { duration: durationMs / 1000, ease };
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0, transition },
    transition,
  };
}

/**
 * transform 문자열 + transitionEnd 'none' 방식의 들어오기/나가기 프리셋을 만든다.
 * reduce 면 움직임 없이 opacity 만 빠르게(120ms) 바꾸는 변형을 돌려준다.
 * 갈래별 새 프리셋은 이 함수로 자기 파일에서 만든다(이 파일의 표에 덧붙이지 않는다).
 */
export function transformPreset(options: TransformPresetOptions, reduce = false): MotionPreset {
  if (reduce) return fadePreset(MOTION_MS.fast);
  const {
    from,
    exitTo = from,
    duration = MOTION_MS.base,
    ease = EASE.out,
    exitDuration = MOTION_MS.fast,
    exitEase = EASE.in,
  } = options;
  const rest = identityTransform(from);
  return {
    initial: { opacity: 0, transform: from },
    animate: { opacity: 1, transform: rest, transitionEnd: { transform: 'none' } },
    exit: {
      opacity: 0,
      // 'none' 에서 출발하면 framer 가 scale(0) 에서 출발시킨다 — 제자리 값을 명시한다.
      transform: [identityTransform(exitTo), exitTo],
      transition: { duration: exitDuration / 1000, ease: exitEase },
    },
    transition: { duration: duration / 1000, ease },
  };
}

const MOTION_PRESETS = {
  /** 모달·팝오버 떠오르기 — 6px 아래·98% 크기에서 180ms. */
  popIn: {
    full: transformPreset({ from: 'translateY(6px) scale(0.98)', exitTo: 'translateY(4px) scale(0.98)' }),
    reduced: transformPreset({ from: 'translateY(6px) scale(0.98)' }, true),
  },
  /** 같은 자리의 내용 교체 — opacity 만 140ms. 움직임이 없으니 '동작 줄이기'에서도 같다. */
  fadeSwap: {
    full: fadePreset(SWAP_MS),
    reduced: fadePreset(SWAP_MS),
  },
} as const;

export type MotionPresetName = keyof typeof MOTION_PRESETS;

/**
 * 이름으로 공용 프리셋을 고른다. 같은 객체를 돌려주므로 렌더마다 새로 만들지 않는다.
 *   const { reduce } = useMotionPref();
 *   <motion.div {...motionPreset('popIn', reduce)} />
 */
export function motionPreset(name: MotionPresetName, reduce: boolean): MotionPreset {
  const entry = MOTION_PRESETS[name];
  return reduce ? entry.reduced : entry.full;
}

/* ─── WAAPI 도우미 ────────────────────────────────────────────── */

/**
 * OS '동작 줄이기' 또는 앱 설정 '움직임: 최소'(<html data-motion="minimal">).
 * 창이 없는 환경(테스트·메인 프로세스)에서는 false. React 안에서는 useMotionPref 를 쓴다.
 */
export function prefersReducedMotion(): boolean {
  if (isMinimalMotionInDom()) return true;
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 움직임(위치·크기·회전)을 만드는 키. '동작 줄이기'에서는 뺀다. */
const MOVEMENT_KEYS = new Set(['transform', 'translate', 'scale', 'rotate']);
/** 그려지는 값이 아닌 키프레임 속성. */
const TIMING_KEYS = new Set(['offset', 'easing', 'composite']);

/**
 * el.animate 를 공통 기본값(보통 180ms · out 곡선)으로 부른다. 합성 스레드에서 도는 transform·opacity 를 쓸 것.
 * - reduce(기본: OS 설정)면 transform/translate/scale/rotate 를 빼고, 남은 값(opacity 등)만 한 번·최대 120ms 로 돌린다.
 *   남는 게 없으면 아무것도 하지 않고 null — 호출한 쪽은 최종 상태를 스타일로 이미 갖고 있어야 한다.
 * - WAAPI 가 없는 환경(테스트 DOM 등)이나 el 이 없으면 null.
 * 클래스를 넣었다 빼서 animation 을 껐다 켜는 방식(animation:none 토글) 대신 이걸 쓴다 — 끝날 때 깜빡이지 않는다.
 */
export function animateEl(
  el: Element | null | undefined,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions = {},
  reduce: boolean = prefersReducedMotion(),
): Animation | null {
  if (!el || typeof (el as { animate?: unknown }).animate !== 'function') return null;
  const merged: KeyframeAnimationOptions = { duration: MOTION_MS.base, easing: EASE_CSS.out, ...options };
  if (!reduce) return el.animate(keyframes, merged);

  const calm = keyframes.map((frame) => {
    const next: Keyframe = {};
    for (const [key, value] of Object.entries(frame)) {
      if (!MOVEMENT_KEYS.has(key)) next[key] = value;
    }
    return next;
  });
  const hasVisual = calm.some((frame) => Object.keys(frame).some((key) => !TIMING_KEYS.has(key)));
  if (!hasVisual) return null;
  const duration = typeof merged.duration === 'number' ? Math.min(merged.duration, MOTION_MS.fast) : MOTION_MS.fast;
  return el.animate(calm, { ...merged, duration, iterations: 1 });
}
