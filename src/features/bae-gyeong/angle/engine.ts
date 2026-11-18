/**
 * BAE경 '다른 각도로' 엔진 (HTML v0.4.11 script_4.js 2748~3172줄의 ANG 를 계산 그대로). 순수 계산 — DOM 도 WebGL 도 없다.
 *
 * 완성된 배경 한 장 → 입체 판(2.5D 세트): 깊이 모델의 disparity 를 바닥 줄(배경의 아래쪽 줄은 눈높이 카메라에서 본 바닥)로 미터로 바꾸고,
 * 그림을 깊이가 뛰는 곳에서 끊긴 그물로 만든 다음, 새 카메라에서 다시 본다. 실험 1 방법 2 (prep_place.py, 2026-10-24) 의 JS 판.
 * 세계: 카메라 A(그림을 그린 카메라)가 원점에서 -z 를 본다, y 위, 미터.
 *
 * 숫자 · 순서 · 배열 종류(Float32 / Float64, Math.fround)를 바꾸면 HTML 과 결과가 달라진다 (tests/baeGyeongAngleEngine.test.ts 가 HTML 원본과 견준다).
 * 주문서 글은 src/shared/bae/angle/order.ts (메인과 같이 쓴다).
 */
import { ANGLE_KIND, ANGLE_PRESET_LABEL, ANGLE_UNDER, anglePromptText, angleMEn, angleMKo, type AngleKind, type AnglePreset, type AnglePromptOpts } from '@/shared/bae/angle/order';

export type Vec3 = [number, number, number];
export interface AngleExt { xmin?: number; xmax?: number; zmax?: number }
/** 입체 판 (HTML ANG.build 의 답). ext 는 창이 더한 그림의 카메라 자리로 넣는다. */
export interface AngleSet {
  v: 1; kind: AngleKind; W: number; H: number; w: number; h: number; f: number; cx: number; cy: number; camH: number; hfov: number; ZMAX: number;
  Zp: number; Zback: number; xmin: number; xmax: number; ytop: number; pivot: Vec3; fit: [number, number]; fitOk: boolean; anchors: Array<[number, number]> | null;
  R: number; C: number; pos: Float32Array; uv: Float32Array; idx: Uint32Array; ntri: number; vfov: number;
  ext?: AngleExt | null;
}
/** 카메라: 자리 · 보는 곳 · 바로 고르기 이름. 투시만 바꾸기는 shift (화면 -1..1). */
export interface AngleCam { pos: Vec3; target: Vec3; preset: AnglePreset | null; shift?: [number, number] }
export interface AngleBuildOpts { kind?: AngleKind | string; hfov?: number; h?: number; anchors?: Array<[number, number]> | null }
export interface AngleInfo { orbit: number; dist: number; pitch: number; pan: number; yaw: number; floorH: number; eyeH: number; dy: number; move: number }
export interface AngleView {
  eye: Vec3; tgt: Vec3; fovy: number; w: number; h: number; fw: Vec3; r: Vec3; u: Vec3; tx: number; ty: number; sx: number; sy: number; mvp: Float32Array;
  project(p: Vec3 | number[]): [number, number, number] | null;
  ray(px: number, py: number): Vec3;
}
export interface AnglePose { pos: Vec3; yaw: number; s?: number }
export interface AnglePart { box: [number, number, number, number]; area: number; seen: number }

const WORK = 2048, STEP = 4;   // the working picture's long side (the experiment's 2048 x 1152) and the mesh step (~512 columns)
const KIND = ANGLE_KIND;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const fr = Math.fround;

