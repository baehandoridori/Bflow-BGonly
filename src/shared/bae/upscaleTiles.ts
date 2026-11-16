/**
 * BAE경 4K로 키우기의 타일 계산 (HTML v0.3.5 script_4.js BAEUP.enlarge2x 를 글자 그대로 옮김, 2050~2140줄).
 * 모델 일꾼(4K A, onnxruntime-node)과 화면 쪽 일꾼(4K B, onnxruntime-web)이 같이 쓴다. 모델을 부르는 일(run)만 바꿔 끼운다.
 *   그림을 겹치는 타일로 자르고, 타일마다 키운 뒤, 겹친 곳을 서서히 섞어 이음매가 보이지 않게 한다.
 *   A 는 4배로 나온 것을 2×2 평균으로 2배로, B 는 모델이 2배로 내고 테두리(8px)도 잘라서 준다.
 * 마지막 크기 맞추기(예: 4096×2304 → 3840×2160)는 화면의 캔버스가 한다 (HTML toCanvas, imageSmoothingQuality 'high').
 * electron · 브라우저 · onnxruntime 을 import 하지 않는다.
 */
import { RATIOS, type RatioId } from './order/constants';

export type BaeUpscaleKey = 'A' | 'B';
export interface BaeUpscaleSpec { model: 'av3' | 'swin'; scale: 2 | 4; padIn: number; tile: number }

/** HTML BAEUP.SPECS 그대로 */
export const BAE_UPSCALE_SPECS: Record<BaeUpscaleKey, BaeUpscaleSpec> = {
  A: { model: 'av3', scale: 4, padIn: 16, tile: 512 },     // the model gives 4x; 16 px of context on each side is thrown away
  B: { model: 'swin', scale: 2, padIn: 8, tile: 400 },     // the model gives 2x and already cuts 8 px of context; tile = 16 + 48k
};

/** HTML UP_HINT 그대로 */
export const BAE_UPSCALE_HINT: Record<BaeUpscaleKey, string> = { A: '선이 가장 또렷해져요. 가장 빨라요.', B: '붓 질감까지 원본 그대로예요. A보다 2배쯤 걸려요.' };

export interface BaeRgbaImage { width: number; height: number; data: Uint8ClampedArray | Uint8Array }
export interface BaeTileOutput { data: ArrayLike<number>; dims: readonly number[] }
/** 타일 하나 (1×3×tile×tile, 0~1) 를 모델에 넣고 나온 것 (1×3×oh×ow). */
export type BaeTileRunner = (input: Float32Array, tile: number) => Promise<BaeTileOutput>;
export interface BaeEnlarged { w: number; h: number; rgba: Uint8ClampedArray }

/** 몇 번 모델을 부르나 (진행 막대용, enlarge2x 의 타일 수와 같다). */
export function baeUpscaleTileCount(key: BaeUpscaleKey, width: number, height: number, tileOverride?: number): number {
  const spec = BAE_UPSCALE_SPECS[key], tile = tileOverride || spec.tile;
  const core = tile - 2 * spec.padIn, blend = 8, step = core - blend;
  const pos = (n: number) => { const p: number[] = []; for (let x = 0; ; x += step) { if (x + core >= n) { p.push(Math.max(0, n - core)); break; } p.push(x); } return [...new Set(p)]; };
  return pos(width).length * pos(height).length;
}

