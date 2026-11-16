/* BAE layer engine: image tools on plain typed arrays (no browser, no canvas), so the same code runs in a page,
   in a Web Worker and in Node / Electron.
   Masks are Uint8Array(w*h) holding 0/1. Pictures are RGB Uint8Array(w*h*3). Each tool mirrors the OpenCV / SciPy /
   scikit-image call the Python prototype used (named in the comments), so the two give the same layers. */

export const newMask = (w, h) => new Uint8Array(w * h);
export function cvRound(v) { const r = Math.round(v); return (Math.abs(v % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r; } // round half to even
export function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- boxes and counting ---------- */
export function bbox(m, w, h) {                   // [x0, y0, x1, y1) of the set pixels, or null
  let x0 = w, y0 = -1, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const r = y * w; let a = -1, b = -1;
    for (let x = 0; x < w; x++) if (m[r + x]) { a = x; break; }
    if (a < 0) continue;
    for (let x = w - 1; x >= a; x--) if (m[r + x]) { b = x; break; }
    if (y0 < 0) y0 = y; y1 = y; if (a < x0) x0 = a; if (b > x1) x1 = b;
  }
  return y0 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}
export function cropBox(m, pad, w, h) { const b = bbox(m, w, h); if (!b) return null; return [Math.max(0, b[0] - pad), Math.max(0, b[1] - pad), Math.min(w, b[2] + pad), Math.min(h, b[3] + pad)]; }
export function count(m) { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; }
export function any(m) { for (let i = 0; i < m.length; i++) if (m[i]) return true; return false; }
export function and(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] & b[i]; return o; }
export function or(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] | b[i]; return o; }
export function andNot(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] & (b[i] ^ 1); return o; }
export function not(a) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] ^ 1; return o; }
export function orInto(dst, src) { for (let i = 0; i < dst.length; i++) dst[i] |= src[i]; return dst; }
export function andNotInto(dst, src) { for (let i = 0; i < dst.length; i++) dst[i] &= src[i] ^ 1; return dst; }
export function andInto(dst, src) { for (let i = 0; i < dst.length; i++) dst[i] &= src[i]; return dst; }
export function countAnd(a, b) { let n = 0; for (let i = 0; i < a.length; i++) n += a[i] & b[i]; return n; }
export function unionOf(list, w, h) { const o = new Uint8Array(w * h); for (const m of list) if (m) orInto(o, m); return o; }

