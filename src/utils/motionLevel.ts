/* ═══════════════════════════════════════════════════════════════
   앱 안 '움직임' 설정 (움직임 폴리싱 바탕 B 2단계, 2026-10)

   - 'full'(기본)    : 지금 그대로.
   - 'lite'(가볍게)  : 계속 반복되는 장식(대시보드 배경, 숨 쉬는 배지·빛, 그래프 정점 펄스 등)을 멈추고 뒤 흐림을 끈다(CSS).
                       창이 열리는 것 같은 짧은 반응은 남긴다. 저사양 PC 용.
   - 'minimal'(최소) : 윈도우 '애니메이션 효과 끄기'(동작 줄이기)와 같게.

   값은 preferences.json 의 motionLevel 에 저장하고, 창마다 document.documentElement.dataset.motion 에 적는다.
   CSS 는 html[data-motion-lite]('가볍게' 이상)·html[data-motion-minimal]('최소') 로, React 는 useMotionPref() 로,
   React 밖은 prefersReducedMotion()(src/utils/motion.ts) 으로 읽는다.

   node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X).
   ═══════════════════════════════════════════════════════════════ */

export type MotionLevel = 'full' | 'lite' | 'minimal';

export const MOTION_LEVELS: readonly MotionLevel[] = Object.freeze(['full', 'lite', 'minimal'] as const);

export const DEFAULT_MOTION_LEVEL: MotionLevel = 'full';

export function isMotionLevel(value: unknown): value is MotionLevel {
  return value === 'full' || value === 'lite' || value === 'minimal';
}

/** 저장값·방송값을 믿지 않고 세 값 중 하나로 맞춘다(모르는 값은 기본). */
export function normalizeMotionLevel(value: unknown): MotionLevel {
  return isMotionLevel(value) ? value : DEFAULT_MOTION_LEVEL;
}

/**
 * 컴포넌트가 실제로 쓰는 판단.
 * - reduce: 움직임(위치·크기·회전)을 빼고 opacity 만 남긴다. OS 동작 줄이기 또는 '최소'.
 * - lite:   계속 반복되는 장식을 멈춘다. '가볍게' 이상 — '최소'·OS 동작 줄이기도 포함한다.
 * - level:  설정값 그대로(표시용).
 */
export interface MotionPref {
  readonly reduce: boolean;
  readonly lite: boolean;
  readonly level: MotionLevel;
}

const PREF_TABLE: Readonly<Record<'os' | 'app', Readonly<Record<MotionLevel, MotionPref>>>> = Object.freeze({
  app: Object.freeze({
    full: Object.freeze({ reduce: false, lite: false, level: 'full' as const }),
    lite: Object.freeze({ reduce: false, lite: true, level: 'lite' as const }),
    minimal: Object.freeze({ reduce: true, lite: true, level: 'minimal' as const }),
  }),
  os: Object.freeze({
    full: Object.freeze({ reduce: true, lite: true, level: 'full' as const }),
    lite: Object.freeze({ reduce: true, lite: true, level: 'lite' as const }),
    minimal: Object.freeze({ reduce: true, lite: true, level: 'minimal' as const }),
  }),
});

/** 같은 조합이면 같은 객체를 돌려준다(렌더마다 새 객체 X — effect 의존성에 넣어도 된다). */
export function resolveMotionPref(osReduce: boolean, level: MotionLevel): MotionPref {
  return PREF_TABLE[osReduce ? 'os' : 'app'][normalizeMotionLevel(level)];
}

/* ─── 창 하나 안의 현재 값(가게) ─────────────────────────────── */

type Listener = () => void;

let current: MotionLevel = DEFAULT_MOTION_LEVEL;
let explicitWrites = 0;
const listeners = new Set<Listener>();

function writeDom(level: MotionLevel): void {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      const data = document.documentElement.dataset;
      data.motion = level;
      // CSS 용 '있다/없다' 표시: data-motion-lite('가볍게' 이상 — '최소' 포함) · data-motion-minimal('최소').
      // 브라우저는 조상에 어떤 속성 '이름'이 있는지로 규칙을 미리 거르므로(값은 못 본다), 모든 요소에 걸리는
      // '가볍게'·'최소' 규칙이 기본일 때는 바로 걸러진다(최종 성능 측정 지적 — scripts/postcss-motion-minimal.cjs).
      if (level === 'full') delete data.motionLite;
      else data.motionLite = '';
      if (level === 'minimal') data.motionMinimal = '';
      else delete data.motionMinimal;
    }
  } catch {
    // 문서가 없는 환경(테스트·메인 프로세스)
  }
}

export function getMotionLevel(): MotionLevel {
  return current;
}

/**
 * 값을 바꾸고 <html data-motion> 에 적은 뒤 구독자에게 알린다. 바뀐 값을 돌려준다.
 * 같은 값이면 DOM 만 다시 맞추고 알리지 않는다.
 */
export function setMotionLevel(value: unknown): MotionLevel {
  const next = normalizeMotionLevel(value);
  explicitWrites += 1;
  writeDom(next);
  if (next === current) return current;
  current = next;
  for (const listener of [...listeners]) listener();
  return current;
}

/** applyStoredMotionLevel 에 넘길 '저장값을 읽기 시작한 시점'의 표시. */
export function motionLevelWriteMark(): number {
  return explicitWrites;
}

