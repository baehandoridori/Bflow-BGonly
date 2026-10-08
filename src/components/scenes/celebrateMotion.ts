/* ═══════════════════════════════════════════════════════════════
   끝냈을 때의 보상 — 씬 완료 카드 '톡'·칸 빛, 파트 완료 화면 장식 (움직임 폴리싱 17번 celebrate-done)

   - 씬 완료: 카드가 살짝 떠올랐다 돌아오고(280ms, 살짝 넘치는 곡선), 초록빛이 0.4초 동안 번진다(CSS).
     동작 줄이기면 꽃가루·톡 대신 완료 칸 테두리가 한 번 은은하게 빛난다(opacity .7→0, 400ms).
   - 파트 완료: 장식은 처음 4.5초만 흐르고 1초에 걸쳐 잦아들어 멈춘다(재생 속도를 1→0 으로 낮춘다).
     한 번 닫은(본) 완료 화면은 기억해 두었다가 다시 열 때 카드만 작게 띄운다.

   node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X).
   ═══════════════════════════════════════════════════════════════ */

/* ─── 씬 완료 ─────────────────────────────────────────────────── */

export const CARD_POP_MS = 280;
/** 작은 보상용 살짝 넘치는 곡선(--ease-spring 과 같은 값). */
export const CARD_POP_EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

/**
 * 카드 '톡' — 개별 transform 속성(translate·scale)으로 건다. 카드의 hover 떠오름(transform)·강조 확대와
 * 겹쳐도 서로 덮어쓰지 않고 더해지고, 합성 스레드에서 돈다.
 */
export const CARD_POP_KEYFRAMES: Keyframe[] = [
  { translate: '0px 0px', scale: '1' },
  { offset: 0.4, translate: '0px -2px', scale: '1.025' },
  { translate: '0px 0px', scale: '1' },
];

/** 동작 줄이기에서 꽃가루 대신 완료 칸 테두리가 한 번 빛난다. */
export const CELEBRATE_GLOW_KEYFRAMES: Keyframe[] = [{ opacity: 0.7 }, { opacity: 0 }];
export const CELEBRATE_GLOW_EASE = 'cubic-bezier(0, 0, 0.58, 1)';

export interface GlowRect {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: string;
}

