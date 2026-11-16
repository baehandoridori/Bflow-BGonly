// 부품 시트의 자리 계산 (HTML v0.4.11 script_4.js 973~1004줄 partCanvas · composeSheet 의 숫자 부분 그대로). DOM 없음:
// 캔버스에 그리는 일은 src/features/bae-gyeong/make/place.ts 가 이 계산을 받아서 한다.
import type { BaePlacePart } from './types';

/** 부품 시트: 회색 2048×1152 종이, 둘레 56, 사이 36, 흰 테두리 6, 부품 긴 변 최대 1400. */
export const BAE_SHEET = {
  W: 2048, H: 1152, M: 56, GAP: 36, PAD: 6, PART_MAX_SIDE: 1400,
  BG: 'rgb(228,228,228)', BOX_FILL: '#fff', BOX_LINE: 'rgb(190,190,190)', SWATCH_LINE: 'rgb(150,150,150)', LINE_W: 2, SWATCH_GAP: 14,
} as const;

/** HTML partCanvas 의 자르기: 그림(iw×ih) 안 부품 네모 → 원본에서 잘라 올 곳(sx, sy, sw, sh)과 만들 캔버스 크기(w, h). */
export interface BaePartCrop { sx: number; sy: number; sw: number; sh: number; w: number; h: number }
export function baePartCrop(iw: number, ih: number, p: Pick<BaePlacePart, 'x0' | 'y0' | 'x1' | 'y1'>, maxSide: number = BAE_SHEET.PART_MAX_SIDE): BaePartCrop {
  const sx = p.x0 * iw, sy = p.y0 * ih, sw = Math.max(1, (p.x1 - p.x0) * iw), sh = Math.max(1, (p.y1 - p.y0) * ih);
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  return { sx, sy, sw, sh, w: Math.max(1, Math.round(sw * s)), h: Math.max(1, Math.round(sh * s)) };
}

/** 시트 위 자리: boxes = 부품마다 [x, y, w, h] (흰 테두리 안쪽), swatches = 견본마다 [x, y] (한 변 s). */
export interface BaeSheetLayout { boxes: Array<[number, number, number, number]>; s: number; sx: number; sy: number; swatches: Array<[number, number]> }

/**
 * HTML composeSheet 의 자리 찾기: 부품 높이를 460 에서 60 까지 10씩 줄이며 왼쪽부터 줄을 채우고, 견본은 부품 뒤(자리가 없으면 다음 줄)에
 * 두 줄로. 종이에 다 들어가는 첫 높이를 쓴다. 들어가는 높이가 없으면 null (HTML 은 그때 부품 시트를 보내지 않는다).
 * items = 부품 캔버스 크기(baePartCrop 의 w, h), swCount = 견본 수(baePlaceSheetSwatches 의 길이).
 */
export function baeSheetLayout(items: ReadonlyArray<{ w: number; h: number }>, swCount: number): BaeSheetLayout | null {
  const { W, H, M, GAP } = BAE_SHEET; let best: { L: Array<[number, number, number, number]>; s: number; sx: number; sy: number } | null = null;
  for (let h = 460; h >= 60 && !best; h -= 10) {
    const L: Array<[number, number, number, number]> = []; let x = M, y = M, ok = true;
    for (const c of items) {
      const w = Math.max(8, Math.round(c.w * h / c.h)); if (w > W - 2 * M) { ok = false; break; }
      if (x > M && x + w > W - M) { x = M; y += h + GAP; } L.push([x, y, w, h]); x += w + GAP;
    }
    if (!ok) continue;
    const s = Math.max(24, Math.min(150, Math.floor((h - 14) / 2))), cols = Math.ceil(swCount / 2), bw = swCount ? cols * (s + 14) - 14 : 0;
    let sx = items.length ? x : M, sy = y;
    if (swCount && sx + bw > W - M) { sx = M; sy = y + h + GAP; }
    const bottom = Math.max(items.length ? y + h : 0, swCount ? sy + 2 * s + 14 : 0);
    if (bottom > H - M) continue;
    best = { L, s, sx, sy };
  }
  if (!best) return null;
  const b = best;
  const swatches = Array.from({ length: swCount }, (_, i): [number, number] => [b.sx + Math.floor(i / 2) * (b.s + BAE_SHEET.SWATCH_GAP), b.sy + (i % 2) * (b.s + BAE_SHEET.SWATCH_GAP)]);
  return { boxes: b.L, s: b.s, sx: b.sx, sy: b.sy, swatches };
}
