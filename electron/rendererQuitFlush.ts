/**
 * 앱 종료 직전, 창(렌더러)이 미뤄 둔 저장을 끝낼 시간을 준다.
 *
 * 움직임 폴리싱 20번 '되돌리기': 댓글 휴지통은 5초 동안 되돌리기를 기다렸다가 서버에서 지운다. 그 사이 트레이 '종료'나
 * '지금 업데이트'로 앱을 끄면, 메인은 대기 작업이 있을 때만 창에 알리고 곧바로 끝냈기 때문에 지운 댓글이 남았다.
 * 이제 메인은 대기 작업과 상관없이 모든 창에 신호를 보내고, 각 창이 '끝났다'고 답하거나 시간이 다 되면 종료를 이어 간다.
 * 창은 기다릴 일이 없으면 곧바로 답하므로 평소 종료는 늦어지지 않는다.
 *
 * electron 을 import 하지 않는다 — 메인(electron/main.ts)·preload(electron/preload.ts)가 함께 쓰고,
 * node --test 에서 바로 불러 쓴다(tests/motion/comments-notify-review-fix.test.ts).
 */

/** 메인 → 창: 미뤄 둔 저장을 지금 끝내 달라(값: 이번 종료의 표). */
export const QUIT_FLUSH_CHANNEL = 'app:before-quit-flush';
/** 창 → 메인: 끝났다(값: 받은 표 그대로). */
export const QUIT_FLUSHED_CHANNEL = 'app:before-quit-flushed';
/** 창이 답하지 않아도(멈춤·로딩 중) 종료를 이만큼만 미룬다. */
export const QUIT_FLUSH_TIMEOUT_MS = 3000;

export interface QuitFlushTarget {
  /** 답한 창을 가리는 번호(webContents.id). */
  id: number;
  send: (channel: string, token: string) => void;
}

export interface QuitFlushOptions {
  targets: QuitFlushTarget[];
  token: string;
  /** 창의 답을 듣는다. 돌려준 함수로 그만 듣는다. */
  subscribeAck: (listener: (senderId: number, token: unknown) => void) => () => void;
  timeoutMs?: number;
  /** 테스트용 시계. 기본은 setTimeout/clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export type QuitFlushResult = 'none' | 'flushed' | 'timeout';

/** 모든 창에 신호를 보내고, 모두 답하거나 시간이 다 되면 끝난다(실패로 끝나지 않는다). */
export function waitForRendererQuitFlush(options: QuitFlushOptions): Promise<QuitFlushResult> {
  const {
    targets,
    token,
    subscribeAck,
    timeoutMs = QUIT_FLUSH_TIMEOUT_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;
  const waiting = new Set(targets.map((target) => target.id));
  if (waiting.size === 0) return Promise.resolve('none');

  return new Promise<QuitFlushResult>((resolve) => {
    let settled = false;
    let timer: unknown = null;
    let unsubscribe: () => void = () => {};
    const finish = (result: QuitFlushResult) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimer(timer);
      try { unsubscribe(); } catch { /* ignore */ }
      resolve(result);
    };
    unsubscribe = subscribeAck((senderId, ackToken) => {
      if (ackToken !== token || !waiting.delete(senderId)) return;
      if (waiting.size === 0) finish('flushed');
    });
    timer = setTimer(() => finish('timeout'), timeoutMs);
    for (const target of targets) {
      try {
        target.send(QUIT_FLUSH_CHANNEL, token);
      } catch {
        // 이미 닫힌 창 — 기다리지 않는다.
        waiting.delete(target.id);
      }
    }
    if (waiting.size === 0) finish('flushed');
  });
}

/**
 * 창(preload) 쪽: 화면이 맡긴 '종료 전에 끝낼 일'을 모아 두었다가, 신호가 오면 모두 끝낸 뒤(실패해도) 답한다.
 * 맡긴 일이 없으면 곧바로 끝난다.
 */
export function createQuitFlushRegistry() {
  const callbacks = new Set<() => unknown>();
  return {
    add(callback: () => unknown): () => void {
      callbacks.add(callback);
      return () => { callbacks.delete(callback); };
    },
    async run(): Promise<void> {
      await Promise.allSettled([...callbacks].map((callback) => {
        try {
          return Promise.resolve(callback());
        } catch (err) {
          return Promise.reject(err);
        }
      }));
    },
  };
}
