/**
 * BAE경 '같은 장소' 그림 엔진의 화면 쪽 입구 (HTML v0.4.11 script_4.js 891~969줄, 1079~1091줄).
 *   - 색 견본: baePalette · baeAutoSwatches (autoSwatches) · baePartColors / baePlaceColors (updatePlaceColors) · baeBaseSwatches · baeSheetSwatches
 *   - 색 맞춤: baeLockColors (lockColors + baseRefPixels)
 *   - 노이즈 제거: baeDenoise (denoiseBlob)
 *   - 그린 뒤: baeFinishPicture (finishPicture: 기울기 되돌리기 → 색 맞춤)
 * 계산은 웹 워커 두 개(colorWorker.ts · noiseWorker.ts)에서 하고, 처음 쓸 때 만든다. 입력 그림(Blob)은 바꾸지 않고 늘 새 Blob 을 돌려준다.
 */
import type { BaePlaceBase, BaePlacePart } from '@/shared/bae/place/types';
import type { DrawSizes } from '@/shared/bae/order/sizes';
import { baseSwatches, nearHex, sheetSwatches, swHex, type ColorBox, type LockInfo, type PaletteOpts } from './colorEngine';
import type { DenoiseInfo } from './noiseEngine';
import type { ColorJob, ColorReply } from './colorWorker';
import type { NoiseJob, NoiseReply } from './noiseWorker';
import { rotateBack } from './tilt';

export type { LockInfo, LockMoved, LockKept, PaletteOpts, ColorBox } from './colorEngine';
export type { DenoiseInfo } from './noiseEngine';
export { levelCanvas, levelMap, rotateBack } from './tilt';
export { hexToRgb as baeHexToRgb, rgbToHex as baeRgbToHex, nearHex as baeNearHex, swHex as baeSwHex } from './colorEngine';

/* ---------- 캔버스 도우미 (HTML 160~181줄 그대로) ---------- */
type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
function makeCanvas(w: number, h: number): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function dims(src: Drawable): [number, number] { const im = src as HTMLImageElement; return [im.naturalWidth || src.width, im.naturalHeight || src.height]; }
function fit(w: number, h: number, max: number): [number, number] { const s = Math.min(1, max / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]; }
function ctx2d(c: HTMLCanvasElement, read = false): CanvasRenderingContext2D { return (read ? c.getContext('2d', { willReadFrequently: true }) : c.getContext('2d')) as CanvasRenderingContext2D; }
function scaled(src: Drawable, max: number): HTMLCanvasElement {   // 흰 바탕에 긴 변 max (키우지 않음)
  const [w0, h0] = dims(src); const [w, h] = fit(w0, h0, max);
  const c = makeCanvas(w, h); const x = ctx2d(c); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h);
  return c;
}
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('이미지를 열 수 없어요')); im.src = src; });
}
const toBlob = (c: HTMLCanvasElement, type = 'image/png', q?: number) => new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('그림을 만들지 못했어요'))), type, q));
function pixelsOf(c: HTMLCanvasElement): ImageData { return ctx2d(c, true).getImageData(0, 0, c.width, c.height); }

/** 엔진에 넣을 수 있는 그림: Blob, 이미 그린 그림, 또는 그림 주소(data URL · blob URL) */
export type BaeImageSource = Blob | ImageBitmap | HTMLCanvasElement | HTMLImageElement | string;
async function withImage<T>(src: BaeImageSource, fn: (img: Drawable) => T): Promise<T> {
  if (typeof src === 'string') return fn(await loadImg(src));
  if (src instanceof Blob) { const u = URL.createObjectURL(src); try { return fn(await loadImg(u)); } finally { URL.revokeObjectURL(u); } }
  return fn(src);
}

/* ---------- 워커 (HTML ColorEngine · NoiseEngine): 처음 부를 때 만들고, 멈추면 걸린 일을 모두 실패로 돌린 뒤 다음에 새로 ---------- */
type Ok<R> = Extract<R, { ok: true }>;
type JobOf<J> = J extends unknown ? Omit<J, 'id'> : never;   // 묶음(union)마다 id 빼기
function engine<J extends { id: number }, R extends { id: number }>(make: () => Worker, crashed: string) {
  let w: Worker | null = null, seq = 0;
  const pending = new Map<number, { res: (r: Ok<R>) => void; rej: (e: Error) => void; step?: (s: string) => void }>();
  function worker(): Worker {
    if (w) return w;
    const nw = make();
    nw.onmessage = (e: MessageEvent) => {
      const d = e.data as R & { step?: string; ok?: boolean; error?: string }; const p = pending.get(d.id); if (!p) return;
      if (d.step) { if (p.step) p.step(d.step); return; }
      pending.delete(d.id); if (d.ok) p.res(d as Ok<R>); else p.rej(new Error(d.error));
    };
    nw.onerror = (e: ErrorEvent) => { for (const p of pending.values()) p.rej(new Error(e.message || crashed)); pending.clear(); try { nw.terminate(); } catch { /* ignore */ } if (w === nw) w = null; };
    w = nw; return nw;
  }
  const call = (msg: JobOf<J>, transfer: Transferable[] = [], step?: (s: string) => void) => new Promise<Ok<R>>((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej, step });
    try { worker().postMessage(Object.assign({ id }, msg), transfer); } catch (e) { pending.delete(id); rej(e instanceof Error ? e : new Error(String(e))); }
  });
  return { call };
}
// Vite 가 './colorWorker.ts' 를 따로 묶는다 (개발: 모듈 워커, 빌드: assets/colorWorker-*.js).
const ColorEngine = engine<ColorJob, ColorReply>(() => new Worker(new URL('./colorWorker.ts', import.meta.url), { type: 'module' }), '색 엔진이 멈췄어요');
const NoiseEngine = engine<NoiseJob, NoiseReply>(() => new Worker(new URL('./noiseWorker.ts', import.meta.url), { type: 'module' }), '노이즈 엔진이 멈췄어요');