/** 화면 좌표 사각형을 카드 안쪽(테두리 안) 기준으로 바꾼다 — 카드가 hover 로 떠 있어도 그대로 맞는다. */
export function rectWithin(
  rect: { left: number; top: number; width: number; height: number },
  container: { left: number; top: number },
  border: { left: number; top: number },
  radius: string,
): GlowRect {
  return {
    left: Math.round(rect.left - container.left - border.left),
    top: Math.round(rect.top - container.top - border.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    radius,
  };
}

/* ─── 파트 완료 화면 ──────────────────────────────────────────── */

/** 장식이 지금처럼 화사하게 흐르는 시간. */
export const PART_COMPLETE_FLOW_MS = 4500;
/** 그 뒤 잦아들어 멈추는 시간. */
export const PART_COMPLETE_SETTLE_MS = 1000;
/** 잦아드는 동안 재생 속도를 고치는 간격. 느린 표류라 이 정도 계단은 눈에 띄지 않는다. */
export const PART_COMPLETE_SETTLE_STEP_MS = 50;
/** X 를 눌렀을 때 사라지는 시간. */
export const PART_COMPLETE_EXIT_MS = 300;

/**
 * 잦아드는 동안의 재생 속도(1 → 0). 시작과 끝이 모두 부드럽게(코사인) — 멈추기 시작하는 순간도 티 나지 않는다.
 * progress 는 0~1(범위 밖은 잘라 낸다).
 */
export function settlePlaybackRate(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return Math.round(((1 + Math.cos(Math.PI * p)) / 2) * 1000) / 1000;
}

export interface DriftFrame {
  x?: number;
  y?: number;
  rotate?: number;
  scale?: number;
  scaleX?: number;
  opacity?: number;
}

const num = (value: number) => Math.round(value * 100) / 100;

/**
 * 표류 키프레임 — 모든 프레임이 같은 모양의 transform 문자열(translate → rotate → scale/scaleX)이라
 * 함수별로 이어진다. 구간마다 ease-in-out(예전 framer 'easeInOut' 과 같은 느낌).
 */
export function driftKeyframes(frames: readonly DriftFrame[], easing = 'ease-in-out'): Keyframe[] {
  const first = frames[0] ?? {};
  const hasRotate = first.rotate !== undefined;
  const hasScale = first.scale !== undefined;
  const hasScaleX = first.scaleX !== undefined;
  return frames.map((frame) => {
    const parts = [`translate(${num(frame.x ?? 0)}px, ${num(frame.y ?? 0)}px)`];
    if (hasRotate) parts.push(`rotate(${num(frame.rotate ?? 0)}deg)`);
    if (hasScale) parts.push(`scale(${num(frame.scale ?? 1)})`);
    if (hasScaleX) parts.push(`scaleX(${num(frame.scaleX ?? 1)})`);
    const keyframe: Keyframe = { transform: parts.join(' '), easing };
    if (frame.opacity !== undefined) keyframe.opacity = frame.opacity;
    return keyframe;
  });
}

export interface BokehOrbSpec {
  r: number;
  color: readonly [number, number, number];
  /** 자리(%). */
  x: number;
  y: number;
  durationMs: number;
  /** 음수 — 처음부터 길 중간에서 출발해 4.5초 안에 모두 움직인다. */
  delayMs: number;
  keyframes: Keyframe[];
}

/** 빛망울 — 예전 framer 경로(x·y 3점 + 크기 1→1.08→.96→1.04→1)를 그대로 transform 문자열로. */
export function buildBokehOrbs(
  options: { count: number; minR: number; maxR: number; drift: number; speed: number; palette: readonly (readonly [number, number, number])[] },
  random: () => number = Math.random,
): BokehOrbSpec[] {
  const { count, minR, maxR, drift, speed, palette } = options;
  return Array.from({ length: count }, (_, i) => {
    const r = Math.round(minR + random() * (maxR - minR));
    const durationMs = Math.round(speed * (0.8 + random() * 0.6) * 1000);
    const path = Array.from({ length: 3 }, () => [(random() - 0.5) * drift, (random() - 0.5) * drift] as const);
    const scales = [1, 1.08, 0.96, 1.04, 1];
    const points: Array<readonly [number, number]> = [[0, 0], ...path, [0, 0]];
    return {
      r,
      color: palette[i % palette.length],
      x: Math.round(random() * 100),
      y: Math.round(random() * 100),
      durationMs,
      delayMs: -Math.round(random() * durationMs),
      keyframes: driftKeyframes(points.map(([x, y], index) => ({ x, y, scale: scales[index] }))),
    };
  });
}

/**
 * 빛망울 바탕 — 움직이는 층에 filter blur 를 걸지 않고, 가장자리를 미리 흐리게 그린 radial-gradient.
 * 큰 망울(예전 blur(r/10))일수록 가장자리를 더 일찍·길게 흐린다.
 */
export function bokehBackground(color: readonly [number, number, number], alpha: number, r: number): string {
  const [cr, cg, cb] = color;
  const soft = r > 30;
  const stops = soft
    ? [[0, 1], [30, 0.6], [52, 0.28], [70, 0.08], [86, 0]]
    : [[0, 1], [35, 0.5], [60, 0.15], [80, 0]];
  const body = stops
    .map(([at, k]) => `rgba(${cr},${cg},${cb},${num(alpha * k)}) ${at}%`)
    .join(', ');
  return `radial-gradient(circle at ${soft ? '45% 45%' : '38% 38%'}, ${body})`;
}

/* ─── 본 완료 화면 기억 ───────────────────────────────────────── */

export const PART_COMPLETE_SEEN_STORAGE_KEY = 'bflow_part_complete_seen_v1';
export const PART_COMPLETE_SEEN_MAX = 200;

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 한 번 닫은(본) 파트 완료 화면 키 목록. 저장소가 없거나 깨졌으면 빈 목록. */
export function readSeenPartCompletionKeys(storage: KeyValueStorage | null = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PART_COMPLETE_SEEN_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

/** 본 키를 맨 뒤에 기억하고(중복 제거, 최근 200개까지) 새 목록을 돌려준다. 저장에 실패해도 목록은 돌려준다. */
export function rememberSeenPartCompletionKey(key: string, storage: KeyValueStorage | null = defaultStorage()): string[] {
  const next = [...readSeenPartCompletionKeys(storage).filter((item) => item !== key), key].slice(-PART_COMPLETE_SEEN_MAX);
  try {
    storage?.setItem(PART_COMPLETE_SEEN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 저장 못 해도 이번 실행 안에서는 기억한다 */
  }
  return next;
}
