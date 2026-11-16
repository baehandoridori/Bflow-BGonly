/**
 * 화면 기울기(더치 앵글): 기울인 러프를 수평으로 돌려 더 큰 종이에 보내고, 그림 모델이 수평으로 그린 결과를 다시 돌려 자른다.
 * HTML v0.4.11 script_4.js levelCanvas · levelMap · rotateBack (875~889줄) 그대로. DOM 캔버스를 쓰므로 화면(렌더러) 전용.
 * z 는 drawSizes() (src/shared/bae/order/sizes.ts) 의 결과.
 */
import { levelMap, type DrawSizes } from '@/shared/bae/order/sizes';

export { levelMap };
export type TiltImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

function makeCanvas(w: number, h: number): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function dims(src: TiltImage): [number, number] { const im = src as HTMLImageElement; return [im.naturalWidth || src.width, im.naturalHeight || src.height]; }

/** HTML levelCanvas: 기울인 러프를 수평으로 돌려 더 큰 종이 가운데에 (흰 모서리). 긴 변 1536. */
export function levelCanvas(src: TiltImage, tilt: number, z: DrawSizes): HTMLCanvasElement {
  const k = 1536 / Math.max(z.gen[0], z.gen[1]); const c = makeCanvas(Math.round(z.gen[0] * k), Math.round(z.gen[1] * k)); const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.translate(c.width / 2, c.height / 2); x.rotate(tilt * Math.PI / 180); x.drawImage(src, -z.out[0] * k / 2, -z.out[1] * k / 2, z.out[0] * k, z.out[1] * k);
  return c;
}

/** HTML rotateBack: 수평으로 그린 그림을 기울기만큼 되돌려 마지막 크기(z.out)로 자른다. */
export function rotateBack(img: TiltImage, tilt: number, z: DrawSizes): HTMLCanvasElement {
  const [iw, ih] = dims(img), k = iw / z.gen[0]; const c = makeCanvas(z.out[0], z.out[1]); const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.translate(z.out[0] / 2, z.out[1] / 2); x.rotate(-tilt * Math.PI / 180);
  x.drawImage(img, -iw / k / 2, -ih / k / 2, iw / k, ih / k); return c;
}