/* ---------- morphology (cv2.getStructuringElement / cv2.dilate / cv2.erode / cv2.morphologyEx) ---------- */
const HW_CACHE = new Map();
export function ellipse(r) {                      // cv2.MORPH_ELLIPSE (2r+1, 2r+1): half-width of each row
  const key = 'e' + r; if (HW_CACHE.has(key)) return HW_CACHE.get(key);
  const hw = new Int32Array(2 * r + 1);
  if (r > 0) { const inv = 1 / (r * r); for (let i = 0; i <= 2 * r; i++) { const dy = i - r; hw[i] = Math.min(r, cvRound(r * Math.sqrt((r * r - dy * dy) * inv))); } }
  HW_CACHE.set(key, hw); return hw;
}
export function rect(r) { const key = 'r' + r; if (!HW_CACHE.has(key)) HW_CACHE.set(key, new Int32Array(2 * r + 1).fill(r)); return HW_CACHE.get(key); }
const maxOf = (a) => { let v = 0; for (let i = 0; i < a.length; i++) if (a[i] > v) v = a[i]; return v; };
export function dilate(m, w, h, k) {              // k: half-widths (ellipse(r) or rect(r)) or a number r = ellipse(r)
  const hw = typeof k === 'number' ? ellipse(k) : k; const R = (hw.length - 1) >> 1, A = maxOf(hw);
  const out = new Uint8Array(w * h); const bb = bbox(m, w, h); if (!bb) return out;
  if (R === 0 && A === 0) { out.set(m); return out; }
  const sx0 = bb[0], sw = bb[2] - bb[0], sy0 = bb[1], sh = bb[3] - bb[1], pw = sw + 1;
  const P = new Int32Array(sh * pw);
  for (let y = 0; y < sh; y++) { const r = (y + sy0) * w + sx0, b = y * pw; let s = 0; for (let x = 0; x < sw; x++) { s += m[r + x]; P[b + x + 1] = s; } }
  const X0 = Math.max(0, bb[0] - A), X1 = Math.min(w, bb[2] + A), Y0 = Math.max(0, bb[1] - R), Y1 = Math.min(h, bb[3] + R);
  for (let y = Y0; y < Y1; y++) {
    const kLo = Math.max(0, sy0 - y + R), kHi = Math.min(2 * R, sy0 + sh - 1 - y + R);
    for (let x = X0; x < X1; x++) {
      let hit = 0;
      for (let k2 = kLo; k2 <= kHi; k2++) {
        const a = hw[k2]; let xa = x - a - sx0, xb = x + a + 1 - sx0; if (xa < 0) xa = 0; if (xb > sw) xb = sw; if (xb <= xa) continue;
        const b = (y + k2 - R - sy0) * pw; if (P[b + xb] - P[b + xa] > 0) { hit = 1; break; }
      }
      out[y * w + x] = hit;
    }
  }
  return out;
}
export function erode(m, w, h, k) {               // outside the picture counts as set, like cv2.erode's default border
  const hw = typeof k === 'number' ? ellipse(k) : k; const R = (hw.length - 1) >> 1, A = maxOf(hw);
  const out = new Uint8Array(w * h); const bb = bbox(m, w, h); if (!bb) return out;
  if (R === 0 && A === 0) { out.set(m); return out; }
  const X0 = Math.max(0, bb[0] - A), X1 = Math.min(w, bb[2] + A), Y0 = Math.max(0, bb[1] - R), Y1 = Math.min(h, bb[3] + R), sw = X1 - X0, pw = sw + 1;
  const Z = new Int32Array((Y1 - Y0) * pw);
  for (let y = Y0; y < Y1; y++) { const r = y * w + X0, b = (y - Y0) * pw; let s = 0; for (let x = 0; x < sw; x++) { s += m[r + x] ^ 1; Z[b + x + 1] = s; } }
  for (let y = bb[1]; y < bb[3]; y++) {
    const kLo = Math.max(0, R - y), kHi = Math.min(2 * R, h - 1 - y + R);
    for (let x = bb[0]; x < bb[2]; x++) {
      if (!m[y * w + x]) continue; let ok = 1;
      for (let k2 = kLo; k2 <= kHi; k2++) {
        const a = hw[k2]; const xa = Math.max(0, x - a) - X0, xb = Math.min(w, x + a + 1) - X0;
        const b = (y + k2 - R - Y0) * pw; if (Z[b + xb] - Z[b + xa] > 0) { ok = 0; break; }
      }
      out[y * w + x] = ok;
    }
  }
  return out;
}
export const dil = (m, w, h, r) => dilate(m, w, h, ellipse(r));       // the prototype's dil(m, r)
export const ero = (m, w, h, r) => erode(m, w, h, ellipse(r));        // the prototype's ero(m, r)
export const open = (m, w, h, k) => dilate(erode(m, w, h, k), w, h, k);
export const close = (m, w, h, k) => erode(dilate(m, w, h, k), w, h, k);

