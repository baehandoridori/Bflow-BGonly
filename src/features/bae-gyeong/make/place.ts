// '같은 장소'(기준 배경)를 캔버스로: 부품 자르기 · 부품 시트 그리기 (HTML v0.4.11 script_4.js 973~1004줄 partCanvas · composeSheet 그대로).
// 자리 계산은 @/shared/bae/place 의 baePartCrop · baeSheetLayout 이 하고, 여기서는 HTML 과 같은 순서 · 같은 설정으로 그리기만 한다.
// 요청에 넣는 일(buildPlace · placeItems)은 inputs.ts 가 이 파일을 불러서 한다.
import { BAE_SHEET, baePartCrop, baePlaceSheetSwatches, baeSheetLayout } from '@/shared/bae/place';
import type { BaePlaceBase, BaePlacePart } from '@/shared/bae/place';
import { dims, loadImg, makeCanvas } from './board/image';

/** 기준 배경 그림 (주소 → 불러온 그림). 같은 주소는 한 번만 연다. */
export type BaeBaseImages = Map<string, HTMLImageElement>;

/** 기준 배경들의 그림을 연다 (images 에 이미 있으면 그대로). HTML 의 b.img 와 같다: b.src 는 normalizeSrc 를 거친 주소. */
export async function loadBaseImages(bases: readonly BaePlaceBase[], images: BaeBaseImages = new Map()): Promise<BaeBaseImages> {
  for (const b of bases) if (!images.has(b.src)) images.set(b.src, await loadImg(b.src));
  return images;
}

/** HTML partCanvas(b, p, maxSide): 기준 배경에서 부품 네모를 잘라 긴 변 maxSide 이하로 (부드럽게 'high'). */
export function partCanvas(img: HTMLImageElement | HTMLCanvasElement | ImageBitmap, p: Pick<BaePlacePart, 'x0' | 'y0' | 'x1' | 'y1'>, maxSide: number = BAE_SHEET.PART_MAX_SIDE): HTMLCanvasElement {
  const [iw, ih] = dims(img); const k = baePartCrop(iw, ih, p, maxSide);
  const c = makeCanvas(k.w, k.h); const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(img, k.sx, k.sy, k.sw, k.sh, 0, 0, c.width, c.height); return c;
}

/**
 * HTML composeSheet(): 자른 부품을 흰 테두리 상자로 회색 2048×1152 종이에 늘어놓고, 그 뒤에 색 견본(최대 8개)을 두 줄로.
 * imgOf(b) = 그 기준 배경의 그림 (loadBaseImages 로 연 것). 종이에 들어가지 않으면 null.
 */
export function composeSheet(bases: readonly BaePlaceBase[], imgOf: (b: BaePlaceBase) => HTMLImageElement | HTMLCanvasElement | ImageBitmap): HTMLCanvasElement | null {
  const { W, H, PAD } = BAE_SHEET; const items: HTMLCanvasElement[] = [];
  for (const b of bases) for (const p of b.parts) items.push(partCanvas(imgOf(b), p));
  const sw = baePlaceSheetSwatches(bases);
  const lay = baeSheetLayout(items.map((c) => ({ w: c.width, h: c.height })), sw.length); if (!lay) return null;
  const c = makeCanvas(W, H), x = c.getContext('2d') as CanvasRenderingContext2D;
  x.fillStyle = BAE_SHEET.BG; x.fillRect(0, 0, W, H); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  lay.boxes.forEach(([px, py, w, h], i) => {
    x.fillStyle = BAE_SHEET.BOX_FILL; x.fillRect(px - PAD, py - PAD, w + PAD * 2, h + PAD * 2); x.drawImage(items[i], px, py, w, h);
    x.strokeStyle = BAE_SHEET.BOX_LINE; x.lineWidth = BAE_SHEET.LINE_W; x.strokeRect(px - PAD, py - PAD, w + PAD * 2, h + PAD * 2);
  });
  sw.forEach((hex, i) => { const [cx, cy] = lay.swatches[i]; x.fillStyle = hex; x.fillRect(cx, cy, lay.s, lay.s); x.strokeStyle = BAE_SHEET.SWATCH_LINE; x.lineWidth = BAE_SHEET.LINE_W; x.strokeRect(cx, cy, lay.s, lay.s); });
  return c;
}

/** 화면의 '부품 시트 미리 보기': 그림을 열고 composeSheet. 부품이 없거나 종이에 들어가지 않으면 null. */
export async function placeSheetPreview(bases: readonly BaePlaceBase[], images?: BaeBaseImages): Promise<HTMLCanvasElement | null> {
  if (!bases.some((b) => b.parts.length)) return null;
  const imgs = await loadBaseImages(bases, images);
  return composeSheet(bases, (b) => imgs.get(b.src) as HTMLImageElement);
}

/** '부품 자르기' 창의 부품 썸네일 (HTML renderSide: partCanvas(b, p, 160) 을 JPEG 0.8 로). */
export async function partPreviewUrl(base: BaePlaceBase, p: BaePlacePart, images?: BaeBaseImages, max = 160): Promise<string> {
  const imgs = await loadBaseImages([base], images);
  return partCanvas(imgs.get(base.src) as HTMLImageElement, p, max).toDataURL('image/jpeg', 0.8);
}
