/**
 * BAE경 모델 일꾼을 띄우고 지켜보는 쪽 (메인 전용, 계획 14 3-3).
 *   - 처음 요청이 올 때 띄운다. 일꾼이 죽으면(그래픽카드 드라이버 · 메모리) 걸린 요청은 실패로 돌려주고, Bflow 는 그대로다.
 *     다음 요청에서 새로 띄운다 (같은 요청을 저절로 다시 보내지는 않는다 — 같은 그림이 또 죽이면 끝없이 돌기 때문).
 *   - 5분 동안 아무 일이 없으면 일꾼을 내려 메모리 · 그래픽카드 메모리를 돌려받는다 (0단계: 5.9GB · 10.3GB → 91MB · 0).
 *     전용 통로로 오는 일은 일꾼이 '일이 왔음'을 알려 와서 같이 센다.
 *   - 화면 쪽 일꾼에게 줄 전용 통로(MessagePort)를 일꾼에게 건넨다. 일꾼이 내려가면 통로도 닫힌다 → 화면은 새로 받는다.
 * electron 을 import 하지 않는다: 띄우는 함수(fork)를 부르는 쪽이 넣는다 (main: utilityProcess.fork, 시험: 가짜).
 */
import type { BaeWorkerRequest } from '../../../src/shared/bae/modelProtocol';
import { isBaeWorkerProgress, isBaeWorkerReply } from '../../../src/shared/bae/modelProtocol';

export interface BaeModelChild {
  postMessage(message: unknown, transfer?: unknown[]): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
  readonly pid?: number | undefined;
}

export interface BaeModelHostOptions {
  /** 일꾼 하나를 띄운다. env 는 일꾼 환경 변수에 더할 것. */
  fork(env: Record<string, string>): BaeModelChild;
  env: Record<string, string>;
  /** 쉬면 내리는 시간 (기본 5분) */
  idleMs?: number;
  /** 띄운 뒤 '준비됨'을 기다리는 시간 (기본 30초) */
  readyMs?: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  log?: (line: string) => void;
  /** 일꾼이 내려갔을 때 (expected: 쉬어서 · 끄라고 해서) */
  onExit?: (info: { code: number | null; expected: boolean; reason: string }) => void;
}

export class BaeWorkerError extends Error {
  constructor(message: string, readonly code: string) { super(message); }   // name 은 'Error' 그대로 (화면의 cleanIpcErrorMessage 가 벗김)
}

type Req = BaeWorkerRequest extends infer U ? (U extends unknown ? Omit<U, 'id'> : never) : never;
type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; onProgress?: (done: number, total: number) => void; type: string };
type Run = { child: BaeModelChild; ready: boolean; queue: Array<{ msg: unknown; transfer?: unknown[] }>; stopping: string | null; readyTimer: unknown; pid: number | null };