/* ---------- connected areas (cv2.connectedComponentsWithStats), holes (scipy binary_fill_holes) ---------- */
export function components(m, w, h, conn = 8) {    // labels 1..n in raster order of their first pixel; stats [area, x0, y0, x1, y1)
  const lab = new Int32Array(w * h); const stats = [null]; let n = 0; let stack = new Int32Array(4096);
  for (let i0 = 0; i0 < w * h; i0++) {
    if (!m[i0] || lab[i0]) continue;
    n++; let sp = 0; stack[sp++] = i0; lab[i0] = n; let area = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (sp) {
      const i = stack[--sp]; const y = (i / w) | 0, x = i - y * w; area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue; if (conn === 4 && dx && dy) continue;
          const xx = x + dx; if (xx < 0 || xx >= w) continue; const j = yy * w + xx;
          if (m[j] && !lab[j]) { lab[j] = n; if (sp >= stack.length) { const s2 = new Int32Array(stack.length * 2); s2.set(stack); stack = s2; } stack[sp++] = j; }
        }
      }
    }
    stats.push([area, x0, y0, x1 + 1, y1 + 1]);
  }
  return { lab, n, stats };
}
export function compMasks(m, w, h, minArea = 1, conn = 8) {  // the prototype's comps(m, min_area): one mask per area, raster order
  const { lab, n, stats } = components(m, w, h, conn); const out = [];
  for (let c = 1; c <= n; c++) {
    if (stats[c][0] < minArea) continue; const o = new Uint8Array(w * h); const [, x0, y0, x1, y1] = stats[c];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (lab[y * w + x] === c) o[y * w + x] = 1;
    o.area = stats[c][0]; o.box = [x0, y0, x1, y1]; out.push(o);
  }
  return out;
}
export function fillHolesAll(m, w, h) {            // scipy.ndimage.binary_fill_holes (4-connected background)
  const out = m.slice(); const vis = new Uint8Array(w * h); let stack = new Int32Array(4096), sp = 0;
  const push = (j) => { if (m[j] || vis[j]) return; vis[j] = 1; if (sp >= stack.length) { const s2 = new Int32Array(stack.length * 2); s2.set(stack); stack = s2; } stack[sp++] = j; };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) { const i = stack[--sp]; const y = (i / w) | 0, x = i - y * w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w); }
  for (let i = 0; i < w * h; i++) if (!m[i] && !vis[i]) out[i] = 1;
  return out;
}

/* ---------- exact Euclidean distance (cv2.distanceTransform / distanceTransformWithLabels) ---------- */
// distance from every pixel to the nearest pixel where src == 0; idx = that nearest pixel (when wanted). roi limits the work.
export function edt(src, w, h, wantIdx = false, roi = null) {
  const [X0, Y0, X1, Y1] = roi || [0, 0, w, h]; const W = X1 - X0, H = Y1 - Y0, N = Math.max(W, H);
  const BIG = 1e20; const g = new Float64Array(W * H); const gy = wantIdx ? new Int32Array(W * H) : null;
  const f = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1), arg = new Int32Array(N);
  const run = (n) => {                          // lower envelope of parabolas (Felzenszwalb & Huttenlocher)
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const t = q - v[k]; d[q] = t * t + f[v[k]]; arg[q] = v[k]; }
  };
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = src[(y + Y0) * w + x + X0] ? BIG : 0;
    run(H); for (let y = 0; y < H; y++) { g[y * W + x] = d[y]; if (gy) gy[y * W + x] = arg[y]; }
  }
  const dist = new Float32Array(W * H); const idx = wantIdx ? new Int32Array(W * H) : null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = g[y * W + x];
    run(W);
    for (let x = 0; x < W; x++) { dist[y * W + x] = Math.sqrt(Math.min(d[x], 1e18)); if (idx) { const ax = arg[x]; idx[y * W + x] = (gy[y * W + ax] + Y0) * w + ax + X0; } }
  }
  return { dist, idx, roi: [X0, Y0, X1, Y1], W, H };
}
export function innerPoint(m, w, h) {             // the deepest pixel of a mask (the picture's edge counts as outside)
  const b = bbox(m, w, h); if (!b) return [0, 0];
  const pw = b[2] - b[0] + 2, ph = b[3] - b[1] + 2; const pad = new Uint8Array(pw * ph);
  for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) pad[(y - b[1] + 1) * pw + x - b[0] + 1] = m[y * w + x];
  const { dist } = edt(pad, pw, ph); let best = -1, bi = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > best) { best = dist[i]; bi = i; }
  const y = (bi / pw) | 0, x = bi - y * pw; return [x - 1 + b[0], y - 1 + b[1]];
}

