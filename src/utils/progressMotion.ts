/* ═══════════════════════════════════════════════════════════════
   진행률 숫자 굴림 · 진행률 원 계산 (움직임 폴리싱 10번 rolling-numbers)

   - 숫자는 바뀐 자릿수만 주행거리계처럼 굴린다. 오를 땐 위로만, 내릴 땐 아래로만 감긴다
     (0~9 한 줄 띠로 9→0 을 되감으면 8·7·6… 엉뚱한 숫자가 스친다 → 0~9 를 여러 벌 이어 붙인 띠에서
     한 방향으로만 움직이고, 시작 위치를 같은 숫자의 다른 벌로 옮겨 띠 범위를 지킨다).
   - 큰 변화(COUNT_UP_MIN_DELTA 이상)는 숫자가 막대와 같은 길이·곡선(ROLL_MS · EASE.out)으로 함께 올라간다.
     막대·원 쪽 박자는 src/styles/motion-view-entry.css 의 --motion-roll 이 같은 값이다(테스트가 묶는다).
   - 처음 그릴 때·탭/에피소드를 바꾼 직후(ROLL_QUIET_MS)에는 굴리지 않고 바로 보여 준다.

   node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·다른 파일 import X).
   ═══════════════════════════════════════════════════════════════ */

/** 숫자 굴림·카운트업·짝지은 막대/원 전환 길이(ms). */
export const ROLL_MS = 500;

/** 이 값(진행률 %p) 이상 바뀌면 자릿수 굴림 대신 막대와 함께 세어 올라간다. */
export const COUNT_UP_MIN_DELTA = 5;

/** 처음 그린 뒤·탭/에피소드 전환 직후 이만큼은 굴리지 않는다(뒤늦게 도착한 값도 바로 보여 준다). */
export const ROLL_QUIET_MS = 400;

/** 숫자 띠: 0~9 를 네 벌 이어 붙인다(40칸). 한 번에 최대 29칸까지 한 방향으로 감을 수 있다. */
export const STRIP_COPIES = 4;
export const STRIP_CELLS = STRIP_COPIES * 10;
/** 띠 글자 — 한 줄에 한 숫자. 요소 40개 대신 글자 하나로 그린다. */
export const STRIP_TEXT = Array.from({ length: STRIP_CELLS }, (_, i) => String(i % 10)).join('\n');

/** 한 번에 감는 최대 칸 수. 이보다 멀면 같은 숫자의 가까운 벌로 줄인다(바퀴 수만 줄고 방향·도착 숫자는 같다). */
export const MAX_ROLL_SPAN = STRIP_CELLS - 11;

export type RollDirection = 1 | -1;

/** 굴림에 쓰는 글자열. 소수 자릿수는 고정(폭이 흔들리지 않게). 숫자가 아니면 0. */
export function formatRolling(value: number, decimals = 0): string {
  const safe = Number.isFinite(value) ? value : 0;
  const places = Math.max(0, Math.min(6, Math.floor(decimals)));
  return safe.toFixed(places);
}

export type RollingToken =
  | { kind: 'digit'; key: string; digit: number }
  | { kind: 'char'; key: string; char: string };

/**
 * '45.2' → 자리마다 토큰. 정수 자리는 오른쪽(일의 자리)부터 i0·i1·i2, 소수 자리는 f1·f2 로 키를 붙인다.
 * 9.9 → 10.0 처럼 자릿수가 늘어도 일의 자리·소수 자리는 같은 키라 제자리에서 굴러간다.
 */
export function splitRollingDigits(text: string): RollingToken[] {
  const tokens: RollingToken[] = [];
  const dot = text.indexOf('.');
  const intEnd = dot === -1 ? text.length : dot;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch >= '0' && ch <= '9') {
      const key = i < intEnd ? `i${intEnd - 1 - i}` : `f${i - intEnd}`;
      tokens.push({ kind: 'digit', key, digit: ch.charCodeAt(0) - 48 });
    } else {
      tokens.push({ kind: 'char', key: ch === '.' ? 'dot' : ch === '-' ? 'sign' : `c${i}`, char: ch });
    }
  }
  return tokens;
}

export function rollDirection(previous: number, next: number): RollDirection {
  return next < previous ? -1 : 1;
}

const mod10 = (n: number) => ((n % 10) + 10) % 10;

