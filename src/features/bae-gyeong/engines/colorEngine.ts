/**
 * BAE경 색 엔진 (팔레트 + 색 맞춤 v6). HTML v0.4.11 script_4.js 의 COLOR_WORKER_SRC 를 계산 그대로 옮긴 순수 함수 (DOM 없음).
 *   - palette: 그림의 단색들 (Lab k-means). 부품 시트 · 그림판의 색 견본.
 *   - lock (색 맞춤 v6): 새 그림의 넓은 단색 면 중 기준 배경의 단색과 같은 재질인 면을 그 색으로 옮긴다. 평평하게 만들지 않고
 *     그 색 묶음의 모든 픽셀을 같은 RGB 만큼 옮겨서 판자 줄 · 패널 · 부드러운 가장자리의 대비는 그대로 (color_lock.py v6 의 JS 판).
 * 스레드는 colorWorker.ts, 화면 쪽 호출은 index.ts. 숫자 · 순서 · 배열 종류(Float32 / Float64)를 바꾸면 결과가 HTML 과 달라진다.
 * 아래쪽의 swHex · nearHex · baseSwatches · sheetSwatches 는 HTML 814~818줄 (기준 배경 색 견본).
 */
import type { BaePlaceBase } from '@/shared/bae/place/types';

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; }
const fl = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
type Num3 = { [i: number]: number };
/** skimage rgb2lab (D65, 2도) */
export function rgbLab(r: number, g: number, b: number, out: Num3, o: number): void {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const x = fl((0.412453 * R + 0.357580 * G + 0.180423 * B) / 0.95047), y = fl(0.212671 * R + 0.715160 * G + 0.072169 * B), z = fl((0.019334 * R + 0.119193 * G + 0.950227 * B) / 1.08883);
  out[o] = 116 * y - 16; out[o + 1] = 500 * (x - y); out[o + 2] = 200 * (y - z);
}
export function labOf(rgb: ArrayLike<number>): number[] { const o = [0, 0, 0]; rgbLab(rgb[0], rgb[1], rgb[2], o, 0); return o; }
export function toLab(px: ArrayLike<number>, n: number): Float32Array { const L = new Float32Array(n * 3), t = [0, 0, 0]; for (let i = 0; i < n; i++) { rgbLab(px[i * 3], px[i * 3 + 1], px[i * 3 + 2], t, 0); L[i * 3] = t[0]; L[i * 3 + 1] = t[1]; L[i * 3 + 2] = t[2]; } return L; }
const D2R = Math.PI / 180;
/** skimage deltaE_ciede2000, kL = kC = kH = 1 */
export function de2000(l1: readonly number[], l2: readonly number[]): number {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  let Cbar = 0.5 * (Math.hypot(a1, b1) + Math.hypot(a2, b2)); let c7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(c7 / (c7 + Math.pow(25, 7)))), s = 1 + G;
  const pol = (x: number, y: number): [number, number] => { let t = Math.atan2(y, x); if (t < 0) t += 2 * Math.PI; return [Math.hypot(x, y), t]; };
  const [C1, h1] = pol(a1 * s, b1), [C2, h2] = pol(a2 * s, b2);
  const Lbar = 0.5 * (L1 + L2), tmp = (Lbar - 50) * (Lbar - 50), SL = 1 + 0.015 * tmp / Math.sqrt(20 + tmp), Lt = (L2 - L1) / SL;
  Cbar = 0.5 * (C1 + C2); const SC = 1 + 0.045 * Cbar, Ct = (C2 - C1) / SC;
  const hd = h2 - h1, hs = h1 + h2, CC = C1 * C2;
  let dH = hd; if (hd > Math.PI) dH -= 2 * Math.PI; if (hd < -Math.PI) dH += 2 * Math.PI; if (CC === 0) dH = 0;
  const dHt = 2 * Math.sqrt(CC) * Math.sin(dH / 2);
  let Hbar = hs; if (CC !== 0 && Math.abs(hd) > Math.PI) Hbar += hs < 2 * Math.PI ? 2 * Math.PI : -2 * Math.PI; if (CC === 0) Hbar *= 2; Hbar *= 0.5;
  const T = 1 - 0.17 * Math.cos(Hbar - 30 * D2R) + 0.24 * Math.cos(2 * Hbar) + 0.32 * Math.cos(3 * Hbar + 6 * D2R) - 0.20 * Math.cos(4 * Hbar - 63 * D2R);
  const SH = 1 + 0.015 * Cbar * T, Ht = dHt / SH;
  c7 = Math.pow(Cbar, 7); const Rc = 2 * Math.sqrt(c7 / (c7 + Math.pow(25, 7)));
  const dth = 30 * D2R * Math.exp(-Math.pow((Hbar / D2R - 275) / 25, 2)), Rt = -Math.sin(2 * dth) * Rc * Ct * Ht;
  return Math.sqrt(Math.max(Lt * Lt + Ct * Ct + Ht * Ht + Rt, 0));
}
export function rng(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Lab k-means (k-means++ 시작, 몇 번 해서 가장 좋은 것), cv2.kmeans(..., KMEANS_PP_CENTERS) 처럼 */
export function kmeans(S: Float64Array, n: number, k: number, rand: () => number, attempts = 3, maxIt = 50, eps = 0.2): Float64Array {
  let best: Float64Array | null = null, bestScore = Infinity; const lbl = new Int32Array(n), d = new Float64Array(n);
  for (let at = 0; at < attempts; at++) {
    const C = new Float64Array(k * 3); const f = Math.floor(rand() * n); C[0] = S[f * 3]; C[1] = S[f * 3 + 1]; C[2] = S[f * 3 + 2];
    for (let i = 0; i < n; i++) { const x = S[i * 3] - C[0], y = S[i * 3 + 1] - C[1], z = S[i * 3 + 2] - C[2]; d[i] = x * x + y * y + z * z; }
    for (let c = 1; c < k; c++) {
      let sum = 0; for (let i = 0; i < n; i++) sum += d[i];
      let r = rand() * sum, pick = n - 1; for (let i = 0; i < n; i++) { r -= d[i]; if (r <= 0) { pick = i; break; } }
      C[c * 3] = S[pick * 3]; C[c * 3 + 1] = S[pick * 3 + 1]; C[c * 3 + 2] = S[pick * 3 + 2];
      for (let i = 0; i < n; i++) { const x = S[i * 3] - C[c * 3], y = S[i * 3 + 1] - C[c * 3 + 1], z = S[i * 3 + 2] - C[c * 3 + 2]; const e = x * x + y * y + z * z; if (e < d[i]) d[i] = e; }
    }
    let score = 0;
    for (let it = 0; it < maxIt; it++) {
      score = 0;
      for (let i = 0; i < n; i++) {
        let bj = 0, bd = Infinity; const p = S[i * 3], q = S[i * 3 + 1], s = S[i * 3 + 2];
        for (let c = 0; c < k; c++) { const x = p - C[c * 3], y = q - C[c * 3 + 1], z = s - C[c * 3 + 2]; const e = x * x + y * y + z * z; if (e < bd) { bd = e; bj = c; } }
        lbl[i] = bj; score += bd;
      }
      const acc = new Float64Array(k * 3), cnt = new Float64Array(k);
      for (let i = 0; i < n; i++) { const c = lbl[i]; acc[c * 3] += S[i * 3]; acc[c * 3 + 1] += S[i * 3 + 1]; acc[c * 3 + 2] += S[i * 3 + 2]; cnt[c]++; }
      let shift = 0;
      for (let c = 0; c < k; c++) {
        if (!cnt[c]) { const j = Math.floor(rand() * n); acc[c * 3] = S[j * 3]; acc[c * 3 + 1] = S[j * 3 + 1]; acc[c * 3 + 2] = S[j * 3 + 2]; cnt[c] = 1; }   // 빈 묶음은 아무 표본에서 다시
        const x = acc[c * 3] / cnt[c], y = acc[c * 3 + 1] / cnt[c], z = acc[c * 3 + 2] / cnt[c];
        const e = (x - C[c * 3]) ** 2 + (y - C[c * 3 + 1]) ** 2 + (z - C[c * 3 + 2]) ** 2; if (e > shift) shift = e;
        C[c * 3] = x; C[c * 3 + 1] = y; C[c * 3 + 2] = z;
      }
      if (shift <= eps * eps) break;
    }
    if (score < bestScore) { bestScore = score; best = C; }
  }
  return best as Float64Array;
}

/** k-means 묶음 하나: 정확한 단색 = 가장 흔한 RGB 값, mean = 그 색 2 Lab 안의 평평한 부분만의 평균 */
export interface ColorGroup { j: number; share: number; rgb: number[]; lab: number[]; mean: number[]; big: boolean }
export interface ColorGroups { lab: Float32Array; C: Float64Array; k: number; o1: Uint8Array; o2: Uint8Array; d1: Float32Array; d2: Float32Array; G: Array<ColorGroup | null> }
export interface GroupOpts { minShare?: number; seed?: number; sample?: number; attempts?: number }
/* 그림의 단색: k-means 묶음마다 정확한 단색은 가장 흔한 RGB, 평균은 그 색에서 2 Lab 안의 평평한 부분만으로 (부드러운 가장자리에 끌리지 않게).
   px: 쓸 픽셀의 RGB 바이트 (픽셀당 3), n 개 */
export function groups(px: ArrayLike<number>, n: number, k: number, opts: GroupOpts = {}): ColorGroups {
  const minShare = opts.minShare == null ? 0.005 : opts.minShare, rand = rng(opts.seed || 1), sample = opts.sample || 90000;
  const lab = toLab(px, n); const m = Math.min(n, sample); const S = new Float64Array(m * 3);
  if (m === n) S.set(lab); else for (let i = 0; i < m; i++) { const j = Math.floor(rand() * n); S[i * 3] = lab[j * 3]; S[i * 3 + 1] = lab[j * 3 + 1]; S[i * 3 + 2] = lab[j * 3 + 2]; }
  const kk = Math.max(1, Math.min(k, m)); const C = kmeans(S, m, kk, rand, opts.attempts || 3);
  // 픽셀마다 가장 가까운 묶음과 두 번째 묶음 (두 번째는 lock() 의 부드러운 가장자리용)
  const o1 = new Uint8Array(n), o2 = new Uint8Array(n), d1 = new Float32Array(n), d2 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = lab[i * 3], q = lab[i * 3 + 1], s = lab[i * 3 + 2]; let a = 0, ad = Infinity, b = 0, bd = Infinity;
    for (let c = 0; c < kk; c++) { const x = p - C[c * 3], y = q - C[c * 3 + 1], z = s - C[c * 3 + 2]; const e = x * x + y * y + z * z; if (e < ad) { b = a; bd = ad; a = c; ad = e; } else if (e < bd) { b = c; bd = e; } }
    o1[i] = a; o2[i] = kk > 1 ? b : a; d1[i] = ad; d2[i] = kk > 1 ? bd : ad;
  }
  // 묶음마다 가장 흔한 정확한 RGB: (묶음, rgb) 키를 정렬해 같은 값의 길이를 센다
  const key = new Int32Array(n); for (let i = 0; i < n; i++) key[i] = (o1[i] << 24) | (px[i * 3] << 16) | (px[i * 3 + 1] << 8) | px[i * 3 + 2];
  key.sort(); const mode = new Int32Array(kk).fill(-1), modeN = new Int32Array(kk), cnt = new Int32Array(kk);
  for (let i = 0; i < n;) { let j = i; while (j < n && key[j] === key[i]) j++; const g = key[i] >>> 24; cnt[g] += j - i; if (j - i > modeN[g]) { modeN[g] = j - i; mode[g] = key[i] & 0xFFFFFF; } i = j; }
  const mlab: Array<number[] | null> = []; const G: Array<ColorGroup | null> = [];
  for (let g = 0; g < kk; g++) mlab.push(mode[g] < 0 ? null : labOf([(mode[g] >> 16) & 255, (mode[g] >> 8) & 255, mode[g] & 255]));
  const sum = new Float64Array(kk * 3), core = new Float64Array(kk);
  for (let i = 0; i < n; i++) {
    const g = o1[i], ml = mlab[g]; if (!ml) continue;
    const x = lab[i * 3] - ml[0], y = lab[i * 3 + 1] - ml[1], z = lab[i * 3 + 2] - ml[2];
    if (x * x + y * y + z * z < 4) { sum[g * 3] += px[i * 3]; sum[g * 3 + 1] += px[i * 3 + 1]; sum[g * 3 + 2] += px[i * 3 + 2]; core[g]++; }
  }
  for (let g = 0; g < kk; g++) {
    if (!cnt[g]) { G.push(null); continue; }
    const rgb = [(mode[g] >> 16) & 255, (mode[g] >> 8) & 255, mode[g] & 255];
    G.push({ j: g, share: cnt[g] / n, rgb, lab: mlab[g] as number[], mean: core[g] ? [sum[g * 3] / core[g], sum[g * 3 + 1] / core[g], sum[g * 3 + 2] / core[g]] : rgb.slice(), big: cnt[g] / n >= minShare });
  }
  return { lab, C, k: kk, o1, o2, d1, d2, G };
}