/* ---------- color (cv2.COLOR_RGB2LAB on 8-bit, then L in 0..100 and a, b around 0, like the prototype's lab()) ---------- */
const G = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 255; G[i] = x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
const fLab = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
const sat8 = (v) => v < 0 ? 0 : v > 255 ? 255 : cvRound(v);
export function lab1(r, g, b, out, o = 0) {
  r = G[r]; g = G[g]; b = G[b];
  const X = (0.412453 * r + 0.357580 * g + 0.180423 * b) / 0.950456, Y = 0.212671 * r + 0.715160 * g + 0.072169 * b, Z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / 1.088754;
  const L = Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y; const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  out[o] = sat8(L * 255 / 100) * 100 / 255; out[o + 1] = sat8(500 * (fx - fy) + 128) - 128; out[o + 2] = sat8(200 * (fy - fz) + 128) - 128;
  return out;
}
const LAB_CACHE = new Map();
export function labOf(rgb, n) {                    // RGB Uint8Array(n*3) -> Float32Array(n*3)
  const out = new Float32Array(n * 3); const t = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2], key = (r << 16) | (g << 8) | b;
    let v = LAB_CACHE.get(key);
    if (!v) { lab1(r, g, b, t); v = [t[0], t[1], t[2]]; if (LAB_CACHE.size < 2e6) LAB_CACHE.set(key, v); }
    out[i * 3] = v[0]; out[i * 3 + 1] = v[1]; out[i * 3 + 2] = v[2];
  }
  return out;
}
export function labOfFloat(c) {                    // float RGB centers -> Lab (clipped to 8-bit first, like lab(np.clip(...)))
  const n = c.length / 3; const u = new Uint8Array(n * 3); for (let i = 0; i < u.length; i++) u[i] = sat8(c[i]); return labOf(u, n);
}

