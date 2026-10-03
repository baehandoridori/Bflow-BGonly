import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useMotionPref } from '@/hooks/useMotionPref';
import { cn } from '@/utils/cn';
import { EASE, EASE_CSS } from '@/utils/motion';
import {
  ROLL_MS,
  ROLL_QUIET_MS,
  STRIP_CELLS,
  STRIP_TEXT,
  chooseRollMode,
  formatRolling,
  makeBezierEasing,
  planStripRoll,
  rollDirection,
  splitRollingDigits,
  type RollDirection,
} from '@/utils/progressMotion';

/**
 * 진행률 숫자 — 바뀐 자릿수만 '또르륵' 굴러 새 숫자에서 멈춘다 (움직임 폴리싱 10번).
 *
 * - 작은 변화: 바뀐 자리의 숫자 띠만 ROLL_MS 동안 굴린다. 오를 땐 위로만, 내릴 땐 아래로만(주행거리계).
 * - 큰 변화(5%p 이상): 숫자가 막대와 같은 길이·곡선으로 세어 올라간다. 굴러가는 중 새 값이 오면 그 자리에서 이어 간다.
 * - 처음 그릴 때·resetKey(탭/에피소드)가 바뀐 직후·'동작 줄이기'면 바로 최종값.
 * - 숫자 칸 하나만 다시 그린다: 굴림은 WAAPI transform(합성 스레드), 카운트업도 이 작은 컴포넌트 안의 상태만 바뀐다.
 *   쉬는 동안에는 평범한 글자 하나라 씬 카드처럼 많이 깔려도 가볍다(띠는 굴러가는 동안에만 그린다).
 * - 숫자 폭은 tabular-nums 로 고정한다.
 */

const easeOut = makeBezierEasing(EASE.out as readonly number[]);
const IDLE = { kind: 'idle' } as const;

type View =
  | typeof IDLE
  | { kind: 'roll'; from: string; dir: RollDirection }
  | { kind: 'count'; text: string };

interface CountState {
  from: number;
  to: number;
  /** 첫 프레임 시각. 막대의 CSS 전환도 값이 바뀐 다음 프레임에 출발하므로 같은 시계(rAF 시각)로 맞춘다. */
  start: number | null;
  current: number;
  raf: number;
}

