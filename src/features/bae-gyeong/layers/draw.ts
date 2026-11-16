/**
 * 레이어 계획 창의 그림 위 표시 (HTML lpMask · lpSprite · lpDraw · lpHit 을 옮김). 물건마다 층 색의 반투명 윤곽을 캔버스에,
 * 이름표는 창이 버튼으로 띄운다 (자리만 여기서 셈: 겹치면 한 줄씩 비켜 섬, 고른 물건과 앞쪽 물건이 제자리).
 * 층 색은 글자색으로 쓰지 않는다 (계획 14d 9장) — 윤곽 채움 · 테두리 · 점에만.
 */
import type { PackedMask } from './engine/planner';
import type { LayersLabel } from './planModel';

export interface UnpackedMask { x0: number; y0: number; w: number; h: number; d: Uint8Array; area: number }

export function unpackMask(p: PackedMask | null | undefined): UnpackedMask | null {
  if (!p) return null;
  const n = p.w * p.h, d = new Uint8Array(n); let area = 0;
  for (let i = 0; i < n; i++) { const v = (p.bits[i >> 3] >> (i & 7)) & 1; d[i] = v; area += v; }
  return { x0: p.x0, y0: p.y0, w: p.w, h: p.h, d, area };
}

/** 그림 위 한 점 아래의 가장 작은 윤곽 (게시판 위 카드가 게시판보다 먼저). HTML lpHit */
export function hitTest(px: number, py: number, ids: string[], maskOf: (id: string) => UnpackedMask | null): string | null {
  let best: string | null = null, ba = Infinity; const x = Math.floor(px), y = Math.floor(py);
  for (const id of ids) {
    const m = maskOf(id);
    if (!m || x < m.x0 || y < m.y0 || x >= m.x0 + m.w || y >= m.y0 + m.h || !m.d[(y - m.y0) * m.w + x - m.x0]) continue;
    if (m.area < ba) { ba = m.area; best = id; }
  }
  return best;
}

const hexRgb = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); if (m) { const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  const r = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c); return r ? [+r[1], +r[2], +r[3]] : [139, 141, 163];
};

/** 윤곽 한 장: 가장자리 2px 는 진하게, 안쪽은 옅게 (고른 것은 조금 더). HTML lpSprite */
export function makeSprite(m: UnpackedMask, color: string, strong: boolean): HTMLCanvasElement | OffscreenCanvas {
  const c = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: m.w, height: m.h }) : new OffscreenCanvas(m.w, m.h);
  const x = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const im = x.createImageData(m.w, m.h); const [r, g, b] = hexRgb(color);
  const at = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < m.w && yy < m.h && m.d[yy * m.w + xx];
  for (let yy = 0; yy < m.h; yy++) for (let xx = 0; xx < m.w; xx++) {
    if (!m.d[yy * m.w + xx]) continue; let edge = false;
    for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2 && !at(xx + dx, yy + dy)) { edge = true; break; }
    const q = (yy * m.w + xx) * 4; im.data[q] = r; im.data[q + 1] = g; im.data[q + 2] = b; im.data[q + 3] = edge ? 255 : (strong ? 105 : 40);
  }
  x.putImageData(im, 0, 0);
  return c;
}

export interface DrawInput {
  canvas: HTMLCanvasElement; W: number; H: number; ids: string[];
  maskOf(id: string): UnpackedMask | null;
  spriteOf(id: string, strong: boolean): HTMLCanvasElement | OffscreenCanvas | null;
  highlight: Set<string>; hover: string | null; showAll: boolean;
  /** 그리는 중인 네모 (작업 크기 픽셀) */
  box: number[] | null; boxColor: string;
}
/** 캔버스를 화면 크기에 맞추고 윤곽을 그린다. HTML lpDraw (이름표는 따로). */
export function drawOutlines(o: DrawInput): void {
  const cv = o.canvas; const r = cv.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(1, Math.round(r.width * dpr)), ch = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  const x = cv.getContext('2d'); if (!x) return;
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cw, ch);
  const sx = cw / o.W, sy = ch / o.H; x.setTransform(sx, 0, 0, sy, 0, 0); x.imageSmoothingEnabled = true;
  if (o.showAll) for (const id of o.ids) { if (o.highlight.has(id) || id === o.hover) continue; const s = o.spriteOf(id, false), m = o.maskOf(id); if (s && m) x.drawImage(s as CanvasImageSource, m.x0, m.y0); }
  for (const id of new Set([...o.highlight, o.hover].filter(Boolean) as string[])) { const s = o.spriteOf(id, true), m = o.maskOf(id); if (s && m) x.drawImage(s as CanvasImageSource, m.x0, m.y0); }
  if (o.box) {
    const b = o.box; x.lineWidth = 2 / sx; x.setLineDash([6 / sx, 4 / sx]); x.strokeStyle = '#fff'; x.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    x.strokeStyle = o.boxColor; x.lineDashOffset = 5 / sx; x.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); x.setLineDash([]);
  }
}

export interface PlacedLabel { L: LayersLabel; x: number; y: number; w: number; pri: number }
/**
 * 이름표 자리 (CSS 픽셀, 이름표 가운데 줄의 y). 레이어마다 하나: 작은 물건은 골랐거나 손이 올라 있을 때만.
 * 겹치면 한 줄씩 아래 · 위로 비켜 선다. 고른 것이 먼저 자리를 잡고, 다음은 앞쪽 레이어부터 (HTML lpDraw 의 이름표 부분).
 */
export function placeLabels(o: {
  labels: LayersLabel[]; maskOf(id: string): UnpackedMask | null; W: number; H: number; cw: number; ch: number;
  measure(text: string): number; highlight: Set<string>; hover: string | null; showAll: boolean;
}): PlacedLabel[] {
  const sx = o.cw / o.W, sy = o.ch / o.H; const todo: PlacedLabel[] = [];
  for (const L of o.labels) {
    const ms = L.ids.map(o.maskOf).filter(Boolean) as UnpackedMask[]; if (!ms.length) continue;
    const m = ms.reduce((a, b) => (b.x0 < a.x0 ? b : a));
    const big = ms.some((q) => q.w * sx > 46 && q.h * sy > 30); const hot = o.highlight.has(L.id) || o.hover === L.id;
    if (!big && !hot) continue; if (!o.showAll && !o.highlight.has(L.id)) continue;
    const tw = o.measure(L.text) + 30; const tx = Math.max(2, Math.min(o.cw - tw - 2, m.x0 * sx + 4)), ty = Math.max(12, m.y0 * sy + 13);
    todo.push({ L, w: tw, x: tx, y: ty, pri: hot ? 1 : 0 });
  }
  todo.sort((a, b) => (b.pri - a.pri) || (b.L.ord - a.L.ord));
  const LH = 24, GAP = 2; const placed: Array<{ x: number; y: number; w: number }> = [];
  const hit = (tx: number, ty: number, tw: number) => placed.some((p) => tx < p.x + p.w + GAP && tx + tw + GAP > p.x && Math.abs(ty - p.y) < LH + GAP);
  for (const t of todo) {
    if (hit(t.x, t.y, t.w)) for (const d of [1, -1, 2, -2, 3, -3, 4]) {
      const y2 = t.y + d * (LH + GAP); if (y2 < 12 || y2 > o.ch - 12) continue;
      if (!hit(t.x, y2, t.w)) { t.y = y2; break; }
    }
    placed.push({ x: t.x, y: t.y, w: t.w });
  }
  return todo.reverse();   // 그리는 순서: 뒤 → 앞, 고른 것은 맨 위
}