// enlarge an ImageData by 2 (A: 4x then averaged 2x2) -> {w, h, rgba}
export async function baeEnlarge2x(run: BaeTileRunner, key: BaeUpscaleKey, img: BaeRgbaImage, onTile?: (done: number, total: number) => void, tileOverride?: number, yieldEvery = true): Promise<BaeEnlarged> {
  const spec = BAE_UPSCALE_SPECS[key], scale = spec.scale, padIn = spec.padIn, tile = tileOverride || spec.tile;
  const W = img.width, H = img.height, src = img.data;
  const core = tile - 2 * padIn, blend = 8, step = core - blend;
  const pos = (n: number) => { const p: number[] = []; for (let x = 0; ; x += step) { if (x + core >= n) { p.push(Math.max(0, n - core)); break; } p.push(x); } return [...new Set(p)]; };
  const xs = pos(W), ys = pos(H), W2 = W * 2, H2 = H * 2, cw = Math.min(core, W), ch = Math.min(core, H);
  const acc = new Float32Array(W2 * H2 * 3), wsum = new Float32Array(W2 * H2);
  const inp = new Float32Array(3 * tile * tile), plane = tile * tile;
  const total = xs.length * ys.length; let done = 0;
  for (const ty of ys) for (const tx of xs) {
    for (let v = 0; v < tile; v++) {
      const sy = Math.min(H - 1, Math.max(0, ty - padIn + v));
      for (let u = 0; u < tile; u++) {
        const sx = Math.min(W - 1, Math.max(0, tx - padIn + u)), si = (sy * W + sx) * 4, di = v * tile + u;
        inp[di] = src[si] / 255; inp[plane + di] = src[si + 1] / 255; inp[2 * plane + di] = src[si + 2] / 255;
      }
    }
    const y = await run(inp, tile);
    const yd = y.data, ow = y.dims[3], op = y.dims[2] * ow;
    // where the tile's own pixels start inside the model output, and how many 2x pixels we keep
    const kx = cw * 2, ky = ch * 2, f = scale / 2, off = scale === 4 ? padIn * 4 : 0;
    const hasL = tx > 0, hasR = tx + core < W, hasT = ty > 0, hasB = ty + core < H, ramp = blend * 2;
    for (let yy = 0; yy < ky; yy++) {
      let wy = 1; if (hasT) wy = Math.min(wy, (yy + .5) / ramp); if (hasB) wy = Math.min(wy, (ky - yy - .5) / ramp);
      const gy = ty * 2 + yy; if (gy >= H2) continue;
      for (let xx = 0; xx < kx; xx++) {
        let wx = 1; if (hasL) wx = Math.min(wx, (xx + .5) / ramp); if (hasR) wx = Math.min(wx, (kx - xx - .5) / ramp);
        const gx = tx * 2 + xx; if (gx >= W2) continue;
        const wgt = Math.max(1e-4, Math.min(wx, wy));
        let r, g, b;
        if (f === 1) { const i = (yy) * ow + xx; r = yd[i]; g = yd[op + i]; b = yd[2 * op + i]; }
        else {         // 4x -> 2x: average 2x2
          const i0 = (off + yy * 2) * ow + off + xx * 2, i1 = i0 + ow;
          r = (yd[i0] + yd[i0 + 1] + yd[i1] + yd[i1 + 1]) * .25; g = (yd[op + i0] + yd[op + i0 + 1] + yd[op + i1] + yd[op + i1 + 1]) * .25;
          b = (yd[2 * op + i0] + yd[2 * op + i0 + 1] + yd[2 * op + i1] + yd[2 * op + i1 + 1]) * .25;
        }
        const gi = gy * W2 + gx; acc[gi * 3] += r * wgt; acc[gi * 3 + 1] += g * wgt; acc[gi * 3 + 2] += b * wgt; wsum[gi] += wgt;
      }
    }
    done++; if (onTile) onTile(done, total);
    if (yieldEvery) await new Promise((r) => setTimeout(r, 0));
  }
  // Uint8ClampedArray: 반올림 · 0~255 자르기가 HTML 과 같다 (Uint8Array 로 받으면 버림이 되어 1씩 달라진다).
  const rgba = new Uint8ClampedArray(W2 * H2 * 4);
  for (let i = 0, n = W2 * H2; i < n; i++) { const w = wsum[i] || 1; rgba[i * 4] = acc[i * 3] / w * 255; rgba[i * 4 + 1] = acc[i * 3 + 1] / w * 255; rgba[i * 4 + 2] = acc[i * 3 + 2] / w * 255; rgba[i * 4 + 3] = 255; }
  return { w: W2, h: H2, rgba };
}

/** HTML halfToF32Bytes: 16비트 무게를 32비트로 (보관함의 w.bin 은 이미 푼 것 — 시험 · 확인용). */
export function baeHalfToF32Bytes(u8: Uint8Array): Uint8Array {
  const h16 = new Uint16Array(u8.buffer, u8.byteOffset, u8.byteLength >> 1);
  const out = new Uint32Array(h16.length);
  for (let i = 0; i < h16.length; i++) {
    const h = h16[i], s = (h & 0x8000) << 16; let e = (h >> 10) & 0x1f, m = h & 0x3ff;
    if (e === 0) {
      if (m === 0) { out[i] = s; continue; }
      e = 1; while (!(m & 0x400)) { m <<= 1; e--; } m &= 0x3ff; out[i] = (s | ((e + 112) << 23) | (m << 13)) >>> 0; continue;
    }
    if (e === 31) { out[i] = (s | 0x7f800000 | (m << 13)) >>> 0; continue; }
    out[i] = (s | ((e + 112) << 23) | (m << 13)) >>> 0;
  }
  return new Uint8Array(out.buffer);
}

/** HTML upTarget: 비율의 FHD 크기 × 2 (16:9 → 3840×2160). FHD 가 없는 비율은 그림 크기 × 2. */
export function baeUpscaleTarget(ratio: string | null | undefined, w: number, h: number): [number, number] {
  const r = ratio && Object.prototype.hasOwnProperty.call(RATIOS, ratio) ? RATIOS[ratio as RatioId] : null;
  const base = r && r.fhd ? r.fhd : [w, h];
  return [base[0] * 2, base[1] * 2];
}

/** 키울 수 있는 그림인가 (HTML 은 결과 그림만 받았다 — 여기서는 너무 크거나 빈 그림을 막는다). */
export function baeUpscaleInputProblem(w: unknown, h: unknown, bytes?: number): string | null {
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || (w as number) < 16 || (h as number) < 16) return '그림 크기가 올바르지 않아요.';
  if ((w as number) * (h as number) > 4096 * 4096) return '4K로 키우기에는 그림이 너무 커요 (최대 4096×4096).';
  if (bytes !== undefined && bytes !== (w as number) * (h as number) * 4) return '그림 데이터의 크기가 맞지 않아요.';
  return null;
}
