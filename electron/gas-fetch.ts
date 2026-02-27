/**
 * GAS (Google Apps Script) HTTP fetch 공유 모듈
 *
 * sheets.ts와 vacation.ts 모두 이 모듈의 gasFetch/gasFetchWithRetry를 사용한다.
 * GAS 웹 앱은 302 리다이렉트로 응답을 전달하므로, 리다이렉트를 수동으로 처리한다.
 */

// ─── 재시도 알림 콜백 ────────────────────────────────────────────
let retryNotifyCallback: ((message: string) => void) | null = null;

export function setRetryNotifyCallback(cb: (message: string) => void): void {
  retryNotifyCallback = cb;
}

export function getRetryNotifyCallback(): ((message: string) => void) | null {
  return retryNotifyCallback;
}

// ─── 재시도 상수 ────────────────────────────────────────────────
export const MAX_RETRIES = 2;
export const RETRY_DELAYS = [1000, 3000]; // 1초, 3초

export function isRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

// ─── GAS fetch 헬퍼 (302 리다이렉트 수동 처리) ──────────────────

export async function gasFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  let targetUrl = url;
  let currentOptions = { ...options };

  for (let i = 0; i < 5; i++) {
    const res = await fetch(targetUrl, {
      ...currentOptions,
      redirect: 'manual',
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new Error('리다이렉트 location 헤더 없음');
      targetUrl = location;

      // 301/302/303: POST→GET 변환 (RFC 7231)
      if ([301, 302, 303].includes(res.status) && currentOptions.method === 'POST') {
        const { method: _, body: __, ...rest } = currentOptions;
        currentOptions = { ...rest, method: 'GET' };
      }

      continue;
    }

    return res;
  }

  throw new Error('리다이렉트 횟수 초과');
}

// ─── 재시도 래퍼 ────────────────────────────────────────────────

export async function gasFetchWithRetry(
  url: string,
  options: RequestInit = {},
  label = 'GAS'
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await gasFetch(url, options);

      if (!res.ok && isRetryable(res.status) && attempt < MAX_RETRIES) {
        console.warn(
          `[${label}] HTTP ${res.status}, 재시도 ${attempt + 1}/${MAX_RETRIES} (${RETRY_DELAYS[attempt]}ms 후)`
        );
        retryNotifyCallback?.(`동기화 재시도 중... (${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < MAX_RETRIES) {
        console.warn(
          `[${label}] 네트워크 오류, 재시도 ${attempt + 1}/${MAX_RETRIES} (${RETRY_DELAYS[attempt]}ms 후):`,
          lastError.message
        );
        retryNotifyCallback?.(`동기화 재시도 중... (${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
    }
  }

  throw lastError ?? new Error('요청 실패 (재시도 소진)');
}