// the model's disparity (dw x dh, squashed over the whole picture) at a working pixel, like PIL's bilinear resize
function sampler(disp: ArrayLike<number>, dw: number, dh: number, W: number, H: number): (x: number, y: number) => number {
  const sx = dw / W, sy = dh / H;
  return (x, y) => {
    let u = (x + 0.5) * sx - 0.5, v = (y + 0.5) * sy - 0.5;
    u = u < 0 ? 0 : u > dw - 1 ? dw - 1 : u; v = v < 0 ? 0 : v > dh - 1 ? dh - 1 : v;
    const u0 = Math.floor(u), v0 = Math.floor(v), u1 = u0 + 1 < dw ? u0 + 1 : u0, v1 = v0 + 1 < dh ? v0 + 1 : v0, fu = u - u0, fv = v - v0;
    const top = fr(disp[v0 * dw + u0] * (1 - fu) + disp[v0 * dw + u1] * fu), bot = fr(disp[v1 * dw + u0] * (1 - fu) + disp[v1 * dw + u1] * fu);
    return fr(top * (1 - fv) + bot * fv);
  };
}
// numpy's percentile (linear)
function pct(vals: ArrayLike<number>, q: number): number {
  const s = Float64Array.from(vals).sort(), n = s.length; if (!n) return NaN;
  const i = (n - 1) * q / 100, lo = Math.floor(i), hi = Math.min(lo + 1, n - 1); return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
// d = a * (1/Z) + b on the floor rows, least squares, then 3 more passes without the worst 30 % (x 2)
function fitLine(xs: number[], ys: number[]): [number, number] {
  const n0 = xs.length; const keep = new Uint8Array(n0).fill(1); let a = NaN, b = NaN;
  for (let it = 0; it < 4; it++) {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n0; i++) if (keep[i]) { n++; sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    const den = n * sxx - sx * sx; if (n < 3 || !den) break;
    a = (n * sxy - sx * sy) / den; b = (sy - a * sx) / n;
    const r = new Float64Array(n0), rk: number[] = []; for (let i = 0; i < n0; i++) { r[i] = Math.abs(a * xs[i] + b - ys[i]); if (keep[i]) rk.push(r[i]); }
    const lim = pct(rk, 70) * 2 + 1e-9; for (let i = 0; i < n0; i++) keep[i] = r[i] < lim ? 1 : 0;
  }
  return [a, b];
}
function workSize(w: number, h: number): [number, number] { const s = WORK / Math.max(w, h); return [Math.max(16, Math.round(w * s)), Math.max(16, Math.round(h * s))]; }

/* the set. disp: Float32Array (dw x dh); w, h: the picture; o: { kind, hfov (deg, long side), h (eye height, m) } */
/* v0.4.6: o.anchors = [[disparity, metres], ...] for a picture added to another picture's room (its own floor fit is not
   trusted there): 1/z is joined in straight lines between the known distances (see scaleRefs and anchorsFor) */
function build(disp: ArrayLike<number>, dw: number, dh: number, w: number, h: number, o: AngleBuildOpts = {}): AngleSet {
  const kind: AngleKind = o.kind === 'exterior' ? 'exterior' : 'interior', K = KIND[kind];
  const camH = o.h || K.h, hfov = o.hfov || 55, ZMAX = K.zmax;
  const [W, H] = workSize(w, h), f = Math.max(W, H) / (2 * Math.tan(hfov * D2R / 2)), cx = W / 2, cy = H / 2;
  const at = sampler(disp, dw, dh, W, H);
  // the scale: the bottom rows are floor, so there disparity = a * (v - cy) / (f h) + b for a level camera
  const fx: number[] = [], fy: number[] = [];
  for (let v = Math.floor(H * 0.88); v < Math.floor(H * 0.985); v += 3) for (let u = Math.floor(W * 0.15); u < Math.floor(W * 0.85); u += 5) { fx.push((v - cy) / (f * camH)); fy.push(at(u, v)); }
  let [a, b] = fitLine(fx, fy), fitOk = isFinite(a) && isFinite(b) && a > 1e-6;
  if (!fitOk) {   // the bottom is not floor (or the model saw it upside down): a plain scale from the middle of the floor rows
    const ratios: number[] = []; for (let i = 0; i < fx.length; i++) if (fx[i] > 0 && fy[i] > 0) ratios.push(fy[i] / fx[i]);
    a = ratios.length ? pct(ratios, 50) : 1; b = 0; if (!(a > 1e-6)) a = 1;
  }
  const AN = o.anchors && o.anchors.length >= 2 ? o.anchors.map(([d, z]) => [d, 1 / z] as [number, number]).sort((p, q) => p[0] - q[0]) : null;
  if (AN) fitOk = true;
  const invA = (d: number) => { const L = AN as Array<[number, number]>; let i = 0; while (i < L.length - 2 && d > L[i + 1][0]) i++; const [d0, w0] = L[i], [d1, w1] = L[i + 1]; return w0 + (d - d0) * (w1 - w0) / (d1 - d0); };
  const zOf = (d: number) => { const den = AN ? invA(d) : (d - b) / a; const z = den > 1 / ZMAX ? 1 / Math.max(den, 1e-6) : ZMAX; return z < 0.3 ? 0.3 : z > ZMAX ? ZMAX : z; };
  // mesh: one vertex every STEP working pixels, the last row and column on the picture's edge
  const gxs: number[] = [], gys: number[] = [];
  for (let x = 0; x <= W; x += STEP) gxs.push(Math.min(x, W - 1)); if (gxs[gxs.length - 1] < W - 1) gxs.push(W - 1);
  for (let y = 0; y <= H; y += STEP) gys.push(Math.min(y, H - 1)); if (gys[gys.length - 1] < H - 1) gys.push(H - 1);
  const C = gxs.length, R = gys.length, N = R * C;
  const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), Zg = new Float64Array(N), Xg = new Float64Array(N), Yg = new Float64Array(N);
  for (let r = 0, i = 0; r < R; r++) for (let c = 0; c < C; c++, i++) {
    const gx = gxs[c], gy = gys[r], z = zOf(at(gx, gy)), X = (gx - cx) / f * z, Y = -(gy - cy) / f * z;
    Zg[i] = z; Xg[i] = X; Yg[i] = Y; pos[i * 3] = X; pos[i * 3 + 1] = Y; pos[i * 3 + 2] = -z; uv[i * 2] = gx / (W - 1); uv[i * 2 + 1] = 1 - gy / (H - 1);
  }
  // two triangles per cell, kept only where the depth does not jump (far things stay a backdrop, gaps stay open)
  const idx = new Uint32Array((R - 1) * (C - 1) * 6); let n = 0;
  const ok = (p: number, q: number, s: number) => { const zp = Zg[p], zq = Zg[q], zs = Zg[s]; return Math.max(zp, zq, zs) / Math.min(zp, zq, zs) < 1.08; };
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) {
    const q00 = r * C + c, q01 = q00 + 1, q10 = q00 + C, q11 = q10 + 1;
    if (ok(q00, q10, q01)) { idx[n++] = q00; idx[n++] = q10; idx[n++] = q01; }
    if (ok(q01, q10, q11)) { idx[n++] = q01; idx[n++] = q10; idx[n++] = q11; }
  }
  // the place's size: the subject distance (pivot), the back wall, the side walls at standing height
  const region = (r0: number, r1: number, c0: number, c1: number) => { const out = new Float64Array(Math.max(0, (r1 - r0) * (c1 - c0))); let k = 0; for (let y = r0; y < r1; y++) for (let x = c0; x < c1; x++) out[k++] = zOf(at(x, y)); return out; };
  const Zp = pct(region(Math.floor(H * .35), Math.floor(H * .75), Math.floor(W * .35), Math.floor(W * .65)), 50);
  const Zback = Math.max(Zp, pct(region(Math.floor(H * .2), Math.floor(H * .55), Math.floor(W * .3), Math.floor(W * .7)), 85));
  const xsB: number[] = [], ysW: number[] = [];
  for (let i = 0; i < N; i++) {
    if (Yg[i] > -camH + 0.4 && Yg[i] < -camH + 2.0 && Zg[i] > Zp * 0.5 && Zg[i] < Zback * 1.1) xsB.push(Xg[i]);
    if (Zg[i] > Zback * 0.85 && Zg[i] < Zback * 1.15) ysW.push(Yg[i]);
  }
  let xmin = -3, xmax = 3; if (xsB.length > 50) { xmin = pct(xsB, 2); xmax = pct(xsB, 98); }
  if (xmax - xmin < 2) { const m = (xmin + xmax) / 2; xmin = m - 1; xmax = m + 1; }
  const ytop = ysW.length > 50 ? pct(ysW, 98) : 2.0;
  const pivot: Vec3 = [0, -camH + K.ph, -Zp];
  return { v: 1, kind, W, H, w, h, f, cx, cy, camH, hfov, ZMAX, Zp, Zback, xmin, xmax, ytop, pivot, fit: [a, b], fitOk, anchors: AN ? (o.anchors as Array<[number, number]>).map((q) => q.slice() as [number, number]) : null, R, C, pos, uv, idx: idx.subarray(0, n), ntri: n / 3,
    vfov: 2 * Math.atan((H / 2) / f) * R2D };
}

