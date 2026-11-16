/**
 * BAE경 4K로 키우기의 화면 쪽 공통 (HTML v0.3.5 script_4.js 2160~2180줄, BAEUP.toCanvas).
 *   그림 읽기: Blob → 이미지 → 캔버스 → RGBA (HTML loadImg + makeCanvas + getImageData)
 *   마무리: 2배 그림 → 목표 크기 (예: 4096×2304 → 3840×2160) 를 브라우저의 가장 좋은 다시 뽑기로 → PNG
 */
import type { BaeEnlarged } from '@/shared/bae/upscaleTiles';

export interface BaeUpscaleOutcome {
  blob: Blob;
  w: number;
  h: number;
  /** 모델 계산이 돈 곳 */
  ep: 'webgpu' | 'wasm' | 'dml' | 'cpu';
  /** 그림 읽기부터 PNG 까지 */
  ms: number;
  tiles: number;
  /** 그래픽카드에서 실패해 CPU 로 이어 갔나 */
  fellBack: boolean;
}
export interface BaeUpscaleOptions {
  /** 저장 크기 (HTML upTarget). 없으면 2배 그대로. src/shared/bae/upscaleTiles.ts 의 baeUpscaleTarget 으로 정한다. */
  target?: [number, number];
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('이미지를 열 수 없어요')); im.src = src; });
}
function makeCanvas(w: number, h: number): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/** HTML: loadImg(curUrl) → 같은 크기 캔버스에 그리고 → getImageData */
export async function baeReadPixels(src: Blob | string): Promise<ImageData> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = await loadImg(url);
    const c = makeCanvas(img.naturalWidth, img.naturalHeight), x = c.getContext('2d') as CanvasRenderingContext2D;
    x.drawImage(img, 0, 0);
    return x.getImageData(0, 0, c.width, c.height);
  } finally { if (typeof src !== 'string') URL.revokeObjectURL(url); }
}

// the 2x picture -> the final size (e.g. 4096x2304 -> 3840x2160) with the browser's best resampling
export function baeToCanvas(big: BaeEnlarged, tw?: number, th?: number): HTMLCanvasElement {
  const c2 = makeCanvas(big.w, big.h); (c2.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(big.rgba as Uint8ClampedArray<ArrayBuffer>, big.w, big.h), 0, 0);
  if (!tw || (tw === big.w && th === big.h)) return c2;
  const c = makeCanvas(tw, th as number); const x = c.getContext('2d') as CanvasRenderingContext2D; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(c2, 0, 0, tw, th as number);
  return c;
}

export function baeCanvasPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('그림을 만들지 못했어요'))), 'image/png'));
}

export function baeTicket(): string { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
