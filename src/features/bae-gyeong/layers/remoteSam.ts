/**
 * 레이어 엔진의 sam 어댑터 (계획 14 3-4): SAM 2.1 은 모델 일꾼 프로세스(onnxruntime-node, DirectML)에서 돌고, 화면 쪽 일꾼은
 * 전용 통로(MessagePort)로 묻는다. 말의 모양은 src/shared/bae/modelProtocol.ts (sam.setImage · sam.run).
 * 낮은 해상도 답(256×256 네 장)을 마스크로 바꾸는 계산은 엔진 sam.js 의 coef · toMask · singleOf 를 그대로 옮겼다 (0단계 samClient.js).
 *   - 함정 1 (계획 14 3-4): 엔진은 모든 그림을 'orig' 같은 같은 이름으로 부른다. 그대로 두면 다음 그림이 앞 그림의 기억을 쓴다.
 *     그래서 그림마다 이름 뒤에 픽셀의 SHA-256 앞 12자리를 붙인다 (진행 기록 0-4).
 *   - 모델 일꾼이 쉬어서 내려가면 통로가 닫힌다: usePort 로 새 통로를 받으면, 다음 그림 읽기에서 일꾼이 '그림이 없어요'(need)라고
 *     답하고 이쪽이 픽셀을 다시 보낸다. 계산 중에 기억에서 밀려난 그림(SAM_NEED_IMAGE)도 한 번 다시 보내고 이어 간다.
 */
import * as B from './engine/bm.js';
import type { BM } from './engine/bm';
import type { EngineSam } from './engine/split';

interface PortLike { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null; close?(): void }
type Reply = { id: number; ok: true; [k: string]: unknown } | { id: number; ok: false; error: string; code?: string };
interface Cur { key: string; W: number; H: number; s: number; nw: number; nh: number; rgb: Uint8Array }

function coef(sn: number, dn: number) { const sc = sn / dn, i0 = new Int32Array(dn), i1 = new Int32Array(dn), a = new Float32Array(dn); for (let d = 0; d < dn; d++) { let f = (d + 0.5) * sc - 0.5; let s = Math.floor(f); f -= s; if (s < 0) { s = 0; f = 0; } if (s >= sn - 1) { s = sn - 1; f = 0; } i0[d] = s; i1[d] = Math.min(sn - 1, s + 1); a[d] = f; } return { i0, i1, a }; }

/** 256×256 낮은 해상도 답 k 번째 → 그림 크기 마스크 (엔진 sam.js toMask 와 같은 셈). */
export function samToMask(lo: Float32Array, k: number, e: { W: number; H: number; nw: number; nh: number }): BM {
  const L = 256, off = k * L * L; const { W, H, nw, nh } = e;
  let mnx = L, mny = L, mxx = -1, mxy = -1;
  for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) if (lo[off + y * L + x] > 0) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
  if (mxx < 0) return new B.BM();
  const ax = Math.max(0, (mnx - 2) * 4), ay = Math.max(0, (mny - 2) * 4), bx = Math.min(1024, (mxx + 3) * 4), by = Math.min(1024, (mxy + 3) * 4);
  const U = coef(L, 1024); const up = new Float32Array((bx - ax) * (by - ay)); const uw = bx - ax;
  for (let y = ay; y < by; y++) { const r0 = off + U.i0[y] * L, r1 = off + U.i1[y] * L, b = U.a[y]; for (let x = ax; x < bx; x++) { const a = U.a[x]; up[(y - ay) * uw + x - ax] = (lo[r0 + U.i0[x]] * (1 - a) + lo[r0 + U.i1[x]] * a) * (1 - b) + (lo[r1 + U.i0[x]] * (1 - a) + lo[r1 + U.i1[x]] * a) * b; } }
  const X = coef(nw, W), Y = coef(nh, H); const gx0 = Math.max(0, Math.floor((ax - 1) * W / nw)), gy0 = Math.max(0, Math.floor((ay - 1) * H / nh)), gx1 = Math.min(W, Math.ceil((bx + 1) * W / nw)), gy1 = Math.min(H, Math.ceil((by + 1) * H / nh));
  const gw = gx1 - gx0, o = new Uint8Array(gw * (gy1 - gy0));
  const at = (x: number, y: number) => (x < ax || x >= bx || y < ay || y >= by) ? -1e9 : up[(y - ay) * uw + x - ax];
  for (let y = gy0; y < gy1; y++) { const y0 = Y.i0[y], y1 = Y.i1[y], b = Y.a[y]; for (let x = gx0; x < gx1; x++) { const x0 = X.i0[x], x1 = X.i1[x], a = X.a[x]; const v = (at(x0, y0) * (1 - a) + at(x1, y0) * a) * (1 - b) + (at(x0, y1) * (1 - a) + at(x1, y1) * a) * b; o[(y - gy0) * gw + x - gx0] = v > 0 ? 1 : 0; } }
  return B.fromCrop(o, [gx0, gy0, gx1, gy1]);
}
/** 한 장짜리 답 고르기 (엔진 sam.js singleOf). */
export function samSingleOf(masks: Float32Array, iou: Float32Array, e: { W: number; H: number; nw: number; nh: number }) {
  const L = 256 * 256; let pos = 0, neg = 0; for (let i = 0; i < L; i++) { const v = masks[i]; if (v > .05) pos++; if (v > -.05) neg++; }
  const stab = neg ? pos / neg : 1; let k = 0;
  if (stab < .98) { k = 1; for (let q = 2; q <= 3; q++) if (iou[q] > iou[k]) k = q; }
  return { mask: samToMask(masks, k, e), conf: iou[k], token: k };
}
/** 그림 이름에 붙일 것: 픽셀의 SHA-256 앞 12자리 (16진수). */
export async function samPixelHash(rgb: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', rgb as BufferSource); const u = new Uint8Array(d); let s = '';
  for (let i = 0; i < 6; i++) s += u[i].toString(16).padStart(2, '0');
  return s;
}