/* ---------- v0.4.6: more pictures of the same place ---------- */
export interface AngleScaleRefs { camH: number; dFloor: number; zFloor: number; dBack: number }
// what a picture says about two of its distances: the floor rows (their distance follows from the eye height, like build's
// own fit) and the back of what it shows (only its disparity: the distance comes from where the picture stands on the plan)
function scaleRefs(disp: ArrayLike<number>, dw: number, dh: number, w: number, h: number, o: AngleBuildOpts = {}): AngleScaleRefs {
  const kind: AngleKind = o.kind === 'exterior' ? 'exterior' : 'interior', camH = o.h || KIND[kind].h, hfov = o.hfov || 55;
  const [W, H] = workSize(w, h), f = Math.max(W, H) / (2 * Math.tan(hfov * D2R / 2)), cy = H / 2, at = sampler(disp, dw, dh, W, H);
  const fx: number[] = [], fy: number[] = [], band: number[] = [];
  for (let v = Math.floor(H * 0.88); v < Math.floor(H * 0.985); v += 3) for (let u = Math.floor(W * 0.15); u < Math.floor(W * 0.85); u += 5) { fx.push((v - cy) / (f * camH)); fy.push(at(u, v)); }
  for (let y = Math.floor(H * .2); y < Math.floor(H * .55); y += 2) for (let x = Math.floor(W * .3); x < Math.floor(W * .7); x += 2) band.push(at(x, y));
  return { camH, dFloor: pct(fy, 50), zFloor: 1 / pct(fx, 50), dBack: pct(band, 15) };
}
// the two anchors for a picture whose back stands 'wall' metres away (null when the picture cannot take them)
function anchorsFor(ref: AngleScaleRefs, wall: number): Array<[number, number]> | null {
  if (!(ref.dFloor > ref.dBack * 1.05 + 1e-6) || !(wall > ref.zFloor + 0.3)) return null;
  return [[ref.dFloor, ref.zFloor], [ref.dBack, wall]];
}
export interface AngleWallHit { dist: number; wall: 'left' | 'right' | 'back' }
// where a camera standing at pos and looking along yaw (degrees: 0 = the way camera A looks, + = to its right) meets a wall
// of camera A's room (left, right or back); null when it looks out of what camera A saw (toward camera A's back)
function wallAhead(S: AngleSet, pos: Vec3 | number[], yawDeg: number): AngleWallHit | null {
  const dx = Math.sin(yawDeg * D2R), dz = -Math.cos(yawDeg * D2R), zS = 0.3 * S.Zback; let best: AngleWallHit | null = null;
  const hit = (t: number, wall: AngleWallHit['wall']) => { if (t > 0.05 && (!best || t < best.dist)) best = { dist: t, wall }; };
  if (dx < -1e-6) { const t = (S.xmin - pos[0]) / dx, z = pos[2] + dz * t; if (z >= -S.Zback - 1e-6 && z <= zS) hit(t, 'left'); }
  if (dx > 1e-6) { const t = (S.xmax - pos[0]) / dx, z = pos[2] + dz * t; if (z >= -S.Zback - 1e-6 && z <= zS) hit(t, 'right'); }
  if (dz < -1e-6) { const t = (-S.Zback - pos[2]) / dz, x = pos[0] + dx * t; if (x >= S.xmin - 1e-6 && x <= S.xmax + 1e-6) hit(t, 'back'); }
  return best;
}
// a picture's place in camera A's room: { pos: [x, y, z] of its camera, yaw (degrees, like wallAhead), s (size, 1) }
// local (the picture's own set: its camera at 0 looking -z) -> A's room, as a column-major matrix and as points
function poseMat(p: AnglePose): Float32Array {
  const t = p.yaw * D2R, k = p.s || 1, c = Math.cos(t) * k, s = Math.sin(t) * k;
  return new Float32Array([c, 0, s, 0, 0, k, 0, 0, -s, 0, c, 0, p.pos[0], p.pos[1], p.pos[2], 1]);
}
function toRoom(p: AnglePose, q: Vec3 | number[]): Vec3 { const t = p.yaw * D2R, k = p.s || 1, c = Math.cos(t), s = Math.sin(t), x = q[0] * k, y = q[1] * k, z = q[2] * k; return [x * c - z * s + p.pos[0], y + p.pos[1], x * s + z * c + p.pos[2]]; }
function toLocal(p: AnglePose, q: Vec3 | number[]): Vec3 { const t = p.yaw * D2R, k = p.s || 1, c = Math.cos(t), s = Math.sin(t), X = q[0] - p.pos[0], Y = q[1] - p.pos[1], Z = q[2] - p.pos[2]; return [(X * c + Z * s) / k, Y / k, (-X * s + Z * c) / k]; }
const POSE0: AnglePose = { pos: [0, 0, 0], yaw: 0, s: 1 };
// a set's own view distance in a direction, for the merge's 'it looked straight through here' check: the nearest of the 3x3
// mesh points around it (so the edge of a thing does not count as looking through it). One value per mesh point.
function nearGrid(S: AngleSet): Float32Array {
  const R = S.R, C = S.C, z = new Float32Array(R * C), out = new Float32Array(R * C);
  for (let i = 0; i < R * C; i++) z[i] = -S.pos[i * 3 + 2];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { let m = Infinity;
    for (let dr = -1; dr <= 1; dr++) { const rr = r + dr; if (rr < 0 || rr >= R) continue; for (let dc = -1; dc <= 1; dc++) { const cc = c + dc; if (cc < 0 || cc >= C) continue; const v = z[rr * C + cc]; if (v < m) m = v; } }
    out[r * C + c] = m; }
  return out;
}

