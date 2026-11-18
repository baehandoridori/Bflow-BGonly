/**
 * BAE경 '다른 각도로'의 깊이 재기: Depth Anything V2 Small (Apache-2.0, onnx-community 판 4472b736, 99,060,839바이트).
 * HTML v0.4.11 ANGD.run 과 같은 입력(그림 전체를 518 × 518 로 부드럽게 줄여 ImageNet 평균 · 표준편차로)을 만들어,
 * 모델 일꾼 프로세스(onnxruntime-node, 그래픽카드 DirectML → 안 되면 CPU)에 전용 통로로 보낸다 (계획 14 3-2).
 * 모델 파일은 메인의 보관함이 확인값까지 보고 준비한다 (처음 한 번 약 99MB: 창고 → 인터넷). HTML 은 브라우저(IndexedDB)에 두고 WebGPU 로 돌렸다.
 * 답: disparity (가까울수록 큼), dw × dh — 엔진의 ANG.build 가 받는 모양 그대로.
 */
import { baeModelGateway, baeModelPort, type BaeModelGateway } from '../modelApi';
import type { BaeModelProgress } from '@/shared/bae/models';
import { makeCanvas } from '../make/inputs';

export interface AngleDepth { disp: Float32Array; dw: number; dh: number; ep: string; ms: number }
export type AngleDepthFn = (img: CanvasImageSource, hooks?: { onProgress?(got: number, total: number): void; onStage?(ep: string): void; signal?: AbortSignal }) => Promise<AngleDepth>;

export const ANGLE_DEPTH_N = 518;
const M = [0.485, 0.456, 0.406], SD = [0.229, 0.224, 0.225];

/** HTML ANGD.run 의 입력 만들기 그대로 (1 × 3 × 518 × 518, 평면 순서). */
export function angleDepthInput(img: CanvasImageSource): Float32Array {
  const N = ANGLE_DEPTH_N;
  const c = makeCanvas(N, N), x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data, p = N * N, inp = new Float32Array(3 * p);
  for (let i = 0; i < p; i++) for (let ch = 0; ch < 3; ch++) inp[ch * p + i] = (d[i * 4 + ch] / 255 - M[ch]) / SD[ch];
  return inp;
}

/** 모델 일꾼에게 한 번 묻기 (전용 통로 하나를 열고, 답이 오면 닫는다). */
function ask(port: MessagePort, msg: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const done = (err: Error | null, v?: Record<string, unknown>) => { port.removeEventListener('message', onMsg); signal?.removeEventListener('abort', onAbort); if (err) reject(err); else resolve(v!); };
    const onMsg = (e: MessageEvent) => {
      const m = e.data as { id?: unknown; ok?: unknown; error?: unknown } | null;
      if (!m || m.id !== id || typeof m.ok !== 'boolean') return;
      if (m.ok) done(null, m as Record<string, unknown>); else done(new Error(String(m.error || '깊이를 재지 못했어요')));
    };
    const onAbort = () => done(new DOMException('그만뒀어요.', 'AbortError'));
    if (signal?.aborted) { onAbort(); return; }
    port.addEventListener('message', onMsg); signal?.addEventListener('abort', onAbort, { once: true }); port.start();
    port.postMessage({ ...msg, id });
  });
}

/**
 * 이 PC 의 모델 일꾼으로 깊이를 잰다. onProgress = 모델을 처음 받는 중 (바이트), onStage = 계산을 시작할 때 ('dml' | 'cpu').
 * 같은 그림을 다시 재지 않는 것은 부르는 쪽(창)이 기억한다 (HTML AG.depth).
 */
export function createWorkerDepth(gateway: () => BaeModelGateway = baeModelGateway): AngleDepthFn {
  return async (img, hooks = {}) => {
    const gw = gateway();
    const off = gw.onProgress((p: BaeModelProgress) => { if (p.id === 'depth' && (p.phase === 'copy' || p.phase === 'download') && hooks.onProgress) hooks.onProgress(p.doneBytes, p.totalBytes); });
    try { await gw.ensure('depth'); } finally { off(); }
    const input = angleDepthInput(img);
    await new Promise((r) => setTimeout(r, 30));
    const port = await baeModelPort(gw);
    try {
      hooks.onStage?.('worker');
      const t0 = performance.now();
      const r = await ask(port, { type: 'depth.run', input, dims: [1, 3, ANGLE_DEPTH_N, ANGLE_DEPTH_N] }, hooks.signal);
      const dm = (r.dims as number[]) || [];
      const disp = r.data instanceof Float32Array ? r.data : Float32Array.from(r.data as ArrayLike<number>);
      return { disp, dw: dm[dm.length - 1], dh: dm[dm.length - 2], ep: String(r.ep || ''), ms: Math.round(typeof r.ms === 'number' ? r.ms : performance.now() - t0) };
    } finally { try { port.close(); } catch { /* ignore */ } }
  };
}

/** 깊이 모델이 이 PC 에 이미 있는지 (창의 '처음 한 번 약 99MB' 안내를 고르려고). 모르면 false. */
export async function angleDepthReady(gateway: () => BaeModelGateway = baeModelGateway): Promise<boolean> {
  try { const s = await gateway().status(); return !!s.models.find((m) => m.id === 'depth')?.ready; } catch { return false; }
}