/**
 * 직전 목표 칸(prevTarget)에서 digit 까지 dir 방향으로만 감았을 때의 칸.
 * 오를 때 9→0 은 +1칸(되감기 없음), 내릴 때 0→9 는 −1칸.
 */
export function nextStripTarget(prevTarget: number, digit: number, dir: RollDirection): number {
  const base = Math.round(prevTarget);
  const from = mod10(base);
  const delta = dir > 0 ? mod10(digit - from) : -mod10(from - digit);
  return base + delta;
}

/**
 * 띠를 어디서 어디로 움직일지 정한다.
 * - visual: 지금 화면에 보이는 칸(굴러가는 중이면 소수). 굴러가는 중 새 값이 오면 그 자리에서 이어 감는다.
 * - prevTarget: 직전 목표 칸.
 * 돌려준 from·to 는 [0, STRIP_CELLS-1] 안이고, to 는 digit 칸이다(같은 숫자의 다른 벌이라 보이는 글자는 같다).
 */
export function planStripRoll(visual: number, prevTarget: number, digit: number, dir: RollDirection): { from: number; to: number } {
  let to = nextStripTarget(prevTarget, digit, dir);
  const from = visual;
  while (Math.abs(to - from) > MAX_ROLL_SPAN) to -= 10 * Math.sign(to - from);
  const shift = Math.floor(Math.min(from, to) / 10) * 10;
  return { from: from - shift, to: to - shift };
}

/** 이번 변화를 자릿수 굴림으로 할지, 막대와 함께 세어 올릴지. 이미 세는 중이면 그 자리에서 이어 센다. */
export function chooseRollMode(from: number, to: number, options: { countUp: boolean; counting: boolean }): 'count' | 'roll' {
  if (!options.countUp) return 'roll';
  if (options.counting) return 'count';
  return Math.abs(to - from) >= COUNT_UP_MIN_DELTA ? 'count' : 'roll';
}

/**
 * CSS cubic-bezier(x1, y1, x2, y2) 와 같은 곡선을 JS 에서 계산한다(막대 CSS 전환과 숫자 카운트업을 같은 곡선으로).
 * 뉴턴법 + 이분법 — WebKit UnitBezier 와 같은 방식.
 */
export function makeBezierEasing([x1, y1, x2, y2]: readonly number[]): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 60; i += 1) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-7) return t;
      if (x > v) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveX(t));
  };
}

/* ─── 진행률 원 (대시보드 전체 진행률) ─────────────────────────── */

/** 명언 구간. 같은 구간 안에서 0.1% 움직여도 명언을 바꾸지 않는다(8초 주기는 따로). */
export type ProgressBucket = '0' | '1-10' | '10-25' | '25-50' | '50-75' | '75-99' | '100';

export function progressBucket(pct: number): ProgressBucket {
  if (pct === 0) return '0';
  if (pct >= 100) return '100';
  if (pct < 10) return '1-10';
  if (pct < 25) return '10-25';
  if (pct < 50) return '25-50';
  if (pct < 75) return '50-75';
  return '75-99';
}

export interface RingSegmentInput {
  min: number;
  max: number;
  color: string;
}

export interface RingSegmentArc {
  key: number;
  color: string;
  dasharray: string;
  dashoffset: number;
}

/**
 * 구간색 띠 4개를 항상 '꽉 찬 모양'으로 그린다(값과 무관하게 고정). 얼마나 보일지는 가림막(mask) 하나가 정한다.
 * 그래서 25%·50%·75% 경계를 넘을 때 새 띠가 '툭' 생기지 않고, 큰 변화에서도 띠 사이가 벌어지지 않는다.
 */
export function ringSegmentArcs(segments: readonly RingSegmentInput[], circumference: number): RingSegmentArc[] {
  return segments.map((seg) => {
    const length = ((seg.max - seg.min) / 100) * circumference;
    return {
      key: seg.min,
      color: seg.color,
      dasharray: `${length} ${circumference}`,
      dashoffset: -(seg.min / 100) * circumference,
    };
  });
}

/** 가림막이 드러내는 길이와 둥근 끝점 각도. 끝점 원은 길이와 같은 박자로 돌아 늘 띠 끝에 붙어 있다. */
export function ringReveal(pct: number, circumference: number): { length: number; capDeg: number; capVisible: boolean } {
  const clamped = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  return {
    length: (clamped / 100) * circumference,
    capDeg: clamped * 3.6,
    capVisible: clamped > 0,
  };
}