/* ---------- k-means (cv2.kmeans with KMEANS_PP_CENTERS, 3 attempts, 30 rounds, eps 0.5) ---------- */
export function kmeans(pts, dim, k, { attempts = 3, iters = 30, eps = 0.5, seed = 12345 } = {}) {
  const n = pts.length / dim; k = Math.max(1, Math.min(k, n)); const rnd = mulberry32(seed);
  let best = null;
  const labels = new Int32Array(n); const dist = new Float64Array(n);
  for (let at = 0; at < attempts; at++) {
    const C = new Float64Array(k * dim);
    // k-means++ (cv2 generateCentersPP: 3 trials per center)
    let i0 = Math.min(n - 1, (rnd() * n) | 0); for (let d = 0; d < dim; d++) C[d] = pts[i0 * dim + d];
    let sum = 0; for (let i = 0; i < n; i++) { let s = 0; for (let d = 0; d < dim; d++) { const t = pts[i * dim + d] - C[d]; s += t * t; } dist[i] = s; sum += s; }
    for (let c = 1; c < k; c++) {
      let bestSum = Infinity, bestI = 0;
      for (let tr = 0; tr < 3; tr++) {
        let p = rnd() * sum, ci = 0; for (; ci < n - 1; ci++) { p -= dist[ci]; if (p <= 0) break; }
        let s2 = 0; for (let i = 0; i < n; i++) { let s = 0; for (let d = 0; d < dim; d++) { const t = pts[i * dim + d] - pts[ci * dim + d]; s += t * t; } s2 += Math.min(s, dist[i]); }
        if (s2 < bestSum) { bestSum = s2; bestI = ci; }
      }
      for (let d = 0; d < dim; d++) C[c * dim + d] = pts[bestI * dim + d];
      sum = 0; for (let i = 0; i < n; i++) { let s = 0; for (let d = 0; d < dim; d++) { const t = pts[i * dim + d] - C[c * dim + d]; s += t * t; } if (s < dist[i]) dist[i] = s; sum += dist[i]; }
    }
    let comp = 0;
    for (let it = 0; it < iters; it++) {
      comp = 0;
      for (let i = 0; i < n; i++) {
        let bd = Infinity, bc = 0;
        for (let c = 0; c < k; c++) { let s = 0; for (let d = 0; d < dim; d++) { const t = pts[i * dim + d] - C[c * dim + d]; s += t * t; } if (s < bd) { bd = s; bc = c; } }
        labels[i] = bc; dist[i] = bd; comp += bd;
      }
      const S = new Float64Array(k * dim), cnt = new Int32Array(k);
      for (let i = 0; i < n; i++) { const c = labels[i]; cnt[c]++; for (let d = 0; d < dim; d++) S[c * dim + d] += pts[i * dim + d]; }
      let shift = 0;
      for (let c = 0; c < k; c++) {
        if (!cnt[c]) {                             // an empty cluster takes the point farthest from its center
          let fi = 0, fd = -1; for (let i = 0; i < n; i++) if (dist[i] > fd) { fd = dist[i]; fi = i; }
          for (let d = 0; d < dim; d++) { const nv = pts[fi * dim + d]; shift = Math.max(shift, Math.abs(nv - C[c * dim + d])); C[c * dim + d] = nv; } dist[fi] = 0; continue;
        }
        let s = 0; for (let d = 0; d < dim; d++) { const nv = S[c * dim + d] / cnt[c]; const t = nv - C[c * dim + d]; s += t * t; C[c * dim + d] = nv; } shift = Math.max(shift, s);
      }
      if (shift <= eps * eps) break;
    }
    comp = 0; for (let i = 0; i < n; i++) { let bd = Infinity, bc = 0; for (let c = 0; c < k; c++) { let s = 0; for (let d = 0; d < dim; d++) { const t = pts[i * dim + d] - C[c * dim + d]; s += t * t; } if (s < bd) { bd = s; bc = c; } } labels[i] = bc; comp += bd; }
    if (!best || comp < best.comp) best = { comp, centers: Float32Array.from(C), labels: labels.slice() };
  }
  return best;
}
export function kcenters(rgbPts, k, seed = 7) {   // the prototype's kcenters(): RGB points (Uint8Array n*3) -> k centers (Float32Array k*3)
  let n = rgbPts.length / 3; let src = rgbPts;
  if (n > 40000) { const rnd = mulberry32(seed); const idx = new Int32Array(n); for (let i = 0; i < n; i++) idx[i] = i; for (let i = 0; i < 40000; i++) { const j = i + ((rnd() * (n - i)) | 0); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; } src = new Uint8Array(120000); for (let i = 0; i < 40000; i++) { src[i * 3] = rgbPts[idx[i] * 3]; src[i * 3 + 1] = rgbPts[idx[i] * 3 + 1]; src[i * 3 + 2] = rgbPts[idx[i] * 3 + 2]; } n = 40000; }
  const f = new Float32Array(n * 3); for (let i = 0; i < f.length; i++) f[i] = src[i];
  return kmeans(f, 3, Math.max(1, Math.min(k, n)), { seed: seed + n }).centers;
}
export function pick(rgb, m, w, h) {               // the RGB values under a mask, as Uint8Array(n*3)
  let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; const o = new Uint8Array(n * 3); let j = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) { o[j++] = rgb[i * 3]; o[j++] = rgb[i * 3 + 1]; o[j++] = rgb[i * 3 + 2]; }
  return o;
}