/* ---------- 색 견본 ---------- */
export interface BaePaletteOpts extends PaletteOpts { /** 먼저 흰 바탕에 긴 변을 이만큼으로 줄인다 (기본 1024, HTML autoSwatches) */ max?: number }
/** 그림의 단색 견본 '#RRGGBB' (HTML autoSwatches: 긴 변 1024 흰 바탕, 큰 것부터 6개). opts.skip 상자 안은 뺀다. */
export async function baePalette(src: BaeImageSource, opts: BaePaletteOpts = {}): Promise<string[]> {
  const { max = 1024, ...rest } = opts;
  const c = await withImage(src, (img) => scaled(img, max)); const d = pixelsOf(c);
  const r = await ColorEngine.call({ type: 'palette', data: d.data, w: c.width, h: c.height, opts: { top: 6, ...rest } });
  return ('colors' in r ? r.colors : []).map((x) => swHex(x.rgb));
}
/** HTML autoSwatches(b): 기준 배경의 색 견본 (부품 상자 안은 빼고 6개). 결과는 b.sw.auto 에 넣는다. */
export function baeAutoSwatches(b: Pick<BaePlaceBase, 'src' | 'parts'>): Promise<string[]> {
  return baePalette(b.src, { skip: b.parts.map((p): ColorBox => [p.x0, p.y0, p.x1, p.y1]), top: 6 });
}
/** HTML baseSwatches(b): 그 기준 배경의 견본 (엔진 색 + 더한 색 - 끈 색) */
export const baeBaseSwatches = (b: Pick<BaePlaceBase, 'sw'>): string[] => baseSwatches(b);
/** HTML sheetSwatches(): 모든 기준 배경의 견본, 서로 가까운 색은 하나만, 8개까지 (부품 시트의 색 칩) */
export const baeSheetSwatches = (bases: ReadonlyArray<Pick<BaePlaceBase, 'sw'>>): string[] => sheetSwatches(bases);

function partCanvas(img: Drawable, p: BaePlacePart, maxSide = 1400): HTMLCanvasElement {   // HTML partCanvas: 부품 상자만 (바탕 칠 없음)
  const [iw, ih] = dims(img); const sx = p.x0 * iw, sy = p.y0 * ih, sw = Math.max(1, (p.x1 - p.x0) * iw), sh = Math.max(1, (p.y1 - p.y0) * ih);
  const s = Math.min(1, maxSide / Math.max(sw, sh)); const c = makeCanvas(Math.max(1, Math.round(sw * s)), Math.max(1, Math.round(sh * s))); const x = ctx2d(c);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height); return c;
}
const partColorCache = new Map<string, string[]>();
/** 부품 하나의 주된 색 2개 (HTML updatePlaceColors 의 부품 색: 긴 변 360, k 8, minShare .12, minL 0). 실패하면 []. 기준 배경 id · 상자로 기억한다. */
export async function baePartColors(b: Pick<BaePlaceBase, 'id' | 'src'>, p: BaePlacePart): Promise<string[]> {
  const key = b.id + ':' + [p.x0, p.y0, p.x1, p.y1].map((v) => Math.round(v * 1000)).join(',');
  const hit = partColorCache.get(key); if (hit) return hit;
  let out: string[];
  try {
    const c = await withImage(b.src, (img) => partCanvas(img, p, 360)), d = pixelsOf(c);
    const r = await ColorEngine.call({ type: 'palette', data: d.data, w: c.width, h: c.height, opts: { k: 8, top: 2, minShare: 0.12, minL: 0 } });
    out = ('colors' in r ? r.colors : []).map((x) => swHex(x.rgb));
  } catch { out = []; }
  partColorCache.set(key, out); return out;
}
/** HTML updatePlaceColors 의 목록: 견본('벽·바닥 색') 다음에 부품마다 주된 색(부품 이름), 가까운 색은 하나만, 21개까지 → 그림판 장소 색 */
export async function baePlaceColors(bases: readonly BaePlaceBase[]): Promise<Array<{ hex: string; name: string }>> {
  const list = sheetSwatches(bases).map((h) => ({ hex: h, name: '벽·바닥 색' }));
  for (const b of bases) for (const p of b.parts) {
    for (const h of await baePartColors(b, p)) if (!list.some((o) => nearHex(o.hex, h))) list.push({ hex: h, name: p.name || '부품' });
  }
  return list.slice(0, 21);
}

