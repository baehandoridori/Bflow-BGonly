/* ═══════════════════════════════════════════════════════════════
   저장 실패 자동 재전송 (움직임 폴리싱 20번 safety-net — 한솔 결정 2026-10-03)

   단계 체크 저장이 실패하면 바로 되돌리지 않는다. 화면은 켜진 채로 두고 자동으로 다시 보낸다.
   - 다시 보내 볼 만한 실패(인터넷 끊김·시간 초과·서버 쪽 5xx)만 0.8초 → 2초 → 4초 간격으로 3번 더 보낸다.
   - 인터넷이 끊긴 상태면(브라우저 연결 신호) 다시 연결될 때까지 기다렸다가 보낸다(한 작업에 최대 60초).
   - 다시 보내 봐도 소용없는 실패(권한·검증 거절, 알 수 없는 실패)는 기다리지 않고 바로 포기한다.
   - 같은 칸 묶음(key)에 새 저장이 들어오면 기다리던 재전송은 취소된다 — 새 저장이 마지막 값을 보낸다('superseded').
     보내는 중이던 요청은 끝까지 기다리고, 그 요청이 저장에 성공했으면 새 저장에 알린다(onSupersededSaved).
     새 저장이 끝내 실패해도 이미 저장된 앞 클릭까지 되돌리지 않게 하려는 것이다.
   - 같은 key 의 요청은 차례로 보낸다. 앞 요청이 끝나야 다음 요청이 나간다(뒤 요청이 먼저 실패해 되돌린 다음
     앞 요청이 저장되는 일을 막는다).
   - 다시 보내기 직전에 화면 값이 내가 보낸 값과 다르면(다른 사람이 실시간으로 바꿈) 덮지 않고 멈춘다('overtaken').
   - 앱을 끄기 직전(flushNow)에는 재전송을 기다리던 작업을 깨워 지금 한 번 보낸다. 그 사이 같은 칸이 또 바뀌면
     넘겨받은 새 저장의 요청까지 기다린다.

   실패 분류는 오류 '문구'로 한다. 저장은 렌더러 → IPC → 메인 → Supabase 를 거치는데, 메인의 IPC 래퍼가
   오류를 문구 하나로 다시 던져서 코드·HTTP 상태가 사라진다. 그래서 메인이 HTTP 오류 상태를 문구 끝에
   ` [HTTP 503]` 처럼 붙여 보내고(electron/supabase.ts), 여기서는 그 표시와 네트워크·시간 초과 문구만 다시 보낼 대상으로 본다.

   node --test 가 그대로 import 하도록 @/ 별칭·외부 패키지를 쓰지 않는다(공용 모듈은 .ts 확장자까지 적은 상대 경로).
   ═══════════════════════════════════════════════════════════════ */

import { readHttpStatusMark } from '../shared/saveFailureMark.ts';

/** 다시 보내기 전 기다리는 시간(ms) — 3번. */
export const SAVE_RETRY_DELAYS_MS: readonly number[] = Object.freeze([800, 2000, 4000]);

/** 인터넷이 끊겼을 때 다시 연결되기를 기다리는 최대 시간(ms, 한 작업 전체). */
export const SAVE_OFFLINE_WAIT_MAX_MS = 60_000;

export type SaveFailureKind = 'transient' | 'permanent';

/** 네트워크가 끊겼거나 응답을 못 받은 실패. */
const NETWORK_PATTERNS: readonly RegExp[] = [
  /fetch failed/i, // Node(undici) — 메인 프로세스의 supabase-js
  /failed to fetch/i, // 브라우저 fetch
  /networkerror/i,
  /network request failed/i,
  /\b(ECONNRESET|ECONNREFUSED|ECONNABORTED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EPIPE)\b/,
  /\bUND_ERR_[A-Z_]+/,
  /socket hang up/i,
  /other side closed/i,
  /connection (?:reset|terminated|closed)/i,
];

/** 시간 초과·중단. */
const TIMEOUT_PATTERNS: readonly RegExp[] = [
  /AbortError/,
  /\b(?:this|the) operation was aborted/i,
  /\btimed? ?out\b/i, // 'timeout', 'time out', 'timed out'
  /\bETIMEDOUT\b/,
];

