// 만드는 화면(크게 보기)의 계산만 모은 곳 — 화면 · WebGL 없이 node --test 로 확인한다 (tests/baeGyeongMakingStage.test.ts).
// 점 효과(dotField.ts)와 화면(MakingStage.tsx)이 같이 쓴다. 런타임 import 가 없다.

export type MakingPhase = 'order' | 'draw' | 'done';

/** 기다리는 문구가 바뀌는 간격 (HTML 기다림 화면과 같은 4.3초) */
export const PHRASE_MS = 4300;
/** 완성: 점이 가운데에서 바깥으로 풀리는 시간 */
export const FINALE_DISSOLVE_MS = 1000;
/** 완성: 점이 다 풀린 뒤 화면을 넘기기까지 (빛이 사라지는 꼬리). 풀리는 시간과 합쳐 약 1.4초 */
export const FINALE_TAIL_MS = 400;
/** 완성 그림이 아직 안 열렸으면 이만큼까지만 기다렸다가 효과를 시작한다 */
export const FINALE_WAIT_MS = 500;

/** HTML PHR_DRAW 그대로 */
export const DRAW_PHRASES: readonly string[] = ['러프 따라 구도 잡는 중', '그림체 기준 맞추는 중', '단색 면으로 칠하는 중', '손맛 넣는 중'];
/** 주문서 문구를 따로 받지 못했을 때 (HTML orderPhrases 의 처음과 끝) */
export const ORDER_PHRASES: readonly string[] = ['PD가 러프를 읽는 중', '영어 주문서 쓰는 중'];
export const DONE_PHRASE = '완성!';

export function defaultPhrases(phase: MakingPhase): readonly string[] {
  return phase === 'order' ? ORDER_PHRASES : phase === 'draw' ? DRAW_PHRASES : [DONE_PHRASE];
}

/** 중간 그림이 왔을 때 잠깐 끼어드는 문구 (HTML Wait.partial) */
export function partialPhrase(n: number): string {
  return n <= 1 ? '중간 그림이 왔어요' : '조금만 더요';
}

/** 상태 칩에 붙는 도착 표시 */
export function partialArrivedText(n: number): string {
  return `중간 그림 ${Math.max(1, Math.floor(n))}장 도착`;
}

/** 문구 순서: 끼어든 문구가 있으면 그것을 한 번 보여 준 뒤 다음 문구로 (HTML: partial 은 순번을 건드리지 않고, 다음 차례에 하나 넘어간다) */
export interface Talk { i: number; extra: string | null }
export function nextTalk(t: Talk, len: number): Talk {
  return { i: len < 2 ? 0 : (t.i + 1) % len, extra: null };
}
export function talkText(t: Talk, list: readonly string[]): string {
  if (t.extra !== null) return t.extra;
  return list.length ? list[t.i % list.length] : '';
}

/** 오려 붙인 글자 하나의 기울기(도) — HTML say() 와 같은 식 */
export function letterTilt(i: number): number {
  return (((i * 37) % 11) - 5) * 2;
}
/** 글자가 빠지는 시간 (HTML: 240ms + 글자당 14ms) */
export function wordsOutMs(text: string): number {
  return 240 + [...text].length * 14;
}

/**
 * 그리는 중 진행 (점이 그림을 얼마나 드러낼지, 0~1). 숫자로 보여 주지 않는다 — 가짜 퍼센트를 쓰지 않는다.
 * 실제 단계(중간 그림 0장 · 1장 · 2장)마다 바닥이 있고, 중간 그림이 오면 다음 바닥으로 뛴다.
 * 한 단계 안에서는 시간이 갈수록 천천히 그 단계의 천장 쪽으로 다가가되 닿지 않는다 (다음 바닥보다 늘 낮다).
 * 다 보이는 것은 완성 효과(finale)만 한다.
 * 값은 셰이더의 드러남 곡선에 맞췄다 (앱 엔진에서 잰 그림 자리 밝기: 0.40 → 거의 안 보임, 0.50 → 약 1/3, 0.56 → 약 3/4, 0.62 → 거의 다).
 * 그래서 중간 그림 0장 = 얼룩이 막 돋는 데서 약 1/4 까지, 1장 = 약 1/3 에서 3/5, 2장 = 약 2/3 에서 9할.
 */
export const DRAW_STAGES: readonly (readonly [number, number])[] = [[0.38, 0.485], [0.495, 0.54], [0.55, 0.595]];
/** 단계 안에서 천장까지 남은 거리의 63% 를 가는 시간(초) */
export const DRAW_STAGE_SEC = 18;
export function drawReveal(partials: number, secondsInStage: number): number {
  const i = Math.min(DRAW_STAGES.length - 1, Math.max(0, Math.floor(Number.isFinite(partials) ? partials : 0)));
  const [lo, hi] = DRAW_STAGES[i];
  const t = Math.max(0, Number.isFinite(secondsInStage) ? secondsInStage : 0);
  return lo + (hi - lo) * (1 - Math.exp(-t / DRAW_STAGE_SEC));
}

/** 지금 값을 목표 쪽으로 dt 초만큼 (시간 상수 tau 초). 뛰는 값도 몇백 ms 에 걸쳐 자라 보이게 한다. */
export function approach(current: number, target: number, dtSec: number, tauSec: number): number {
  if (tauSec <= 0 || dtSec <= 0) return tauSec <= 0 ? target : current;
  const next = target + (current - target) * Math.exp(-dtSec / tauSec);
  return Math.abs(target - next) < 1e-4 ? target : next;
}

/** 완성 효과 곡선 (부드럽게 출발해 부드럽게 멈춤) */
export function finaleCurve(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** 마우스가 밖에 있을 때 돋보기가 혼자 천천히 도는 자리 (시안 그대로, 0~1 · 위가 1) */
export function wanderAt(time: number): [number, number] {
  return [0.5 + 0.3 * Math.sin(time * 0.37), 0.5 + 0.24 * Math.sin(time * 0.53 + 1.1)];
}

/** 다음 장까지 최소 간격(ms): 마우스가 위에 있으면 매 프레임, 아니면 초당 30장쯤. '가볍게'는 늘 30장. 느린 PC 는 더 띄운다. */
export function frameGapMs(inside: boolean, lite: boolean, level: number): number {
  return inside && !lite ? 12 : Math.max(30, level * level * 4);
}

/** 그리기 판 배율: 화면 배율은 1.5배까지('가볍게'는 1배), 판 전체는 약 200만 화소까지, 느린 PC 는 단계마다 0.7배 */
export function canvasScale(dpr: number, cssW: number, cssH: number, level: number, lite: boolean): number {
  const cap = lite ? 1 : 1.5;
  const d = Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, cap);
  const area = Math.max(1, cssW * cssH);
  return Math.min(d, Math.sqrt(2.0736e6 / area)) * Math.pow(0.7, Math.max(0, level));
}

/** 느린 PC 맞추기 (시안 tune): 2초 동안 프레임이 50번이 안 되면 한 단계 낮추고, 괜찮아지면 점점 늦게 한 단계씩 되돌린다 */
export interface Tune { level: number; next: number; wait: number }
export const TUNE_START: Tune = { level: 0, next: 0, wait: 2 };
export function tuneLevel(t: Tune, ticks: number, now: number): Tune {
  if (ticks < 50) return { level: Math.min(5, t.level + 1), next: now + t.wait * 1000, wait: t.wait };
  if (t.level > 0 && now > t.next) {
    const wait = Math.min(t.wait * 2, 64);
    return { level: t.level - 1, next: now + wait * 1000, wait };
  }
  return t;
}