/* ---------- cameras: { pos: [x, y, z], target: [x, y, z], preset } ---------- */
const sub = (p: ArrayLike<number>, q: ArrayLike<number>): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const hyp = (x: number, z: number) => Math.sqrt(x * x + z * z);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);   // numpy's clip (hi wins if lo > hi)
const yHigh = (S: AngleSet) => S.kind === 'interior' ? Math.max(0.5, S.ytop - 0.12 * (S.ytop + S.camH)) : 0.1 + 0.6 * S.Zp;
export interface AngleStage { xmin: number; xmax: number; zmax: number }
// where a camera may stand: inside the room (interior) or around the scene (exterior).
// v0.4.8: B may pull back well behind camera A - as far behind it as what A looks at is in front of it (and at least half the
// room's depth) - and turn round to the room behind A. The walls it then stands behind are not drawn (the views hide back faces,
// like a set with a wall taken out). S.ext (set by the dialog from the added pictures' cameras) widens the room to where they stand.
function stage(S: AngleSet): AngleStage {
  const e = S.ext || {}, back = S.kind === 'interior' ? Math.max(S.Zp, 0.5 * S.Zback) : Math.max(S.Zp, 0.3 * S.Zback);
  return { xmin: Math.min(S.xmin, e.xmin != null ? e.xmin : Infinity), xmax: Math.max(S.xmax, e.xmax != null ? e.xmax : -Infinity),
    zmax: Math.max(0.2 * S.Zp, back, e.zmax != null ? e.zmax : 0) };
}
export interface AngleLimits { x: [number, number]; z: [number, number]; y: [number, number] }
function limits(S: AngleSet): AngleLimits {
  const G = stage(S);
  if (S.kind === 'interior') return { x: [G.xmin + 0.5, G.xmax - 0.5], z: [-(S.Zback - 1.0), G.zmax], y: [-S.camH + 0.15, yHigh(S)] };
  return { x: [G.xmin - 6, G.xmax + 6], z: [-0.9 * S.Zback, G.zmax], y: [-S.camH + 0.15, yHigh(S)] };
}
function fixCam(S: AngleSet, cam: { pos: ArrayLike<number>; target: ArrayLike<number>; preset?: AnglePreset | null }): AngleCam {
  const L = limits(S), G = stage(S), p = Array.from(cam.pos) as Vec3, t = Array.from(cam.target) as Vec3;
  p[0] = clamp(p[0], L.x[0], L.x[1]); p[2] = clamp(p[2], L.z[0], L.z[1]); p[1] = clamp(p[1], L.y[0], L.y[1]);
  t[0] = clamp(t[0], G.xmin - 3, G.xmax + 3); t[2] = clamp(t[2], -S.Zback * 1.2, G.zmax + 3); t[1] = clamp(t[1], -S.camH - 2, yHigh(S) + 4);
  const dx = t[0] - p[0], dz = t[2] - p[2], d = hyp(dx, dz);
  if (d < 0.6) { const k = d > 1e-6 ? 0.6 / d : 0; t[0] = p[0] + (k ? dx * k : 0); t[2] = p[2] + (k ? dz * k : -0.6); }
  const pitch = Math.atan2(t[1] - p[1], hyp(t[0] - p[0], t[2] - p[2])) * R2D;    // at most 70 degrees up or down
  if (Math.abs(pitch) > 70) t[1] = p[1] + Math.sign(pitch) * Math.tan(70 * D2R) * hyp(t[0] - p[0], t[2] - p[2]);
  return { pos: p, target: t, preset: cam.preset || null };
}
export type AnglePresets = Record<Exclude<AnglePreset, 'vp'>, AngleCam>;
function presets(S: AngleSet): AnglePresets {
  const P = S.pivot, K = KIND[S.kind], h = S.camH, Zp = S.Zp, rad = [0 - P[0], 0 - P[1], 0 - P[2]];
  const orbit = (deg: number): Vec3 => {
    const t = deg * D2R, c = Math.cos(t), s = Math.sin(t), v = [rad[0] * K.k, rad[1] * K.k, rad[2] * K.k];
    const p: Vec3 = [P[0] + c * v[0] + s * v[2], P[1] + v[1], P[2] - s * v[0] + c * v[2]];
    if (S.kind === 'interior') p[0] = clamp(p[0], S.xmin + 0.5, S.xmax - 0.5);
    return p;
  };
  const out = { orig: { pos: [0, 0, 0], target: [0, 0, -Zp] } } as Record<string, { pos: Vec3; target: Vec3; preset?: AnglePreset | null }>;
  for (const [k, d] of [['left45', -45], ['left20', -20], ['right20', 20], ['right45', 45]] as Array<[string, number]>) out[k] = { pos: orbit(d), target: P.slice() as Vec3 };
  if (S.kind === 'interior') out.high = { pos: [0, yHigh(S), 0], target: P.slice() as Vec3 };
  else { const e = 30 * D2R, r = 0.95 * Zp; out.high = { pos: [P[0], P[1] + r * Math.sin(e), P[2] + r * Math.cos(e)], target: P.slice() as Vec3 }; }
  const lp: Vec3 = [0, -h * 0.75, -0.05 * Zp], L = 0.95 * Zp; out.low = { pos: lp, target: [0, lp[1] + Math.tan(9 * D2R) * L, lp[2] - L] };
  for (const k in out) out[k].preset = k as AnglePreset;
  return out as unknown as AnglePresets;
}
// what a camera is, in the artist's words: orbit around what it looks at, height, tilt, distance, pan away from the middle
function info(S: AngleSet, cam: { pos: ArrayLike<number>; target: ArrayLike<number> }): AngleInfo {
  const p = cam.pos, t = cam.target, P0 = S.pivot;
  const a = [0 - t[0], 0 - t[2]], b = [p[0] - t[0], p[2] - t[2]];
  let orbit = (Math.atan2(b[0], b[1]) - Math.atan2(a[0], a[1])) * R2D; orbit = ((orbit + 540) % 360) - 180;
  const dist = hyp(b[0], b[1]) / Math.max(1e-6, hyp(a[0], a[1]));
  const pitch = Math.atan2(t[1] - p[1], hyp(t[0] - p[0], t[2] - p[2])) * R2D;
  const yawV = Math.atan2(t[0] - p[0], -(t[2] - p[2])) * R2D, yawP = Math.atan2(P0[0] - p[0], -(P0[2] - p[2])) * R2D;
  let pan = yawV - yawP; pan = ((pan + 540) % 360) - 180;
  const yawA = yawV;                      // where it looks, compared with camera A (0 = straight ahead like A, + = to the right)
  return { orbit, dist, pitch, pan, yaw: yawA, floorH: p[1] + S.camH, eyeH: S.camH, dy: p[1], move: hyp(p[0], p[2]) };
}
/* v0.4.7 투시만 바꾸기 (A안): the eye moves sideways / up-down and the frame slides with it so that the back wall stays exactly
   where it was; s = where the vanishing point goes (-1..1 of the frame, 0, 0 = camera A). Like moving the vanishing point of a
   one-point drawing: the back wall keeps its size and place, side walls / floor / nearer things change, verticals stay vertical.
   The eye stays inside the room and between 15 cm over the floor and the 'high' height. */