/**
 * 시작할 때 저장값을 늦게 읽어 오는 경우용. 읽는 사이 사용자가 이미 바꿨으면(setMotionLevel 호출이 있었으면)
 * 덮어쓰지 않는다. 적용했으면 true.
 */
export function applyStoredMotionLevel(value: unknown, writeMarkBeforeLoad: number): boolean {
  if (explicitWrites !== writeMarkBeforeLoad) return false;
  setMotionLevel(value);
  return true;
}

export function subscribeMotionLevel(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 방송에 함께 싣는 '누가 몇 번째로 보냈나'. 방송은 보낸 창에도 돌아오므로, 빠르게 연달아 고르면
 * (가볍게 → 최소) 먼저 끝난 '가볍게' 방송이 뒤늦게 돌아와 잠깐 되돌아갔다 다시 바뀌는 깜빡임이 생긴다.
 * 보낸 창은 자기 마지막 요청보다 오래된 자기 방송을 버린다(다른 창의 방송은 그대로 따른다).
 */
export interface MotionLevelBroadcastOrigin {
  readonly from: string;
  readonly seq: number;
}

/** 설정 화면이 보내는 방송 내용. */
export function motionLevelBroadcastPayload(level: MotionLevel, origin: MotionLevelBroadcastOrigin) {
  return { motionLevel: level, motionLevelFrom: origin.from, motionLevelSeq: origin.seq };
}

/**
 * 설정 변경 방송({ motionLevel }) 에서 값을 꺼낸다. 다른 설정의 방송이면 null.
 * self 를 넘기면, 이 창이 보낸 방송 중 마지막 요청(self.seq)보다 오래된 것도 null(이미 더 새 값을 골랐음).
 */
export function motionLevelFromBroadcast(payload: unknown, self?: MotionLevelBroadcastOrigin): MotionLevel | null {
  if (!payload || typeof payload !== 'object' || !('motionLevel' in payload)) return null;
  const message = payload as { motionLevel?: unknown; motionLevelFrom?: unknown; motionLevelSeq?: unknown };
  if (
    self
    && message.motionLevelFrom === self.from
    && typeof message.motionLevelSeq === 'number'
    && message.motionLevelSeq < self.seq
  ) {
    return null;
  }
  return normalizeMotionLevel(message.motionLevel);
}

/**
 * 움직임 설정 저장(파일 읽기 → 쓰기 → 방송)을 한 줄로 세운다(코덱스 지적: 빠르게 두 번 고르면 두 저장이 엇갈려,
 * 늦게 끝난 옛 저장이 새 값 뒤에 파일·다른 창을 옛 값으로 되돌렸다).
 * - 앞 저장이 끝난 뒤에 다음 저장을 시작한다(앞 저장이 실패해도 줄은 이어진다).
 * - 차례가 왔을 때 더 새 요청이 이미 들어와 있으면 그 저장은 건너뛴다 — 새 요청이 쓰고 방송한다.
 * - run 은 isStale() 로 '그사이 더 새 요청이 들어왔는지'를 다시 볼 수 있다(읽기를 기다린 뒤 쓰기 전에).
 */
export interface MotionLevelSaveQueue {
  enqueue(seq: number, run: (isStale: () => boolean) => Promise<void>): Promise<void>;
}

export function createMotionLevelSaveQueue(): MotionLevelSaveQueue {
  let tail: Promise<void> = Promise.resolve();
  let latest = 0;
  return {
    enqueue(seq, run) {
      if (seq > latest) latest = seq;
      const isStale = () => seq < latest;
      const job = tail.then(() => (isStale() ? undefined : run(isStale)));
      tail = job.catch(() => undefined);
      return job;
    },
  };
}

/* ─── OS '동작 줄이기' ─────────────────────────────────────────── */

const OS_REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

function osReduceMedia(): MediaQueryList | null {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    return window.matchMedia(OS_REDUCE_QUERY) ?? null;
  } catch {
    return null;
  }
}

/** 지금 OS '동작 줄이기'가 켜져 있는지(창·matchMedia 가 없는 환경은 false). */
export function readOsReducedMotion(): boolean {
  return osReduceMedia()?.matches === true;
}

/**
 * OS '동작 줄이기'가 바뀌면 알린다 — 앱을 쓰는 도중 윈도우 설정을 바꿔도 오래 떠 있는 화면(사이드바·헤더 등)이
 * 다시 시작하지 않고 따라가게. 끊는 함수를 돌려준다.
 */
export function subscribeOsReducedMotion(listener: Listener): () => void {
  const media = osReduceMedia();
  if (!media) return () => {};
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }
  // 옛 MediaQueryList(addListener 만 있음)
  media.addListener?.(listener);
  return () => media.removeListener?.(listener);
}

/** 지금 판단(OS 값 + 앱 설정). */
export function readMotionPref(): MotionPref {
  return resolveMotionPref(readOsReducedMotion(), current);
}

/** React 밖에서 읽는 '최소' 여부 — <html data-motion> 에 적힌 값을 본다. */
export function isMinimalMotionInDom(): boolean {
  try {
    return typeof document !== 'undefined'
      && document.documentElement?.dataset?.motion === 'minimal';
  } catch {
    return false;
  }
}

/** 테스트 전용: 가게를 처음 상태로 되돌린다. */
export function resetMotionLevelForTest(): void {
  current = DEFAULT_MOTION_LEVEL;
  explicitWrites = 0;
  listeners.clear();
}