/** 단색 하나 = 정확한 색끼리 CIEDE2000 `close` 안인 묶음들. to · dE · why 는 lock() 이 쓴다. */
export interface FlatColor { members: ColorGroup[]; share: number; rgb: number[]; lab: number[]; mean: number[]; to?: FlatColor | null; dE?: number | null; why?: string }
export function merge(G0: Array<ColorGroup | null>, close: number): FlatColor[] {
  const G = G0.filter(Boolean) as ColorGroup[]; const parent = G.map((_, i) => i);
  const root = (i: number) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < G.length; i++) for (let j = i + 1; j < G.length; j++) if (de2000(G[i].lab, G[j].lab) < close) parent[root(i)] = root(j);
  const F = new Map<number, ColorGroup[]>(); G.forEach((g, i) => { const r = root(i); if (!F.has(r)) F.set(r, []); (F.get(r) as ColorGroup[]).push(g); });
  return [...F.values()].map((members) => { const head = members.reduce((a, b) => b.share > a.share ? b : a); return { members, share: members.reduce((s, g) => s + g.share, 0), rgb: head.rgb, lab: head.lab, mean: head.mean }; });
}

/** 상자: (x0, y0, x1, y1) 그림에 대한 비율 */
export type ColorBox = [number, number, number, number];
export interface PaletteOpts { skip?: ColorBox[]; k?: number; seed?: number; sample?: number; attempts?: number; close?: number; minShare?: number; minL?: number; top?: number }
export interface PaletteColor { rgb: number[]; share: number; L: number }
/** 색 견본용 그림의 단색: skip 상자 안의 픽셀과 반투명 픽셀(알파 128 미만)은 뺀다 */
export function palette(rgba: ArrayLike<number>, w: number, h: number, opts: PaletteOpts = {}): PaletteColor[] {
  const skip = opts.skip || []; const px = new Uint8Array(w * h * 3); let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / w, v = (y + 0.5) / h; if (skip.some((b) => u >= b[0] && u <= b[2] && v >= b[1] && v <= b[3])) continue;
    const i = (y * w + x) * 4; if (rgba[i + 3] < 128) continue; px[n * 3] = rgba[i]; px[n * 3 + 1] = rgba[i + 1]; px[n * 3 + 2] = rgba[i + 2]; n++;
  }
  if (n < 50) return [];
  const R = groups(px, n, opts.k || 24, { seed: opts.seed || 3, sample: opts.sample || 40000, attempts: opts.attempts || 2, minShare: 0 });
  const all = merge(R.G, opts.close || 2).sort((a, b) => b.share - a.share), keep: FlatColor[] = [];
  for (const f of all) {
    if (f.share < (opts.minShare || 0.006) || f.lab[0] < (opts.minL == null ? 18 : opts.minL)) continue;
    if (keep.some((g) => g.share >= 3 * f.share && de2000(g.lab, f.lab) < 3.5)) continue;   // 더 큰 색의 한 톤 (판자의 어두운 톤)
    keep.push(f); if (keep.length >= (opts.top || 6)) break;
  }
  return keep.map((f) => ({ rgb: f.rgb, share: Math.round(f.share * 1000) / 1000, L: Math.round(f.lab[0]) }));
}

