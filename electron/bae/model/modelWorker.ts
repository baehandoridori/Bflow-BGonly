/**
 * BAE경 모델 일꾼 프로세스 (Electron utilityProcess, 계획 14 3-3 · 진행 기록 0단계의 s0_model.cjs 를 옮김).
 * onnxruntime-node 1.29.0 으로 모델을 돌린다: 그래픽카드(DirectML) 먼저, 안 되면 CPU 로 이어서 끝까지 (계획 14 9-4).
 *   - 말은 두 길로 받는다: 메인이 직접(parentPort) / 화면 쪽 일꾼이 전용 통로(MessagePort). 말의 모양은 src/shared/bae/modelProtocol.ts.
 *   - 기록은 파일로만 (%LOCALAPPDATA%\Bflow-BGonly\bae\logs\model.log). 창 없는 Electron 이 콘솔에 쓰면 EPIPE 오류 창이 뜬다.
 *   - 모델 일은 한 번에 하나씩 (DirectML 세션은 같은 세션을 동시에 돌리지 않는다).
 *   - 모델 파일은 메인의 보관함이 확인값까지 본 뒤에 부른다. 여기서는 자리와 크기만 다시 본다.
 * 환경 변수 (메인 modelHost 가 넣는다):
 *   BAE_MODEL_ROOT 보관함 · BAE_MODEL_LOG 기록 파일 · BAE_MODEL_EP 'dml'|'cpu' (cpu = 그래픽카드를 쓰지 않음)
 *   BAE_MODEL_FAKE_NO_GPU 'session'|'run' (시험: 그래픽카드를 끈 것처럼 — 세션을 못 만들거나, 첫 계산이 실패) · BAE_MODEL_TEST '1'
 */
import fs from 'node:fs';
import path from 'node:path';
import type * as OrtNs from 'onnxruntime-node';
import { BAE_MODELS, type BaeModelId } from '../../../src/shared/bae/models';
import { baeEnlarge2x, baeUpscaleInputProblem } from '../../../src/shared/bae/upscaleTiles';
import type { BaeWorkerEp, BaeWorkerRequest } from '../../../src/shared/bae/modelProtocol';

type Ort = typeof OrtNs;
type Session = OrtNs.InferenceSession;
interface PortLike { on(ev: 'message', fn: (e: { data: unknown; ports?: PortLike[] }) => void): void; postMessage(m: unknown): void; start?(): void; on(ev: 'close', fn: () => void): void }
interface ParentPortLike { on(ev: 'message', fn: (e: { data: unknown; ports: PortLike[] }) => void): void; postMessage(m: unknown): void }

const env = process.env;
const ROOT = env.BAE_MODEL_ROOT || '';
const LOG = env.BAE_MODEL_LOG || '';
const PREFER: BaeWorkerEp = env.BAE_MODEL_EP === 'cpu' ? 'cpu' : 'dml';
const FAKE_NO_GPU = env.BAE_MODEL_FAKE_NO_GPU === 'session' || env.BAE_MODEL_FAKE_NO_GPU === 'run' ? env.BAE_MODEL_FAKE_NO_GPU : null;
const TEST = env.BAE_MODEL_TEST === '1';
const PROBE_MODEL_B64 = 'CAdCBAoAEA06MwoMCgFYEgFZIgRSZWx1EgFwWg8KAVgSCgoICAESBAoCCARiDwoBWRIKCggIARIECgIIBA=='; // Relu, X:float[4] → Y (opset 13)

