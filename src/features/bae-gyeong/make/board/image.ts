/**
 * 그림판이 쓰는 그림 도우미 (HTML v0.4.11 script_4.js 152~168줄 그대로). DOM 캔버스를 쓴다.
 */

export type BoardImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('이미지를 열 수 없어요')); im.src = src; });
}
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(new Error('파일을 읽을 수 없어요')); r.readAsDataURL(file); });
}
export function dims(src: BoardImage): [number, number] {
  const im = src as HTMLImageElement;
  return [im.naturalWidth || src.width, im.naturalHeight || src.height];
}
export function fit(w: number, h: number, max: number): [number, number] {
  const s = Math.min(1, max / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}
export function makeCanvas(w: number, h: number): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
/** 흰 바탕에 긴 변 max 로 줄인 그림 */
export function scaled(src: BoardImage, max: number): HTMLCanvasElement {
  const [w0, h0] = dims(src); const [w, h] = fit(w0, h0, max);
  const c = makeCanvas(w, h); const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h);
  return c;
}
export const toBlob = (c: HTMLCanvasElement, type = 'image/png', q?: number): Promise<Blob | null> => new Promise((r) => c.toBlob(r, type, q));
/** 선 러프가 아니라 디테일 많은 AI 그림·사진 같은지 (HTML isPhotoLike 그대로): 흰 곳이 35% 못 되고 색이 많으면 */
export function isPhotoLike(img: BoardImage): boolean {
  try {
    const w = 96, h = 54; const c = makeCanvas(w, h); const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D; x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data; let white = 0; const colors = new Set<number>();
    for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (r > 225 && g > 225 && b > 225) white++; colors.add((r >> 4) << 8 | (g >> 4) << 4 | (b >> 4)); }
    return white / (w * h) < 0.35 && colors.size > 180;
  } catch { return false; }
}
/** 큰 사진은 들어올 때 긴 변 2048px 로 줄인다: 그림판은 그보다 크게 쓰지 않고, 저장도 작아진다 */
export async function normalizeSrc(file: File): Promise<{ src: string; img: HTMLImageElement }> {
  const src = await fileToDataUrl(file); const img = await loadImg(src); const [w, h] = dims(img);
  if (Math.max(w, h) <= 2048 && src.length < 4e6) return { src, img };
  const out = scaled(img, 2048).toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92);
  const small = out.length < 6e6 ? out : scaled(img, 2048).toDataURL('image/jpeg', 0.9);
  return { src: small, img: await loadImg(small) };
}
