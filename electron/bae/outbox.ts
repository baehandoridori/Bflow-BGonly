/**
 * BAE경 '못 보낸 것' 줄 (장부 줄 · 작업 기록 · 미리보기 올리기). 이 PC 파일에 먼저 적고 → 보내 보고 → 보낸 줄만 지운다.
 * - 줄 파일은 한 줄에 하나(JSONL). 고칠 때마다 임시 파일 → 이름 바꾸기로 통째로 다시 쓴다 (반쯤 쓴 파일이 남지 않는다).
 * - 같은 번호표(id)는 두 번 들어가지 않는다 (서버도 request_id 로 한 번만 받지만 여기서도 막는다).
 * - 실패하면 5초 → 10초 → … 최대 10분 기다렸다가 다시. 같은 작업(orderKey)의 줄은 생긴 순서대로, 앞 줄이 막히면 뒤 줄도 기다린다.
 * - 다시 보내도 소용없는 오류(권한 없음 · 모양이 틀림)는 dead 파일로 옮긴다 (지우지 않는다).
 * - 줄은 넣은 사람(owner)의 세션으로만 보낸다: 다른 사람이 로그인해 있으면 기다린다.
 * - 키 · 세션 토큰은 줄에 넣지 않는다 (넣으려 하면 거절하고 파일에 적지 않는다).
 * electron 을 import 하지 않는다. 시계 · 타이머 · 보내기 함수는 주입한다.
 */
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { maskSecrets } from '../../src/shared/bae/secrets';
import { writeFileAtomic } from './atomicFile';

export type BaeOutboxKind = 'usage' | 'job' | 'preview' | (string & {});

export interface BaeOutboxEntry {
  id: string;
  kind: BaeOutboxKind;
  payload: unknown;
  tries: number;
  /** 다음에 보내 볼 때 (ms). */
  nextAt: number;
  createdAt: number;
  /** 넣은 사람의 사용자 id (토큰이 아니다). 이 사람이 로그인해 있을 때만 보낸다. */
  owner: string | null;
  /** 같은 값끼리는 생긴 순서대로 (기본: 작업 기록 · 미리보기는 작업 id). */
  orderKey: string | null;
  lastError: string | null;
}

export type BaeOutboxHandler = (payload: unknown, id: string, ctx: { kind: string; owner: string | null; signal: AbortSignal }) => Promise<unknown>;

export interface BaeOutboxOptions {
  /** 줄 파일을 둘 폴더 (보관함의 outbox\). */
  dir: string;
  /** 종류별 보내기 함수. 던지면 실패, 끝나면 성공. */
  handlers: Record<string, BaeOutboxHandler>;
  /** 지금 로그인한 사람 (없으면 null). 주면 줄은 넣은 사람이 로그인해 있을 때만 보낸다. */
  ownerNow?: () => string | null;
  orderKey?: (kind: string, payload: unknown) => string | null;
  /** 다시 보내도 소용없는 오류인지 (기본: baeOutboxPermanent). */
  isPermanent?: (error: unknown) => boolean;
  /** 줄 안에 있으면 안 되는 값들 (지금 세션 토큰 · 키). 들어 있으면 거절한다. */
  forbiddenValues?: () => Array<string | null | undefined>;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 보내기 함수 하나를 이만큼만 기다린다 (그 뒤엔 실패로 보고 다시 줄에). */
  sendTimeoutMs?: number;
  log?: (message: string) => void;
}

export type BaeEnqueueStatus = 'sent' | 'queued' | 'duplicate' | 'dead';

const QUEUE_FILE = 'outbox.jsonl';
const DEAD_FILE = 'dead.jsonl';
const BROKEN_FILE = 'broken.txt';
const MAX_PAYLOAD_CHARS = 1_000_000;
const ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const KIND_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const SECRET_FIELD_RE = /^(p_)?(session_?token|access_?token|refresh_?token|token|api_?key|openai_?key|key|authorization|password|secret)$/i;
const KEY_IN_TEXT_RE = /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/;
const BEARER_IN_TEXT_RE = /Bearer\s+[A-Za-z0-9._~+/-]{16,}/;

/** 다시 보내도 소용없는 오류: 권한 없음(42501, 단 로그인 세션 만료는 다시 로그인하면 되니 빼고) · 값 모양이 틀림(22023 · 22P02) · 직접 표시(permanent). */
export function baeOutboxPermanent(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; permanent?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.permanent === true) return true;
  const code = String(e.code ?? ''); const msg = String(e.message ?? '');
  if (code === '42501') return !/로그인 세션/.test(msg);
  return code === '22023' || code === '22P02';
}

