/**
 * BAE경 메인 → OpenAI 통신. HTML v0.4.11 의 api(1500) · callPD(1716) · readStream(1743) · callImage(1760) 의 네트워크 부분.
 * - 키는 인자로만 받아 Authorization 머리글에만 싣는다. 어디에도 두지 않는다. 오류 글은 모두 maskSecrets 를 거친다.
 * - 요청 몸(주문서) · 필드(그림)는 다른 모듈이 만든다. 여기는 보내고, 읽고, 오류를 HTML 문장으로 바꾼다.
 * - 돈이 나갈 수 있는 다시 보내기는 HTML 그대로만 (400 일 때만: 개발자 메시지 · stream · image[] 바꿔 보내기). 503 은 다시 보내지 않는다.
 * - HTML 에 없던 것: 스트림 멈춤(데이터가 한동안 안 오면 끊기)과 첫 응답 기다림의 끝.
 * electron 을 import 하지 않는다 (node 시험이 그대로 읽는다). fetch 는 주입할 수 있다.
 */
import { maskSecrets } from '../../src/shared/bae/secrets';

/** HTML NET_ERR 의 첫 줄 (둘째 줄의 '브라우저가 막는 경우'는 메인에는 맞지 않아 뺐다). */
export const BAE_NET_ERR = 'OpenAI에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.';
export const BAE_STALL_ERR = '응답이 한동안 오지 않아서 멈췄어요. 다시 시도해 주세요.';
export const BAE_DROP_ERR = '응답을 받는 중에 연결이 끊겼어요. 다시 시도해 주세요.';
export const BAE_EMPTY_IMAGE_ERR = '그림 응답이 비어 있어요. 다시 시도해 주세요.';
export const BAE_EMPTY_ORDER_ERR = '주문서 응답이 비어 있어요. 다시 시도해 주세요.';
export const BAE_NO_KEY_ERR = 'OpenAI 키가 없어요. 관리자에게 키를 넣어 달라고 요청해 주세요.';
export const BAE_BAD_BASE_ERR = 'API 주소는 https:// 로 시작하는 주소예요.';

/** 응답 몸이 이만큼 조용하면 끊는다. */
export const BAE_PD_IDLE_MS = 90_000;
export const BAE_IMAGE_IDLE_MS = 150_000;
/** 첫 응답(머리글)을 기다리는 끝. 스트림이 아닌 요청은 다 만든 뒤에야 머리글이 오므로 넉넉히. */
export const BAE_FIRST_BYTE_MS = 300_000;

export type BaeOpenAiErrorCode = 'BAE_HTTP' | 'BAE_NET' | 'BAE_DROP' | 'BAE_STALL' | 'BAE_STREAM' | 'BAE_EMPTY' | 'BAE_INPUT';

/** 화면에 그대로 보여도 되는 오류 (키 · 머리글 · 응답 몸 전체가 없다). */
export class BaeOpenAiError extends Error {
  readonly code: BaeOpenAiErrorCode;
  /** HTTP 상태 (HTTP 오류일 때만). HTML 의 err.status. */
  readonly status: number | null;
  /** OpenAI 오류 JSON 의 message (가림). HTML 의 err.raw. */
  readonly raw: string;
  /** 응답 머리글 x-request-id (머리글이 온 뒤의 오류일 때). */
  readonly requestId: string | null;
  constructor(code: BaeOpenAiErrorCode, message: string, extra: { status?: number | null; raw?: string; requestId?: string | null } = {}) {
    super(maskSecrets(message));
    this.name = 'BaeOpenAiError';
    this.code = code;
    this.status = extra.status ?? null;
    this.raw = maskSecrets(extra.raw ?? '');
    this.requestId = extra.requestId ?? null;
  }
}