/** 상태 표시 없이 문구만 남은 서버 쪽(5xx) 실패 — 게이트웨이 HTML·Cloudflare·PostgREST 일시 오류. */
const SERVER_5XX_PATTERNS: readonly RegExp[] = [
  /\bBad Gateway\b/i,
  /\bService (?:Temporarily )?Unavailable\b/i,
  /\bGateway Time-?out\b/i,
  /\b5\d\d Internal Server Error\b/i,
  /error code: 5\d\d\b/i, // Cloudflare
  /upstream (?:connect error|request timeout|server)/i,
  /\bPGRST002\b/, // 스키마 캐시를 아직 못 읽음(503)
  /could not query the database for the schema cache/i,
  /too many connections|remaining connection slots/i,
];

function errorText(error: unknown): string {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'object') {
    const { name, message, code } = error as { name?: unknown; message?: unknown; code?: unknown };
    return [name, message, code].filter((part) => typeof part === 'string' && part).join(': ');
  }
  return String(error);
}

/**
 * 저장 실패를 '다시 보내 볼 만한 실패(transient)'와 '보내도 소용없는 실패(permanent)'로 나눈다.
 * 확실히 알 수 없으면 permanent(보수적으로) — 네트워크·시간 초과·5xx 만 다시 보낸다.
 * 메인이 붙인 HTTP 상태 표시가 있으면 그것이 우선이다(5xx·408 만 transient).
 */
export function classifySaveFailure(error: unknown): SaveFailureKind {
  const text = errorText(error);
  if (!text) return 'permanent';
  // 메인 프로세스가 붙인 HTTP 상태(src/shared/saveFailureMark.ts). 예: 'upstream request timeout [HTTP 504]'.
  const status = readHttpStatusMark(text);
  if (status !== null) return status >= 500 || status === 408 ? 'transient' : 'permanent';
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(text))) return 'transient';
  if (TIMEOUT_PATTERNS.some((pattern) => pattern.test(text))) return 'transient';
  if (SERVER_5XX_PATTERNS.some((pattern) => pattern.test(text))) return 'transient';
  return 'permanent';
}

/* ─── 재전송 진행기 ───────────────────────────────────────────── */

export interface SaveRetryEnv {
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
  /** 연결 상태 신호. 모르면 true(연결됨으로 본다). */
  isOnline(): boolean;
  /** 다시 연결되면 callback 을 부른다. 구독을 푸는 함수를 돌려준다. */
  onOnline(callback: () => void): () => void;
}

/** 브라우저(렌더러) 환경 — navigator.onLine 과 window 'online' 이벤트. */
export function browserSaveRetryEnv(): SaveRetryEnv {
  return {
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    onOnline: (callback) => {
      if (typeof window === 'undefined') return () => {};
      window.addEventListener('online', callback);
      return () => window.removeEventListener('online', callback);
    },
  };
}

/**
 * 'saved': 저장됨 · 'failed': 포기(onGiveUp 호출됨) · 'overtaken': 남의 값이 이겨서 멈춤
 * 'superseded': 같은 key 의 새 저장이 넘겨받음(이 작업의 콜백은 더 부르지 않는다).
 */
export type SaveRetryOutcome = 'saved' | 'failed' | 'overtaken' | 'superseded';

export interface SaveRetryJob<C = unknown> {
  /** 다음 저장이 넘겨받을 정보(되돌릴 기준값, 함께 보낼 칸 등). pendingCarry 로 읽는다. */
  carry: C;
  /** 보낸다. 실패하면 던진다. 다시 보낼 때도 같은 함수를 부른다. */
  attempt(): Promise<void>;
  /** 다시 보내기 직전 — 화면 값이 아직 내가 보낸 값인가. false 면 덮지 않고 멈춘다. */
  stillMine(): boolean;
  /** 처음으로 다시 보내기로 했을 때('다시 보내는 중' 표시). */
  onRetrying?(): void;
  onSaved?(): void;
  onOvertaken?(): void;
  /** 포기 — permanent 는 바로, transient 는 재전송을 다 쓰거나 연결을 60초 기다려도 안 될 때. 여기서 되돌린다. */
  onGiveUp(error: unknown, kind: SaveFailureKind): void;
  /**
   * 새 저장에 넘겨준 뒤 이 저장의 요청이 성공했다. successor 는 지금 이 key 를 맡은 저장의 carry 다.
   * 새 저장이 끝내 실패하면 이 저장의 결과까지만 되돌리도록 그 기준값을 앞당긴다.
   * (같은 key 의 요청은 차례로 나가므로 이때 뒤 요청은 아직 끝나지 않았다.)
   */
  onSupersededSaved?(successor: C | undefined): void;
}

