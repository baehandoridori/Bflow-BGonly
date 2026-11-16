/**
 * 레이어 엔진의 codec 어댑터 (계획 14 3-4 '그대로'): 화면 쪽 일꾼의 OffscreenCanvas. 엔진 adapters/browser.js 의 browserCodec 을
 * 계산 그대로 옮겼다 — PD 에게 보내는 JPEG 글자까지 HTML 과 같아야 같은 답이 온다. 결과 미리보기 작은 그림도 여기서 만든다.
 */
import type { EngineCodec } from './engine/split';
import { tightLayer } from './engine/psd.js';
import { resizeArea } from './engine/img.js';

const b64 = (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as unknown as number[]); return btoa(s); };

export const browserCodec: EngineCodec = {
  async encodePng(rgba, w, h) {
    const c = new OffscreenCanvas(w, h); c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  },
  async decodePng(bytes) {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); const w = bmp.width, h = bmp.height;
    const c = new OffscreenCanvas(w, h); const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(bmp, 0, 0); const d = x.getImageData(0, 0, w, h).data; bmp.close?.();
    const rgb = new Uint8Array(w * h * 3); for (let i = 0; i < w * h; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; } return { w, h, rgb };
  },
  async toDataUrl(rgb, w, h, jpeg) {
    const rgba = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
    const c = new OffscreenCanvas(w, h); c.getContext('2d')!.putImageData(new ImageData(rgba, w, h), 0, 0);
    const blob = await c.convertToBlob(jpeg ? { type: 'image/jpeg', quality: 0.92 } : { type: 'image/png' }); return 'data:' + blob.type + ';base64,' + b64(new Uint8Array(await blob.arrayBuffer()));
  },
};

/** 결과 미리보기 (엔진 worker/entry.js 의 thumb · rgbaThumb 그대로). */
export interface LayersThumbs {
  picture(rgb: Uint8Array, w: number, h: number, tw?: number): Promise<string>;
  layer(it: { box: number[]; rgba: Uint8Array }, max?: number): Promise<string>;
}
export const browserThumbs: LayersThumbs = {
  async picture(rgb, w, h, tw = 480) { const th = Math.max(1, Math.round(h * tw / w)); return browserCodec.toDataUrl(resizeArea(rgb, w, h, tw, th, 3), tw, th, true); },
  async layer(it, max = 120) {
    const t = tightLayer({ box: it.box, rgba: it.rgba }); if (!t) return '';
    const s = Math.min(1, max / Math.max(t.w, t.h)), tw = Math.max(1, Math.round(t.w * s)), th = Math.max(1, Math.round(t.h * s));
    const c = new OffscreenCanvas(t.w, t.h); c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(t.data.buffer as ArrayBuffer, t.data.byteOffset, t.w * t.h * 4), t.w, t.h), 0, 0);
    const c2 = new OffscreenCanvas(tw, th); const x = c2.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, tw, th);
    const blob = await c2.convertToBlob({ type: 'image/png' });
    return 'data:image/png;base64,' + b64(new Uint8Array(await blob.arrayBuffer()));
  },
};