/** HTML explainError 그대로. */
export function explainOpenAiError(status: number, msg: unknown): string {
  const m = String(msg || ''); let hint = '';
  if (status === 401) hint = 'API 키가 맞지 않아요. 설정에서 키를 다시 확인해 주세요.';
  else if (status === 403 && /verif/i.test(m)) hint = '이 모델은 조직 인증(Organization Verification)이 필요해요. API 관리자에게 요청해 주세요.';
  else if (status === 403) hint = '이 키로는 이 모델을 쓸 권한이 없어요. 관리자에게 모델 권한을 확인해 주세요.';
  else if (status === 404) hint = '모델 이름을 찾을 수 없어요. 설정의 모델 이름을 확인해 주세요.';
  else if (status === 429) hint = '사용 한도에 걸렸거나 요청이 너무 많아요. 잠시 후 다시 하거나 예산 한도를 확인해 주세요.';
  else if (status === 400 && /safety|moderation|policy|rejected/i.test(m)) hint = '안전 필터에 걸렸어요. 설명이나 이미지를 조금 바꿔서 다시 해보세요.';
  else if (status === 400 && /size/i.test(m)) hint = '이 크기를 모델이 받지 않았어요. 크기를 한 단계 낮춰서 다시 해보세요.';
  else if (status >= 500) hint = 'OpenAI 쪽 문제예요. 잠시 후 다시 해보세요.';
  return (hint ? hint + '\n' : '') + '(' + status + ') ' + m;
}

/** HTML outputText 그대로: 주문서 답의 글. 거절 · 빈 답은 HTML 문장으로 던진다. */
export function responseOutputText(r: unknown): string {
  const o = r as { output_text?: unknown; output?: unknown } | null;
  if (o && typeof o.output_text === 'string' && o.output_text) return o.output_text;
  for (const item of (Array.isArray(o?.output) ? o!.output : []) as Array<{ type?: string; content?: unknown }>) {
    if (item && item.type === 'message' && Array.isArray(item.content)) for (const c of item.content as Array<{ type?: string; text?: unknown; refusal?: unknown }>) {
      if (c && c.type === 'output_text' && typeof c.text === 'string' && c.text) return c.text;
      if (c && c.type === 'refusal') throw new BaeOpenAiError('BAE_EMPTY', 'PD가 이 요청을 거절했어요: ' + String(c.refusal ?? ''));
    }
  }
  throw new BaeOpenAiError('BAE_EMPTY', BAE_EMPTY_ORDER_ERR);
}

export type BaeFetch = (url: string, init: RequestInit) => Promise<Response>;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** 키를 보낼 곳: https, 아니면 이 PC 안(시험용 가짜 서버)만. 주소 안의 사용자 이름 · 비밀번호는 받지 않는다. */
export function baeEndpoint(apiBase: unknown, path: string): string {
  let u: URL;
  try { u = new URL(String(apiBase ?? '').trim().replace(/\/+$/, '') + path); } catch { throw new BaeOpenAiError('BAE_INPUT', BAE_BAD_BASE_ERR); }
  const ok = u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname));
  if (!ok || u.username || u.password || u.search || u.hash) throw new BaeOpenAiError('BAE_INPUT', BAE_BAD_BASE_ERR);
  return u.toString();
}

function authHeader(key: unknown): string {
  // 머리글에 못 넣는 글자가 섞이면 fetch 가 키를 담은 오류 글을 만든다: 보내기 전에 막는다 (키 글자는 싣지 않는다).
  if (typeof key !== 'string' || !/^[\x21-\x7e]{8,400}$/.test(key.trim())) throw new BaeOpenAiError('BAE_INPUT', BAE_NO_KEY_ERR);
  return 'Bearer ' + key.trim();
}

function readRequestId(res: Response): string | null {
  const v = (res.headers.get('x-request-id') || '').trim();
  return v && v.length <= 100 && /^[\x21-\x7e]+$/.test(v) ? maskSecrets(v) : null;
}

const abortError = () => new DOMException('그만뒀어요.', 'AbortError');
const isAbortLike = (e: unknown) => !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';

/** 한 번의 요청: 그만두기(밖의 signal)와 멈춤 시계를 한 AbortController 로 묶는다. */
function openCall(outer: AbortSignal | undefined) {
  const ctl = new AbortController();
  let stalled = false; let timer: ReturnType<typeof setTimeout> | null = null; let onStall: (() => void) | null = null;
  const forward = () => ctl.abort();
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', forward, { once: true }); }
  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  return {
    signal: ctl.signal,
    /** 이만큼 아무것도 안 오면 끊는다 (데이터가 올 때마다 다시 건다). */
    arm(ms: number) { clear(); timer = setTimeout(() => { stalled = true; ctl.abort(); try { onStall?.(); } catch { /* 이미 닫힘 */ } }, ms); },
    onStall(fn: () => void) { onStall = fn; },
    get stalled() { return stalled; },
    get userAborted() { return !!outer?.aborted; },
    /** 끝: 시계를 멈추고, 다 못 읽은 연결이 남아 있으면 닫는다 (다 읽은 뒤에는 아무 일도 없다). */
    close() { clear(); outer?.removeEventListener('abort', forward); ctl.abort(); },
  };
}
type Call = ReturnType<typeof openCall>;