export interface SaveRetryOptions {
  delaysMs?: readonly number[];
  offlineWaitMaxMs?: number;
  classify?: (error: unknown) => SaveFailureKind;
}

export interface SaveRetryController {
  /** 아직 끝나지 않은(보내는 중이거나 다시 보낼 차례를 기다리는) 같은 key 작업의 carry. */
  pendingCarry<C>(key: string): C | undefined;
  /** key 작업이 '다시 보내는 중'(첫 실패 뒤)인가. */
  isRetrying(key: string): boolean;
  run<C>(key: string, job: SaveRetryJob<C>): Promise<SaveRetryOutcome>;
  /**
   * 앱 종료 직전 — 재전송을 기다리던 작업을 깨워 지금 한 번 보낸다(연결 대기도 건너뛴다).
   * 깨운 요청과 보내는 중이던 요청이 끝나면(성공·실패 상관없이) 끝난다.
   */
  flushNow(): Promise<void>;
}

interface Entry {
  job: SaveRetryJob<unknown>;
  superseded: boolean;
  retrying: boolean;
  /** 새 저장이 넘겨받았다 — 기다림을 끝내고 그만둔다. */
  cancelWait: (() => void) | null;
  /** 앱 종료 직전 — 기다림을 끝내고 지금 보낸다. */
  wakeWait: (() => void) | null;
  /** flushNow 를 받았다 — 연결을 기다리지 않고 보낸다. */
  flushing: boolean;
  /** 다음 요청이 끝나거나 작업이 끝나면 부를 것(flushNow). */
  attemptWaiters: Array<() => void>;
}

const noop = () => {};