export function createBaeModelHost(opts: BaeModelHostOptions) {
  const idleMs = opts.idleMs ?? 5 * 60 * 1000;
  const readyMs = opts.readyMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const setIv = opts.setInterval ?? ((fn, ms) => { const h = setInterval(fn, ms); (h as { unref?: () => void }).unref?.(); return h; });
  const clearIv = opts.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const setTo = opts.setTimeout ?? ((fn, ms) => { const h = setTimeout(fn, ms); (h as { unref?: () => void }).unref?.(); return h; });
  const clearTo = opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const log = (line: string) => { try { opts.log?.(line); } catch { /* ignore */ } };

  let run: Run | null = null;
  let seq = 0;
  const pending = new Map<number, Pending>();
  let lastActivity = now();
  let idleTimer: unknown = null;
  let extraEnv: Record<string, string> = {};
  const stats = { starts: 0, crashes: 0, idleStops: 0 };

  function failAll(err: Error) { for (const [id, p] of pending) { pending.delete(id); p.reject(err); } }

  function onMessage(r: Run, m: unknown) {
    if (run !== r) return;
    const notice = m as { type?: unknown; pid?: unknown } | null;
    if (notice && typeof notice === 'object' && notice.type === 'ready') {
      r.ready = true; r.pid = typeof notice.pid === 'number' ? notice.pid : r.pid; if (r.readyTimer) { clearTo(r.readyTimer); r.readyTimer = null; }
      for (const q of r.queue.splice(0)) r.child.postMessage(q.msg, q.transfer);
      return;
    }
    if (notice && typeof notice === 'object' && notice.type === 'activity') { lastActivity = now(); return; }
    if (isBaeWorkerProgress(m)) { lastActivity = now(); const p = pending.get(m.id); try { p?.onProgress?.(m.progress.done, m.progress.total); } catch { /* ignore */ } return; }
    if (isBaeWorkerReply(m)) {
      lastActivity = now();
      const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
      if (m.ok) p.resolve(m as Record<string, unknown>);
      else p.reject(new BaeWorkerError(String((m as { error?: unknown }).error || '모델 계산이 실패했어요.'), String((m as { code?: unknown }).code || 'WORKER_ERROR')));
    }
  }

  function onExit(r: Run, code: number | null) {
    if (run !== r) return;
    run = null;
    if (r.readyTimer) { clearTo(r.readyTimer); r.readyTimer = null; }
    if (idleTimer) { clearIv(idleTimer); idleTimer = null; }
    const expected = r.stopping !== null;
    const reason = r.stopping ?? `exit ${code}`;
    if (!expected) stats.crashes++;
    log(`model worker ${r.pid ?? '?'} ${expected ? 'stopped' : 'died'} (${reason})`);
    failAll(expected && r.stopping === 'idle'
      ? new BaeWorkerError('모델 일꾼을 쉬게 했어요. 다시 해 주세요.', 'WORKER_STOPPED')
      : new BaeWorkerError('모델 일꾼이 멈췄어요. 다시 누르면 새로 띄워서 해요.', 'WORKER_EXIT'));
    try { opts.onExit?.({ code, expected, reason }); } catch { /* ignore */ }
  }

  function start(): Run {
    if (run) return run;
    const child = opts.fork({ ...opts.env, ...extraEnv });
    const r: Run = { child, ready: false, queue: [], stopping: null, readyTimer: null, pid: child.pid ?? null };
    run = r; stats.starts++; lastActivity = now();
    child.on('message', (m) => onMessage(r, m));
    child.on('exit', (code) => onExit(r, typeof code === 'number' ? code : null));
    r.readyTimer = setTo(() => {
      if (run === r && !r.ready) { log('model worker did not get ready'); stop('not ready', r); }
    }, readyMs);
    idleTimer = setIv(() => {
      if (run === r && r.ready && pending.size === 0 && now() - lastActivity >= idleMs) { stats.idleStops++; stop('idle', r); }
    }, Math.max(1000, Math.min(30_000, Math.floor(idleMs / 4))));
    log(`model worker starting (#${stats.starts})`);
    return r;
  }

  function send(r: Run, msg: unknown, transfer?: unknown[]) {
    if (r.ready) r.child.postMessage(msg, transfer); else r.queue.push({ msg, transfer });
  }

  function stop(reason: string, only?: Run): void {
    const r = run; if (!r || (only && only !== r)) return;
    r.stopping = reason;
    try { r.child.kill(); } catch { /* 이미 끝남 */ }
    // kill 뒤 'exit' 가 오지 않는 경우에도 다음 요청이 새로 띄우게
    setTo(() => { if (run === r) onExit(r, null); }, 5000);
  }

  return {
    /**
     * 일꾼에게 일 하나. 일꾼이 없으면 띄운다. 일꾼이 도중에 죽으면 BaeWorkerError('WORKER_EXIT').
     * 큰 배열은 복사로 간다 (utilityProcess 는 통로만 넘겨줄 수 있다).
     */
    request<T extends Record<string, unknown> = Record<string, unknown>>(msg: Req, o: { onProgress?: (done: number, total: number) => void } = {}): Promise<T & { id: number; ok: true }> {
      const id = ++seq; const r = start(); lastActivity = now();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: Record<string, unknown>) => void, reject, onProgress: o.onProgress, type: String((msg as { type?: unknown }).type) });
        try { send(r, { ...msg, id }); } catch (e) { pending.delete(id); reject(e instanceof Error ? e : new Error(String(e))); }
      });
    },
    /** 화면 쪽 일꾼에게 줄 통로의 한쪽 끝을 일꾼에게 건넨다 (일꾼이 없으면 띄운다). */
    connectPort(port: unknown): void { const r = start(); lastActivity = now(); send(r, { type: 'port' }, [port]); },
    /** 지금 일꾼을 내린다 (걸린 요청은 실패). */
    stop(reason = 'stop'): void { stop(reason); },
    /** 다음에 띄울 일꾼의 환경을 바꾼다 (시험: 그래픽카드를 끈 것처럼). 지금 일꾼은 내린다. */
    restartWith(env: Record<string, string>): void { extraEnv = { ...env }; stop('restart'); },
    state() { return { running: !!run, ready: !!run?.ready, pid: run?.pid ?? null, pending: pending.size, lastActivity, ...stats }; },
  };
}
export type BaeModelHost = ReturnType<typeof createBaeModelHost>;
