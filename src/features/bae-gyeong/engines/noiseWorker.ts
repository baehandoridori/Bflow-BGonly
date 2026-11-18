/**
 * BAE경 노이즈 제거 웹 워커 (HTML NOISE_WORKER_SRC 의 메시지 약속 그대로). 계산은 noiseEngine.ts.
 *   { id, data, w, h } → 단계마다 { id, step } … 끝에 { id, ok: true, data, w, h, info } (data 는 넘겨줌)
 *   실패 → { id, ok: false, error }
 */
import { denoise, type DenoiseInfo } from './noiseEngine';

export interface NoiseJob { id: number; data: Uint8ClampedArray; w: number; h: number }
export type NoiseReply =
  | { id: number; step: string }
  | { id: number; ok: true; data: Uint8ClampedArray; w: number; h: number; info: DenoiseInfo }
  | { id: number; ok: false; error: string };

interface WorkerScope { onmessage: ((e: MessageEvent) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void }
const scope = self as unknown as WorkerScope;

scope.onmessage = (e: MessageEvent) => {
  const m = e.data as NoiseJob;
  try {
    const r = denoise(m.data, m.w, m.h, (step) => scope.postMessage({ id: m.id, step } satisfies NoiseReply));
    scope.postMessage({ id: m.id, ok: true, data: r.data, w: m.w, h: m.h, info: r.info } satisfies NoiseReply, [r.data.buffer]);
  } catch (err) { scope.postMessage({ id: m.id, ok: false, error: String((err && (err as Error).message) || err) } satisfies NoiseReply); }
};
