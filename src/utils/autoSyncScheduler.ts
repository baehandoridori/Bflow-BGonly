/**
 * 자동 '전부 다시 받기'를 언제 할지 정한다 (2026-10-20 켜 두기만 해도 서버를 계속 부르던 문제).
 *
 * 다른 사람의 변경은 실시간 연결이 바로 알려 준다. 주기적인 전부 다시 받기는 그 알림을 놓쳤을 때를 위한
 * 안전망일 뿐인데, 예전에는 켜진 PC 마다 15초에 한 번씩 창이 트레이에 있어도 돌아 하루 약 49만 건이 됐다.
 *
 * - 창이 보이고 실시간이 붙어 있으면: 마지막으로 받은 뒤 visibleConnectedMs 가 지나야 받는다.
 * - 창이 보이는데 실시간이 끊겼으면: visibleDisconnectedMs(예전 15초). 이때는 이게 변경을 아는 유일한 길이다.
 * - 창이 숨었으면(트레이·최소화): hiddenMs. 실시간으로 온 '전부 다시 받아야 하는 변경'도 미뤄 두고 표시만 해 둔다.
 * - 다시 보이면: 미뤄 둔 변경이 있거나 마지막으로 받은 지 staleOnShowMs 가 지났으면 바로 받는다.
 *   화면은 갖고 있던 내용을 그대로 보여 주고, 받는 동안 뒤에서 조용히 바뀐다.
 * - 안전망 차례에 이미 받는 중이면 건너뛴다(겹쳐 쌓이지 않게). 실시간 변경으로 받는 것은 예전처럼 바로 돈다.
 * - 첫 로드·직접 새로고침처럼 다른 길로 받은 것도 '마지막으로 받은 때'로 센다(getLastSyncedAt).
 *
 * 흔한 데이터 앱(TanStack Query 의 refetchOnWindowFocus·refetchIntervalInBackground=false,
 * Supabase 실시간 안내의 '재연결·다시 보일 때 정본 다시 읽기')과 같은 짜임이다.
 *
 * node --test 가 그대로 import 하도록 런타임 의존이 없다.
 */

export interface AutoSyncIntervals {
  /** 창이 보이고 실시간이 붙어 있을 때 안전망 간격 */
  visibleConnectedMs: number;
  /** 창이 보이는데 실시간이 끊겼을 때 간격 */
  visibleDisconnectedMs: number;
  /** 창이 숨었을 때(트레이·최소화) 간격 */
  hiddenMs: number;
  /** 다시 보일 때 이만큼 지났으면 바로 받는다 */
  staleOnShowMs: number;
}

/** 본 창 — 화면 대부분이 여기서 받은 내용을 쓴다. */
export const MAIN_WINDOW_SYNC_INTERVALS: AutoSyncIntervals = {
  visibleConnectedMs: 60_000,
  visibleDisconnectedMs: 15_000,
  hiddenMs: 5 * 60_000,
  staleOnShowMs: 30_000,
};

/** 위젯 새 창 — 칸 단위 변경은 실시간으로 바로 고쳐 쓰고, 예전 안전망도 2분이었다. */
export const POPUP_WINDOW_SYNC_INTERVALS: AutoSyncIntervals = {
  visibleConnectedMs: 5 * 60_000,
  visibleDisconnectedMs: 2 * 60_000,
  hiddenMs: 5 * 60_000,
  staleOnShowMs: 60_000,
};

/** 타이머가 거의 제때 울렸으면 다시 미루지 않는다(아주 짧은 재예약이 이어지지 않게). */
const DUE_TOLERANCE_MS = 250;
/** 받는 중이라 건너뛰었거나 미룬 변경을 곧 받아야 할 때 다시 살펴보는 간격 */
const RETRY_WAIT_MS = 1_000;

export function autoSyncIntervalMs(
  intervals: AutoSyncIntervals,
  state: { visible: boolean; connected: boolean },
): number {
  if (!state.visible) return intervals.hiddenMs;
  return state.connected ? intervals.visibleConnectedMs : intervals.visibleDisconnectedMs;
}

export interface AutoSyncSchedulerDeps {
  /** 전부 다시 받기 한 번 */
  run: () => unknown;
  /** 지금 받는 중인가 */
  isBusy: () => boolean;
  isVisible: () => boolean;
  /** 실시간 연결이 붙어 있는가 */
  isConnected: () => boolean;
  intervals: AutoSyncIntervals;
  /** 다른 길(첫 로드·직접 새로고침)로 마지막으로 받은 때 */
  getLastSyncedAt?: () => number | null;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface AutoSyncScheduler {
  start(): void;
  stop(): void;
  /** 실시간 변경·재연결로 전부 다시 받아야 할 때. 창이 숨어 있으면 미뤄 둔다. 바로 받았으면 true. */
  requestFromEvent(): boolean;
  /** 창이 보이거나 숨었을 때, 실시간 연결 상태가 바뀌었을 때 부른다. */
  refreshState(): void;
}

export function createAutoSyncScheduler(deps: AutoSyncSchedulerDeps): AutoSyncScheduler {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let started = false;
  let timer: unknown = null;
  /** 창이 숨어 있는 동안 실시간 변경이 와서 미뤄 둔 받기가 있다 */
  let deferred = false;
  let lastRunAt: number | null = null;
  let wasVisible = true;

  const lastSyncedAt = (): number | null => {
    const other = deps.getLastSyncedAt?.() ?? null;
    if (lastRunAt === null) return other;
    return other === null ? lastRunAt : Math.max(lastRunAt, other);
  };

  const currentInterval = () => autoSyncIntervalMs(deps.intervals, {
    visible: deps.isVisible(),
    connected: deps.isConnected(),
  });

  const runNow = () => {
    deferred = false;
    lastRunAt = now();
    try {
      void Promise.resolve(deps.run()).catch(() => { /* 실패 표시는 run 이 맡는다 */ });
    } catch { /* 동기 예외도 다음 차례에 다시 시도한다 */ }
  };

  const isDue = (): boolean => {
    if (deferred && deps.isVisible()) return true;
    const last = lastSyncedAt();
    return last === null || now() - last >= currentInterval() - DUE_TOLERANCE_MS;
  };

  const schedule = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (!started) return;
    let wait: number;
    if (deferred && deps.isVisible()) {
      wait = RETRY_WAIT_MS;
    } else {
      const last = lastSyncedAt();
      const interval = currentInterval();
      wait = last === null ? interval : Math.max(RETRY_WAIT_MS, last + interval - now());
    }
    timer = setTimer(tick, wait);
  };

  function tick() {
    timer = null;
    if (!started) return;
    if (isDue()) {
      if (deps.isBusy()) {
        timer = setTimer(tick, RETRY_WAIT_MS);
        return;
      }
      runNow();
    }
    schedule();
  }

  return {
    start() {
      if (started) return;
      started = true;
      wasVisible = deps.isVisible();
      schedule();
    },
    stop() {
      started = false;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
    requestFromEvent() {
      if (started && !deps.isVisible()) {
        deferred = true;
        schedule();
        return false;
      }
      runNow();
      schedule();
      return true;
    },
    refreshState() {
      if (!started) return;
      const visible = deps.isVisible();
      if (visible && !wasVisible) {
        const last = lastSyncedAt();
        const stale = last === null || now() - last >= deps.intervals.staleOnShowMs;
        // 받는 중이면 그 받기가 미뤄 둔 변경보다 먼저 시작했을 수 있다 — deferred 를 남겨 1초 뒤 다시 본다.
        if ((deferred || stale) && !deps.isBusy()) runNow();
      }
      wasVisible = visible;
      schedule();
    },
  };
}
