export interface TrailingDebounce {
  /** 한 번 부르기를 예약한다. 이미 예약돼 있으면 기다림을 다시 잰다(가장 이른 예약에서 maxWaitMs를 넘기지는 않는다). */
  schedule: () => void;
  /** 예약을 버린다. */
  cancel: () => void;
}

export interface TrailingDebounceOptions {
  waitMs: number;
  maxWaitMs: number;
  /** 테스트용 시계. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createTrailingDebounce(run: () => void, options: TrailingDebounceOptions): TrailingDebounce {
  const {
    waitMs,
    maxWaitMs,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;
  let handle: unknown = null;
  let firstAt: number | null = null;

  const cancel = () => {
    if (handle !== null) clearTimer(handle);
    handle = null;
    firstAt = null;
  };
  const fire = () => {
    handle = null;
    firstAt = null;
    run();
  };
  const schedule = () => {
    const at = now();
    if (firstAt === null) firstAt = at;
    if (handle !== null) clearTimer(handle);
    handle = setTimer(fire, Math.max(0, Math.min(waitMs, firstAt + maxWaitMs - at)));
  };
  return { schedule, cancel };
}
