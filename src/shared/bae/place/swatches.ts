// 기준 배경의 색 견본 · 같은 장소 열쇠 (HTML v0.4.11 script_4.js 180~181 · 814~821줄 그대로). DOM 없음.
// 색을 고르는 계산(k-means)은 엔진이 한다: 여기서는 b.sw.auto 를 받은 값으로만 쓴다.
import { baePlaceMode } from './types';
import type { BaePlaceBase } from './types';

/** HTML hexToRgb: '#rrggbb'(대소문자 무관) → [r, g, b]. 모양이 틀리면 검정. */
export function baeHexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h) || [0, '000000']; const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** HTML rgbToHex: 늘 대문자 '#RRGGBB'. */
export const baeRgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * HTML swHex: 엔진이 고른 색 하나 → '#RRGGBB'. HTML 은 [r, g, b] 를 받는다. Bflow 의 sw.auto 는 '#rrggbb' 글이라
 * 글이면 같은 색의 대문자 꼴로 (HTML 이 같은 색에 만드는 글자와 같다).
 */
export function baePlaceSwHex(c: string | readonly number[]): string {
  if (typeof c === 'string') { const [r, g, b] = baeHexToRgb(c); return baeRgbToHex(r, g, b); }
  return baeRgbToHex(c[0], c[1], c[2]);
}

/** HTML nearHex: 두 색의 채널 차이 합이 10 미만이면 같은 색으로 본다. */
export function baePlaceNearHex(a: string, b: string): boolean {
  const x = baeHexToRgb(a), y = baeHexToRgb(b);
  return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) < 10;
}

/** HTML baseSwatches(b): 엔진이 고른 색 + 사람이 더한 색 (겹친 것 한 번), 사람이 끈 색은 뺀다. */
export function baePlaceBaseSwatches(b: Pick<BaePlaceBase, 'sw'>): string[] {
  const off = new Set(b.sw.off);
  return [...new Set((b.sw.auto || []).map(baePlaceSwHex).concat(b.sw.add))].filter((h) => !off.has(h));
}

/** HTML sheetSwatches(): 모든 기준 배경의 견본에서 거의 같은 색을 한 번씩, 최대 8개 (부품 시트에 들어가는 색). */
export function baePlaceSheetSwatches(bases: ReadonlyArray<Pick<BaePlaceBase, 'sw'>>): string[] {
  const out: string[] = [];
  for (const b of bases) for (const h of baePlaceBaseSwatches(b)) if (!out.some((o) => baePlaceNearHex(o, h))) out.push(h);
  return out.slice(0, 8);
}

/** HTML placeKey(): 요청에 들어갈 '같은 장소' 그림이 바뀌었는지 보는 열쇠 (방식 · 기준 배경 id · 부품 네모(천분의 일) · 견본). 메모는 들어가지 않는다. */
export function baePlaceKey(bases: readonly BaePlaceBase[]): string {
  return baePlaceMode(bases) + '|' + JSON.stringify(bases.map((b) => [b.id, b.parts.map((p) => [p.x0, p.y0, p.x1, p.y1].map((v) => Math.round(v * 1000))), baePlaceBaseSwatches(b)]));
}