export function createSaveRetryController(env: SaveRetryEnv, options: SaveRetryOptions = {}): SaveRetryController {
  const delays = options.delaysMs ?? SAVE_RETRY_DELAYS_MS;
  const offlineWaitMaxMs = options.offlineWaitMaxMs ?? SAVE_OFFLINE_WAIT_MAX_MS;
  const classify = options.classify ?? classifySaveFailure;
  const entries = new Map<string, Entry>();
  /** key 마다 마지막으로 나간 요청(끝나면 지운다). 같은 key 의 다음 요청은 이 뒤에 선다. */
  const chains = new Map<string, Promise<void>>();

  /** 같은 key 의 앞 요청이 끝난 뒤에 보낸다. 앞 요청이 없으면 바로(클릭 순서 그대로) 보낸다. */
  const attemptInOrder = (key: string, job: SaveRetryJob<unknown>): Promise<void> => {
    const previous = chains.get(key);
    let current: Promise<void>;
    if (previous) {
      current = previous.then(() => job.attempt());
    } else {
      try {
        current = Promise.resolve(job.attempt());
      } catch (error) {
        current = Promise.reject(error);
      }
    }
    const settled = current.then(noop, noop);
    chains.set(key, settled);
    void settled.then(() => {
      if (chains.get(key) === settled) chains.delete(key);
    });
    return current;
  };

  const settleWaiters = (entry: Entry) => {
    entry.attemptWaiters.splice(0).forEach((resolve) => resolve());
  };

  /** ms 기다린다. 새 저장이 넘겨받으면 false, 앱 종료 직전에 깨우면 true. */
  const sleep = (entry: Entry, ms: number) =>
    new Promise<boolean>((resolve) => {
      let handle: unknown = null;
      const done = (proceed: boolean) => {
        if (handle !== null) env.clearTimer(handle);
        entry.cancelWait = null;
        entry.wakeWait = null;
        resolve(proceed);
      };
      handle = env.setTimer(() => done(true), ms);
      entry.cancelWait = () => done(false);
      entry.wakeWait = () => done(true);
    });

  /** 다시 연결될 때까지(최대 budgetMs) 기다린다. 앱 종료 직전에 깨우면 연결된 것처럼 바로 보낸다. */
  const waitOnline = (entry: Entry, budgetMs: number) =>
    new Promise<'online' | 'timeout' | 'cancelled'>((resolve) => {
      let settled = false;
      let handle: unknown = null;
      let unsubscribe: () => void = () => {};
      const finish = (result: 'online' | 'timeout' | 'cancelled') => {
        if (settled) return;
        settled = true;
        if (handle !== null) env.clearTimer(handle);
        unsubscribe();
        entry.cancelWait = null;
        entry.wakeWait = null;
        resolve(result);
      };
      unsubscribe = env.onOnline(() => finish('online'));
      handle = env.setTimer(() => finish('timeout'), Math.max(0, budgetMs));
      entry.cancelWait = () => finish('cancelled');
      entry.wakeWait = () => finish('online');
      // 구독하는 사이에 이미 연결됐을 수 있다.
      if (env.isOnline()) finish('online');
    });

  const runEntry = async (key: string, entry: Entry): Promise<SaveRetryOutcome> => {
    const { job } = entry;
    const release = () => {
      if (entries.get(key) === entry) entries.delete(key);
    };
    const giveUp = (error: unknown, kind: SaveFailureKind): SaveRetryOutcome => {
      release();
      job.onGiveUp(error, kind);
      return 'failed';
    };

    let retriesUsed = 0;
    let offlineBudgetMs = offlineWaitMaxMs;
    for (;;) {
      try {
        await attemptInOrder(key, job);
      } catch (error) {
        settleWaiters(entry);
        if (entry.superseded) return 'superseded';
        const kind = classify(error);
        if (kind === 'permanent' || retriesUsed >= delays.length) return giveUp(error, kind);
        if (!entry.retrying) {
          entry.retrying = true;
          job.onRetrying?.();
        }
        const waited = await sleep(entry, delays[retriesUsed]);
        retriesUsed += 1;
        if (!waited || entry.superseded) return 'superseded';
        if (!env.isOnline() && !entry.flushing) {
          const startedAt = env.now();
          const result = await waitOnline(entry, offlineBudgetMs);
          offlineBudgetMs = Math.max(0, offlineBudgetMs - (env.now() - startedAt));
          if (result === 'cancelled' || entry.superseded) return 'superseded';
          if (result === 'timeout') return giveUp(error, 'transient');
        }
        if (!job.stillMine()) {
          release();
          job.onOvertaken?.();
          return 'overtaken';
        }
        continue;
      }
      settleWaiters(entry);
      if (entry.superseded) {
        // 넘겨준 뒤 저장됐다 — 지금 이 key 를 맡은 저장이 끝내 실패해도 이 결과까지는 되돌리지 않게 알린다.
        job.onSupersededSaved?.(entries.get(key)?.job.carry);
        return 'superseded';
      }
      release();
      job.onSaved?.();
      return 'saved';
    }
  };

  return {
    pendingCarry<C>(key: string) {
      return entries.get(key)?.job.carry as C | undefined;
    },
    isRetrying(key: string) {
      return entries.get(key)?.retrying ?? false;
    },
    async run<C>(key: string, job: SaveRetryJob<C>) {
      const previous = entries.get(key);
      const entry: Entry = {
        job: job as SaveRetryJob<unknown>,
        superseded: false,
        retrying: false,
        cancelWait: null,
        wakeWait: null,
        flushing: false,
        attemptWaiters: [],
      };
      if (previous) {
        previous.superseded = true;
        // 앱 종료 직전 정리(flushNow)가 앞 저장을 기다리는 중에 같은 칸이 또 바뀌었다 — 그 정리가 새 저장의 요청까지
        // 기다리도록 정리 상태와 대기자를 넘긴다(앞 저장이 끝났다고 정리가 끝나면 마지막 클릭이 보내지지 않은 채 꺼진다).
        if (previous.attemptWaiters.length > 0) {
          entry.flushing = true;
          entry.attemptWaiters = previous.attemptWaiters.splice(0);
        }
        previous.cancelWait?.();
      }
      entries.set(key, entry);
      try {
        return await runEntry(key, entry);
      } finally {
        settleWaiters(entry);
      }
    },
    flushNow() {
      const waits: Promise<void>[] = [];
      for (const entry of entries.values()) {
        entry.flushing = true;
        waits.push(new Promise<void>((resolve) => entry.attemptWaiters.push(resolve)));
        entry.wakeWait?.();
      }
      // 넘겨준 뒤 아직 보내는 중인 앞 요청은 따로 기다리지 않는다 — 넘겨받은 저장의 요청이 그 뒤에 서 있다.
      return Promise.all(waits).then(noop);
    },
  };
}