export interface LockOpts { match?: number; surf?: number }
export type LockMoved = { from: number[]; to: number[]; dE: number; share: number };
export type LockKept = { rgb: number[]; dE: number | null; share: number; why: string };
/** 색 맞춤 결과 정보: flatA = 기준 배경의 넓은 단색 수, flat = 새 그림의 넓은 단색 수, moved = 옮긴 면, kept = 그대로 둔 면 */
export type LockInfo = { flatA: number; flat: number; moved: LockMoved[]; kept: LockKept[] };
/* 색 맞춤 v6. ref: 기준 배경들의 RGB 바이트 (이미 약 1/3 로 줄인 것), img: 새 그림의 RGB 바이트.
   stats: 큰 그림일 때 묶음을 만들 작은 사본 */
export function lock(ref: ArrayLike<number>, nRef: number, img: ArrayLike<number>, n: number, opt: LockOpts = {}, stats: { px: Uint8Array; n: number } | null = null): { out: Uint8ClampedArray; info: LockInfo } {
  const match = opt.match || 3.0, surf = opt.surf || 0.02, guardClose = 1.5, guardApart = 2.5, family = 15.0;
  const RA = groups(ref, nRef, 28, { seed: 1, sample: 80000 });
  const A = merge(RA.G.filter((g) => g && g.big), 1.5);
  const R = stats ? groups(stats.px, stats.n, 32, { seed: 1, sample: 90000 }) : groups(img, n, 32, { seed: 1, sample: 90000 }); const F = merge(R.G.filter(Boolean), 2.0);
  for (const f of F) {
    f.to = null; f.dE = null;
    if (f.share < 0.005 || f.share < surf) continue;    // 넓은 면(벽 · 바닥 · 하늘 · 큰 가구)만 맞춘다
    const cand = A.filter((a) => a.share >= surf); if (!cand.length) continue;
    const near = cand.map((a) => ({ a, e: de2000(f.lab, a.lab) })).sort((x, y) => x.e - y.e); f.dE = near[0].e;
    if (near[0].e >= match) continue;
    // 넓은 면의 한 톤(바닥의 어두운 판자 톤)이 아주 조금 더 가까울 수 있다: 그땐 넓은 면이 이긴다
    let pick = near[0]; for (const x of near) if (x.e < match && x.a.share >= 4 * pick.a.share && x.e <= near[0].e + 0.6) pick = x;
    f.to = pick.a; f.dE = pick.e;
  }
  for (const f of F) {   // A 의 색 하나는 면 하나에게: 넓고도 가까운 쪽
    if (!f.to) continue;
    for (const h of F) { if (h === f || h.to !== f.to || de2000(f.lab, h.lab) <= guardApart) continue; if (h.share * (match - (h.dE as number)) > f.share * (match - (f.dE as number))) { f.to = null; f.why = 'another surface took this color'; break; } }
  }
  for (const f of F.slice().sort((a, b) => b.share - a.share)) {   // 대비 지킴, 넓은 것부터: 두 면을 한 색으로 만들지 않는다
    if (!f.to) continue;
    for (const h of F) { if (h === f || h.share < 0.005) continue; const hn = h.to ? h.to.lab : h.lab; if (de2000(f.lab, h.lab) > guardApart && de2000(f.to.lab, hn) < guardClose) { f.to = null; f.why = 'would merge with another surface'; break; } }
  }
  const k = R.k, off = new Float64Array(k * 3), moved = new Uint8Array(k);
  for (const f of F) { if (!f.to) continue; for (const g of f.members) { off[g.j * 3] = f.to.mean[0] - g.mean[0]; off[g.j * 3 + 1] = f.to.mean[1] - g.mean[1]; off[g.j * 3 + 2] = f.to.mean[2] - g.mean[2]; moved[g.j] = 1; } }
  const idx: number[] = []; for (let j = 0; j < k; j++) if (moved[j]) idx.push(j);
  const kept = new Set<number>(); for (const f of F) if (!f.to && f.share >= 0.005) for (const g of f.members) kept.add(g.j);   // 맞추지 않은 넓은 면은 그대로
  const C = R.C; const offF = Float64Array.from(off);
  for (let j = 0; j < k; j++) {   // 작은 무늬는 제 면과 같이 움직인다 (바닥과 판자 줄)
    if (moved[j] || kept.has(j) || !idx.length) continue;
    let bi = -1, bd = Infinity; for (const i of idx) { const e = Math.hypot(C[i * 3] - C[j * 3], C[i * 3 + 1] - C[j * 3 + 1], C[i * 3 + 2] - C[j * 3 + 2]); if (e < bd) { bd = e; bi = i; } }
    if (bd < family) { offF[j * 3] = off[bi * 3]; offF[j * 3 + 1] = off[bi * 3 + 1]; offF[j * 3 + 2] = off[bi * 3 + 2]; }
  }
  const out = new Uint8ClampedArray(n * 3); const L3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    let a: number, b: number, e1: number, e2: number;
    if (!stats) { a = R.o1[i]; b = R.o2[i]; e1 = R.d1[i]; e2 = R.d2[i]; }
    else {   // 묶음은 작은 사본에서 왔다: 이 픽셀의 가까운 두 묶음을 여기서 찾는다
      rgbLab(img[i * 3], img[i * 3 + 1], img[i * 3 + 2], L3, 0); a = 0; b = 0; e1 = Infinity; e2 = Infinity;
      for (let c = 0; c < k; c++) { const x = L3[0] - C[c * 3], y = L3[1] - C[c * 3 + 1], z = L3[2] - C[c * 3 + 2]; const e = x * x + y * y + z * z; if (e < e1) { b = a; e2 = e1; a = c; e1 = e; } else if (e < e2) { b = c; e2 = e; } }
      if (k < 2) { b = a; e2 = e1; }
    }
    const t = Math.min(1, Math.max(0, (Math.sqrt(e2) - Math.sqrt(e1)) / 4)); const w1 = 0.5 + 0.5 * t, w2 = 1 - w1;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(img[i * 3 + c] + w1 * offF[a * 3 + c] + w2 * offF[b * 3 + c]);
  }
  const big = F.filter((f) => f.share >= 0.005);
  const info: LockInfo = { flatA: A.length, flat: big.length,
    moved: big.filter((f) => f.to).map((f) => ({ from: f.rgb, to: (f.to as FlatColor).rgb, dE: Math.round((f.dE as number) * 100) / 100, share: Math.round(f.share * 1000) / 1000 })),
    kept: big.filter((f) => !f.to).map((f) => ({ rgb: f.rgb, dE: f.dE == null ? null : Math.round(f.dE * 100) / 100, share: Math.round(f.share * 1000) / 1000, why: f.why || 'no match' })) };
  return { out, info };
}
export const rgbaToRgb = (d: ArrayLike<number>, n: number): Uint8Array => { const o = new Uint8Array(n * 3); for (let i = 0; i < n; i++) { o[i * 3] = d[i * 4]; o[i * 3 + 1] = d[i * 4 + 1]; o[i * 3 + 2] = d[i * 4 + 2]; } return o; };