/* ---------- 색 맞춤 ---------- */
/** HTML baseRefPixels: 기준 배경을 모두 1/3 크기로 줄여 한 줄로 이어 붙인 픽셀 */
async function baseRefPixels(bases: readonly BaePlaceBase[]): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const parts: Uint8ClampedArray[] = []; let total = 0;
  for (const b of bases) {
    const img = await loadImg(b.src);
    const [iw, ih] = dims(img), w = Math.max(1, Math.round(iw / 3)), h = Math.max(1, Math.round(ih / 3)); const c = makeCanvas(w, h); const x = ctx2d(c, true);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h); parts.push(x.getImageData(0, 0, w, h).data); total += w * h;
  }
  const all = new Uint8ClampedArray(total * 4); let o = 0; for (const d of parts) { all.set(d, o); o += d.length; }
  return { data: all, w: total, h: 1 };
}
/** HTML lockColors: GPT 그림의 넓은 면(벽 · 바닥 · 소파 …)을 기준 배경의 색으로. info.moved 가 비면 옮긴 면이 없다. */
export async function baeLockColors(result: Blob, bases: readonly BaePlaceBase[]): Promise<{ blob: Blob; info: LockInfo }> {
  const u = URL.createObjectURL(result);
  try {
    const img = await loadImg(u), W = img.naturalWidth, H = img.naturalHeight; const c = makeCanvas(W, H); const x = ctx2d(c, true); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, W, H); const r = await ColorEngine.call({ type: 'lock', ref: await baseRefPixels(bases), img: { data: d.data, w: W, h: H }, opts: {} }, [d.data.buffer]);
    if (!('data' in r)) throw new Error('색 엔진이 그림을 돌려주지 않았어요');
    x.putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer as ArrayBuffer), W, H), 0, 0);
    return { blob: await toBlob(c), info: r.info };
  } finally { URL.revokeObjectURL(u); }
}

/* ---------- 노이즈 제거 ---------- */
/** HTML denoiseBlob: 같은 그림을 면마다 한 색으로 (새 PNG Blob). step 은 단계 이름('색 읽기' … '칠하기'). 되돌리기는 원래 Blob 을 쓰면 된다. */
export async function baeDenoise(blob: Blob, step?: (s: string) => void): Promise<{ blob: Blob; info: DenoiseInfo }> {
  const u = URL.createObjectURL(blob);
  try {
    const img = await loadImg(u), W = img.naturalWidth, H = img.naturalHeight; const c = makeCanvas(W, H); const x = ctx2d(c, true); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, W, H); const r = await NoiseEngine.call({ data: d.data, w: W, h: H }, [d.data.buffer], step);
    if (!('data' in r)) throw new Error('노이즈 엔진이 그림을 돌려주지 않았어요');
    x.putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer as ArrayBuffer), W, H), 0, 0);
    return { blob: await toBlob(c), info: r.info };
  } finally { URL.revokeObjectURL(u); }
}

/* ---------- 그림 모델 다음 ---------- */
export interface BaeFinished {
  /** 보여 줄 그림 (돌리고 색 맞춘 것) */
  blob: Blob;
  /** 색 맞춤 전 그림 (색 맞춤 스위치로 바꿔 볼 것). 맞춘 면이 없거나 색 맞춤을 안 했으면 null */
  alt: Blob | null;
  info: LockInfo | null;
  /** 결과에 붙일 안내 (색 맞춤을 못 했을 때만) */
  note: string;
}
/** HTML finishPicture: 기울인 컷은 기울기만큼 돌려 자르고, 기준 배경이 있고 색 맞춤이 켜져 있으면 색을 맞춘다. onPhrase 는 기다림 문구. */
export async function baeFinishPicture(blob: Blob, z: DrawSizes, bases: readonly BaePlaceBase[] | null, lockOn: boolean, onPhrase?: (phrase: string) => void): Promise<BaeFinished> {
  let out = blob, alt: Blob | null = null, info: LockInfo | null = null, note = '';
  if (z.tilt) {
    onPhrase?.('기울기만큼 돌리는 중'); const u = URL.createObjectURL(blob);
    try { out = await toBlob(rotateBack(await loadImg(u), z.tilt, z)); } finally { URL.revokeObjectURL(u); }
  }
  if (bases && bases.length && lockOn) {
    onPhrase?.('기준 배경 색 맞추는 중');
    try { const r = await baeLockColors(out, bases); if (r.info.moved.length) { alt = out; out = r.blob; info = r.info; } else note = '색 맞춤: 기준 배경과 같은 넓은 면을 찾지 못해서 GPT가 그린 색 그대로 뒀어요.'; }
    catch (e) { note = '색 맞춤을 하지 못해서 GPT가 그린 색 그대로 뒀어요. (' + ((e as Error)?.message || e) + ')'; }
  }
  return { blob: out, alt, info, note };
}