function vpCam(S: AngleSet, s: ArrayLike<number>): AngleCam {
  const tyS = Math.tan(S.vfov * D2R / 2), txS = tyS * S.W / S.H, Zb = S.Zback;
  let sx = clamp(+s[0] || 0, -0.85, 0.85), sy = clamp(+s[1] || 0, -0.85, 0.85), dx = sx * Zb * txS, dy = sy * Zb * tyS;
  if (S.kind === 'interior') { const d2 = clamp(dx, S.xmin + 0.3, S.xmax - 0.3); if (d2 !== dx) { dx = d2; sx = dx / (Zb * txS); } }
  const y2 = clamp(dy, -S.camH + 0.15, yHigh(S)); if (y2 !== dy) { dy = y2; sy = dy / (Zb * tyS); }
  return { pos: [dx, dy, 0], target: [dx, dy, -S.Zp], preset: 'vp', shift: [sx, sy] };
}
/* v0.4.9: the part of the original picture camera B sees - the box (0..1 from the top left of the picture) round the points of the
   set that land in B's frame (a sample; what hides behind something still counts). A box much smaller than the picture means a
   closer, tighter shot: then GPT gets that part of the picture cut out (not the whole room it would otherwise draw again). */
function part(S: AngleSet, cam: AngleCam): AnglePart | null {
  const V = camView(S, cam, 320, Math.max(16, Math.round(320 * S.H / S.W))), n = S.pos.length / 3, step = Math.max(1, Math.floor(n / 20000)), us: number[] = [], vs: number[] = [];
  let all = 0;
  for (let i = 0; i < n; i += step) {
    all++; const p = V.project([S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]]);
    if (!p || p[0] < 0 || p[0] > V.w || p[1] < 0 || p[1] > V.h) continue;
    us.push(S.uv[i * 2]); vs.push(1 - S.uv[i * 2 + 1]);
  }
  if (us.length < 50) return null;
  const box: [number, number, number, number] = [pct(us, 2), pct(vs, 2), pct(us, 98), pct(vs, 98)];
  return { box, area: (box[2] - box[0]) * (box[3] - box[1]), seen: us.length / all };
}
// a closer, tighter shot by hand: nearer than A and turned less than 15 degrees round (a zoom in, not a new angle), seeing under half
// of the picture (the presets keep the experiment's own words)
const tightOf = (S: AngleSet, cam: AngleCam, pt: AnglePart | null): boolean => { if (cam.preset || !pt || pt.area >= 0.5) return false; const it = info(S, cam); return it.dist < 0.9 && Math.abs(it.orbit) < 15; };
const pc = (v: number) => Math.round(Math.abs(v) * 50);   // a shift in -1..1 of the frame as % of the frame (half the frame = 50 %)
const near = (S: AngleSet, cam: AngleCam): boolean => { const i = info(S, cam); return i.move < 0.25 && Math.abs(i.dy) < 0.15 && Math.abs(i.yaw) < 2 && Math.abs(i.pitch) < 2; };
const r5 = (v: number) => Math.max(5, Math.round(Math.abs(v) / 5) * 5);