/** 잡힌 오류를 HTML 문장으로. 머리글 전이면 '연결하지 못함', 뒤면 '중간에 끊김'. */
function translate(error: unknown, call: Call, phase: 'connect' | 'body', requestId: string | null): unknown {
  if (call.stalled) return new BaeOpenAiError('BAE_STALL', BAE_STALL_ERR, { requestId });
  if (call.userAborted || isAbortLike(error)) return abortError();
  if (error instanceof BaeOpenAiError) return error;
  return phase === 'connect' ? new BaeOpenAiError('BAE_NET', BAE_NET_ERR) : new BaeOpenAiError('BAE_DROP', BAE_DROP_ERR, { requestId });
}

/** 응답 몸을 조각마다 넘긴다. 조각 사이가 idleMs 보다 길면 끊는다. limit 를 넘으면 거기까지만. */
async function pump(res: Response, call: Call, idleMs: number, onChunk: (chunk: Uint8Array) => void, limit = Infinity): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  call.onStall(() => { void reader.cancel().catch(() => undefined); });
  let total = 0;
  try {
    for (;;) {
      call.arm(idleMs);
      const { done, value } = await reader.read();
      if (call.stalled) throw new BaeOpenAiError('BAE_STALL', BAE_STALL_ERR);
      if (done) break;
      total += value.byteLength; onChunk(value);
      if (total >= limit) { void reader.cancel().catch(() => undefined); break; }
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }
}

async function readAll(res: Response, call: Call, idleMs: number, limit = Infinity): Promise<string> {
  const parts: Uint8Array[] = [];
  await pump(res, call, idleMs, (c) => parts.push(c), limit);
  return Buffer.concat(parts).toString('utf8');
}

/** HTTP 오류 몸에서 OpenAI 오류 JSON 의 message 만 (HTML: 없으면 앞 300자). 응답 몸 전체는 붙이지 않는다. */
async function httpError(res: Response, call: Call, idleMs: number, requestId: string | null): Promise<BaeOpenAiError> {
  let text = '';
  try { text = await readAll(res, call, idleMs, 256 * 1024); } catch (e) { if (call.stalled || call.userAborted) throw translate(e, call, 'body', requestId); }
  let data: { error?: { message?: unknown } } | null = null;
  try { data = JSON.parse(text); } catch { /* JSON 이 아님 */ }
  const raw = data && data.error && typeof data.error.message === 'string' && data.error.message ? data.error.message : text.slice(0, 300);
  return new BaeOpenAiError('BAE_HTTP', explainOpenAiError(res.status, maskSecrets(raw)), { status: res.status, raw, requestId });
}

/** HTML readStream 의 줄 나누기: 빈 줄(\r?\n\r?\n)로 묶음을 자른다. 이미 본 곳은 다시 훑지 않는다 (결과는 같다). */
export function createSseSplitter(onBlock: (block: string) => void) {
  let buf = ''; let from = 0;
  const sep = /\r?\n\r?\n/g;
  return {
    push(text: string) {
      buf += text;
      for (;;) {
        sep.lastIndex = Math.max(0, from - 3);
        const m = sep.exec(buf);
        if (!m) { from = buf.length; return; }
        const block = buf.slice(0, m.index); buf = buf.slice(m.index + m[0].length); from = 0;
        onBlock(block);
      }
    },
    end() { const rest = buf; buf = ''; from = 0; if (rest.trim()) onBlock(rest); },
  };
}

/** 한 묶음의 data: 줄들 (HTML 그대로). */
export function sseData(block: string): string {
  return block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
}

/** 스트림 안의 오류 사건 → HTML 처럼 explainError(400, …). 상태 번호는 없다 (HTML 도 다시 보내지 않는다). */
function streamEventError(ev: { error?: unknown }): BaeOpenAiError {
  const e = ev.error as { message?: unknown } | string | undefined;
  const m = (e && (typeof e === 'object' ? e.message || e : e)) || 'stream error';
  const raw = typeof m === 'string' ? m : JSON.stringify(m).slice(0, 300);
  return new BaeOpenAiError('BAE_STREAM', explainOpenAiError(400, raw), { raw });
}