export interface RollingNumberProps {
  value: number;
  /** 소수 자릿수(고정). 기본 0. */
  decimals?: number;
  /** 뒤에 붙는 고정 글자(예: '%'). 굴리지 않는다. */
  suffix?: string;
  /** 이 값이 바뀐 직후(탭·에피소드 전환, 데이터 첫 도착)에는 굴리지 않고 바로 보여 준다. */
  resetKey?: string | number | null;
  /** 큰 변화에서 막대와 함께 세어 올라갈지. 곁에 막대가 없는 숫자(씬 카드 등)는 false — 늘 자릿수만 굴린다. */
  countUp?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function RollingNumber({
  value,
  decimals = 0,
  suffix = '',
  resetKey = null,
  countUp = true,
  className,
  style,
  title,
}: RollingNumberProps) {
  const { reduce } = useMotionPref();
  const text = formatRolling(value, decimals);
  const target = Number(text);
  const [view, setView] = useState<View>(IDLE);
  const rootRef = useRef<HTMLSpanElement>(null);
  const lastRef = useRef({ value: target, text, resetKey });
  const quietUntilRef = useRef(0);
  const countRef = useRef<CountState | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const decimalsRef = useRef(decimals);
  decimalsRef.current = decimals;

  const stopCount = () => {
    if (countRef.current) cancelAnimationFrame(countRef.current.raf);
    countRef.current = null;
  };
  const clearIdleTimer = () => {
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  };
  const settle = () => {
    stopCount();
    clearIdleTimer();
    setView(IDLE);
  };

  // 굴림이 끝나면 띠를 걷고 평범한 글자로 돌아간다(띠의 마지막 칸과 같은 자리라 바뀌는 순간이 보이지 않는다).
  const armIdle = () => {
    clearIdleTimer();
    const check = () => {
      const root = rootRef.current;
      const running = root?.getAnimations?.({ subtree: true }).some((anim) => anim.playState === 'running') ?? false;
      if (running) {
        idleTimerRef.current = window.setTimeout(check, 60);
        return;
      }
      idleTimerRef.current = null;
      setView((prev) => (prev.kind === 'roll' ? IDLE : prev));
    };
    idleTimerRef.current = window.setTimeout(check, ROLL_MS + 40);
  };

  const startCount = (from: number, to: number) => {
    stopCount();
    const state: CountState = { from, to, start: null, current: from, raf: 0 };
    countRef.current = state;
    const step = (frameTime: number) => {
      if (countRef.current !== state) return;
      if (state.start === null) state.start = frameTime;
      const progress = Math.min(1, (frameTime - state.start) / ROLL_MS);
      state.current = from + (to - from) * easeOut(progress);
      if (progress >= 1) {
        countRef.current = null;
        setView(IDLE);
        return;
      }
      const nextText = formatRolling(state.current, decimalsRef.current);
      setView((prev) => (prev.kind === 'count' && prev.text === nextText ? prev : { kind: 'count', text: nextText }));
      state.raf = requestAnimationFrame(step);
    };
    clearIdleTimer();
    setView({ kind: 'count', text: formatRolling(from, decimalsRef.current) });
    state.raf = requestAnimationFrame(step);
  };

  useLayoutEffect(() => {
    quietUntilRef.current = now() + ROLL_QUIET_MS;
    return () => {
      stopCount();
      clearIdleTimer();
    };
  }, []);

  useLayoutEffect(() => {
    if (reduce) settle();
  }, [reduce]);

  useLayoutEffect(() => {
    const last = lastRef.current;
    const keyChanged = !Object.is(last.resetKey, resetKey);
    if (!keyChanged && last.text === text) return;
    lastRef.current = { value: target, text, resetKey };
    const at = now();
    if (keyChanged) quietUntilRef.current = at + ROLL_QUIET_MS;
    if (reduce || at < quietUntilRef.current) {
      settle();
      return;
    }
    const counting = countRef.current;
    const from = counting ? counting.current : last.value;
    if (chooseRollMode(from, target, { countUp, counting: counting !== null }) === 'count') {
      startCount(from, target);
      return;
    }
    setView({ kind: 'roll', from: last.text, dir: rollDirection(last.value, target) });
    armIdle();
    // settle·startCount·armIdle 은 ref 만 만지는 안정된 함수다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, target, resetKey, reduce, countUp]);

  const rootClass = cn('bf-roll', className);

  if (view.kind !== 'roll') {
    return (
      <span ref={rootRef} className={rootClass} style={style} title={title}>
        {view.kind === 'count' ? view.text : text}
        {suffix}
      </span>
    );
  }

  const fromDigits = new Map<string, number>();
  for (const token of splitRollingDigits(view.from)) {
    if (token.kind === 'digit') fromDigits.set(token.key, token.digit);
  }

  return (
    <span ref={rootRef} className={rootClass} style={style} title={title}>
      <span className="sr-only">
        {text}
        {suffix}
      </span>
      <span aria-hidden="true">
        {splitRollingDigits(text).map((token) =>
          token.kind === 'digit' ? (
            <RollColumn key={token.key} digit={token.digit} mountFrom={fromDigits.get(token.key) ?? 0} dir={view.dir} />
          ) : (
            <span key={token.key}>{token.char}</span>
          ),
        )}
        {suffix}
      </span>
    </span>
  );
}

/* ─── 자리 하나: 숫자 띠(0~9 네 벌)를 위아래로 미끄러뜨린다 ─── */

const cellTransform = (cell: number) => `translateY(${(-cell * 100) / STRIP_CELLS}%)`;

/** 지금 보이는 칸(굴러가는 중이면 소수). 계산된 transform 의 세로 이동 ÷ 한 칸 높이. */
function readStripCell(strip: HTMLElement, fallback: number): number {
  const cellPx = strip.offsetHeight / STRIP_CELLS;
  const matrix = getComputedStyle(strip).transform;
  if (!cellPx || !matrix || matrix === 'none') return fallback;
  const match = matrix.match(/^matrix(3d)?\(([^)]+)\)$/);
  if (!match) return fallback;
  const values = match[2].split(',').map((part) => Number(part.trim()));
  const ty = match[1] ? values[13] : values[5];
  return Number.isFinite(ty) ? -ty / cellPx : fallback;
}

/** 굴러가는 중이면 지금 보이는 칸을 애니메이션 진행도(곡선 적용 뒤)로 계산한다 — DOM 을 읽지 않는다. 모르면 null. */
function rollingCellNow(anim: Animation | null, roll: { from: number; to: number } | null): number | null {
  if (!anim || !roll) return null;
  const progress = anim.effect?.getComputedTiming().progress;
  return typeof progress === 'number' && Number.isFinite(progress) ? roll.from + (roll.to - roll.from) * progress : null;
}

function RollColumn({ digit, mountFrom, dir }: { digit: number; mountFrom: number; dir: RollDirection }) {
  const stripRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef<number | null>(null);
  const animRef = useRef<Animation | null>(null);
  /** 지금 굴리는 칸 범위(진행도로 보이는 자리를 계산할 때 쓴다). */
  const rollRef = useRef<{ from: number; to: number } | null>(null);
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const mountFromRef = useRef(mountFrom);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const prevTarget = targetRef.current ?? mountFromRef.current;
    // 굴러가는 중이면 지금 보이는 자리에서 이어 감는다(애니메이션을 지우기 전에 읽는다).
    // 보이는 자리는 애니메이션 진행도로 계산하고, 멈춰 있으면 마지막 목표가 곧 보이는 자리다. 띠의 높이·계산된 transform 을
    // 읽으면 레이아웃을 강제로 다시 계산해서 단계 클릭마다 카드 목록 전체를 다시 쟀다(움직임 폴리싱 검증 지적 perf-6).
    // 진행도를 얻지 못할 때만 띠를 읽는다.
    const running = animRef.current?.playState === 'running';
    const visual = targetRef.current === null || !running
      ? prevTarget
      : rollingCellNow(animRef.current, rollRef.current) ?? readStripCell(strip, prevTarget);
    const plan = planStripRoll(visual, prevTarget, digit, dirRef.current);
    targetRef.current = plan.to;
    const toTransform = cellTransform(plan.to);
    strip.style.transform = toTransform;
    animRef.current?.cancel();
    animRef.current = null;
    if (Math.abs(plan.from - plan.to) < 0.001 || typeof strip.animate !== 'function') return;
    animRef.current = strip.animate(
      [{ transform: cellTransform(plan.from) }, { transform: toTransform }],
      { duration: ROLL_MS, easing: EASE_CSS.out },
    );
    rollRef.current = { from: plan.from, to: plan.to };
    // 언마운트 때 애니메이션을 따로 지우지 않는다 — 요소와 함께 사라지고, 개발 모드(StrictMode)의
    // '마운트 직후 한 번 떼었다 붙이기'에서 막 시작한 굴림이 지워지지 않게 한다(다시 붙을 때 지금 자리에서 이어 감는다).
  }, [digit]);

  return (
    <span className="bf-roll-col">
      <span className="bf-roll-ghost">{digit}</span>
      <span ref={stripRef} className="bf-roll-strip">
        {STRIP_TEXT}
      </span>
    </span>
  );
}