// the camera move in plain English, for the picture model. The presets keep the experiment's own sentences.
function sentence(S: AngleSet, cam: AngleCam, o: { tight?: boolean } = {}): string {     // o.tight (v0.4.9): a closer shot that shows only the part of the original in image 2
  const K = KIND[S.kind], ext = S.kind === 'exterior', it = info(S, cam), pre = cam.preset, tight = !!o.tight && !pre;
  if (pre === 'left20' || pre === 'right20' || pre === 'left45' || pre === 'right45') {
    const side = pre.startsWith('left') ? 'left' : 'right', deg = pre.endsWith('45') ? 45 : 20;
    if (deg === 20) return 'The camera has moved about 20 degrees to the ' + side + ' around ' + K.mid + ' (it now stands to the ' + side + ' of where the reference was drawn), at the same eye height, and still looks at ' + K.mid + ', so we see ' + (ext ? 'it' : K.noun) + ' a little from the ' + side + ' side.';
    return 'The camera has moved about 45 degrees to the ' + side + ' around ' + K.mid + ' (it now stands ' + (ext ? 'far to the ' + side : 'near the ' + side + ' side of the room') + '), at the same eye height, and looks back toward ' + K.mid + ', so we see ' + (ext ? 'it' : K.noun) + ' from the ' + side + ' at an angle.';
  }
  if (pre === 'high') return ext ? 'The camera is raised high, like from a third-floor window, and looks down at ' + K.mid + ' (about ' + r5(it.pitch) + ' degrees down).'
    : 'The camera stays at the same spot but is raised up near the ceiling and looks down at ' + K.mid + ' (about ' + r5(it.pitch) + ' degrees down): a high-angle view that shows more of the floor.';
  if (pre === 'vp' && cam.shift) {
    const [sx, sy] = cam.shift, hx = Math.abs(sx) >= 0.02, hy = Math.abs(sy) >= 0.02;
    if (!hx && !hy) return 'The camera stays where it was.';
    const where = [hx ? (sx < 0 ? 'to the left' : 'to the right') + ' (about ' + pc(sx) + ' percent of the picture width)' : '', hy ? (sy > 0 ? 'higher' : 'lower') + ' (about ' + pc(sy) + ' percent of the picture height)' : ''].filter(Boolean).join(' and ');
    const eye = [hx ? (sx < 0 ? 'to the left' : 'to the right') : '', hy ? (sy > 0 ? 'up' : 'down') + ' to about ' + angleMEn(cam.pos[1] + S.camH) + ' m above the ' + (ext ? 'ground' : 'floor') : ''].filter(Boolean).join(' and ');
    const see = [hx ? 'more of the ' + (sx < 0 ? 'right' : 'left') + ' side' : '', hy ? (sy > 0 ? 'more of the ' + (ext ? 'ground' : 'floor') + ' and the tops of things, seen a little from above' : 'less of the ' + (ext ? 'ground' : 'floor') + ', seen from a lower eye level') : ''].filter(Boolean).join(' and ');
    return 'Only the perspective changes: the vanishing point moved ' + where + '. The eye moved ' + eye + ', and the frame slid with it so that the back ' + (ext ? 'of the scene' : 'wall') + ' stays exactly where it is in image 2, with the same size and place in the frame. ' +
      'The side walls, the ' + (ext ? 'ground' : 'floor') + ' and the nearer things are seen from the new eye position (' + see + '), and vertical lines stay vertical.';
  }
  if (pre === 'low') return 'The camera stays at the same spot but is lowered close to the ' + (ext ? 'ground' : 'floor') + ' (about knee height) and tilts up slightly: a low-angle view, the ' + (ext ? 'ground looks thin and the buildings look taller.' : 'floor looks thin and the walls and furniture look taller.');
  // a camera the artist placed by hand
  const parts: string[] = []; const side = it.orbit > 0 ? 'right' : 'left', ao = Math.abs(it.orbit);
  let hgt: string;
  if (Math.abs(it.dy) < 0.3) hgt = 'at the same eye height';
  else if (it.dy < 0) hgt = it.floorH < 0.6 ? 'lowered close to the ' + (ext ? 'ground' : 'floor') + ' (about knee height)' : 'a little lower than eye height';
  else hgt = (!ext && it.floorH > 0.8 * (yHigh(S) + S.camH)) ? 'raised up near the ceiling' : it.dy > 2.5 ? 'raised high above eye height' : 'a little higher than eye height';
  const what = tight ? 'the part of ' + K.noun + ' shown in image 2' : Math.abs(it.pan) > 8 ? 'the ' + (it.pan > 0 ? 'right' : 'left') + ' part of ' + K.noun : K.mid;
  const far = (d: number) => d < 1 ? 'about ' + Math.round(d * 10) * 10 + ' percent of the distance' : 'about ' + Math.round(d * 10) / 10 + ' times the distance';
  if (ao >= 5) {
    const where = ao < 30 ? 'to the ' + side + ' of where the reference was drawn' : ao < 60 ? (ext ? 'far to the ' + side : 'near the ' + side + ' side of the room') : 'at the ' + side + ' side of ' + K.noun + ', looking across it';
    parts.push('The camera has moved about ' + r5(ao) + ' degrees to the ' + side + ' around ' + what + ' (it now stands ' + where + ')');
    if (it.dist < 0.8) parts.push('it is closer to ' + what + ' (' + far(it.dist) + ')');
    else if (it.dist > 1.2) parts.push('it is further back (' + far(it.dist) + ')');
  } else if (it.move < 0.4) parts.push('The camera stays at the same spot');
  else if (it.dist < 0.92) parts.push('The camera has moved straight toward ' + what + ' (' + far(it.dist) + ')');
  else if (it.dist > 1.08) parts.push('The camera has moved straight back (' + far(it.dist) + ')');
  else parts.push('The camera has moved a little to the ' + (cam.pos[0] > 0 ? 'right' : 'left'));
  parts.push(hgt === 'at the same eye height' ? 'it stays at the same eye height' : 'it is ' + hgt);
  let look = tight ? 'it looks straight at it' : ao >= 30 ? 'it looks back toward ' + what : 'it looks at ' + what;
  if (it.pitch < -4) look += ' (about ' + r5(it.pitch) + ' degrees down)'; else if (it.pitch > 4) look += ' (tilted about ' + r5(it.pitch) + ' degrees up)';
  parts.push(look);
  let s = parts[0]; for (let i = 1; i < parts.length; i++) s += (i === parts.length - 1 ? ', and ' : ', ') + parts[i];
  if (tight) s += '. It is a closer, tighter shot: that part fills the whole frame, and nothing outside it is seen.';
  else s += ao >= 5 ? ', so we see ' + (ext ? 'it' : K.noun) + (ao < 30 ? ' a little from the ' + side + ' side.' : ao < 60 ? ' from the ' + side + ' at an angle.' : ' almost from the ' + side + ' side.') : '.';
  if (it.pitch < -10 && it.dy > 0.3) s += ' A high-angle view that shows more of the ' + (ext ? 'ground.' : 'floor.');
  else if (it.pitch > 4 && it.floorH < 0.8) s += ' A low-angle view: the ' + (ext ? 'ground looks thin and the buildings look taller.' : 'floor looks thin and the walls and furniture look taller.');
  return s;
}
// the order for the picture model: image 1 = the set seen from the new camera, image 2 = the original (src/shared/bae/angle/order.ts)
function prompt(S: AngleSet, cam: AngleCam, x: AnglePromptOpts = {}): string {
  return anglePromptText(S.kind, x.crop ? sentence(S, cam, { tight: true }) : sentence(S, cam), x);
}
// the same in Korean, for the dialog
function ko(S: AngleSet, cam: AngleCam): string {
  const it = info(S, cam), out: string[] = [];
  if (cam.preset === 'vp' && cam.shift) {
    const [sx, sy] = cam.shift; if (Math.abs(sx) < 0.02 && Math.abs(sy) < 0.02) return '투시만 바꾸기: B 그림의 빨간 점(소실점)을 끌어 보세요';
    if (Math.abs(sx) >= 0.02) out.push('소실점 ' + (sx < 0 ? '왼쪽' : '오른쪽') + '으로 ' + pc(sx) + '%');
    if (Math.abs(sy) >= 0.02) out.push('지평선 ' + (sy > 0 ? '위' : '아래') + '로 ' + pc(sy) + '% (눈높이 ' + angleMKo(cam.pos[1] + S.camH) + 'm)');
    return '투시만 바꾸기: ' + out.join(' · ') + ' · 뒷벽은 그대로';
  }
  if (near(S, cam)) return '원래 카메라 그대로예요';
  const ao = Math.abs(it.orbit);
  out.push(ao >= 3 ? (it.orbit > 0 ? '오른쪽' : '왼쪽') + '으로 약 ' + Math.round(ao) + '° 돌았어요' : '돌지 않았어요');
  out.push(Math.abs(it.dy) < 0.3 ? '눈높이 그대로' : '바닥에서 ' + angleMKo(it.floorH) + 'm (눈높이 ' + it.eyeH.toFixed(1) + 'm)');
  out.push(Math.abs(it.pitch) < 2 ? '고개 수평' : '고개 ' + (it.pitch < 0 ? '아래로 ' : '위로 ') + Math.round(Math.abs(it.pitch)) + '°');
  if (it.dist < 0.9 || it.dist > 1.1) out.push('거리 ' + Math.round(it.dist * 100) + '%');
  if (Math.abs(it.pan) > 8) out.push('가운데보다 ' + (it.pan > 0 ? '오른쪽' : '왼쪽') + '을 봐요');
  return out.join(' · ');
}
// move a camera by the artist's controls (each keeps the others)
function setOrbit(S: AngleSet, cam: AngleCam, deg: number): AngleCam {     // rotate the camera around what it looks at, keeping height; closer only when a wall is in the way
  const t = cam.target, a = [0 - t[0], 0 - t[2]], d0 = hyp(cam.pos[0] - t[0], cam.pos[2] - t[2]) || hyp(a[0], a[1]);
  const base = Math.atan2(a[0], a[1]) + deg * D2R, sx = Math.sin(base), sz = Math.cos(base), L = limits(S);
  const fits = (d: number) => { const x = t[0] + sx * d, z = t[2] + sz * d; return x >= L.x[0] - 1e-9 && x <= L.x[1] + 1e-9 && z >= L.z[0] - 1e-9 && z <= L.z[1] + 1e-9; };
  let d = d0;
  if (!fits(d)) { let lo = Math.min(1.5, d), hi = d; if (fits(lo)) { for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; } d = lo; } }
  return fixCam(S, { pos: [t[0] + sx * d, cam.pos[1], t[2] + sz * d], target: t.slice() as Vec3 });
}
function setDist(S: AngleSet, cam: AngleCam, k: number): AngleCam {        // k = distance to what it looks at / camera A's distance to it
  const t = cam.target, a = hyp(0 - t[0], 0 - t[2]), dx = cam.pos[0] - t[0], dz = cam.pos[2] - t[2], d = hyp(dx, dz) || 1;
  return fixCam(S, { pos: [t[0] + dx / d * a * k, cam.pos[1], t[2] + dz / d * a * k], target: t.slice() as Vec3 });
}
function setHeight(S: AngleSet, cam: AngleCam, floorH: number): AngleCam { return fixCam(S, { pos: [cam.pos[0], floorH - S.camH, cam.pos[2]], target: cam.target.slice() as Vec3 }); }
function setPitch(S: AngleSet, cam: AngleCam, deg: number): AngleCam {
  const p = cam.pos, t = cam.target, d = hyp(t[0] - p[0], t[2] - p[2]);
  return fixCam(S, { pos: p.slice() as Vec3, target: [t[0], p[1] + Math.tan(clamp(deg, -70, 70) * D2R) * d, t[2]] });
}

