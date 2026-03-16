// ─── 지수 백오프 재연결 유틸 ────────────────────
// broadcast.ts, realtime.ts 공통 사용

export const RETRY_DEFAULTS = {
  MAX_RETRIES: 10,
  BASE_DELAY_MS: 2_000,
  MAX_DELAY_MS: 60_000,
} as const;

export interface RetryManager {
  /** 현재 재시도 횟수 */
  readonly count: number;
  /** 재시도 예약 (중복 방지 내장). 콜백이 호출될 때 count가 자동 증가. 최대 횟수 초과 시 false 반환 */
  schedule(callback: () => void): boolean;
  /** 재시도 성공 시 카운터 + 타이머 초기화 */
  reset(): void;
  /** 정리 (타이머 해제) */
  clear(): void;
}

export function createRetryManager(
  label: string,
  opts?: Partial<typeof RETRY_DEFAULTS>,
): RetryManager {
  const MAX_RETRIES = opts?.MAX_RETRIES ?? RETRY_DEFAULTS.MAX_RETRIES;
  const BASE_DELAY_MS = opts?.BASE_DELAY_MS ?? RETRY_DEFAULTS.BASE_DELAY_MS;
  const MAX_DELAY_MS = opts?.MAX_DELAY_MS ?? RETRY_DEFAULTS.MAX_DELAY_MS;

  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function getDelay(): number {
    return Math.min(BASE_DELAY_MS * 2 ** retryCount, MAX_DELAY_MS);
  }

  return {
    get count() {
      return retryCount;
    },

    schedule(callback: () => void): boolean {
      if (retryCount >= MAX_RETRIES) {
        console.error(`[${label}] 최대 재시도 횟수(${MAX_RETRIES}) 초과 — 재연결 중단`);
        return false;
      }
      if (retryTimer) return true; // 이미 예약됨

      const delay = getDelay();
      console.log(`[${label}] ${delay / 1000}초 후 재연결 시도 (${retryCount + 1}/${MAX_RETRIES})`);

      retryTimer = setTimeout(() => {
        retryTimer = null;
        retryCount++;
        callback();
      }, delay);
      return true;
    },

    reset() {
      retryCount = 0;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    },

    clear() {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    },
  };
}
