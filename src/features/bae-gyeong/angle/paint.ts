/**
 * BAE경 '다른 각도로'의 러프 덧대기와 PD메모 그리기 (HTML v0.4.11 script_4.js 4021~4063줄, 4134~4140줄 그대로).
 * 붓 자국 · 메모는 B 그림의 0..1 자리로 갖고 있어서 어떤 크기로도 그린다. 붓은 밑그림에 들어가고, 메모는 PD 만 본다.
 */
import { FONT, NOTE_COLOR } from '@/shared/bae/order/constants';
import type { AngleNote } from '@/shared/bae/angle/order';
import { dims, makeCanvas } from '../make/inputs';

/** 붓 한 획 (0..1 자리, 굵기는 B 그림 너비의 몫). erase = 지우개. */
export interface AngleStroke { col: string; w: number; pts: Array<[number, number]>; erase?: boolean; seq?: number }
/** 창에서 고치는 중인 메모 표시 (그리지 않는다). */
export type AngleNoteDraw = AngleNote & { _editing?: boolean };

/** 붓 자국을 따로 한 층에 (지우개가 그 층만 지우게). HTML agPaintDraw. */
export function anglePaintDraw(x: CanvasRenderingContext2D, w: number, h: number, strokes: readonly AngleStroke[]): void {
  x.save(); x.lineCap = 'round'; x.lineJoin = 'round';
  for (const s of strokes) {
    x.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    x.strokeStyle = s.erase ? '#000' : s.col; x.fillStyle = x.strokeStyle; x.lineWidth = Math.max(1, s.w * w);
    if (s.pts.length === 1) { x.beginPath(); x.arc(s.pts[0][0] * w, s.pts[0][1] * h, x.lineWidth / 2, 0, 7); x.fill(); continue; }
    x.beginPath(); x.moveTo(s.pts[0][0] * w, s.pts[0][1] * h); for (let i = 1; i < s.pts.length; i++) x.lineTo(s.pts[i][0] * w, s.pts[i][1] * h); x.stroke();
  }
  x.restore();
}
/** 그림(GPT 밑그림) 위에 붓 자국: 한 층에 먼저 그린 뒤 얹는다. HTML agPaintOn. */
export function anglePaintOn(c: HTMLCanvasElement, strokes: readonly AngleStroke[]): HTMLCanvasElement {
  if (!strokes.length) return c; const L = makeCanvas(c.width, c.height); anglePaintDraw(L.getContext('2d') as CanvasRenderingContext2D, c.width, c.height, strokes); (c.getContext('2d') as CanvasRenderingContext2D).drawImage(L, 0, 0); return c;
}
/** PD메모 (그림판 메모와 같은 분홍빨강, 흰 테두리). HTML agNotesDraw. */
export function angleNotesDraw(x: CanvasRenderingContext2D, w: number, h: number, list: readonly AngleNoteDraw[]): void {
  x.save(); x.lineCap = 'round'; x.lineJoin = 'round';
  for (const n of list) {
    if (n._editing) continue;
    const lw = Math.max(2, ((n as { w?: number }).w || 0.006) * w);
    if (n.type === 'arrow') {
      const x1 = n.x1 * w, y1 = n.y1 * h, x2 = n.x2 * w, y2 = n.y2 * h, ang = Math.atan2(y2 - y1, x2 - x1), head = Math.max(12, lw * 3.4);
      const ex = x2 - Math.cos(ang) * head * .7, ey = y2 - Math.sin(ang) * head * .7, tri = [[x2, y2], [x2 - Math.cos(ang - .45) * head, y2 - Math.sin(ang - .45) * head], [x2 - Math.cos(ang + .45) * head, y2 - Math.sin(ang + .45) * head]];
      for (const pass of [0, 1]) {
        const c = pass ? NOTE_COLOR : 'rgba(255,255,255,.92)'; x.strokeStyle = c; x.fillStyle = c; x.lineWidth = lw + (pass ? 0 : 5);
        x.beginPath(); x.moveTo(x1, y1); x.lineTo(ex, ey); x.stroke();
        x.beginPath(); x.moveTo(tri[0][0], tri[0][1]); x.lineTo(tri[1][0], tri[1][1]); x.lineTo(tri[2][0], tri[2][1]); x.closePath(); if (!pass) { x.lineWidth = 5; x.stroke(); } x.fill();
      }
    } else if (n.type === 'mark') {
      for (const pass of [0, 1]) {
        x.strokeStyle = pass ? NOTE_COLOR : 'rgba(255,255,255,.92)'; x.lineWidth = lw + (pass ? 0 : 5); x.beginPath();
        n.pts.forEach((q, i) => i ? x.lineTo(q[0] * w, q[1] * h) : x.moveTo(q[0] * w, q[1] * h)); if (n.pts.length === 1) x.lineTo(n.pts[0][0] * w + 0.5, n.pts[0][1] * h); x.stroke();
      }
    } else if (n.type === 'text') {
      const fs = Math.max(10, n.size * w), lh = fs * 1.22; x.font = '800 ' + fs + 'px ' + FONT; x.textBaseline = 'top';
      n.text.split('\n').forEach((ln, i) => { x.lineWidth = Math.max(3, fs * .22); x.strokeStyle = 'rgba(255,255,255,.95)'; x.strokeText(ln, n.x * w, n.y * h + i * lh); x.fillStyle = NOTE_COLOR; x.fillText(ln, n.x * w, n.y * h + i * lh); });
    }
  }
  x.restore();
}
/** v0.4.9 가까이 잡은 샷: 상자(0..1, 왼쪽 위부터) 안의 그림 + 여유 4%, 긴 쪽 1536. HTML agCrop. */
export function angleCrop(img: CanvasImageSource, box: readonly number[]): HTMLCanvasElement {
  const [iw, ih] = dims(img), mx = (box[2] - box[0]) * 0.04, my = (box[3] - box[1]) * 0.04;
  const x0 = Math.max(0, box[0] - mx) * iw, y0 = Math.max(0, box[1] - my) * ih, x1 = Math.min(1, box[2] + mx) * iw, y1 = Math.min(1, box[3] + my) * ih;
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), k = 1536 / Math.max(w, h), c = makeCanvas(Math.round(w * k), Math.round(h * k)), x = c.getContext('2d') as CanvasRenderingContext2D;
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(img, x0, y0, w, h, 0, 0, c.width, c.height); return c;
}
export const ANGLE_NOTE_SIZE = 0.03;