/** 기본 순서 열쇠: 작업 기록(p_job 의 id) · 미리보기(jobId)는 같은 작업끼리 한 줄로. 장부 줄은 서로 기대지 않는다. */
export function baeDefaultOrderKey(kind: string, payload: unknown): string | null {
  if (kind !== 'job' && kind !== 'preview') return null;
  const p = payload as { id?: unknown; jobId?: unknown } | null;
  const jid = p && typeof p === 'object' ? (kind === 'job' ? p.id ?? p.jobId : p.jobId) : null;
  return typeof jid === 'string' && jid ? 'job:' + jid : null;
}

/** 줄에 넣으면 안 되는 것이 있는지 (있으면 까닭, 없으면 null). */
export function baeOutboxPayloadProblem(payload: unknown, forbidden: Array<string | null | undefined> = []): string | null {
  let badField = false; let text: string | undefined;
  try { text = JSON.stringify(payload, (k, v) => { if (k && SECRET_FIELD_RE.test(k)) badField = true; return v; }); } catch { return '보낼 내용을 파일에 적을 수 없어요.'; }
  if (text === undefined) return '보낼 내용이 비어 있어요.';
  if (text.length > MAX_PAYLOAD_CHARS) return '보낼 내용이 너무 커요.';
  if (badField || KEY_IN_TEXT_RE.test(text) || BEARER_IN_TEXT_RE.test(text)) return '보낼 줄에 키나 로그인 정보가 들어 있어서 적지 않았어요.';
  for (const v of forbidden) {
    if (typeof v !== 'string' || v.length < 8) continue;
    if (text.includes(v) || text.includes(JSON.stringify(v).slice(1, -1))) return '보낼 줄에 키나 로그인 정보가 들어 있어서 적지 않았어요.';
  }
  return null;
}