/* ---------- flat color areas (skimage.segmentation.felzenszwalb, scale/k with colors in 0..1, sigma 0) ---------- */
export function felzenszwalb(rgb, w, h, scale = 30, minSize = 8, costDiv = 1) {
  const N = w * h; const nR = (w - 1) * h, nD = w * (h - 1), nDR = (w - 1) * (h - 1), nE = nR + nD + 2 * nDR;
  const key = new Int32Array(nE); let e = 0;
  const d2 = (p, q) => { const a = rgb[p * 3] - rgb[q * 3], b = rgb[p * 3 + 1] - rgb[q * 3 + 1], c = rgb[p * 3 + 2] - rgb[q * 3 + 2]; return a * a + b * b + c * c; };
  // skimage's edge order: right, down, down-right, up-right (each block row by row); the cost is the color distance.
  // The two ends of edge i are worked out from i (no arrays for them: saves memory on big pictures)
  const ends = (i, o) => {
    let j = i, y, x, p;
    if (j < nR) { y = (j / (w - 1)) | 0; x = j - y * (w - 1) + 1; p = y * w + x; o[0] = p; o[1] = p - 1; return; } j -= nR;
    if (j < nD) { y = ((j / w) | 0) + 1; x = j - (y - 1) * w; p = y * w + x; o[0] = p; o[1] = p - w; return; } j -= nD;
    if (j < nDR) { y = ((j / (w - 1)) | 0) + 1; x = j - (y - 1) * (w - 1) + 1; p = y * w + x; o[0] = p; o[1] = p - w - 1; return; } j -= nDR;
    y = (j / (w - 1)) | 0; x = j - y * (w - 1) + 1; p = y * w + x; o[0] = p; o[1] = p + w - 1;
  };
  for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) { const p = y * w + x; key[e++] = d2(p, p - 1); }
  for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; key[e++] = d2(p, p - w); }
  for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) { const p = y * w + x; key[e++] = d2(p, p - w - 1); }
  for (let y = 0; y < h - 1; y++) for (let x = 1; x < w; x++) { const p = y * w + x; key[e++] = d2(p, p + w - 1); }
  const E2 = [0, 0];
  // sort by cost: costs are sqrt(integer)/255, so a counting sort on the integer is exact (ties keep their order)
  const MAXK = 3 * 255 * 255 + 1; const cnt = new Int32Array(MAXK + 1);
  for (let i = 0; i < nE; i++) cnt[key[i] + 1]++;
  for (let i = 0; i < MAXK; i++) cnt[i + 1] += cnt[i];
  const order = new Int32Array(nE); for (let i = 0; i < nE; i++) order[cnt[key[i]]++] = i;
  const forest = new Int32Array(N); for (let i = 0; i < N; i++) forest[i] = i;
  const size = new Int32Array(N).fill(1); const cint = new Float64Array(N);
  const find = (n) => { let r = n; while (forest[r] < r) r = forest[r]; while (forest[n] < n) { const t = forest[n]; forest[n] = r; n = t; } return r; };
  const join = (a, b) => { if (a !== b) { a = find(a); b = find(b); if (a > b) forest[a] = b; else forest[b] = a; } };
  // skimage works on colors in 0..1 but also divides scale by 255, so in 8-bit units the cost is the plain color distance
  const cost = new Float64Array(MAXK); for (let i = 0; i < MAXK; i++) cost[i] = Math.sqrt(i) / costDiv;
  for (let t = 0; t < nE; t++) {
    const i = order[t]; ends(i, E2); const s0 = find(E2[0]), s1 = find(E2[1]); if (s0 === s1) continue;
    const c = cost[key[i]];
    if (c < Math.min(cint[s0] + scale / size[s0], cint[s1] + scale / size[s1])) { join(s0, s1); const sn = find(s0); size[sn] = size[s0] + size[s1]; cint[sn] = c; }
  }
  for (let t = 0; t < nE; t++) {
    const i = order[t]; ends(i, E2); const s0 = find(E2[0]), s1 = find(E2[1]); if (s0 === s1) continue;
    if (size[s0] < minSize || size[s1] < minSize) { join(s0, s1); const sn = find(s0); size[sn] = size[s0] + size[s1]; }
  }
  const lab = new Int32Array(N); const map = new Int32Array(N).fill(-1); let n = 0;
  for (let i = 0; i < N; i++) { const r = find(i); if (map[r] < 0) map[r] = n++; lab[i] = map[r]; }
  lab.count = n; return lab;
}

