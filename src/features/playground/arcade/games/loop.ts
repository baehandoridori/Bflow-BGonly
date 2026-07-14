// 고정 timestep 게임 루프 — rAF 로 프레임을 받아 누적기(accumulator)로 시뮬레이션 스텝을 몰아 실행한다.
// stepMs 는 매 스텝마다 다시 읽어 스네이크 가속 같은 가변 간격을 반영한다.
// document.hidden/blur 시 자동 일시정지해 멈춘 시간을 시뮬레이션하지 않는다.

export interface FixedStepLoopOptions {
  getStepMs: () => number; // 현재 스텝 간격(가변)
  onStep: () => void; // 시뮬레이션 1스텝
  onFrame?: () => void; // 프레임마다(렌더 갱신). 스텝 유무와 무관
  maxCatchUp?: number; // 프레임 지연 시 한 프레임에 실행할 최대 스텝(스파이럴 방지). 기본 5
  now?: () => number; // 주입식 클록(테스트용). 기본 performance.now
  requestFrame?: (cb: (t: number) => void) => number;
  cancelFrame?: (id: number) => void;
}

// 누적기에 delta 를 더하고, 현재 stepMs 를 넘길 때마다 onStep 을 실행한다(가변 stepMs 반영).
// 스텝 직전의 간격을 차감해, 스텝 중 stepMs 가 바뀌어도 다음 스텝부터 새 간격이 적용된다.
// 반환: 남은 누적기(remainder).
export function advanceFixedStep(
  accumulatorMs: number,
  deltaMs: number,
  getStepMs: () => number,
  onStep: () => void,
  maxCatchUp = 5,
): number {
  let accumulator = accumulatorMs + Math.max(0, deltaMs);
  let steps = 0;
  while (steps < maxCatchUp) {
    const step = getStepMs();
    if (step <= 0 || accumulator < step) break;
    onStep();
    accumulator -= step;
    steps += 1;
  }
  return accumulator;
}

export interface FixedStepLoop {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createFixedStepLoop(options: FixedStepLoopOptions): FixedStepLoop {
  const now = options.now ?? (() => performance.now());
  const requestFrame = options.requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
  const maxCatchUp = options.maxCatchUp ?? 5;
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';

  let frameId: number | null = null;
  let active = false; // 사용자 의도(시작·재개 O / 일시정지·정지 X)
  let visible = true; // 창이 보이고 포커스됨
  let accumulator = 0;
  let lastNow = 0;
  let listening = false;

  const tick = (timestamp: number): void => {
    if (!active || !visible) return;
    const delta = Math.min(250, timestamp - lastNow); // 큰 간극은 250ms 로 캡
    lastNow = timestamp;
    accumulator = advanceFixedStep(accumulator, delta, options.getStepMs, options.onStep, maxCatchUp);
    options.onFrame?.();
    // onStep 이 stop()/pause() 를 부르면 active/visible 이 꺼진다 — 그때는 다음 프레임을 재요청하지 않고
    // frameId 를 비워, 죽은 뒤 프레임이 한 번 더 돌거나 같은 루프를 다시 시작하지 못하는 문제를 막는다.
    if (active && visible) {
      frameId = requestFrame(tick);
    } else {
      frameId = null;
    }
  };

  const startFrame = (): void => {
    if (frameId !== null || !active || !visible) return;
    lastNow = now(); // 재개 시 lastNow 재설정 → 멈춘/안 보인 시간은 시뮬레이션하지 않는다
    frameId = requestFrame(tick);
  };

  const stopFrame = (): void => {
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
  };

  // hidden/blur 시 자동 정지, 복귀 시 자동 재개(active 인 동안만). 멈춘 시간은 누적하지 않는다.
  const syncVisibility = (): void => {
    const nextVisible = !document.hidden && document.hasFocus();
    if (nextVisible === visible) return;
    visible = nextVisible;
    if (visible) startFrame();
    else stopFrame();
  };
  const onBlur = (): void => { visible = false; stopFrame(); };
  const onFocus = (): void => { syncVisibility(); };

  const attach = (): void => {
    if (!hasDom || listening) return;
    listening = true;
    visible = !document.hidden && document.hasFocus();
    document.addEventListener('visibilitychange', syncVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
  };
  const detach = (): void => {
    if (!hasDom || !listening) return;
    listening = false;
    document.removeEventListener('visibilitychange', syncVisibility);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
  };

  return {
    start() {
      accumulator = 0;
      active = true;
      attach();
      startFrame();
    },
    pause() {
      active = false; // 누적기 보존 — 다음 resume 에서 lastNow 재설정으로 멈춘 시간은 버려진다
      stopFrame();
    },
    resume() {
      active = true;
      startFrame();
    },
    stop() {
      active = false;
      stopFrame();
      detach();
      accumulator = 0;
    },
    isRunning() {
      return active;
    },
  };
}
