/**
 * BAE경 4K '원본 그대로'(B) 화면 쪽 일꾼 (Web Worker). HTML v0.3.5 BAEUP 를 옮김: onnxruntime-web 1.29.0,
 * 그래픽카드(WebGPU)가 되면 그것으로, 아니면 WASM(CPU)으로 (HTML 과 같은 갈림). 모델 일꾼(DirectML)에서는 B 가 틀린 그림을 내서
 * 화면 쪽에 남겼다 (진행 기록 0-2). HTML 은 화면 스레드에서 돌렸지만, Bflow 는 화면 하나에 모든 기능이 있어 WASM 으로 몇 분 돌 때
 * 화면이 멈추지 않게 일꾼으로 옮겼다 — 타일 계산(src/shared/bae/upscaleTiles.ts)과 모델 · 설정은 HTML 그대로.
 * 계산 엔진은 npm 의 onnxruntime-web 을 앱에 묶어 쓴다 (HTML 처럼 cdn 에서 받지 않음).
 *   { type:'init', id, graph, w }  → { id, ok, ep }            (graph = up-b/model.onnx, w = up-b/w.bin 32비트 무게)
 *   { type:'run', id, data, w, h } → 타일마다 { id, progress } … { id, ok, w, h, rgba, ms, tiles }  (data · rgba 는 넘겨줌)
 */
import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { baeEnlarge2x } from '@/shared/bae/upscaleTiles';

export type UpBJob =
  | { type: 'init'; id: number; graph: Uint8Array; w: Uint8Array; forceWasm?: boolean }
  | { type: 'run'; id: number; data: Uint8ClampedArray; w: number; h: number }
  | { type: 'gpu'; id: number };
export type UpBReply =
  | { id: number; progress: { done: number; total: number } }
  | { id: number; ok: true; ep?: 'webgpu' | 'wasm'; w?: number; h?: number; rgba?: Uint8ClampedArray; ms?: number; tiles?: number; fellBack?: boolean; gpu?: { webgpu: boolean; f16?: boolean; name?: string; why?: string } }
  | { id: number; ok: false; error: string };

interface WorkerScope { onmessage: ((e: MessageEvent) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void }
const scope = self as unknown as WorkerScope;
type GpuNav = { gpu?: { requestAdapter(o?: { powerPreference?: string }): Promise<{ info?: { vendor?: string; architecture?: string; description?: string }; features: { has(f: string): boolean } } | null> } };

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

let sess: ort.InferenceSession | null = null; let sessEp: 'webgpu' | 'wasm' = 'wasm';
let model: { graph: Uint8Array; w: Uint8Array } | null = null;

// HTML BAEUP.gpuInfo
async function gpuInfo(): Promise<{ webgpu: boolean; f16?: boolean; name?: string; why?: string }> {
  const nav = navigator as unknown as GpuNav;
  if (!nav.gpu) return { webgpu: false, why: 'no WebGPU' };
  try {
    const a = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) return { webgpu: false, why: 'no adapter' };
    const info = a.info || {};
    // HTML 처럼 어댑터가 있으면 WebGPU 로 간다 (소프트웨어 어댑터인지는 점검에 적기만 한다)
    const soft = /swiftshader|software|llvmpipe|basic render/i.test([info.vendor, info.architecture, info.description].join(' '));
    return { webgpu: true, f16: a.features.has('shader-f16'), name: [info.vendor, info.description || info.architecture].filter(Boolean).join(' '), why: soft ? 'software adapter' : undefined };
  } catch (e) { return { webgpu: false, why: String((e as Error)?.message || e) }; }
}

async function open(ep: 'webgpu' | 'wasm'): Promise<'webgpu' | 'wasm'> {
  if (sess) { try { await sess.release(); } catch { /* ignore */ } sess = null; }
  if (!model) throw new Error('4K 모델이 없어요.');
  sess = await ort.InferenceSession.create(model.graph, { executionProviders: [ep], externalData: [{ path: 'w.bin', data: model.w }], graphOptimizationLevel: 'all' });
  sessEp = ep; return ep;
}
async function init(m: Extract<UpBJob, { type: 'init' }>): Promise<'webgpu' | 'wasm'> {
  model = { graph: m.graph, w: m.w };
  const g = m.forceWasm ? { webgpu: false } : await gpuInfo();
  if (!g.webgpu) return open('wasm');
  // 그래픽카드 세션을 만들지 못하면 CPU(WASM)로 이어 간다 (계획 14 9-4)
  try { return await open('webgpu'); } catch { return open('wasm'); }
}
function enlarge(s: ort.InferenceSession, m: Extract<UpBJob, { type: 'run' }>, onTile: (done: number, total: number) => void) {
  return baeEnlarge2x(async (inp, tile) => {
    const res = await s.run({ x: new ort.Tensor('float32', inp, [1, 3, tile, tile]) });
    const y = res.y || res[Object.keys(res)[0]];
    return { data: y.data as Float32Array, dims: y.dims };
  }, 'B', { width: m.w, height: m.h, data: m.data }, onTile);
}

scope.onmessage = async (e: MessageEvent) => {
  const m = e.data as UpBJob;
  try {
    if (m.type === 'gpu') { scope.postMessage({ id: m.id, ok: true, gpu: await gpuInfo() } satisfies UpBReply); return; }
    if (m.type === 'init') { const ep = await init(m); scope.postMessage({ id: m.id, ok: true, ep } satisfies UpBReply); return; }
    if (!sess) throw new Error('4K 엔진이 준비되지 않았어요.');
    const t0 = performance.now(); let tiles = 0; let fellBack = false;
    const tick = (done: number, total: number) => { tiles = total; scope.postMessage({ id: m.id, progress: { done, total } } satisfies UpBReply); };
    let big;
    try { big = await enlarge(sess, m, tick); }
    catch (err) {
      if (sessEp !== 'webgpu') throw err;
      // 그래픽카드에서 계산이 실패하면 CPU(WASM)로 처음부터 한 번 더
      await open('wasm'); fellBack = true; big = await enlarge(sess!, m, tick);
    }
    scope.postMessage({ id: m.id, ok: true, ep: sessEp, w: big.w, h: big.h, rgba: big.rgba, ms: Math.round(performance.now() - t0), tiles, fellBack } satisfies UpBReply, [big.rgba.buffer]);
  } catch (err) { scope.postMessage({ id: m.id, ok: false, error: String((err && (err as Error).message) || err) } satisfies UpBReply); }
};
