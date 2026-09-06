const MIN_START_INTERVAL_MS = 1_100;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_RATE_LIMIT_RETRIES = 2;

export interface SlackWorkflowSendOptions {
  tag?: string;
  timeoutMs?: number;
  /** 큐 대기나 재시도 중 로그인 세션이 바뀌었다면 실제 전송을 취소한다. */
  isCurrent?: () => boolean;
}

export interface SlackWorkflowTransportDependencies {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface UrlQueue {
  tail: Promise<void>;
  nextStartAt: number;
}

export class SlackWorkflowCancelledError extends Error {
  constructor() {
    super('Slack workflow request cancelled because its session changed.');
    this.name = 'SlackWorkflowCancelledError';
  }
}

function retryDelayMs(header: string | null, now: number): number {
  const value = header?.trim();
  if (!value) return MIN_START_INTERVAL_MS;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value) * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : MIN_START_INTERVAL_MS;
}

/** 모든 Slack workflow 호출이 공유하는 URL별 직렬 전송 큐. 성공 여부가 불명확한 네트워크 오류는 재전송하지 않는다. */
export class SlackWorkflowTransport {
  private readonly fetchRequest: NonNullable<SlackWorkflowTransportDependencies['fetch']>;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly queues = new Map<string, UrlQueue>();

  constructor(dependencies: SlackWorkflowTransportDependencies = {}) {
    this.fetchRequest = dependencies.fetch ?? ((url, init) => fetch(url, init));
    this.now = dependencies.now ?? Date.now;
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async send(url: string, payload: Record<string, string>, options: SlackWorkflowSendOptions = {}): Promise<{ ok: true }> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError('Slack workflow timeoutMs must be a positive integer.');
    const sendOptions = { ...options, timeoutMs };
    const body = JSON.stringify(payload);
    const queueKey = url.trim();
    let queue = this.queues.get(queueKey);
    if (!queue) {
      queue = { tail: Promise.resolve(), nextStartAt: Number.NEGATIVE_INFINITY };
      this.queues.set(queueKey, queue);
    }
    const result = queue.tail.then(() => this.deliver(queueKey, body, sendOptions, queue));
    // 실패한 호출이 다음 수신자나 다른 기능의 전송을 막지 않도록 큐 꼬리는 항상 정상 종료한다.
    queue.tail = result.then(() => {}, () => {});
    return result;
  }

  private assertCurrent(options: SlackWorkflowSendOptions): void {
    if (options.isCurrent && !options.isCurrent()) throw new SlackWorkflowCancelledError();
  }

  private async deliver(url: string, body: string, options: SlackWorkflowSendOptions & { timeoutMs: number }, queue: UrlQueue): Promise<{ ok: true }> {
    const tag = options.tag ?? 'Slack Webhook';
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; ++attempt) {
      this.assertCurrent(options);
      let waitMs = queue.nextStartAt - this.now();
      while (waitMs > 0) {
        if (waitMs > MAX_RETRY_DELAY_MS) throw new Error(`[${tag}] Slack retry delay exceeds ${MAX_RETRY_DELAY_MS}ms.`);
        await this.sleep(waitMs);
        this.assertCurrent(options);
        waitMs = queue.nextStartAt - this.now();
      }
      // 각 재시도의 실제 fetch 직전까지 세션을 확인한다. 취소된 요청은 전송 간격을 소비하지 않는다.
      this.assertCurrent(options);
      queue.nextStartAt = this.now() + MIN_START_INTERVAL_MS;
      const response = await this.fetchRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      await response.text();
      if (response.ok) return { ok: true };
      if (response.status !== 429) throw new Error(`[${tag}] Slack webhook failed: ${response.status}`);

      const delay = retryDelayMs(response.headers.get('Retry-After'), this.now());
      if (!Number.isFinite(delay)) throw new Error(`[${tag}] Slack retry delay exceeds ${MAX_RETRY_DELAY_MS}ms.`);
      // 마지막 429도 URL의 다음 호출에 cooldown을 남긴다. 상한을 넘으면 기다리지 않고 실패한다.
      queue.nextStartAt = Math.max(queue.nextStartAt, this.now() + delay);
      if (delay > MAX_RETRY_DELAY_MS) {
        throw new Error(`[${tag}] Slack retry delay exceeds ${MAX_RETRY_DELAY_MS}ms.`);
      }
      if (attempt === MAX_RATE_LIMIT_RETRIES) throw new Error(`[${tag}] Slack webhook failed: 429 (retry limit reached).`);
    }
    throw new Error(`[${tag}] Slack webhook retry limit reached.`);
  }
}
