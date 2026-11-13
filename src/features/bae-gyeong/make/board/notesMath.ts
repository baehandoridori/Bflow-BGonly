/**
 * 빨간 메모(화살표 · 글씨 · 메모 펜)의 순수 계산 (HTML v0.4.11 script_4.js `Board` 318~337, 449, 726~758줄).
 * 메모는 PD만 읽는다. DOM 없음 — 글자 폭은 measure 로 받는다.
 */
import { FONT } from '../../../../shared/bae/order/constants.ts';
import { clamp, type Measure, type Pt } from './guideMath.ts';

export type BoardNote =
  | { type: 'arrow'; x1: number; y1: number; x2: number; y2: number; w: number; _editing?: boolean }
  | { type: 'mark'; pts: Pt[]; w: number; _editing?: boolean }
  | { type: 'text'; x: number; y: number; text: string; size: number; _editing?: boolean };
export interface Box { x: number; y: number; w: number; h: number }
export interface BoardPoint { x: number; y: number }

export const textFont = (size: number): string => '800 ' + size + 'px ' + FONT;
/** 굵기(가늘게 4 · 보통 10 · 굵게 24) → 메모 선 굵기 · 글씨 크기 */
export const noteWidth = (width: number): number => ({ 4: 5, 10: 7, 24: 11 } as Record<number, number>)[width] || 7;
export const textSizeFor = (width: number): number => ({ 4: 28, 10: 40, 24: 64 } as Record<number, number>)[width] || 40;

export function noteBox(n: BoardNote, measure: Measure): Box {
  if (n.type === 'arrow') { const p = n.w + 10; return { x: Math.min(n.x1, n.x2) - p, y: Math.min(n.y1, n.y2) - p, w: Math.abs(n.x2 - n.x1) + p * 2, h: Math.abs(n.y2 - n.y1) + p * 2 }; }
  if (n.type === 'mark') { const xs = n.pts.map((q) => q[0]), ys = n.pts.map((q) => q[1]); const p = n.w; return { x: Math.min(...xs) - p, y: Math.min(...ys) - p, w: Math.max(...xs) - Math.min(...xs) + p * 2, h: Math.max(...ys) - Math.min(...ys) + p * 2 }; }
  const font = textFont(n.size), lines = n.text.split('\n');
  return { x: n.x, y: n.y, w: Math.max(...lines.map((l) => measure(l, font)), n.size * 0.5), h: lines.length * n.size * 1.22 };
}

export function segDist(p: BoardPoint, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const L = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - a[0]) * dx + (p.y - a[1]) * dy) / L, 0, 1);
  return Math.hypot(p.x - a[0] - t * dx, p.y - a[1] - t * dy);
}

/** 누른 자리의 메모 (나중에 그린 것부터) */
export function noteAt(notes: BoardNote[], p: BoardPoint, measure: Measure): BoardNote | null {
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.type === 'text') { const b = noteBox(n, measure); if (p.x >= b.x - 8 && p.x <= b.x + b.w + 8 && p.y >= b.y - 8 && p.y <= b.y + b.h + 8) return n; }
    else if (n.type === 'arrow') { if (segDist(p, [n.x1, n.y1], [n.x2, n.y2]) <= Math.max(14, n.w + 10)) return n; }
    else if (n.type === 'mark') {
      for (let j = 1; j < n.pts.length; j++) if (segDist(p, n.pts[j - 1], n.pts[j]) <= Math.max(14, n.w + 10)) return n;
      if (n.pts.length === 1 && Math.hypot(p.x - n.pts[0][0], p.y - n.pts[0][1]) < 14) return n;
    }
  }
  return null;
}

/** 메모 옮기기 (그 메모를 고친다 — 고른 메모를 그대로 가리키게) */
export function moveNote(n: BoardNote, dx: number, dy: number): void {
  if (n.type === 'arrow') { n.x1 += dx; n.y1 += dy; n.x2 += dx; n.y2 += dy; }
  else if (n.type === 'mark') n.pts = n.pts.map((q) => [q[0] + dx, q[1] + dy] as Pt);
  else { n.x += dx; n.y += dy; }
}

/** setRatio: 옛 종이를 새 종이 안에 잘리지 않게 맞춰 넣는 배율과 자리 */
export function ratioFit(oW: number, oH: number, W: number, H: number): { s: number; ox: number; oy: number } {
  const s = Math.min(W / oW, H / oH);
  return { s, ox: (W - oW * s) / 2, oy: (H - oH * s) / 2 };
}
/** setRatio: 메모도 같은 배율로 옮기고 굵기·글씨 크기도 맞춘다 (메모를 고친다) */
export function fitNotes(notes: BoardNote[], s: number, ox: number, oy: number): void {
  const T = (x: number, y: number): Pt => [x * s + ox, y * s + oy];
  notes.forEach((n) => {
    if (n.type === 'arrow') { [n.x1, n.y1] = T(n.x1, n.y1); [n.x2, n.y2] = T(n.x2, n.y2); n.w *= s; }
    else if (n.type === 'mark') { n.pts = n.pts.map((q) => T(q[0], q[1])); n.w *= s; }
    else { [n.x, n.y] = T(n.x, n.y); n.size *= s; }
  });
}

/** notesSummary: PD에게 보내는 메모 목록. map = 러프의 한 점(0..1) → PD가 보는 그림의 자리 (러프를 수평으로 돌린 그림) */
export function notesSummary(notes: BoardNote[], W: number, H: number, measure: Measure, map?: ((x: number, y: number) => number[]) | null): string {
  const P = (x: number, y: number) => { const q = map ? map(x / W, y / H) : [x / W, y / H]; return 'x ' + Math.round(q[0] * 100) + '%, y ' + Math.round(q[1] * 100) + '%'; };
  return notes.map((n) => {
    if (n.type === 'text') return '- text "' + n.text.replace(/\s+/g, ' ').trim() + '" at (' + P(n.x, n.y) + ')';
    if (n.type === 'arrow') return '- arrow from (' + P(n.x1, n.y1) + ') to (' + P(n.x2, n.y2) + ')';
    const b = noteBox(n, measure); return '- circled or marked area around (' + P(b.x + b.w / 2, b.y + b.h / 2) + '), about ' + Math.round(b.w / W * 100) + '% wide and ' + Math.round(b.h / H * 100) + '% tall';
  }).join('\n');
}