/* ---------- resizing (cv2.resize) ---------- */
export function resizeNearest(src, sw, sh, dw, dh, ch = 1) {
  const out = new (src.constructor)(dw * dh * ch); const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) { const sy = Math.min(sh - 1, Math.floor(y * fy)); for (let x = 0; x < dw; x++) { const sx = Math.min(sw - 1, Math.floor(x * fx)); for (let c = 0; c < ch; c++) out[(y * dw + x) * ch + c] = src[(sy * sw + sx) * ch + c]; } }
  return out;
}
function linCoef(sn, dn) {
  const sc = sn / dn, i0 = new Int32Array(dn), i1 = new Int32Array(dn), a = new Float32Array(dn);
  for (let d = 0; d < dn; d++) { let f = (d + 0.5) * sc - 0.5; let s = Math.floor(f); f -= s; if (s < 0) { s = 0; f = 0; } if (s >= sn - 1) { s = sn - 1; f = 0; } i0[d] = s; i1[d] = Math.min(sn - 1, s + 1); a[d] = f; }
  return { i0, i1, a };
}
export function resizeLinear(src, sw, sh, dw, dh, ch = 1, round = false) {   // float math; round=true for 8-bit pictures
  const X = linCoef(sw, dw), Y = linCoef(sh, dh); const out = new (src.constructor)(dw * dh * ch);
  for (let y = 0; y < dh; y++) {
    const r0 = Y.i0[y] * sw, r1 = Y.i1[y] * sw, b = Y.a[y];
    for (let x = 0; x < dw; x++) {
      const a = X.a[x], p00 = (r0 + X.i0[x]) * ch, p01 = (r0 + X.i1[x]) * ch, p10 = (r1 + X.i0[x]) * ch, p11 = (r1 + X.i1[x]) * ch;
      for (let c = 0; c < ch; c++) {
        const v = (src[p00 + c] * (1 - a) + src[p01 + c] * a) * (1 - b) + (src[p10 + c] * (1 - a) + src[p11 + c] * a) * b;
        out[(y * dw + x) * ch + c] = round ? Math.max(0, Math.min(255, Math.round(v))) : v;
      }
    }
  }
  return out;
}
function areaUpCoef(sn, dn) {                     // cv2 INTER_AREA when enlarging: its own interpolation weights
  const sc = sn / dn, inv = dn / sn, i0 = new Int32Array(dn), i1 = new Int32Array(dn), a = new Float32Array(dn);
  for (let d = 0; d < dn; d++) { let s = Math.floor(d * sc); let f = (d + 1) - (s + 1) * inv; f = f <= 0 ? 0 : f - Math.floor(f); if (s < 0) { s = 0; f = 0; } if (s >= sn - 1) { s = sn - 1; f = 0; } i0[d] = s; i1[d] = Math.min(sn - 1, s + 1); a[d] = f; }
  return { i0, i1, a };
}
export function resizeArea(src, sw, sh, dw, dh, ch = 3) {    // 8-bit pictures; shrinking averages areas, enlarging interpolates like cv2
  if (dw > sw || dh > sh) {
    const X = areaUpCoef(sw, dw), Y = areaUpCoef(sh, dh); const out = new Uint8Array(dw * dh * ch);
    for (let y = 0; y < dh; y++) {
      const r0 = Y.i0[y] * sw, r1 = Y.i1[y] * sw, b = Y.a[y];
      for (let x = 0; x < dw; x++) {
        const a = X.a[x], p00 = (r0 + X.i0[x]) * ch, p01 = (r0 + X.i1[x]) * ch, p10 = (r1 + X.i0[x]) * ch, p11 = (r1 + X.i1[x]) * ch;
        for (let c = 0; c < ch; c++) out[(y * dw + x) * ch + c] = Math.max(0, Math.min(255, Math.round((src[p00 + c] * (1 - a) + src[p01 + c] * a) * (1 - b) + (src[p10 + c] * (1 - a) + src[p11 + c] * a) * b)));
      }
    }
    return out;
  }
  const out = new Uint8Array(dw * dh * ch); const fx = sw / dw, fy = sh / dh; const acc = new Float64Array(ch);
  for (let y = 0; y < dh; y++) {
    const ya = y * fy, yb = (y + 1) * fy;
    for (let x = 0; x < dw; x++) {
      const xa = x * fx, xb = (x + 1) * fx; acc.fill(0); let wsum = 0;
      for (let sy = Math.floor(ya); sy < Math.min(sh, Math.ceil(yb)); sy++) {
        const wy = Math.min(yb, sy + 1) - Math.max(ya, sy); if (wy <= 0) continue;
        for (let sx = Math.floor(xa); sx < Math.min(sw, Math.ceil(xb)); sx++) {
          const wx = Math.min(xb, sx + 1) - Math.max(xa, sx); if (wx <= 0) continue; const wgt = wx * wy; wsum += wgt;
          for (let c = 0; c < ch; c++) acc[c] += src[(sy * sw + sx) * ch + c] * wgt;
        }
      }
      for (let c = 0; c < ch; c++) out[(y * dw + x) * ch + c] = Math.max(0, Math.min(255, Math.round(acc[c] / wsum)));
    }
  }
  return out;
}