/* ---------- matrices (column-major, like WebGL) ---------- */
const norm = (v: ArrayLike<number>): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function basis(eye: ArrayLike<number>, tgt: ArrayLike<number>): { fw: Vec3; r: Vec3; u: Vec3 } { const fw = norm(sub(tgt, eye)); let r = cross(fw, [0, 1, 0]); if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = [1, 0, 0]; r = norm(r); return { fw, r, u: cross(r, fw) }; }
function lookAt(eye: ArrayLike<number>, tgt: ArrayLike<number>): Float32Array {
  const { fw, r, u } = basis(eye, tgt);
  return new Float32Array([r[0], u[0], -fw[0], 0, r[1], u[1], -fw[1], 0, r[2], u[2], -fw[2], 0, -dot(r, eye), -dot(u, eye), dot(fw, eye), 1]);
}
function persp(fovyDeg: number, aspect: number, nearZ: number, farZ: number): Float32Array {
  const t = 1 / Math.tan(fovyDeg * D2R / 2), nf = 1 / (nearZ - farZ);
  return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (farZ + nearZ) * nf, -1, 0, 0, 2 * farZ * nearZ * nf, 0]);
}
function mul(a: Float32Array, b: Float32Array): Float32Array { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
// a camera ready to draw with: matrices and a projector to screen pixels
// v0.4.7 shift = [sx, sy]: the frame slides (a shift lens), in -1..1 of the frame; the picture moves, the perspective does not
function view(eye: Vec3, tgt: Vec3, fovy: number, w: number, h: number, shift?: ArrayLike<number> | null): AngleView {
  const B = basis(eye, tgt), ty = Math.tan(fovy * D2R / 2), tx = ty * w / h, sx = shift ? +shift[0] || 0 : 0, sy = shift ? +shift[1] || 0 : 0;
  const P = persp(fovy, w / h, 0.05, 2000); if (sx || sy) { P[8] = -sx; P[9] = -sy; }
  return { eye, tgt, fovy, w, h, ...B, tx, ty, sx, sy, mvp: mul(P, lookAt(eye, tgt)),
    project: (p) => { const d = sub(p, eye), zc = dot(d, B.fw); return zc <= 1e-4 ? null : [(dot(d, B.r) / (zc * tx) + sx + 1) / 2 * w, (1 - dot(d, B.u) / (zc * ty) - sy) / 2 * h, zc]; },
    ray: (px, py) => { const nx = (px / w * 2 - 1 - sx) * tx, ny = (1 - py / h * 2 - sy) * ty; return norm([B.fw[0] + B.r[0] * nx + B.u[0] * ny, B.fw[1] + B.r[1] * nx + B.u[1] * ny, B.fw[2] + B.r[2] * nx + B.u[2] * ny]); } };
}
// the new camera keeps camera A's lens; a frame of another shape keeps the width's angle
const camView = (S: AngleSet, cam: AngleCam, w: number, h: number): AngleView => view(cam.pos, cam.target, 2 * Math.atan(Math.tan(S.vfov * D2R / 2) * (h / w) / (S.H / S.W)) * R2D, w, h, cam.shift);
// the set seen from above and behind camera A (a diorama, the experiment's map angle), framed on what the picture shows:
// a sample of the plate itself (not the view out of the windows), camera A and the floor under it
function birdView(S: AngleSet, w: number, h: number, more?: Array<Vec3 | number[]> | null): AngleView {
  const zb = S.Zback, hh = S.camH;
  const eye0: Vec3 = [0, -hh + 0.95 * zb, 0.62 * zb], at0: Vec3 = [0, -hh, -0.42 * zb], fw = norm(sub(at0, eye0));
  const fovy = 50, B = basis(eye0, at0), ty = Math.tan(fovy * D2R / 2), tx = ty * w / h;
  const zcut = S.kind === 'interior' ? Math.min(S.ZMAX * 0.97, zb * 1.3) : S.ZMAX * 0.97, n = S.pos.length / 3, step = Math.max(1, Math.floor(n / 6000)), pts: Vec3[] = [];
  for (let i = 0; i < n; i += step) if (-S.pos[i * 3 + 2] < zcut) pts.push([S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]]);
  const must = ([[0, 0, 0], [0, -hh, 0.3]] as Array<Vec3 | number[]>).concat(more || []);
  let c: Vec3 = at0.slice() as Vec3, D = Math.hypot(...sub(eye0, at0)), eye = eye0;
  for (let it = 0; it < 8; it++) {   // slide and zoom the frame until the plate sits in its middle with a margin
    eye = [c[0] - fw[0] * D, c[1] - fw[1] * D, c[2] - fw[2] * D];
    const xs: number[] = [], ys: number[] = [], prj = (p: ArrayLike<number>) => { const d = sub(p, eye), zc = dot(d, fw); return zc > 0.05 ? [dot(d, B.r) / (zc * tx), dot(d, B.u) / (zc * ty)] : null; };
    for (const p of pts) { const q = prj(p); if (q) { xs.push(q[0]); ys.push(q[1]); } }
    if (xs.length < 10) break;
    let x0 = pct(xs, 1), x1 = pct(xs, 99), y0 = pct(ys, 1), y1 = pct(ys, 99);
    for (const p of must) { const q = prj(p); if (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); } }
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, k = Math.max(0.3, Math.min(3, Math.max((x1 - x0) / 2, (y1 - y0) / 2) / 0.9));
    c = [c[0] + (B.r[0] * mx * tx + B.u[0] * my * ty) * D, c[1] + (B.r[1] * mx * tx + B.u[1] * my * ty) * D, c[2] + (B.r[2] * mx * tx + B.u[2] * my * ty) * D]; D *= k;
  }
  // v0.4.8: points far behind camera A (a pulled-back B) sit almost under the map's eye, where the slide-and-zoom above may not
  // settle: back off (zoom out round the same middle) until each of those points is in the frame
  const inF = () => { const e = [c[0] - fw[0] * D, c[1] - fw[1] * D, c[2] - fw[2] * D]; return (more || []).every((p) => { const d = sub(p, e), zc = dot(d, fw); return zc > 0.05 && Math.abs(dot(d, B.r) / (zc * tx)) <= 0.96 && Math.abs(dot(d, B.u) / (zc * ty)) <= 0.96; }); };
  for (let i = 0; i < 40 && !inF(); i++) D *= 1.1;
  eye = [c[0] - fw[0] * D, c[1] - fw[1] * D, c[2] - fw[2] * D];
  return view(eye, c, fovy, w, h);
}
// where a pointer on the bird view meets the level y (null when it looks above the horizon)
function hitY(V: AngleView, sx: number, sy: number, y: number): Vec3 | null { const d = V.ray(sx, sy); if (Math.abs(d[1]) < 1e-6) return null; const t = (y - V.eye[1]) / d[1]; return t > 0 ? [V.eye[0] + d[0] * t, y, V.eye[2] + d[2] * t] : null; }