/** RGBA 픽셀 묶음 (ImageData 와 같은 모양) */
export interface RgbaImage { data: Uint8ClampedArray | Uint8Array; w: number; h: number }
/** HTML 색 워커의 'lock' 일 그대로: RGBA 두 장 → 색 맞춘 RGBA (알파 255). 180만 픽셀이 넘는 그림은 두 칸마다 한 픽셀로 묶음을 만들고 색은 모든 픽셀에서 옮긴다. */
export function lockRgba(ref: RgbaImage, img: RgbaImage, opts: LockOpts = {}): { data: Uint8ClampedArray; w: number; h: number; info: LockInfo } {
  const nR = ref.w * ref.h, n = img.w * img.h;
  const rgb = rgbaToRgb(img.data, n); let stats: { px: Uint8Array; n: number } | null = null;
  if (n > 1800000) {
    const w2 = Math.floor(img.w / 2), h2 = Math.floor(img.h / 2), px = new Uint8Array(w2 * h2 * 3);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) { const s = ((y * 2) * img.w + x * 2) * 3, o = (y * w2 + x) * 3; px[o] = rgb[s]; px[o + 1] = rgb[s + 1]; px[o + 2] = rgb[s + 2]; }
    stats = { px, n: w2 * h2 };
  }
  const { out, info } = lock(rgbaToRgb(ref.data, nR), nR, rgb, n, opts, stats);
  const rgba = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1]; rgba[i * 4 + 2] = out[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  return { data: rgba, w: img.w, h: img.h, info };
}