/* ---------- 기록 (파일로만) ---------- */
try { process.stdout?.on?.('error', () => {}); process.stderr?.on?.('error', () => {}); } catch { /* ignore */ }
if (LOG) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    if ((fs.statSync(LOG, { throwIfNoEntry: false })?.size ?? 0) > 2 * 1024 * 1024) fs.renameSync(LOG, LOG + '.1');
  } catch { /* 기록 자리를 못 만들어도 계산은 한다 */ }
}
function log(...a: unknown[]): void {
  if (!LOG) return;
  const line = `[${new Date().toISOString()}] [model ${process.pid}] ${a.map((x) => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  try { fs.appendFileSync(LOG, line); } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => { log('uncaught', e); });
process.on('unhandledRejection', (e) => { log('unhandled', e); });

let ortMod: Ort | null = null;
async function getOrt(): Promise<Ort> {
  if (ortMod) return ortMod;
  try {
    const m = (await import('onnxruntime-node')) as unknown as Ort & { default?: Ort };
    ortMod = (m.default && (m.default as Ort).InferenceSession ? m.default : m) as Ort;
    return ortMod;
  } catch (e) { log('onnxruntime-node 를 불러오지 못함', e); throw Object.assign(new Error('계산 엔진을 불러오지 못했어요. 앱을 다시 설치해 주세요.'), { code: 'ENGINE' }); }
}

function modelFile(id: BaeModelId, rel: string): string {
  const f = BAE_MODELS[id].files.find((x) => x.path === rel);
  if (!f || !ROOT) throw Object.assign(new Error('모델 자리가 정해지지 않았어요.'), { code: 'MODEL_MISSING' });
  const file = path.join(ROOT, ...rel.split('/'));
  const st = fs.statSync(file, { throwIfNoEntry: false });
  if (!st || st.size !== f.size) throw Object.assign(new Error(`${BAE_MODELS[id].label}이(가) 아직 이 PC 에 없어요. 먼저 받아 주세요.`), { code: 'MODEL_MISSING' });
  return file;
}
function ensureAllFiles(id: BaeModelId): void { for (const f of BAE_MODELS[id].files) modelFile(id, f.path); }

/* ---------- 세션: DirectML 먼저, 안 되면 CPU ---------- */
interface Made { s: Session; ep: BaeWorkerEp; ms: number }
async function makeSession(file: string | Uint8Array, prefer: BaeWorkerEp, name: string): Promise<Made> {
  const o = await getOrt(); let lastErr: unknown = null;
  for (const ep of (prefer === 'cpu' ? ['cpu'] : ['dml', 'cpu']) as BaeWorkerEp[]) {
    try {
      if (ep === 'dml' && FAKE_NO_GPU === 'session') throw new Error('시험: 그래픽카드를 끈 것처럼 (DirectML 세션을 만들지 않음)');
      const t0 = Date.now();
      const s = typeof file === 'string'
        ? await o.InferenceSession.create(file, { executionProviders: [ep], graphOptimizationLevel: 'all' })
        : await o.InferenceSession.create(file, { executionProviders: [ep], graphOptimizationLevel: 'all' });
      const ms = Date.now() - t0; log('session', name, 'on', ep, ms, 'ms'); return { s, ep, ms };
    } catch (e) { lastErr = e; log('session', name, ep, 'failed', String((e as Error)?.message || e).slice(0, 300)); }
  }
  throw lastErr;
}

/** 모델 하나에 세션 하나 (내릴 때까지 둔다). DirectML 에서 계산이 실패하면 CPU 세션으로 바꿔 이어 간다. */
const sessions = new Map<string, Made>();
const dmlBroken = new Set<string>();
async function session(key: string, file: string | Uint8Array): Promise<Made> {
  const have = sessions.get(key); if (have) return have;
  const m = await makeSession(file, dmlBroken.has(key) ? 'cpu' : PREFER, key); sessions.set(key, m); return m;
}
async function runOn<T>(key: string, file: string | Uint8Array, run: (m: Made, first: boolean) => Promise<T>): Promise<{ r: T; m: Made; fellBack: boolean }> {
  const m = await session(key, file);
  try {
    if (m.ep === 'dml' && FAKE_NO_GPU === 'run') throw new Error('시험: 그래픽카드를 끈 것처럼 (첫 계산 실패)');
    return { r: await run(m, true), m, fellBack: false };
  } catch (e) {
    if (m.ep !== 'dml') throw e;
    log('run', key, 'failed on dml, going on with cpu:', String((e as Error)?.message || e).slice(0, 300));
    dmlBroken.add(key); sessions.delete(key); try { await m.s.release(); } catch { /* ignore */ }
    const c = await session(key, file);
    return { r: await run(c, false), m: c, fellBack: true };
  }
}
async function releaseAll(): Promise<void> {
  for (const [k, m] of sessions) { try { await m.s.release(); } catch { /* ignore */ } sessions.delete(k); }
  SAM.cache.clear();
}

function toF32(t: OrtNs.Tensor): Float32Array {
  const data = t.data as unknown;
  if (t.type === 'float16') {
    const h = data as Uint16Array; const out = new Float32Array(h.length);
    for (let i = 0; i < h.length; i++) { const v = h[i], sg = v & 0x8000 ? -1 : 1, ex = (v >>> 10) & 31, m = v & 1023; out[i] = ex === 0 ? sg * m * 2 ** -24 : ex === 31 ? (m ? NaN : sg * Infinity) : sg * (1 + m / 1024) * 2 ** (ex - 15); }
    return out;
  }
  return Float32Array.from(data as ArrayLike<number>);
}
function f32ToF16(f: Float32Array): Uint16Array {
  const bb = new Float32Array(1), u = new Uint32Array(bb.buffer); const out = new Uint16Array(f.length);
  for (let i = 0; i < f.length; i++) { bb[0] = f[i]; const v = u[0], sg = (v >>> 16) & 0x8000; const e = ((v >>> 23) & 0xff) - 127 + 15; const m = v & 0x7fffff; if (e <= 0) out[i] = sg; else if (e >= 31) out[i] = sg | 0x7c00; else out[i] = sg | (e << 10) | (m >>> 13); }
  return out;
}

/* ---------- 4K 선명하게 (HTML BAEUP, 모델 upm_av3) ---------- */
async function upscaleA(m: Extract<BaeWorkerRequest, { type: 'up.a' }>, progress: (done: number, total: number) => void) {
  const problem = baeUpscaleInputProblem(m.W, m.H, m.rgba?.byteLength); if (problem) throw new Error(problem);
  ensureAllFiles('up-a');
  const o = await getOrt(); const file = modelFile('up-a', 'up-a/model.onnx');
  const t0 = Date.now(); let ep: BaeWorkerEp = 'dml'; let sessionMs = 0; let fellBack = false; let tiles = 0;
  const img = { width: m.W, height: m.H, data: m.rgba };
  const big = await baeEnlarge2x(async (inp, tile) => {
    const { r, m: made, fellBack: fb } = await runOn('up-a', file, (x) => x.s.run({ x: new o.Tensor('float32', inp, [1, 3, tile, tile]) }));
    ep = made.ep; sessionMs = made.ms; fellBack = fellBack || fb;
    const y = (r.y || r[Object.keys(r)[0]]) as OrtNs.Tensor;
    return { data: y.data as Float32Array, dims: y.dims };
  }, 'A', img, (done, total) => { tiles = total; progress(done, total); });
  const ms = Date.now() - t0;
  log('up.a', `${m.W}x${m.H} → ${big.w}x${big.h}`, 'on', ep, ms, 'ms', fellBack ? '(fell back to cpu)' : '');
  return { w: big.w, h: big.h, rgba: big.rgba, ep, ms, sessionMs, tiles, fellBack };
}

/* ---------- SAM 2.1 (엔진 sam.js 의 세션 반쪽, s0_model.cjs 그대로) ---------- */
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
function coef(sn: number, dn: number) { const sc = sn / dn, i0 = new Int32Array(dn), i1 = new Int32Array(dn), a = new Float32Array(dn); for (let d = 0; d < dn; d++) { let f = (d + 0.5) * sc - 0.5; let s = Math.floor(f); f -= s; if (s < 0) { s = 0; f = 0; } if (s >= sn - 1) { s = sn - 1; f = 0; } i0[d] = s; i1[d] = Math.min(sn - 1, s + 1); a[d] = f; } return { i0, i1, a }; }
interface SamPic { key: string; W: number; H: number; s: number; nw: number; nh: number; emb: OrtNs.Tensor[] }
const SAM = { cache: new Map<string, SamPic>() };
async function samSetImage(m: Extract<BaeWorkerRequest, { type: 'sam.setImage' }>) {
  ensureAllFiles('sam');
  const c = SAM.cache.get(m.key); if (c) { SAM.cache.delete(m.key); SAM.cache.set(m.key, c); return { W: c.W, H: c.H, s: c.s, nw: c.nw, nh: c.nh, cached: true }; }
  if (!m.rgb) return { need: true };
  const W = m.W, H = m.H, rgb = m.rgb;
  if (!Number.isSafeInteger(W) || !Number.isSafeInteger(H) || W < 1 || H < 1 || rgb.length !== W * H * 3) throw new Error('SAM 그림 크기가 맞지 않아요.');
  const o = await getOrt(); const s = 1024 / Math.max(W, H), nw = Math.round(W * s), nh = Math.round(H * s);
  const X = coef(W, nw), Y = coef(H, nh); const px = new Float32Array(3 * 1024 * 1024); const plane = 1024 * 1024;
  for (let ch = 0; ch < 3; ch++) { const v = (114 / 255 - MEAN[ch]) / STD[ch]; px.fill(v, ch * plane, (ch + 1) * plane); }
  for (let y = 0; y < nh; y++) { const r0 = Y.i0[y] * W, r1 = Y.i1[y] * W, b = Y.a[y];
    for (let x = 0; x < nw; x++) { const a = X.a[x]; const p00 = (r0 + X.i0[x]) * 3, p01 = (r0 + X.i1[x]) * 3, p10 = (r1 + X.i0[x]) * 3, p11 = (r1 + X.i1[x]) * 3;
      for (let ch = 0; ch < 3; ch++) { const v = Math.round((rgb[p00 + ch] * (1 - a) + rgb[p01 + ch] * a) * (1 - b) + (rgb[p10 + ch] * (1 - a) + rgb[p11 + ch] * a) * b); px[ch * plane + y * 1024 + x] = (v / 255 - MEAN[ch]) / STD[ch]; } } }
  const t0 = Date.now();
  const { r: out, m: made } = await runOn('sam-enc', modelFile('sam', 'sam/vision_encoder_fp16.onnx'), (x) => x.s.run({ pixel_values: new o.Tensor('float32', px, [1, 3, 1024, 1024]) }));
  const e: SamPic = { key: m.key, W, H, s, nw, nh, emb: [out['image_embeddings.0'], out['image_embeddings.1'], out['image_embeddings.2']] as OrtNs.Tensor[] };
  log('SAM picture', m.key, 'read in', Date.now() - t0, 'ms on', made.ep);
  if (SAM.cache.size >= 3) { const k0 = SAM.cache.keys().next().value; if (k0 !== undefined) SAM.cache.delete(k0); }
  SAM.cache.set(m.key, e);
  return { W, H, s, nw, nh, ep: made.ep, enc_ms: Date.now() - t0 };
}
async function samRun(m: Extract<BaeWorkerRequest, { type: 'sam.run' }>) {
  const o = await getOrt(); const e = SAM.cache.get(m.key); if (!e) throw Object.assign(new Error('SAM: 그림을 먼저 읽어야 해요: ' + m.key), { code: 'SAM_NEED_IMAGE' });
  const s = e.s; const P = m.points && m.points.length ? m.points : [], Lb = m.labels && m.labels.length ? m.labels : [], box = m.box;
  const feeds = {
    input_points: new o.Tensor('float32', Float32Array.from(P.flatMap((p) => [p[0] * s, p[1] * s])), [1, 1, P.length, 2]),
    input_labels: new o.Tensor('int64', BigInt64Array.from(Lb.map((v) => BigInt(v))), [1, 1, Lb.length]),
    input_boxes: new o.Tensor('float32', Float32Array.from(box ? box.map((v) => v * s) : []), [1, box ? 1 : 0, 4]),
    'image_embeddings.0': e.emb[0], 'image_embeddings.1': e.emb[1], 'image_embeddings.2': e.emb[2],
  };
  const { r: out, m: made } = await runOn('sam-dec', modelFile('sam', 'sam/sam2_decoder_all.onnx'), (x) => x.s.run(feeds));
  return { masks: Float32Array.from((out.all_masks as OrtNs.Tensor).data as Float32Array), iou: Float32Array.from((out.all_iou as OrtNs.Tensor).data as Float32Array), ep: made.ep };
}

/* ---------- 깊이 · BiRefNet: 모델 하나, 첫 출력 ---------- */
async function depthRun(m: Extract<BaeWorkerRequest, { type: 'depth.run' }>) {
  const o = await getOrt(); const file = modelFile('depth', 'depth/depth-anything-v2-small_model.onnx');
  const t0 = Date.now();
  const { r, m: made, fellBack } = await runOn('depth', file, (x) => x.s.run({ [x.s.inputNames[0]]: new o.Tensor('float32', new Float32Array(m.input), m.dims) }));
  const y = r[Object.keys(r)[0]] as OrtNs.Tensor;
  return { data: toF32(y), dims: y.dims, ep: made.ep, ms: Date.now() - t0, fellBack };
}
const birHalf = { v: false };
async function birRun(m: Extract<BaeWorkerRequest, { type: 'bir.run' }>) {
  const o = await getOrt(); const file = modelFile('birefnet', 'birefnet/birefnet_full_fp16.onnx');
  const x32 = new Float32Array(m.input);
  if (x32.length !== 3 * 1024 * 1024) throw new Error('BiRefNet 입력 크기가 맞지 않아요.');
  const feed = (s: Session, half: boolean) => ({ [s.inputNames[0]]: half ? new o.Tensor('float16', f32ToF16(x32), [1, 3, 1024, 1024]) : new o.Tensor('float32', x32, [1, 3, 1024, 1024]) });
  const t0 = Date.now();
  const { r, m: made, fellBack } = await runOn('birefnet', file, async (x) => {
    try { return await x.s.run(feed(x.s, birHalf.v)); }
    catch (e) { if (birHalf.v || !/type|float16|tensor\(float16\)/i.test(String(e))) throw e; birHalf.v = true; return x.s.run(feed(x.s, true)); }
  });
  const y = r[Object.keys(r)[0]] as OrtNs.Tensor;
  return { data: toF32(y), dims: y.dims, half: birHalf.v, ep: made.ep, ms: Date.now() - t0, fellBack };
}

/* ---------- 점검: 아주 작은 모델을 그래픽카드 · CPU 로 ---------- */
async function probe() {
  const bytes = Uint8Array.from(Buffer.from(PROBE_MODEL_B64, 'base64'));
  const one = async (ep: BaeWorkerEp) => {
    const t0 = Date.now();
    try {
      if (ep === 'dml' && (FAKE_NO_GPU || PREFER === 'cpu')) throw new Error(FAKE_NO_GPU ? '시험: 그래픽카드를 끈 것처럼' : '그래픽카드를 쓰지 않게 설정됨');
      const o = await getOrt();
      const s = await o.InferenceSession.create(bytes, { executionProviders: [ep] });
      try {
        const r = await s.run({ X: new o.Tensor('float32', Float32Array.from([-1, 2, -3, 4]), [4]) });
        const y = Array.from((r.Y as OrtNs.Tensor).data as Float32Array);
        if (y.join(',') !== '0,2,0,4') throw new Error('계산 결과가 틀려요: ' + y.join(','));
      } finally { await s.release(); }
      return { ok: true, ms: Date.now() - t0 };
    } catch (e) { return { ok: false, ms: Date.now() - t0, error: String((e as Error)?.message || e).slice(0, 300) }; }
  };
  const dml = await one('dml'); const cpu = await one('cpu');
  log('probe', JSON.stringify({ dml, cpu }));
  return { dml, cpu };
}

/* ---------- 말 받기 ---------- */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> { const p = chain.then(fn, fn); chain = p.catch(() => undefined); return p; }

async function handle(m: BaeWorkerRequest, progress: (done: number, total: number) => void): Promise<Record<string, unknown>> {
  switch (m.type) {
    case 'hello': return { pid: process.pid, node: process.versions.node, electron: process.versions.electron ?? '', ep: PREFER, fakeNoGpu: FAKE_NO_GPU };
    case 'mem': return { mem: process.memoryUsage(), sessions: [...sessions.keys()] };
    case 'probe': return serial(probe);
    case 'release': return serial(async () => { await releaseAll(); (globalThis as { gc?: () => void }).gc?.(); return { mem: process.memoryUsage() }; });
    case 'up.a': return serial(() => upscaleA(m, progress));
    case 'sam.setImage': return serial(() => samSetImage(m));
    case 'sam.run': return serial(() => samRun(m));
    case 'sam.dispose': return serial(async () => { SAM.cache.clear(); for (const k of ['sam-enc', 'sam-dec']) { const x = sessions.get(k); sessions.delete(k); try { await x?.s.release(); } catch { /* ignore */ } } return {}; });
    case 'depth.run': return serial(() => depthRun(m));
    case 'bir.run': return serial(() => birRun(m));
    case 'crash': if (TEST) { log('crash (test)'); setTimeout(() => process.exit(3), 10); return {}; } throw new Error('시험 전용 요청이에요.');
    default: throw new Error('알 수 없는 요청: ' + String((m as { type?: unknown }).type));
  }
}

async function reply(send: (o: unknown) => void, raw: unknown): Promise<void> {
  const m = raw as BaeWorkerRequest;
  if (!m || typeof m !== 'object' || typeof m.id !== 'number' || typeof m.type !== 'string') return;
  try {
    const r = await handle(m, (done, total) => { try { send({ id: m.id, progress: { done, total } }); } catch { /* 통로가 닫힘 */ } });
    send(Object.assign({}, r, { id: m.id, ok: true }));
  } catch (e) {
    log('error', m.type, e);
    try { send({ id: m.id, ok: false, error: String((e as Error)?.message || e).slice(0, 500), code: (e as { code?: string })?.code }); } catch { /* 통로가 닫힘 */ }
  }
}

const parent = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (parent) {
  let lastNotice = 0;
  parent.on('message', (ev) => {
    const d = ev.data as { type?: unknown } | null;
    if (d && d.type === 'port' && ev.ports && ev.ports[0]) {
      const port = ev.ports[0];
      port.on('message', (pe) => {
        const now = Date.now(); if (now - lastNotice > 5000) { lastNotice = now; parent.postMessage({ type: 'activity' }); }
        void reply((o) => port.postMessage(o), pe.data);
      });
      port.on('close', () => log('renderer port closed'));
      port.start?.(); log('renderer port connected');
      return;
    }
    void reply((o) => parent.postMessage(o), ev.data);
  });
  log('model worker up', JSON.stringify({ node: process.versions.node, electron: process.versions.electron, ep: PREFER, fakeNoGpu: FAKE_NO_GPU, root: ROOT }));
  parent.postMessage({ type: 'ready', pid: process.pid });
}