async function readSse(res: Response, call: Call, idleMs: number, onEvent: (ev: Record<string, unknown>) => void): Promise<void> {
  const dec = new TextDecoder();
  const split = createSseSplitter((block) => {
    const data = sseData(block);
    if (!data || data === '[DONE]') return;
    let ev: unknown; try { ev = JSON.parse(data); } catch { return; }
    if (!ev || typeof ev !== 'object') return;
    const o = ev as Record<string, unknown>;
    if (o.type === 'error' || o.error) throw streamEventError(o);
    onEvent(o);
  });
  await pump(res, call, idleMs, (chunk) => split.push(dec.decode(chunk, { stream: true })));
  split.push(dec.decode());
  split.end();
}

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const isB64 = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && B64_RE.test(v);

// ---------------------------------------------------------------- 주문서 (PD)

export interface BaeResponsesOptions {
  apiBase: string;
  key: string;
  /** POST /responses 의 몸 (주문서 모듈이 만든다). stream: true 면 SSE 로 읽는다 (HTML 은 쓰지 않음). */
  body: unknown;
  /** HTML callPD: 개발자 메시지를 안 받는 모델(400 + developer/role)이면 이 몸으로 한 번 더. */
  fallbackBody?: unknown;
  signal?: AbortSignal;
  /** stream: true 일 때 사건 하나하나. */
  onEvent?: (ev: Record<string, unknown>) => void;
  idleMs?: number;
  firstByteMs?: number;
  fetch?: BaeFetch;
}
export interface BaeResponsesResult {
  /** 응답 JSON 전체 (JSON 이 아니면 null — HTML 처럼 뒤에서 '비어 있어요'). */
  json: Record<string, unknown> | null;
  /** 답의 글 (없거나 거절이면 null — 거절 문장이 필요하면 responseOutputText(json)). */
  outputText: string | null;
  usage: Record<string, unknown> | null;
  requestId: string | null;
}

export async function postResponses(opts: BaeResponsesOptions): Promise<BaeResponsesResult> {
  const url = baeEndpoint(opts.apiBase, '/responses');
  const auth = authHeader(opts.key);
  const doFetch = opts.fetch ?? fetch;
  const idleMs = opts.idleMs ?? BAE_PD_IDLE_MS;
  const firstByteMs = opts.firstByteMs ?? BAE_FIRST_BYTE_MS;

  const send = async (body: unknown): Promise<{ json: Record<string, unknown> | null; requestId: string | null }> => {
    if (opts.signal?.aborted) throw abortError();
    const stream = !!body && typeof body === 'object' && (body as { stream?: unknown }).stream === true;
    let bodyText: string;
    try { bodyText = JSON.stringify(body); } catch { throw new BaeOpenAiError('BAE_INPUT', '주문서 요청을 만들지 못했어요. 다시 시도해 주세요.'); }
    const call = openCall(opts.signal);
    let res: Response; let requestId: string | null = null;
    try {
      call.arm(firstByteMs);
      try {
        res = await doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: bodyText, signal: call.signal });
      } catch (e) { throw translate(e, call, 'connect', null); }
      requestId = readRequestId(res);
      if (!res.ok) throw await httpError(res, call, idleMs, requestId);
      if (stream && /event-stream/.test(res.headers.get('content-type') || '')) {
        let final: Record<string, unknown> | null = null;
        try {
          await readSse(res, call, idleMs, (ev) => {
            try { opts.onEvent?.(ev); } catch { /* 화면 쪽 문제로 받기를 멈추지 않는다 */ }
            if (/^response\.(completed|incomplete|failed)$/.test(String(ev.type || '')) && ev.response && typeof ev.response === 'object') final = ev.response as Record<string, unknown>;
          });
        } catch (e) { throw translate(e, call, 'body', requestId); }
        const failed = final as { status?: unknown; error?: { message?: unknown } } | null;
        if (failed && failed.status === 'failed') throw streamEventError({ error: failed.error ?? 'response failed' });
        return { json: final, requestId };
      }
      let text: string;
      try { text = await readAll(res, call, idleMs); } catch (e) { throw translate(e, call, 'body', requestId); }
      let json: Record<string, unknown> | null = null;
      try { const v = JSON.parse(text); json = v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { /* JSON 이 아님 */ }
      return { json, requestId };
    } catch (e) {
      throw translate(e, call, 'body', requestId);
    } finally { call.close(); }
  };

  let out: { json: Record<string, unknown> | null; requestId: string | null };
  try { out = await send(opts.body); } catch (e) {
    // HTML callPD: 개발자 메시지를 안 받는 모델이면 메모를 사용자 메시지 앞에 넣은 몸으로 한 번 더.
    if (!(opts.fallbackBody !== undefined && e instanceof BaeOpenAiError && e.status === 400 && /developer|role/i.test(e.message))) throw e;
    out = await send(opts.fallbackBody);
  }
  let outputText: string | null = null;
  try { outputText = out.json ? responseOutputText(out.json) : null; } catch { outputText = null; }
  const usage = out.json && out.json.usage && typeof out.json.usage === 'object' ? out.json.usage as Record<string, unknown> : null;
  return { json: out.json, outputText, usage, requestId: out.requestId };
}