/* ---------- 기준 배경 색 견본 (HTML 180~181, 814~818줄) ---------- */
export function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h) || [0, '000000']; const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** '#RRGGBB' (HTML rgbToHex 처럼 대문자) */
export const rgbToHex = (r: number, g: number, b: number): string => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
/** HTML swHex */
export const swHex = (c: ArrayLike<number>): string => rgbToHex(c[0], c[1], c[2]);
/** HTML nearHex: RGB 차이 합이 10 미만이면 같은 색으로 본다 */
export const nearHex = (a: string, b: string): boolean => { const x = hexToRgb(a), y = hexToRgb(b); return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) < 10; };
/** HTML baseSwatches(b): 엔진이 고른 색 + 사람이 더한 색 - 사람이 끈 색. Bflow 에서는 sw.auto 가 이미 '#RRGGBB' 문자열이다. */
export function baseSwatches(b: Pick<BaePlaceBase, 'sw'>): string[] {
  const off = new Set(b.sw.off); return [...new Set((b.sw.auto || []).concat(b.sw.add))].filter((h) => !off.has(h));
}
/** HTML sheetSwatches(): 모든 기준 배경의 견본에서 서로 가까운 색을 빼고 8개까지 */
export function sheetSwatches(bases: ReadonlyArray<Pick<BaePlaceBase, 'sw'>>): string[] {
  const out: string[] = []; for (const b of bases) for (const h of baseSwatches(b)) if (!out.some((o) => nearHex(o, h))) out.push(h);
  return out.slice(0, 8);
}
