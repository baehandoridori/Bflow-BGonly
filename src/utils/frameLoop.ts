/* ═══════════════════════════════════════════════════════════════
   계속 움직이는 배경(캔버스) 루프 — 멈춤·초당 장 수 상한·천천히 멈추기를 지원하는 requestAnimationFrame 루프
   (움직임 폴리싱 바탕 B·C, 2026-10)

   대시보드·로그인 배경(플렉서스·StarNest 두 종)은 '계속 반복되는 장식'이다.
   - 멈춤(still): 동작 줄이기·움직임 '가볍게'·'최소'에서는 한 장만 그리고 멈춘다. 멈춘 동안에도 크기·설정·색이
     바뀌면 invalidate() 로 한 장을 다시 그린다. 멈춤 장은 시간이 흐르지 않는다(dtMs 0).
   - 초당 장 수 상한(maxFps): 배경은 30장이면 충분하다. 사이 프레임은 그리지 않고 넘긴다.
   - 움직임 배율(setActive): 다른 프로그램을 쓰는 동안(창 포커스 없음)·창이 가려졌을 때·위젯을 끄는 동안에는
     배율을 1→0 으로 천천히 줄여 '서서히 멈춘' 뒤 루프를 잠재운다(마지막 장은 화면에 그대로 남는다).
     다시 활성이 되면 0→1 로 천천히 이어 간다. 그리기 쪽은 now 대신 info.dtMs·info.time(배율이 곱해진
     가상 시계)을 써서 움직이므로, 멈췄다 이어도 점이 순간이동하거나 반짝임 위상이 튀지 않는다.

   - draw(now, info) 가 false 를 돌려주면 '아직 다 못 그렸다'는 뜻 — 멈춤 상태라도 다음 프레임에 다시 부른다
     (예: 캔버스 크기가 아직 0, 입자 수를 프레임마다 조금씩 맞추는 중).
   - 루프를 만드는 즉시 첫 프레임을 예약한다(멈춤 상태면 그 한 장으로 끝).
   - setStill(false) 로 풀리면 루프를 이어 간다. setStill(true) 이면 지금 예약된 프레임까지만 그린다.

   node --test 가 그대로 import 하도록 런타임 의존이 없다.
   ═══════════════════════════════════════════════════════════════ */

/** 한 장을 그릴 때 넘겨주는 시간 정보. */
export interface FrameInfo {
  /** 이번 장에서 움직일 시간(ms) = 실제 경과(상한 있음) × 움직임 배율. 멈춤 장은 0. */
  dtMs: number;
  /** 실제 경과(ms, 상한 있음). 배율과 무관하게 흘러야 하는 것(마우스 잔상의 수명 등)에 쓴다. 멈춤 장은 0. */
  realDtMs: number;
  /** 가상 시계(ms) — dtMs 를 쌓은 값. sin(시간) 같은 반복 무늬는 now 대신 이걸 쓴다. */
  time: number;
  /** 움직임 배율 0~1. */
  scale: number;
}

export interface FrameLoop {
  /** 멈춤 여부를 바꾼다. 다시 움직이게 되면 루프를 이어 간다. */
  setStill(still: boolean): void;
  /**
   * 움직일지(1)·서서히 멈출지(0)를 바꾼다. fadeMs 동안 배율이 목표로 옮겨 간다(0 이면 바로).
   * 배율이 0 에 닿으면 마지막 장을 그린 뒤 루프를 잠재우고, 다시 active 가 되면 깨운다.
   */
  setActive(active: boolean, fadeMs?: number): void;
  /** 한 장을 (다시) 그리게 한다. 움직이는 중이면 다음 프레임이 어차피 그리므로 추가로 예약하지 않는다. */
  invalidate(): void;
  /** 예약된 프레임을 취소하고 더는 그리지 않는다. */
  dispose(): void;
  /** 다음 프레임이 예약돼 있는지(테스트·점검용). */
  isScheduled(): boolean;
  /** 지금 움직임 배율(테스트·점검용). */
  getScale(): number;
}