function parseEntry(line: string): BaeOutboxEntry | null {
  let v: Record<string, unknown>;
  try { v = JSON.parse(line); } catch { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (typeof v.id !== 'string' || !ID_RE.test(v.id) || typeof v.kind !== 'string' || !KIND_RE.test(v.kind) || !('payload' in v)) return null;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  if (!num(v.tries) || !num(v.nextAt) || !num(v.createdAt)) return null;
  return {
    id: v.id, kind: v.kind, payload: v.payload, tries: v.tries as number, nextAt: v.nextAt as number, createdAt: v.createdAt as number,
    owner: typeof v.owner === 'string' ? v.owner : null, orderKey: typeof v.orderKey === 'string' ? v.orderKey : null,
    lastError: typeof v.lastError === 'string' ? v.lastError : null,
  };
}

async function readText(file: string): Promise<string> {
  try { return await readFile(file, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export function createBaeOutbox(opts: BaeOutboxOptions) {
  const dir = opts.dir;
  const queueFile = join(dir, QUEUE_FILE);
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return t; });
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const baseDelay = opts.baseDelayMs ?? 5_000;
  const maxDelay = opts.maxDelayMs ?? 600_000;
  const sendTimeout = opts.sendTimeoutMs ?? 30_000;
  const isPermanent = opts.isPermanent ?? baeOutboxPermanent;
  const orderKeyOf = opts.orderKey ?? baeDefaultOrderKey;
  const log = (m: string) => { try { (opts.log ?? ((x: string) => console.warn('[bae outbox]', x)))(maskSecrets(m)); } catch { /* 기록 실패는 무시 */ } };

  let queue: BaeOutboxEntry[] = [];
  const deadIds = new Set<string>();
  const recentSent = new Set<string>();
  let loading: Promise<void> | null = null;
  let writing: Promise<void> = Promise.resolve();
  let running: Promise<void> | null = null; let again = false; let againAll = false;
  let timer: unknown = null; let stopped = false;
  /** 한 번에 여러 줄이 잇달아 실패하면 (연결이 없을 때) 이때까지 쉰다. */
  let holdUntil = 0;

  const ownerNow = () => (opts.ownerNow ? opts.ownerNow() : null);
  const ownerOk = (e: BaeOutboxEntry, owner: string | null) => !opts.ownerNow || e.owner === null || e.owner === owner;
  const sendable = (e: BaeOutboxEntry, owner: string | null) => !!opts.handlers[e.kind] && ownerOk(e, owner);
  const backoff = (tries: number) => Math.min(maxDelay, baseDelay * 2 ** Math.min(Math.max(tries - 1, 0), 20) * (1 + 0.2 * random()));

  function rememberSent(id: string) {
    recentSent.add(id);
    if (recentSent.size > 1000) recentSent.delete(recentSent.values().next().value as string);
  }

  /** 지금 줄 전체를 파일에. 여러 번 불려도 차례대로 쓰고, 쓸 때의 최신 줄을 쓴다. */
  function persist(): Promise<void> {
    const p = writing.then(async () => {
      await writeFileAtomic(queueFile, queue.map((e) => JSON.stringify(e)).join('\n') + (queue.length ? '\n' : ''));
    });
    writing = p.catch(() => undefined);
    return p;
  }
  async function persistQuiet() { try { await persist(); } catch (error) { log('줄 파일을 쓰지 못함: ' + String((error as Error)?.message ?? error)); } }

  function load(): Promise<void> {
    if (!loading) loading = (async () => {
      await mkdir(dir, { recursive: true });
      for (const line of (await readText(join(dir, DEAD_FILE))).split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { const v = JSON.parse(line); if (v && typeof v.id === 'string') deadIds.add(v.id); } catch { /* 깨진 줄은 건너뜀 */ }
      }
      const broken: string[] = []; const seen = new Set<string>(); let dropped = false;
      for (const line of (await readText(queueFile)).split(/\r?\n/)) {
        if (!line.trim()) continue;
        const e = parseEntry(line);
        if (!e) { broken.push(line); continue; }
        if (seen.has(e.id) || deadIds.has(e.id)) { dropped = true; continue; }
        seen.add(e.id); queue.push(e);
      }
      let setAside = true;
      if (broken.length) {
        // 쓰다 꺼진 줄: 버리지 않고 옆 파일에 옮겨 둔다 (옮기지 못하면 줄 파일도 지금은 다시 쓰지 않는다).
        try {
          await appendFile(join(dir, BROKEN_FILE), broken.map((l) => `${new Date(now()).toISOString()}\t${l}`).join('\n') + '\n', 'utf8');
          log(`깨진 줄 ${broken.length}개를 ${BROKEN_FILE} 로 옮김`);
        } catch (error) { setAside = false; log('깨진 줄을 옮기지 못함: ' + String((error as Error)?.message ?? error)); }
      }
      if (setAside && (broken.length || dropped)) await persistQuiet();
    })().catch((error) => { loading = null; queue = []; throw error; }); // 읽지 못하면 다음 부름 때 다시 읽는다
    return loading;
  }

  async function sendOne(e: BaeOutboxEntry): Promise<{ ok: boolean; permanent: boolean; message: string }> {
    const handler = opts.handlers[e.kind];
    const ctl = new AbortController(); let t: unknown = null;
    const work = Promise.resolve().then(() => handler(e.payload, e.id, { kind: e.kind, owner: e.owner, signal: ctl.signal }));
    work.catch(() => undefined); // 시간이 다 된 뒤에 실패해도 처리하지 않은 거절로 남기지 않는다
    const timeout = new Promise<never>((_, reject) => {
      t = setTimeout(() => { ctl.abort(); reject(Object.assign(new Error('보내기가 너무 오래 걸려요.'), { code: 'BAE_OUTBOX_TIMEOUT' })); }, sendTimeout);
    });
    try { await Promise.race([work, timeout]); return { ok: true, permanent: false, message: '' }; } catch (error) {
      const message = maskSecrets(String((error as Error)?.message ?? error)).slice(0, 300);
      let permanent = false; try { permanent = isPermanent(error); } catch { permanent = false; }
      return { ok: false, permanent, message };
    } finally { clearTimeout(t as ReturnType<typeof setTimeout>); }
  }

  async function moveToDead(e: BaeOutboxEntry, message: string) {
    // dead 에 먼저 적고 줄에서 뺀다 (사이에 꺼지면 다음 시작 때 dead 에 있는 id 는 줄에서 뺀다).
    try {
      await appendFile(join(dir, DEAD_FILE), JSON.stringify({ ...e, lastError: message, deadAt: now() }) + '\n', 'utf8');
    } catch (error) { log('dead 파일에 적지 못함: ' + String((error as Error)?.message ?? error)); return false; }
    deadIds.add(e.id);
    queue = queue.filter((x) => x !== e);
    await persistQuiet();
    return true;
  }

  async function pass(all: boolean) {
    await load();
    const owner = ownerNow();
    const blocked = new Set<string>();
    let streak = 0;
    for (const e of [...queue]) {
      if (stopped) break;
      if (!queue.includes(e)) continue;
      if (e.orderKey && blocked.has(e.orderKey)) continue;
      const t = now();
      const due = all || (e.nextAt <= t && t >= holdUntil);
      if (!sendable(e, owner) || !due) { if (e.orderKey) blocked.add(e.orderKey); continue; }
      const r = await sendOne(e);
      if (r.ok) {
        queue = queue.filter((x) => x !== e); rememberSent(e.id); streak = 0; holdUntil = 0;
        await persistQuiet();
        continue;
      }
      if (r.permanent && await moveToDead(e, r.message)) { log(`보내도 소용없는 줄을 dead 로 옮김 (${e.kind} ${e.id}): ${r.message}`); continue; }
      e.tries += 1; e.nextAt = now() + backoff(e.tries); e.lastError = r.message;
      if (e.orderKey) blocked.add(e.orderKey);
      await persistQuiet();
      streak += 1;
      // 잇달아 셋이 실패하면 연결이 아직 없는 것: 이번 판은 여기까지 (all 이어도 — 줄이 많을 때 하나씩 다 기다리지 않게).
      if (streak >= 3) { holdUntil = e.nextAt; break; }
    }
  }

  /** 다음에 보낼 때를 잡는다: 줄마다(같은 작업은 맨 앞 줄만) 가장 이른 때. */
  function schedule() {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (stopped) return;
    const owner = ownerNow(); const seenKeys = new Set<string>(); let at = Infinity;
    for (const e of queue) {
      if (e.orderKey) { if (seenKeys.has(e.orderKey)) continue; seenKeys.add(e.orderKey); }
      if (sendable(e, owner)) at = Math.min(at, e.nextAt);
    }
    if (at === Infinity) return;
    const wait = Math.min(maxDelay, Math.max(50, Math.max(at, holdUntil) - now()));
    timer = setTimer(() => { timer = null; void flush().catch((error) => log('다시 보내기 실패: ' + String((error as Error)?.message ?? error))); }, wait);
  }

  /** 기다릴 때가 된 줄을 보낸다. all: 기다림을 무시하고 모두 (연결이 돌아왔을 때 · 로그인했을 때). */
  function flush(o: { all?: boolean } = {}): Promise<void> {
    if (o.all) againAll = true;
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false; const all = againAll; againAll = false;
        if (all) holdUntil = 0;
        await pass(all);
      } while (again && !stopped);
    })().finally(() => { running = null; schedule(); });
    return running;
  }

  return {
    /** 앱을 켤 때: 남은 줄을 읽고 기다림과 상관없이 한 번씩 마저 보낸다. */
    async start(): Promise<void> { stopped = false; await load(); await flush({ all: true }); },
    /** 앱을 끌 때: 타이머를 멈추고 하던 것만 마친다 (줄은 파일에 남는다). */
    async stop(): Promise<void> { stopped = true; if (timer !== null) { clearTimer(timer); timer = null; } await running?.catch(() => undefined); await writing; },
    flush,
    /**
     * 줄에 넣고 바로 한 번 보내 본다. 실패해도 던지지 않고 줄에 남긴다 (던지는 것은 넣을 수 없는 줄일 때뿐).
     * 세 번째 인자: 번호표 문자열, 또는 { id, owner, orderKey }.
     */
    async enqueue(kind: BaeOutboxKind, payload: unknown, opt?: string | { id?: string; owner?: string | null; orderKey?: string | null }): Promise<{ id: string; status: BaeEnqueueStatus }> {
      const o = typeof opt === 'string' ? { id: opt } : opt ?? {};
      const id = o.id ?? randomUUID();
      if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('보낼 줄의 번호표가 올바르지 않아요.');
      if (typeof kind !== 'string' || !KIND_RE.test(kind) || !opts.handlers[kind]) throw new Error('알 수 없는 보내기 종류예요.');
      let forbidden: Array<string | null | undefined> = [];
      try { forbidden = opts.forbiddenValues?.() ?? []; } catch { forbidden = []; }
      const problem = baeOutboxPayloadProblem(payload, forbidden);
      if (problem) throw new Error(problem);
      const owner = o.owner !== undefined ? o.owner : ownerNow();
      if (opts.ownerNow && !owner) throw new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.');
      await load();
      if (queue.some((e) => e.id === id) || recentSent.has(id) || deadIds.has(id)) return { id, status: 'duplicate' };
      const t = now();
      const entry: BaeOutboxEntry = {
        id, kind, payload: JSON.parse(JSON.stringify(payload)), tries: 0, nextAt: t, createdAt: t, owner: owner ?? null,
        orderKey: o.orderKey !== undefined ? o.orderKey : orderKeyOf(kind, payload), lastError: null,
      };
      queue.push(entry);
      await persistQuiet();
      await flush();
      if (queue.includes(entry)) return { id, status: 'queued' };
      return { id, status: deadIds.has(id) ? 'dead' : 'sent' };
    },
    /** 남은 줄 (내용은 빼고). '못 보낸 것 N개' 표시용. */
    pending(): Array<Omit<BaeOutboxEntry, 'payload'>> {
      return queue.map(({ payload: _payload, ...rest }) => ({ ...rest }));
    },
  };
}
export type BaeOutbox = ReturnType<typeof createBaeOutbox>;