// ---------------------------------------------------------------- 그림 (images/edits)

export type BaeImageFormField =
  | { name: string; value: string }
  | { name: string; file: { bytes: Uint8Array; filename: string; type: string } };

export type BaeImageFieldName = 'image[]' | 'image';

export interface BaeImageEditOptions {
  apiBase: string;
  key: string;
  /** 순서 있는 필드. 이름이 image[] · image 인 파일이 재료 그림이다 (보낼 때 imageField 이름으로 바꾼다).
   *  stream · partial_images 는 여기서 붙인다 (넣어 와도 빼고 HTML 자리에 다시 넣는다: 재료 그림 바로 앞). */
  fields: BaeImageFormField[];
  signal?: AbortSignal;
  /** 중간 그림 (b64 PNG, 몇 번째). */
  onPartial?: (b64: string, index: number | null) => void;
  /** 재료 그림 필드 이름 (HTML LS 'imageField', 기본 image[]). */
  imageField?: BaeImageFieldName;
  /** 스트림으로 받기 (HTML settings.stream && !LS 'noStream', 기본 참). */
  stream?: boolean;
  partialImages?: number;
  /** HTML 이 LS 에 적던 때: 서버가 stream 이나 image[] 를 안 받아서 바꿨을 때. 다음 요청부터 이 값을 넘긴다. */
  onFieldChange?: (prefs: { imageField: BaeImageFieldName; stream: boolean }) => void;
  idleMs?: number;
  firstByteMs?: number;
  fetch?: BaeFetch;
}
export interface BaeImageEditResult {
  b64: string;
  usage: Record<string, unknown> | null;
  requestId: string | null;
  /** 마지막으로 통한 값 (다음 요청에 넘길 것). */
  imageField: BaeImageFieldName;
  stream: boolean;
}

function checkFields(fields: unknown): BaeImageFormField[] {
  if (!Array.isArray(fields) || fields.length > 64) throw new BaeOpenAiError('BAE_INPUT', '보낼 이미지를 준비하지 못했어요. 주문서를 다시 만들어 주세요.');
  for (const f of fields as Array<Record<string, unknown>>) {
    const ok = f && typeof f.name === 'string' && /^[A-Za-z0-9_[\]]{1,40}$/.test(f.name) && (
      typeof f.value === 'string' ||
      (!!f.file && typeof f.file === 'object' && (f.file as { bytes?: unknown }).bytes instanceof Uint8Array &&
        typeof (f.file as { filename?: unknown }).filename === 'string' && typeof (f.file as { type?: unknown }).type === 'string'));
    if (!ok) throw new BaeOpenAiError('BAE_INPUT', '보낼 이미지를 준비하지 못했어요. 주문서를 다시 만들어 주세요.');
  }
  return fields as BaeImageFormField[];
}

/** HTML once() 의 FormData: model … output_format, [stream, partial_images], 재료 그림들. */
export function buildImageForm(fields: BaeImageFormField[], imageField: BaeImageFieldName, stream: boolean, partialImages = 2): FormData {
  const fd = new FormData();
  let streamPlaced = false;
  const placeStream = () => { if (!streamPlaced && stream) { fd.append('stream', 'true'); fd.append('partial_images', String(partialImages)); } streamPlaced = true; };
  for (const f of fields) {
    if ('value' in f) { if (f.name !== 'stream' && f.name !== 'partial_images') fd.append(f.name, f.value); continue; }
    const isImage = f.name === 'image[]' || f.name === 'image';
    if (isImage) placeStream();
    fd.append(isImage ? imageField : f.name, new Blob([f.file.bytes.slice()], { type: f.file.type }), f.file.filename);
  }
  placeStream();
  return fd;
}

