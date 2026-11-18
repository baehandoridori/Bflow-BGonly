/* BAE layer engine: box masks. A scene can have ~100 props and every prop keeps several masks (outline, what it may
   show, what it shows, body, shadow...). Full-size masks for all of them would need gigabytes, so each one is kept
   as just its bounding box plus the pixels inside it. Full-size masks are only made for a moment while computing. */
import * as I from './img.js';

export class BM {
  constructor(x0 = 0, y0 = 0, w = 0, h = 0, d = null) { this.x0 = x0; this.y0 = y0; this.w = w; this.h = h; this.d = d || new Uint8Array(w * h); }
  get x1() { return this.x0 + this.w; } get y1() { return this.y0 + this.h; }
  get empty() { return !this.w || !this.h; }
  box() { return this.empty ? null : [this.x0, this.y0, this.x1, this.y1]; }
}
export const EMPTY = () => new BM();
export function fromFull(m, W, H) {                // tight box around the set pixels
  const b = I.bbox(m, W, H); if (!b) return new BM();
  const w = b[2] - b[0], h = b[3] - b[1], d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) d.set(m.subarray((y + b[1]) * W + b[0], (y + b[1]) * W + b[2]), y * w);
  return new BM(b[0], b[1], w, h, d);
}
export function fromCrop(sub, box) {               // a crop (box) -> tight box mask
  const cw = box[2] - box[0], ch = box[3] - box[1]; const b = I.bbox(sub, cw, ch); if (!b) return new BM();
  const w = b[2] - b[0], h = b[3] - b[1], d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) d.set(sub.subarray((y + b[1]) * cw + b[0], (y + b[1]) * cw + b[2]), y * w);
  return new BM(box[0] + b[0], box[1] + b[1], w, h, d);
}
export function toFull(a, W, H, out = null) {
  const o = out || new Uint8Array(W * H); if (!a || a.empty) return o;
  for (let y = 0; y < a.h; y++) o.set(a.d.subarray(y * a.w, (y + 1) * a.w), (y + a.y0) * W + a.x0);
  return o;
}
export function orInto(full, a, W) { if (!a || a.empty) return full; for (let y = 0; y < a.h; y++) { const r = (y + a.y0) * W + a.x0, s = y * a.w; for (let x = 0; x < a.w; x++) full[r + x] |= a.d[s + x]; } return full; }
export function andNotInto(full, a, W) { if (!a || a.empty) return full; for (let y = 0; y < a.h; y++) { const r = (y + a.y0) * W + a.x0, s = y * a.w; for (let x = 0; x < a.w; x++) if (a.d[s + x]) full[r + x] = 0; } return full; }
export function crop(a, box) {                     // the mask's pixels inside box, as a box-sized array
  const cw = box[2] - box[0], ch = box[3] - box[1], o = new Uint8Array(cw * ch); if (!a || a.empty) return o;
  const x0 = Math.max(box[0], a.x0), x1 = Math.min(box[2], a.x1), y0 = Math.max(box[1], a.y0), y1 = Math.min(box[3], a.y1);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) o[(y - box[1]) * cw + x - box[0]] = a.d[(y - a.y0) * a.w + x - a.x0];
  return o;
}
export function count(a) { if (!a || a.empty) return 0; let n = 0; for (let i = 0; i < a.d.length; i++) n += a.d[i]; return n; }
export function any(a) { if (!a || a.empty) return false; for (let i = 0; i < a.d.length; i++) if (a.d[i]) return true; return false; }
export function get(a, x, y) { return a && !a.empty && x >= a.x0 && x < a.x1 && y >= a.y0 && y < a.y1 ? a.d[(y - a.y0) * a.w + x - a.x0] : 0; }
export function union(list) {                      // box mask of several box masks
  let b = null; for (const a of list) { if (!a || a.empty) continue; b = b ? [Math.min(b[0], a.x0), Math.min(b[1], a.y0), Math.max(b[2], a.x1), Math.max(b[3], a.y1)] : [a.x0, a.y0, a.x1, a.y1]; }
  if (!b) return new BM(); const w = b[2] - b[0], o = new Uint8Array(w * (b[3] - b[1]));
  for (const a of list) { if (!a || a.empty) continue; for (let y = 0; y < a.h; y++) { const r = (y + a.y0 - b[1]) * w + a.x0 - b[0], s = y * a.w; for (let x = 0; x < a.w; x++) o[r + x] |= a.d[s + x]; } }
  return fromCrop(o, b);
}
export const or = (a, b) => union([a, b]);
export function andNot(a, b) {                     // a & ~b
  if (!a || a.empty) return new BM(); const o = a.d.slice();
  if (b && !b.empty) for (let y = Math.max(a.y0, b.y0); y < Math.min(a.y1, b.y1); y++) for (let x = Math.max(a.x0, b.x0); x < Math.min(a.x1, b.x1); x++) if (b.d[(y - b.y0) * b.w + x - b.x0]) o[(y - a.y0) * a.w + x - a.x0] = 0;
  return fromCrop(o, [a.x0, a.y0, a.x1, a.y1]);
}
export function and(a, b) {
  if (!a || a.empty || !b || b.empty) return new BM();
  const x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1), y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y1, b.y1); if (x1 <= x0 || y1 <= y0) return new BM();
  const w = x1 - x0, o = new Uint8Array(w * (y1 - y0));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) o[(y - y0) * w + x - x0] = a.d[(y - a.y0) * a.w + x - a.x0] & b.d[(y - b.y0) * b.w + x - b.x0];
  return fromCrop(o, [x0, y0, x1, y1]);
}
export function andFull(a, full, W) { if (!a || a.empty) return new BM(); const o = a.d.slice(); for (let y = 0; y < a.h; y++) { const r = (y + a.y0) * W + a.x0; for (let x = 0; x < a.w; x++) o[y * a.w + x] &= full[r + x]; } return fromCrop(o, [a.x0, a.y0, a.x1, a.y1]); }
export function andNotFull(a, full, W) { if (!a || a.empty) return new BM(); const o = a.d.slice(); for (let y = 0; y < a.h; y++) { const r = (y + a.y0) * W + a.x0; for (let x = 0; x < a.w; x++) if (full[r + x]) o[y * a.w + x] = 0; } return fromCrop(o, [a.x0, a.y0, a.x1, a.y1]); }
export function countAndFull(a, full, W) { if (!a || a.empty) return 0; let n = 0; for (let y = 0; y < a.h; y++) { const r = (y + a.y0) * W + a.x0; for (let x = 0; x < a.w; x++) n += a.d[y * a.w + x] & full[r + x]; } return n; }
export function countAnd(a, b) { if (!a || a.empty || !b || b.empty) return 0; let n = 0; for (let y = Math.max(a.y0, b.y0); y < Math.min(a.y1, b.y1); y++) for (let x = Math.max(a.x0, b.x0); x < Math.min(a.x1, b.x1); x++) n += a.d[(y - a.y0) * a.w + x - a.x0] & b.d[(y - b.y0) * b.w + x - b.x0]; return n; }
export function pad(a, r, W, H) { return a.empty ? null : [Math.max(0, a.x0 - r), Math.max(0, a.y0 - r), Math.min(W, a.x1 + r), Math.min(H, a.y1 + r)]; }
// morphology on the box only (same result as on the full picture)
export function dil(a, r, W, H) { if (!a || a.empty) return new BM(); const b = pad(a, r + 1, W, H), cw = b[2] - b[0], ch = b[3] - b[1]; return fromCrop(I.dil(crop(a, b), cw, ch, r), b); }
export function dilK(a, k, W, H) { if (!a || a.empty) return new BM(); const r = Math.max((k.length - 1) >> 1, Math.max(...k)); const b = pad(a, r + 1, W, H), cw = b[2] - b[0], ch = b[3] - b[1]; return fromCrop(I.dilate(crop(a, b), cw, ch, k), b); }
// erosion: the result lies inside the box; a margin as wide as the kernel is enough (inside the picture it is empty,
// at the picture's edge img.erode already counts the outside as set, like cv2)
export function ero(a, r, W, H) { return eroK(a, I.ellipse(r), W, H); }
export function eroK(a, k, W, H) {
  if (!a || a.empty) return new BM(); const R = Math.max((k.length - 1) >> 1, Math.max(...k));
  const b = pad(a, R + 1, W, H), cw = b[2] - b[0], ch = b[3] - b[1]; return fromCrop(I.erode(crop(a, b), cw, ch, k), b);
}
export function openK(a, k, W, H) { return dilK(eroK(a, k, W, H), k, W, H); }
export function closeK(a, k, W, H) { return eroK(dilK(a, k, W, H), k, W, H); }
export function bmBox(a) { return a && !a.empty ? [a.x0, a.y0, a.x1, a.y1] : null; }
export function boxUnion(...bs) { let b = null; for (const x of bs) { if (!x) continue; b = b ? [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])] : x.slice(); } return b; }
export function boxPad(b, r, W, H) { return b ? [Math.max(0, b[0] - r), Math.max(0, b[1] - r), Math.min(W, b[2] + r), Math.min(H, b[3] + r)] : null; }
export function boxesTouch(a, b, gap = 0) { return a && b && !(a[0] >= b[2] + gap || b[0] >= a[2] + gap || a[1] >= b[3] + gap || b[1] >= a[3] + gap); }
