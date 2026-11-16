/**
 * BAE경 색 엔진 웹 워커 (HTML COLOR_WORKER_SRC 의 메시지 약속 그대로). 계산은 colorEngine.ts.
 *   { id, type: 'palette', data, w, h, opts } → { id, ok: true, colors }
 *   { id, type: 'lock', ref: { data, w, h }, img: { data, w, h }, opts } → { id, ok: true, data, w, h, info } (data 는 넘겨줌)
 *   실패 → { id, ok: false, error }
 */
import { lockRgba, palette, type LockInfo, type LockOpts, type PaletteColor, type PaletteOpts, type RgbaImage } from './colorEngine';

export type ColorJob =
  | { id: number; type: 'palette'; data: Uint8ClampedArray; w: number; h: number; opts?: PaletteOpts }
  | { id: number; type: 'lock'; ref: RgbaImage; img: RgbaImage; opts?: LockOpts };
export type ColorReply =
  | { id: number; ok: true; colors: PaletteColor[] }
  | { id: number; ok: true; data: Uint8ClampedArray; w: number; h: number; info: LockInfo }
  | { id: number; ok: false; error: string };

interface WorkerScope { onmessage: ((e: MessageEvent) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void }
const scope = self as unknown as WorkerScope;

scope.onmessage = (e: MessageEvent) => {
  const m = e.data as ColorJob;
  try {
    if (m.type === 'palette') { scope.postMessage({ id: m.id, ok: true, colors: palette(m.data, m.w, m.h, m.opts || {}) } satisfies ColorReply); return; }
    if (m.type === 'lock') {
      const r = lockRgba(m.ref, m.img, m.opts || {});
      scope.postMessage({ id: m.id, ok: true, data: r.data, w: r.w, h: r.h, info: r.info } satisfies ColorReply, [r.data.buffer]); return;
    }
    scope.postMessage({ id: (m as { id: number }).id, ok: false, error: 'unknown job ' + (m as { type: string }).type } satisfies ColorReply);
  } catch (err) { scope.postMessage({ id: m.id, ok: false, error: String((err && (err as Error).message) || err) } satisfies ColorReply); }
};
