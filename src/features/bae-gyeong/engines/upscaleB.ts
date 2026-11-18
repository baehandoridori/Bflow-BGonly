/**
 * BAE경 4K로 키우기 — B '원본 그대로' (waifu2x swin_unet art, 화면 쪽 onnxruntime-web WebGPU, 안 되면 WASM).
 * HTML v0.3.5 의 '키워서 저장' 흐름 (script_4.js 2160~2180줄): 그림 읽기 → 2배 (타일) → 목표 크기로 → PNG.
 *   모델 파일은 메인이 보관함에서 확인값까지 보고 준다 (baeModelAPI.files('up-b')). 처음 한 번만 받고 일꾼이 세션을 들고 있다.
 *   일꾼은 5분 쉬면 내려서 그래픽카드 메모리를 돌려준다 (다음에 다시 띄움).
 *
 *   const out = await baeUpscaleB(blob, (d, n) => …, { target: baeUpscaleTarget(rec.ratio, rec.w, rec.h) });
 *   → { blob (PNG), w, h, ep: 'webgpu' | 'wasm', ms, tiles }
 */
import { cleanIpcErrorMessage } from '@/utils/ipcErrorMessage';
import { baeModelGateway, type BaeModelGateway } from '../modelApi';
import { baeCanvasPng, baeReadPixels, baeToCanvas, type BaeUpscaleOptions, type BaeUpscaleOutcome } from './upscaleCommon';
import type { UpBJob, UpBReply } from './upscaleBWorker';

export type { BaeUpscaleOptions, BaeUpscaleOutcome } from './upscaleCommon';
export { baeUpscaleTarget, BAE_UPSCALE_HINT } from '@/shared/bae/upscaleTiles';

const IDLE_MS = 5 * 60 * 1000;
type Ok = Extract<UpBReply, { ok: true }>;
let worker: Worker | null = null; let ready: Promise<'webgpu' | 'wasm'> | null = null; let seq = 0; let idle: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<number, { res: (r: Ok) => void; rej: (e: Error) => void; step?: (d: number, n: number) => void }>();

function drop(reason: string) {
  const w = worker; worker = null; ready = null;
  for (const p of pending.values()) p.rej(new Error(reason)); pending.clear();
  try { w?.terminate(); } catch { /* ignore */ }
}
function getWorker(): Worker {
  if (worker) return worker;
  // Vite 가 './upscaleBWorker.ts' 를 따로 묶는다 (개발: 모듈 워커, 빌드: assets/upscaleBWorker-*.js + 계산 엔진 wasm).
  const w = new Worker(new URL('./upscaleBWorker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent) => {
    const d = e.data as UpBReply; const p = pending.get(d.id); if (!p) return;
    if ('progress' in d) { p.step?.(d.progress.done, d.progress.total); return; }
    pending.delete(d.id); if (d.ok) p.res(d); else p.rej(new Error(d.error));
  };
  w.onerror = (e: ErrorEvent) => { if (worker === w) drop(e.message || '4K 엔진이 멈췄어요'); };
  worker = w; return w;
}
function call(msg: Omit<UpBJob, 'id'>, transfer: Transferable[] = [], step?: (d: number, n: number) => void): Promise<Ok> {
  return new Promise<Ok>((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej, step });
    try { getWorker().postMessage(Object.assign({ id }, msg), transfer); } catch (e) { pending.delete(id); rej(e instanceof Error ? e : new Error(String(e))); }
  });
}
function touch() { if (idle) clearTimeout(idle); idle = setTimeout(() => { if (pending.size === 0) drop('쉬어서 내림'); }, IDLE_MS); }

async function ensureSession(gateway: BaeModelGateway, forceWasm: boolean): Promise<'webgpu' | 'wasm'> {
  if (!ready) {
    ready = (async () => {
      let files: Record<string, Uint8Array>;
      try { ({ files } = await gateway.files('up-b')); } catch (e) { throw new Error(cleanIpcErrorMessage(e, '4K 모델을 준비하지 못했어요.')); }
      const graph = files['up-b/model.onnx'], w = files['up-b/w.bin'];
      if (!graph || !w) throw new Error('4K 모델 파일이 모자라요.');
      const r = await call({ type: 'init', graph, w, forceWasm } as Omit<UpBJob, 'id'>);
      return r.ep ?? 'wasm';
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

/** 화면의 WebGPU (HTML BAEUP.gpuInfo) — 이 PC 점검에 넣는다. */
export async function baeWebGpuInfo(): Promise<{ ok: boolean; f16?: boolean; name?: string; why?: string }> {
  try { const r = await call({ type: 'gpu' } as Omit<UpBJob, 'id'>); touch(); const g = r.gpu; return { ok: !!g?.webgpu, f16: g?.f16, name: g?.name, why: g?.why }; }
  catch (e) { return { ok: false, why: String((e as Error)?.message || e) }; }
}

/** 4K 원본 그대로: 그림(Blob) → 키운 PNG. onProgress(타일, 전체). opts.forceWasm 은 시험용 (그래픽카드를 끈 것처럼). */
export async function baeUpscaleB(src: Blob, onProgress?: (done: number, total: number) => void, opts: BaeUpscaleOptions & { forceWasm?: boolean; gateway?: BaeModelGateway } = {}): Promise<BaeUpscaleOutcome> {
  const t0 = performance.now();
  const gateway = opts.gateway ?? baeModelGateway();
  try {
    await ensureSession(gateway, !!opts.forceWasm);
    const img = await baeReadPixels(src);
    const data = img.data;
    const r = await call({ type: 'run', data, w: img.width, h: img.height } as Omit<UpBJob, 'id'>, [data.buffer as ArrayBuffer], onProgress);
    const [tw, th] = opts.target ?? [r.w as number, r.h as number];
    const out = baeToCanvas({ w: r.w as number, h: r.h as number, rgba: r.rgba as Uint8ClampedArray }, tw, th);
    const blob = await baeCanvasPng(out);
    return { blob, w: out.width, h: out.height, ep: r.ep ?? 'wasm', ms: Math.round(performance.now() - t0), tiles: r.tiles ?? 0, fellBack: !!r.fellBack };
  } finally { touch(); }
}

/** 일꾼을 바로 내린다 (시험 · 화면을 떠날 때). */
export function baeUpscaleBRelease(): void { drop('내림'); }