export interface RemoteSam extends EngineSam {
  readonly stats: { setImage: number; sentPictures: number; runs: number; runMs: number; bytesBack: number; setMs: number };
  /** 새 전용 통로로 바꾼다 (앞 통로는 닫는다). */
  usePort(port: PortLike): void;
  /** 모델 일꾼이 내려갔다: 기다리던 요청을 모두 실패로. */
  gone(reason: string): void;
  call(msg: Record<string, unknown>, transfer?: Transferable[]): Promise<Record<string, unknown>>;
  /** 지금 그림의 이름 (시험용) */
  readonly current: string | null;
}

export function remoteSam(port: PortLike | null, opts: { log?: (t: string) => void } = {}): RemoteSam {
  const log = opts.log ?? (() => {});
  let seq = 0; let ep = '?'; let cur: Cur | null = null; let p: PortLike | null = null;
  const pending = new Map<number, { res: (v: Record<string, unknown>) => void; rej: (e: Error) => void }>();
  const hashes = new WeakMap<Uint8Array, string>();
  const stats = { setImage: 0, sentPictures: 0, runs: 0, runMs: 0, bytesBack: 0, setMs: 0 };
  const onMessage = (ev: MessageEvent) => {
    const m = ev.data as Reply | { id: number; progress: unknown };
    if (!m || typeof m !== 'object' || typeof (m as { id?: unknown }).id !== 'number' || 'progress' in m) return;
    const q = pending.get(m.id); if (!q) return; pending.delete(m.id);
    if ((m as Reply).ok === false) { const r = m as { error: string; code?: string }; q.rej(Object.assign(new Error(r.error || 'SAM 오류'), { code: r.code })); }
    else q.res(m as Record<string, unknown>);
  };
  function usePort(np: PortLike) {
    if (p && p !== np) { try { p.onmessage = null; p.close?.(); } catch { /* 이미 닫힘 */ } failAll('모델 일꾼과의 통로가 바뀌었어요. 다시 해 주세요.'); }
    p = np; p.onmessage = onMessage;
  }
  function failAll(reason: string) { for (const [, q] of pending) q.rej(new Error(reason)); pending.clear(); }
  if (port) usePort(port);
  const call = (msg: Record<string, unknown>, tr?: Transferable[]) => new Promise<Record<string, unknown>>((res, rej) => {
    if (!p) { rej(new Error('모델 일꾼과 통로가 없어요. 다시 해 주세요.')); return; }
    const id = ++seq; pending.set(id, { res, rej });
    try { p.postMessage(Object.assign({}, msg, { id }), tr || []); } catch (e) { pending.delete(id); rej(e instanceof Error ? e : new Error(String(e))); }
  });
  async function send(c: Cur, force: boolean) {
    let r = force ? { need: true } as Record<string, unknown> : await call({ type: 'sam.setImage', key: c.key, W: c.W, H: c.H });
    if (r.need) { stats.sentPictures++; r = await call({ type: 'sam.setImage', key: c.key, W: c.W, H: c.H, rgb: c.rgb }); }
    if (typeof r.ep === 'string') ep = r.ep;
    c.s = Number(r.s); c.nw = Number(r.nw); c.nh = Number(r.nh);
    if (!(c.nw > 0 && c.nh > 0)) throw new Error('SAM 그림 읽기 답이 올바르지 않아요.');
  }
  async function run(o: { box?: number[]; points?: number[][]; labels?: number[] }) {
    if (!cur) throw new Error('SAM: 그림을 먼저 읽어야 해요.');
    const t0 = performance.now(); const c = cur;
    const msg = { type: 'sam.run', key: c.key, box: o.box || null, points: o.points || [], labels: o.labels || [] };
    let r: Record<string, unknown>;
    try { r = await call(msg); }
    catch (e) {
      if ((e as { code?: string }).code !== 'SAM_NEED_IMAGE') throw e;
      log('SAM: 일꾼의 기억에서 그림이 빠져서 다시 보냄 ' + c.key);
      await send(c, true); r = await call(msg);
    }
    const masks = r.masks as Float32Array, iou = r.iou as Float32Array;
    stats.runs++; stats.runMs += performance.now() - t0; stats.bytesBack += masks.byteLength;
    return { masks, iou, e: c };
  }
  return {
    stats,
    get ep() { return ep; },
    get current() { return cur ? cur.key : null; },
    usePort,
    gone(reason: string) { failAll(reason || '모델 일꾼이 내려갔어요. 다시 해 주세요.'); },
    call,
    async setImage(key: string, rgb: Uint8Array, W: number, H: number) {
      stats.setImage++; const t0 = performance.now();
      let h = hashes.get(rgb); if (!h) { h = await samPixelHash(rgb); hashes.set(rgb, h); }
      const c: Cur = { key: key + '@' + h, W, H, s: 0, nw: 0, nh: 0, rgb };
      await send(c, false);
      cur = c; stats.setMs += performance.now() - t0;
    },
    async predict({ box, points, labels, multimask = true }) {
      const { masks, iou, e } = await run({ box, points, labels });
      if (multimask) return [1, 2, 3].map((k) => ({ mask: samToMask(masks, k, e), conf: iou[k] }));
      return [samSingleOf(masks, iou, e)];
    },
    async predictAll({ box, points, labels }) {
      const { masks, iou, e } = await run({ box, points, labels });
      return { multi: [1, 2, 3].map((k) => ({ mask: samToMask(masks, k, e), conf: iou[k] })), single: samSingleOf(masks, iou, e) };
    },
    async dispose() { cur = null; },
  };
}