export async function postImageEdit(opts: BaeImageEditOptions): Promise<BaeImageEditResult> {
  const url = baeEndpoint(opts.apiBase, '/images/edits');
  const auth = authHeader(opts.key);
  const fields = checkFields(opts.fields);
  const doFetch = opts.fetch ?? fetch;
  const idleMs = opts.idleMs ?? BAE_IMAGE_IDLE_MS;
  const firstByteMs = opts.firstByteMs ?? BAE_FIRST_BYTE_MS;
  const partialImages = opts.partialImages ?? 2;

  const once = async (field: BaeImageFieldName, stream: boolean): Promise<{ b64: string | null; usage: Record<string, unknown> | null; requestId: string | null }> => {
    if (opts.signal?.aborted) throw abortError();
    const call = openCall(opts.signal);
    let requestId: string | null = null;
    try {
      call.arm(firstByteMs);
      let res: Response;
      try {
        res = await doFetch(url, { method: 'POST', headers: { Authorization: auth }, body: buildImageForm(fields, field, stream, partialImages), signal: call.signal });
      } catch (e) { throw translate(e, call, 'connect', null); }
      requestId = readRequestId(res);
      if (!res.ok) throw await httpError(res, call, idleMs, requestId);
      if (stream && /event-stream/.test(res.headers.get('content-type') || '')) {
        // HTML readStream: partial_image 는 onPartial 로, completed 는 완성 그림 + usage.
        let final: string | null = null; let usage: Record<string, unknown> | null = null;
        try {
          await readSse(res, call, idleMs, (ev) => {
            const type = typeof ev.type === 'string' ? ev.type : '';
            if (/partial_image$/.test(type) && isB64(ev.b64_json) && opts.onPartial) {
              try { opts.onPartial(ev.b64_json, typeof ev.partial_image_index === 'number' ? ev.partial_image_index : null); } catch { /* 화면 쪽 문제로 받기를 멈추지 않는다 */ }
            }
            if (/completed$/.test(type) && isB64(ev.b64_json)) { final = ev.b64_json; usage = ev.usage && typeof ev.usage === 'object' ? ev.usage as Record<string, unknown> : null; }
          });
        } catch (e) { throw translate(e, call, 'body', requestId); }
        return { b64: final, usage, requestId };
      }
      let text: string;
      try { text = await readAll(res, call, idleMs); } catch (e) { throw translate(e, call, 'body', requestId); }
      let data: { data?: Array<{ b64_json?: unknown }>; usage?: unknown } | null = null;
      try { data = JSON.parse(text); } catch { /* 아래에서 비어 있음 */ }
      const b64 = data && Array.isArray(data.data) && data.data[0] && isB64(data.data[0].b64_json) ? data.data[0].b64_json : null;
      const usage = data && data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : null;
      return { b64, usage, requestId };
    } catch (e) {
      throw translate(e, call, 'body', requestId);
    } finally { call.close(); }
  };

  // HTML callImage 의 세 번: 400 일 때만 (stream 안 받음 → 끄고, image 이름 안 받음 → 한 번 바꿔서). 그 밖은 바로 던진다.
  let stream = opts.stream ?? true; let field: BaeImageFieldName = opts.imageField === 'image' ? 'image' : 'image[]';
  let flipped = false; let out: { b64: string | null; usage: Record<string, unknown> | null; requestId: string | null } | null = null;
  for (let attempt = 0; attempt < 3 && !out; attempt++) {
    try { out = await once(field, stream); } catch (e) {
      if (isAbortLike(e) || !(e instanceof BaeOpenAiError) || e.status !== 400) throw e;
      if (stream && /stream|partial/i.test(e.raw)) { stream = false; opts.onFieldChange?.({ imageField: field, stream }); continue; }
      if (!flipped && /image/i.test(e.raw)) { flipped = true; field = field === 'image[]' ? 'image' : 'image[]'; opts.onFieldChange?.({ imageField: field, stream }); continue; }
      throw e;
    }
  }
  if (!out || !out.b64) throw new BaeOpenAiError('BAE_EMPTY', BAE_EMPTY_IMAGE_ERR, { requestId: out?.requestId ?? null });
  return { b64: out.b64, usage: out.usage, requestId: out.requestId, imageField: field, stream };
}
