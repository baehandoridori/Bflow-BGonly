/**
 * 헤더 '최신 상태' 칸과 새로고침 아이콘의 움직임 규칙 (움직임 폴리싱 3번 header-sync-quiet).
 *
 * - 자동 받아오기(15초 폴링 등): 문구·버튼은 그대로, 초록 체크만 한 번 은은하게 숨 쉰다.
 * - 직접 새로고침: 버튼이 아니라 화살표 아이콘(svg)만 돈다. 끝나면 그 자리에서 0° 로 튀지 않고
 *   돌던 바퀴를 마저 돌며 감속해 멈춘 뒤, 체크가 '톡' 나타난다.
 * - 문구는 같은 칸에 겹쳐 둔 두 줄의 opacity 교차 — 칸 폭이 변하지 않아 옆 아이콘이 밀리지 않는다.
 *
 * node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭 X).
 */
import type { SyncKind } from '../../utils/syncQueue.ts';

/** 아이콘 한 바퀴 시간(ms). 사양: 700ms linear 반복. */
export const SPIN_PERIOD_MS = 700;
/** 문구 교차 시간(ms). 사양 160ms. */
export const LABEL_SWAP_MS = 160;
/** 상태 칸 최소 폭(px). 두 문구를 겹쳐 두어 더 긴 쪽 폭을 갖고, 이 값 아래로는 줄지 않는다. */
export const STATUS_SLOT_MIN_WIDTH = 78;

export const SPIN_KEYFRAMES: Keyframe[] = [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }];

/** 자동 받아오기 때 체크 숨쉬기 — opacity 1 → .35 → 1, 600ms 한 번. */
export const CHECK_BREATH_KEYFRAMES: Keyframe[] = [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }];
export const CHECK_BREATH_TIMING: KeyframeAnimationOptions = { duration: 600, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' };

/** 직접 새로고침이 끝난 뒤 체크 '톡' — scale .6 → 1.12 → 1, 220ms. */
export const CHECK_POP_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(0.6)' },
  { transform: 'scale(1.12)' },
  { transform: 'scale(1)' },
];
export const CHECK_POP_TIMING: KeyframeAnimationOptions = { duration: 220, easing: 'cubic-bezier(0.18, 0.88, 0.34, 1.28)' };

/** 멈출 때 남은 각이 이보다 작으면 한 바퀴를 더 돈다 — 몇 도 안에서 급정거하면 '뚝' 멈춘 것처럼 보인다. */
const MIN_STOP_TRAVEL_DEG = 60;
const STOP_MIN_MS = 240;
const STOP_MAX_MS = 800;

export type SyncLabel = 'syncing' | 'fresh';

export function normalizeDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const n = deg % 360;
  return n < 0 ? n + 360 : n;
}

/**
 * getComputedStyle(el).transform 값에서 회전각(0~360)을 읽는다.
 * 'none'·빈 값은 0. matrix(a, b, …)·matrix3d(a, b, …) 는 atan2(b, a). rotate(Ndeg) 도 받는다.
 */
export function angleFromTransform(transform: string | null | undefined): number {
  const value = (transform ?? '').trim();
  if (!value || value === 'none') return 0;
  const rotate = value.match(/^rotate\(\s*(-?[\d.]+)deg\s*\)$/);
  if (rotate) return normalizeDeg(Number(rotate[1]));
  const matrix = value.match(/^matrix(?:3d)?\(([^)]*)\)$/);
  if (!matrix) return 0;
  const [a, b] = matrix[1].split(',').map((part) => Number(part.trim()));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return normalizeDeg((Math.atan2(b, a) * 180) / Math.PI);
}

export interface SpinStopPlan {
  fromDeg: number;
  /** 항상 360 의 배수 — 끝나면 transform 이 비어도(0°) 같은 모습이라 튀지 않는다. */
  toDeg: number;
  durationMs: number;
  easing: string;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * 돌던 아이콘을 현재 각에서 다음 0°(360 의 배수)까지 감속해 멈추는 계획.
 * - 시작 속도는 돌던 속도(360°/주기)와 같게 곡선의 첫 기울기를 맞춘다 — 멈추기 시작할 때 덜컥하지 않는다.
 * - 길이는 같은 감속도로 멈출 때의 시간(남은 각 × 2 ÷ 속도)을 240~800ms 로 묶는다.
 */
export function planSpinStop(angleDeg: number, periodMs: number = SPIN_PERIOD_MS): SpinStopPlan {
  const fromDeg = normalizeDeg(angleDeg);
  let travel = 360 - fromDeg;
  if (travel < MIN_STOP_TRAVEL_DEG) travel += 360;
  const speed = 360 / periodMs; // deg/ms
  const durationMs = Math.round(Math.min(STOP_MAX_MS, Math.max(STOP_MIN_MS, (2 * travel) / speed)));
  // cubic-bezier(x1, y1, .58, 1): 첫 기울기 y1/x1 = 시작 속도 ÷ 평균 속도, 끝 기울기 0(사뿐히 멈춤).
  const slope = (speed * durationMs) / travel;
  const x1 = Math.min(1 / 3, 1 / slope);
  const y1 = Math.min(1, slope * x1);
  return {
    fromDeg: round3(fromDeg),
    toDeg: Math.round(fromDeg + travel),
    durationMs,
    easing: `cubic-bezier(${round3(x1)}, ${round3(y1)}, 0.58, 1)`,
  };
}

/**
 * 상태 칸에 보일 문구.
 * - 직접 새로고침이 돌거나 예약돼 있거나, 아이콘이 아직 멈추는 중이면 '동기화 중'.
 * - 앱을 막 열어 아직 한 번도 받아오지 못했으면(lastSyncTime 없음) 자동이라도 '동기화 중' — '최신 상태'는 거짓말이다.
 * - 그 외(자동 받아오기 포함)는 '최신 상태' 그대로.
 */
export function resolveSyncLabel(input: {
  isSyncing: boolean;
  syncKind: SyncKind | null;
  lastSyncTime: number | null;
  spinning: boolean;
}): SyncLabel {
  if (input.syncKind === 'manual' || input.spinning) return 'syncing';
  if (input.isSyncing && input.lastSyncTime === null) return 'syncing';
  return 'fresh';
}

export interface SyncKindChange {
  spin: 'start' | 'stop' | null;
  /** 쉬다가 자동 받아오기가 시작됐다 — 체크 숨쉬기 한 번. */
  breathe: boolean;
}

export function syncKindChange(prev: SyncKind | null, next: SyncKind | null): SyncKindChange {
  if (next === 'manual' && prev !== 'manual') return { spin: 'start', breathe: false };
  if (prev === 'manual' && next !== 'manual') return { spin: 'stop', breathe: false };
  return { spin: null, breathe: prev === null && next === 'auto' };
}