/* ---------- small filters on a region (cv2.medianBlur, cv2.GaussianBlur) ---------- */
export function medianBlur8(u8, w, h, k, roi) {     // replicate border, like cv2; only inside roi, the rest copied
  const out = u8.slice(); const r = k >> 1; const [X0, Y0, X1, Y1] = roi || [0, 0, w, h]; const hist = new Int32Array(256); const half = (k * k) >> 1;
  for (let y = Y0; y < Y1; y++) {
    hist.fill(0);
    for (let dy = -r; dy <= r; dy++) { const yy = Math.min(h - 1, Math.max(0, y + dy)); for (let dx = -r; dx <= r; dx++) { const xx = Math.min(w - 1, Math.max(0, X0 + dx)); hist[u8[yy * w + xx]]++; } }
    for (let x = X0; x < X1; x++) {
      if (x > X0) for (let dy = -r; dy <= r; dy++) { const yy = Math.min(h - 1, Math.max(0, y + dy)); hist[u8[yy * w + Math.min(w - 1, Math.max(0, x - r - 1))]]--; hist[u8[yy * w + Math.min(w - 1, x + r)]]++; }
      let c = 0, v = 0; for (; v < 256; v++) { c += hist[v]; if (c > half) break; } out[y * w + x] = v;
    }
  }
  return out;
}
export function gaussianBlur(f, w, h, sigma, roi) {  // float map; reflect-101 border; kernel size like cv2 for float images
  let ks = cvRound(sigma * 4 * 2 + 1) | 1; const r = ks >> 1; const kern = new Float64Array(ks); let s = 0;
  for (let i = 0; i < ks; i++) { const t = i - r; kern[i] = Math.exp(-(t * t) / (2 * sigma * sigma)); s += kern[i]; } for (let i = 0; i < ks; i++) kern[i] /= s;
  const [X0, Y0, X1, Y1] = roi || [0, 0, w, h]; const refl = (i, n) => { if (n === 1) return 0; while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i; return i; };
  const ya = Math.max(0, Y0 - r), yb = Math.min(h, Y1 + r); const tmp = new Float64Array((yb - ya) * (X1 - X0));
  for (let y = ya; y < yb; y++) for (let x = X0; x < X1; x++) { let a = 0; for (let i = 0; i < ks; i++) a += kern[i] * f[y * w + refl(x + i - r, w)]; tmp[(y - ya) * (X1 - X0) + x - X0] = a; }
  const out = Float32Array.from(f);
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { let a = 0; for (let i = 0; i < ks; i++) { const yy = refl(y + i - r, h); a += kern[i] * (yy >= ya && yy < yb ? tmp[(yy - ya) * (X1 - X0) + x - X0] : 0); } out[y * w + x] = a; }
  return out;
}
export function percentile(arr, p) {               // numpy's default (linear) percentile
  const a = Float64Array.from(arr).sort(); if (!a.length) return NaN; const i = p / 100 * (a.length - 1); const lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
export function median(arr) { return percentile(arr, 50); }