/** 결과 줄의 이름 (HTML agLabel): '오른쪽 45°', '왼쪽 25° 높게', '소실점 왼쪽 17%' … */
function label(S: AngleSet, cam: AngleCam): string {
  if (cam.preset === 'vp' && cam.shift) {
    const [sx, sy] = cam.shift, out: string[] = [];
    if (Math.abs(sx) >= 0.02) out.push('소실점 ' + (sx < 0 ? '왼쪽 ' : '오른쪽 ') + Math.round(Math.abs(sx) * 50) + '%');
    if (Math.abs(sy) >= 0.02) out.push('지평선 ' + (sy > 0 ? '위 ' : '아래 ') + Math.round(Math.abs(sy) * 50) + '%');
    return out.join(' ') || '투시만 바꾸기';
  }
  if (cam.preset && ANGLE_PRESET_LABEL[cam.preset]) return ANGLE_PRESET_LABEL[cam.preset];
  const it = info(S, cam), out: string[] = [];
  if (Math.abs(it.orbit) >= 3) out.push((it.orbit > 0 ? '오른쪽 ' : '왼쪽 ') + Math.round(Math.abs(it.orbit)) + '°');
  if (it.dy > 0.3) out.push('높게'); else if (it.dy < -0.3) out.push('낮게');
  if (it.dist < 0.85) out.push('가까이'); else if (it.dist > 1.15) out.push('멀리');
  if (Math.abs(it.pitch) >= 5 && !out.length) out.push('고개 ' + (it.pitch < 0 ? '아래' : '위'));
  return out.join(' ') || '카메라 이동';
}
/** 그릴 수 있는 카메라인지 (원래 자리면 아님, HTML agSync 의 same). */
function isSame(S: AngleSet, cam: AngleCam): boolean {
  return cam.preset === 'vp' && cam.shift ? (Math.abs(cam.shift[0]) < 0.02 && Math.abs(cam.shift[1]) < 0.02) : near(S, cam);
}

/** HTML 의 ANG 와 같은 이름의 모음. mKo · UNDER 도 그대로. */
export const ANG = {
  WORK, STEP, KIND, build, presets, stage, limits, fixCam, part, tightOf, info, near, sentence, prompt, ko, setOrbit, setDist, setHeight, setPitch, view, camView, birdView, hitY, yHigh, workSize, sampler, pct,
  scaleRefs, anchorsFor, wallAhead, poseMat, toRoom, toLocal, POSE0, nearGrid, vpCam, mKo: angleMKo, UNDER: ANGLE_UNDER, label, isSame,
};
export type AngleEngine = typeof ANG;