export interface FrameLoopOptions {
  still: boolean;
  /** 초당 최대 장 수. 없으면 매 프레임 그린다. */
  maxFps?: number;
  /** 처음 움직임 여부. 기본 true. false 면 첫 장만 그리고 잠든다. */
  active?: boolean;
  /** 한 장의 실제 경과 상한(ms). 기본 50 — 프레임이 밀려도 점이 한 번에 멀리 튀지 않게. */
  maxDtMs?: number;
  requestFrame?: (callback: (now: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

/** 상한 간격보다 이만큼 이르게 와도 그린다 — 60Hz 화면에서 두 프레임(33.3ms)마다 한 장이 되게. */
export const FRAME_SLACK_MS = 4;
export const DEFAULT_MAX_DT_MS = 50;
/** setActive 의 fadeMs 를 생략했을 때. */
export const DEFAULT_ACTIVITY_FADE_MS = 600;

/** 초당 장 수 상한에 걸려 이번 프레임을 넘길지. 첫 장(lastDrawAt 없음)은 늘 그린다. */
export function shouldSkipFrame(now: number, lastDrawAt: number | null, maxFps: number | undefined): boolean {
  if (!maxFps || maxFps <= 0 || lastDrawAt === null) return false;
  return now - lastDrawAt < 1000 / maxFps - FRAME_SLACK_MS;
}

/** 진행도(0~1)를 목표 쪽으로 elapsed/fadeMs 만큼 옮긴다. fadeMs 가 0 이하면 바로 목표. */
export function stepActivityProgress(progress: number, target: number, elapsedMs: number, fadeMs: number): number {
  if (fadeMs <= 0) return target;
  const step = Math.max(0, elapsedMs) / fadeMs;
  const next = target > progress ? Math.min(target, progress + step) : Math.max(target, progress - step);
  // 0.1 을 열 번 빼도 정확히 0 이 되지 않는 소수 오차 때문에 한 장 더 그리지 않게 목표에 붙인다.
  return Math.abs(target - next) < 1e-9 ? target : next;
}

/** 진행도 → 움직임 배율. 부드럽게 출발해 부드럽게 멈춘다(smoothstep). */
export function activityScale(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return p * p * (3 - 2 * p);
}

export function createFrameLoop(draw: (now: number, info: FrameInfo) => boolean | void, options: FrameLoopOptions): FrameLoop {
  const requestFrame = options.requestFrame ?? ((callback: (now: number) => void) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));
  const maxFps = options.maxFps;
  const maxDtMs = options.maxDtMs ?? DEFAULT_MAX_DT_MS;
  const nominalDtMs = maxFps && maxFps > 0 ? 1000 / maxFps : 1000 / 60;
  let still = options.still;
  let target = options.active === false ? 0 : 1;
  let progress = target;
  let fadeMs = DEFAULT_ACTIVITY_FADE_MS;
  let handle: number | null = null;
  let disposed = false;
  /** 마지막으로 그린 시각. 루프가 잠들면 비워서, 깨어난 첫 장은 기본 간격으로 움직이게 한다. */
  let lastDrawAt: number | null = null;
  let time = 0;

  const asleep = () => target === 0 && progress === 0;

  const schedule = () => {
    if (disposed || handle !== null) return;
    handle = requestFrame(frame);
  };

  function frame(now: number) {
    handle = null;
    if (disposed) return;
    if (!still && shouldSkipFrame(now, lastDrawAt, maxFps)) {
      schedule();
      return;
    }
    const realDtMs = lastDrawAt === null ? nominalDtMs : Math.min(maxDtMs, Math.max(0, now - lastDrawAt));
    lastDrawAt = now;
    progress = stepActivityProgress(progress, target, realDtMs, fadeMs);
    const scale = activityScale(progress);
    const dtMs = still ? 0 : realDtMs * scale;
    time += dtMs;
    const settled = draw(now, { dtMs, realDtMs: still ? 0 : realDtMs, time, scale }) !== false;
    if ((!still && !asleep()) || !settled) {
      schedule();
    } else {
      lastDrawAt = null;
    }
  }

  schedule();

  return {
    setStill(next) {
      if (next === still) return;
      still = next;
      if (!still) schedule();
    },
    setActive(active, nextFadeMs = DEFAULT_ACTIVITY_FADE_MS) {
      const nextTarget = active ? 1 : 0;
      fadeMs = Math.max(0, nextFadeMs);
      if (fadeMs === 0) progress = nextTarget;
      if (nextTarget === target && fadeMs !== 0) return;
      target = nextTarget;
      // 깨어나거나(1) 서서히 멈추는(0) 동안 프레임이 이어져야 한다. 이미 잠든 채 0 이 되면 예약하지 않는다.
      if (!still && !asleep()) schedule();
    },
    invalidate() {
      schedule();
    },
    dispose() {
      disposed = true;
      if (handle !== null) cancelFrame(handle);
      handle = null;
    },
    isScheduled() {
      return handle !== null;
    },
    getScale() {
      return activityScale(progress);
    },
  };
}
