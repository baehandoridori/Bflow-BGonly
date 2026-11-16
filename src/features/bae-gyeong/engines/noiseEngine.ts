/**
 * BAE경 노이즈 제거 엔진 v1. HTML v0.4.11 script_4.js 의 NOISE_WORKER_SRC (파이썬 celflat9.py '면 평평하게' v2 의 JS 판) 를
 * 계산 그대로 옮긴 순수 함수 (DOM 없음). 한 면 = 한 색: GPT 의 물자국 얼룩 · 붓 덩어리 · 줄무늬는 그 면의 색으로 칠하고,
 * 또렷한 윤곽 · 그린 선 · 설계된 톤(밝은 잎 옆의 어두운 잎)은 남긴다.
 *   1) 경계: 또렷한 색 경계(가벼운 bilateral 뒤 L · a · b 에 Canny) + ±1.5px 안에서 바뀌는 흐린 경계(벽 모서리. 5~10px 에
 *      걸쳐 번지는 물자국 가장자리는 뺌) + 5px 안의 다른 윤곽에 잇는 끊긴 윤곽 끝 + 그린 선(가는 능선. 초록 · 갈색 면 안에서는
 *      길거나 확실히 진한 것만)
 *   2) 경계로 닫힌 칸마다 원래 색의 중앙값 한 색
 *   3) 틈으로 큰 칸에 샌 면(양쪽이 같은 칸인 윤곽에 둘러싸인 것)은 따로 칸
 *   4) 거의 같은 색의 초록 · 갈색 칸은 같은 물감 (기둥에 잘린 나무 덩어리)
 *   5) 초록 · 갈색이 아닌 넓은 면(하늘)은 깨끗한 직선 그라데이션이 있으면 그대로
 *   6) 경계 픽셀은 양쪽 물감의 섞임으로 원래 안티앨리어싱 자리에. 섞임으로 설명 안 되는 픽셀(선 · 하이라이트)과 그린 선은 원래 픽셀
 * AI · 인터넷 없음: 이 PC 의 그림 계산뿐. 스레드는 noiseWorker.ts, 화면 쪽 호출은 index.ts.
 * 숫자 · 순서 · 배열 종류(Float32 / Float64 / Int16)를 바꾸면 결과가 HTML 과 달라진다.
 */

type Chan3 = [Float32Array, Float32Array, Float32Array];

/* ---------- 색 ---------- */
const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; }
const fl = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
function toLab(rgba: ArrayLike<number>, n: number): Chan3 {   // skimage / OpenCV float rgb2lab (D65)
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  const cache = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], key = (r << 16) | (g << 8) | b;
    let v = cache.get(key);
    if (v === undefined) {
      const R = LIN[r], G = LIN[g], Bl = LIN[b];
      const x = fl((0.412453 * R + 0.357580 * G + 0.180423 * Bl) / 0.95047), y = fl(0.212671 * R + 0.715160 * G + 0.072169 * Bl), z = fl((0.019334 * R + 0.119193 * G + 0.950227 * Bl) / 1.08883);
      v = [116 * y - 16, 500 * (x - y), 200 * (y - z)]; if (cache.size < 400000) cache.set(key, v);
    }
    L[i] = v[0]; A[i] = v[1]; B[i] = v[2];
  }
  return [L, A, B];
}
const finv = (t: number) => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
const GLUT = new Uint8Array(8193); for (let i = 0; i <= 8192; i++) { const c = i / 8192, g = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; GLUT[i] = Math.round(255 * Math.min(1, Math.max(0, g))); }
const gam8 = (c: number) => c <= 0 ? 0 : c >= 1 ? 255 : GLUT[Math.round(c * 8192)];
function labToRgb(L: number, a: number, b: number, out: Uint8ClampedArray, o: number): void {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = 0.95047 * finv(fx), Y = finv(fy), Z = 1.08883 * finv(fz);
  out[o] = gam8(3.240479 * X - 1.537150 * Y - 0.498535 * Z);
  out[o + 1] = gam8(-0.969256 * X + 1.875992 * Y + 0.041556 * Z);
  out[o + 2] = gam8(0.055648 * X - 0.204043 * Y + 1.057311 * Z);
}
function family(L: number, a: number, b: number): number {   // 0 그 밖, 1 초록(잎 · 나무 · 풀), 2 갈색(나무 · 줄기 · 황갈색 바닥). 크림색 벽은 0
  const chroma = Math.hypot(a, b); let hue = Math.atan2(b, a) * 180 / Math.PI; if (hue < 0) hue += 360;
  if (chroma > 15 && hue >= 100 && hue <= 200 && a < -6) return 1;
  if (chroma > 18 && hue >= 45 && hue < 95 && a > 2) return 2;
  return 0;
}
/* ---------- 필터 ---------- */
const refl = (i: number, n: number) => { while (i < 0 || i >= n) { if (i < 0) i = -i; if (i >= n) i = 2 * n - 2 - i; } return i; };   // OpenCV BORDER_REFLECT_101
function gaussKernel(sigma: number): { k: Float32Array; r: number } {
  const r = Math.max(1, Math.ceil(3 * sigma)), ks = 2 * r + 1, k = new Float32Array(ks); let s = 0;   // 3 시그마 (OpenCV 는 4, 꼬리는 1% 미만)
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < ks; i++) k[i] /= s; return { k, r };
}
function gauss(src: Float32Array, W: number, H: number, sigma: number): Float32Array {   // 분리형, reflect-101 테두리 (cv2.GaussianBlur)
  const { k, r } = gaussKernel(sigma), tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < r && x < W; x++) { let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * src[o + refl(x + i, W)]; tmp[o + x] = v; }
    for (let x = Math.max(r, W - r); x < W; x++) { let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * src[o + refl(x + i, W)]; tmp[o + x] = v; }
    for (let i = -r; i <= r; i++) { const w = k[i + r], so = o + i; for (let x = r; x < W - r; x++) tmp[o + x] += w * src[so + x]; }
  }
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let i = -r; i <= r; i++) { const w = k[i + r], so = refl(y + i, H) * W; for (let x = 0; x < W; x++) out[o + x] += w * tmp[so + x]; }
  }
  return out;
}
function bilateral(C: Chan3, W: number, H: number): Chan3 {   // cv2.bilateralFilter(lab, 0, sigmaColor 3, sigmaSpace 2): 7x7 원, 색 거리 = |dL|+|da|+|db|
  const R = 3, offs: Array<[number, number]> = [], sw: number[] = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const d = Math.sqrt(dx * dx + dy * dy); if (d > R) continue; offs.push([dx, dy]); sw.push(Math.exp(-(dx * dx + dy * dy) * 0.125)); }
  const NB = 1024, MAXD = 16, lut = new Float32Array(NB + 1);
  for (let i = 0; i <= NB; i++) { const d = i * MAXD / NB; lut[i] = Math.exp(-d * d / 18); }
  const [L, A, B] = C, n = W * H, oL = new Float32Array(n), oA = new Float32Array(n), oB = new Float32Array(n), K = offs.length;
  const odx = new Int32Array(K), ody = new Int32Array(K), osw = new Float32Array(sw); for (let k = 0; k < K; k++) { odx[k] = offs[k][0]; ody[k] = offs[k][1]; }
  for (let y = 0; y < H; y++) {
    const inY = y >= R && y < H - R;
    for (let x = 0; x < W; x++) {
      const p = y * W + x, l0 = L[p], a0 = A[p], b0 = B[p], inside = inY && x >= R && x < W - R;
      let ws = 0, sl = 0, sa = 0, sb = 0;
      for (let k = 0; k < K; k++) {
        const q = inside ? p + ody[k] * W + odx[k] : refl(y + ody[k], H) * W + refl(x + odx[k], W);
        const lq = L[q], aq = A[q], bq = B[q];
        const d = Math.abs(lq - l0) + Math.abs(aq - a0) + Math.abs(bq - b0); if (d >= MAXD) continue;
        const w = osw[k] * lut[(d * NB / MAXD) | 0]; ws += w; sl += w * lq; sa += w * aq; sb += w * bq;
      }
      oL[p] = sl / ws; oA[p] = sa / ws; oB[p] = sb / ws;
    }
  }
  return [oL, oA, oB];
}
/* Canny (OpenCV, aperture 3, L2 기울기): 8비트 채널에 Sobel, 최대 아닌 것 빼기, 이력 문턱 */
interface Grad { dx: Int16Array; dy: Int16Array }
function sobel8(img: Uint8Array, W: number, H: number): Grad {   // cv::Canny 처럼 BORDER_REPLICATE
  const dx = new Int16Array(W * H), dy = new Int16Array(W * H), cl = (v: number, n: number) => v < 0 ? 0 : v >= n ? n - 1 : v;
  for (let y = 0; y < H; y++) {
    const ym = cl(y - 1, H) * W, y0 = y * W, yp = cl(y + 1, H) * W;
    for (let x = 0; x < W; x++) {
      const xm = cl(x - 1, W), xp = cl(x + 1, W);
      dx[y0 + x] = (img[ym + xp] - img[ym + xm]) + 2 * (img[y0 + xp] - img[y0 + xm]) + (img[yp + xp] - img[yp + xm]);
      dy[y0 + x] = (img[yp + xm] - img[ym + xm]) + 2 * (img[yp + x] - img[ym + x]) + (img[yp + xp] - img[ym + xp]);
    }
  }
  return { dx, dy };
}
function canny(g: Grad, W: number, H: number, lo: number, hi: number): Uint8Array {
  const { dx, dy } = g, n = W * H, mag = new Int32Array(n);
  for (let i = 0; i < n; i++) mag[i] = dx[i] * dx[i] + dy[i] * dy[i];
  const low = lo * lo, high = hi * hi, map = new Uint8Array(n), stack = new Int32Array(n); let sp = 0;   // 0 아마, 1 아님, 2 경계
  const TG22 = Math.round(0.4142135623730950488 * (1 << 15));
  for (let y = 0; y < H; y++) {
    let prevFlag = 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, m = mag[i];
      if (m <= low || x === 0 || y === 0 || x === W - 1 || y === H - 1) { map[i] = 1; prevFlag = 0; continue; }
      const xs = Math.abs(dx[i]), ys = Math.abs(dy[i]), tg22x = xs * TG22, yy = ys * 32768;
      let keep = false;
      if (yy < tg22x) keep = m > mag[i - 1] && m >= mag[i + 1];
      else {
        const tg67x = tg22x + xs * 65536;
        if (yy > tg67x) keep = m > mag[i - W] && m >= mag[i + W];
        else { const s = ((dx[i] ^ dy[i]) < 0) ? -1 : 1; keep = m > mag[i - W - s] && m > mag[i + W + s]; }
      }
      if (!keep) { map[i] = 1; prevFlag = 0; continue; }
      if (m > high && !prevFlag && map[i - W] !== 2) { map[i] = 2; stack[sp++] = i; prevFlag = 1; } else map[i] = 0;
    }
  }
  const NB = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
  while (sp) {
    const i = stack[--sp];
    for (let k = 0; k < 8; k++) { const j = i + NB[k]; if (j >= 0 && j < n && map[j] === 0) { map[j] = 2; stack[sp++] = j; } }
  }
  const e = new Uint8Array(n); for (let i = 0; i < n; i++) e[i] = map[i] === 2 ? 1 : 0; return e;
}
/* ---------- 0/1 그림 도우미 ---------- */
function dilateSq(m: Uint8Array, W: number, H: number, r: number): Uint8Array { return boxMorph(m, W, H, r, true); }
function erodeSq(m: Uint8Array, W: number, H: number, r: number): Uint8Array { return boxMorph(m, W, H, r, false); }
function boxMorph(m: Uint8Array, W: number, H: number, r: number, dil: boolean): Uint8Array {   // 정사각형 (2r+1) 최대 / 최소. 바깥 픽셀은 세지 않음 (OpenCV 기본 테두리)
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = dil ? 0 : 1; const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
    for (let xx = x0; xx <= x1; xx++) { const q = m[y * W + xx]; if (dil ? q : !q) { v = dil ? 1 : 0; break; } }
    tmp[y * W + x] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = dil ? 0 : 1; const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let yy = y0; yy <= y1; yy++) { const q = tmp[yy * W + x]; if (dil ? q : !q) { v = dil ? 1 : 0; break; } }
    out[y * W + x] = v;
  }
  return out;
}
interface Labels { lab: Int32Array; n: number; area: Int32Array; X0: Int32Array; Y0: Int32Array; X1: Int32Array; Y1: Int32Array }
function labelCC(m: ArrayLike<number>, W: number, H: number, eight: boolean): Labels {   // m != 0 의 이어진 덩어리 → { lab (1..n), n, area, x0, y0, x1, y1 }
  const n = W * H, lab = new Int32Array(n), parent = [0];
  const find = (a: number) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const uni = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; } };
  let next = 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!m[i]) continue;
    let l = 0, q: number;
    if (x > 0 && (q = lab[i - 1])) l = q;
    if (y > 0 && (q = lab[i - W])) { if (!l) l = q; else if (q !== l) uni(l, q); }
    if (eight && y > 0) {
      if (x > 0 && (q = lab[i - W - 1])) { if (!l) l = q; else if (q !== l) uni(l, q); }
      if (x < W - 1 && (q = lab[i - W + 1])) { if (!l) l = q; else if (q !== l) uni(l, q); }
    }
    if (!l) { l = next++; parent.push(l); }
    lab[i] = l;
  }
  const remap = new Int32Array(next); let cnt = 0;
  for (let l = 1; l < next; l++) { const r = find(l); if (!remap[r]) remap[r] = ++cnt; remap[l] = remap[r]; }
  const area = new Int32Array(cnt + 1), X0 = new Int32Array(cnt + 1).fill(W), Y0 = new Int32Array(cnt + 1).fill(H), X1 = new Int32Array(cnt + 1).fill(-1), Y1 = new Int32Array(cnt + 1).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!lab[i]) continue; const l = remap[lab[i]]; lab[i] = l; area[l]++;
    const x = i % W, y = (i / W) | 0; if (x < X0[l]) X0[l] = x; if (x > X1[l]) X1[l] = x; if (y < Y0[l]) Y0[l] = y; if (y > Y1[l]) Y1[l] = y;
  }
  return { lab, n: cnt, area, X0, Y0, X1, Y1 };
}
/* 가장 가까운 씨앗까지의 정확한 유클리드 거리와 그 씨앗 (Felzenszwalb & Huttenlocher) */
function edt(seed: ArrayLike<number>, W: number, H: number): { d2: Float32Array; near: Int32Array } {
  const INF = 1e20, n = W * H, d2 = new Float32Array(n), near = new Int32Array(n), M = Math.max(W, H);
  const f = new Float64Array(M), src = new Int32Array(M), v = new Int32Array(M), z = new Float64Array(M + 1);
  const colD = new Float64Array(n), colI = new Int32Array(n);
  const run = (len: number, outD: Float32Array | Float64Array, outI: Int32Array, base: number, stride: number) => {   // f[0..len) 와 src[0..len) 는 부르는 쪽이 채운다
    let q0 = 0; while (q0 < len && f[q0] >= INF) q0++;
    if (q0 === len) { for (let q = 0; q < len; q++) { outD[base + q * stride] = INF; outI[base + q * stride] = -1; } return; }
    let k = 0; v[0] = q0; z[0] = -INF; z[1] = INF;
    for (let q = q0 + 1; q < len; q++) {
      const fq = f[q]; if (fq >= INF) continue;
      let s = ((fq + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((fq + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const t = q - v[k]; outD[base + q * stride] = t * t + f[v[k]]; outI[base + q * stride] = src[v[k]]; }
  };
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) { const i = y * W + x; f[y] = seed[i] ? 0 : INF; src[y] = i; } run(H, colD, colI, x, W); }
  for (let y = 0; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) { f[x] = colD[o + x]; src[x] = colI[o + x]; } run(W, d2, near, o, 1); }
  return { d2, near };
}
/* Zhang-Suen 가늘게 하기 (skimage skeletonize) */
function skeleton(m: Uint8Array, W: number, H: number): Uint8Array {
  const s = new Uint8Array(m); let list: number[] = []; for (let i = 0; i < s.length; i++) if (s[i]) list.push(i);
  const at = (i: number, dx: number, dy: number) => { const x = i % W + dx, y = ((i / W) | 0) + dy; return x < 0 || y < 0 || x >= W || y >= H ? 0 : s[y * W + x]; };
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const del: number[] = [];
      for (const i of list) {
        if (!s[i]) continue;
        const p2 = at(i, 0, -1), p3 = at(i, 1, -1), p4 = at(i, 1, 0), p5 = at(i, 1, 1), p6 = at(i, 0, 1), p7 = at(i, -1, 1), p8 = at(i, -1, 0), p9 = at(i, -1, -1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9; if (B < 2 || B > 6) continue;
        // (!a && b) 를 더하는 것 그대로 (false 는 0)
        const A = +(!p2 && p3) + +(!p3 && p4) + +(!p4 && p5) + +(!p5 && p6) + +(!p6 && p7) + +(!p7 && p8) + +(!p8 && p9) + +(!p9 && p2); if (A !== 1) continue;
        if (pass === 0 ? (p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0) : (p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0)) del.push(i);
      }
      if (del.length) { changed = true; for (const i of del) s[i] = 0; }
    }
    list = list.filter((i) => s[i]);
  }
  return s;
}
function median(arr: Float32Array, len: number): number {   // 작업용 사본에서 quickselect (arr 는 다시 씀)
  if (!len) return 0; let lo = 0, hi = len - 1; const k = len >> 1;
  while (lo < hi) {
    const piv = arr[(lo + hi) >> 1]; let i = lo, j = hi;
    while (i <= j) { while (arr[i] < piv) i++; while (arr[j] > piv) j--; if (i <= j) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; i++; j--; } }
    if (k <= j) hi = j; else if (k >= i) lo = i; else break;
  }
  return arr[k];
}
function groupMedians(lab: Int32Array, sel: Uint8Array, C: Chan3, n: number): { med: Float32Array; cnt: Int32Array } {   // 묶음마다 픽셀의 L, a, b 중앙값 (lab[i] = 묶음, sel[i] = 쓸지)
  const N = lab.length, cnt = new Int32Array(n + 1);
  for (let i = 0; i < N; i++) if (sel[i] && lab[i] > 0) cnt[lab[i]]++;
  const start = new Int32Array(n + 2); for (let g = 1; g <= n; g++) start[g + 1] = start[g] + cnt[g];
  const pos = start.slice(), tot = start[n + 1], vL = new Float32Array(tot), vA = new Float32Array(tot), vB = new Float32Array(tot);
  for (let i = 0; i < N; i++) if (sel[i] && lab[i] > 0) { const p = pos[lab[i]]++; vL[p] = C[0][i]; vA[p] = C[1][i]; vB[p] = C[2][i]; }
  const out = new Float32Array((n + 1) * 3);
  for (let g = 1; g <= n; g++) {
    const s = start[g], len = cnt[g]; if (!len) continue;
    out[g * 3] = median(vL.subarray(s, s + len), len); out[g * 3 + 1] = median(vA.subarray(s, s + len), len); out[g * 3 + 2] = median(vB.subarray(s, s + len), len);
  }
  return { med: out, cnt };
}
/* ---------- 경계 ---------- */
function edgeFrame(C: Chan3, W: number, H: number): { nx: Float32Array; ny: Float32Array } {   // 가장 센 색 변화를 가로지르는 방향 (Lab 그림의 structure tensor)
  const n = W * H, jxx = new Float32Array(n), jyy = new Float32Array(n), jxy = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    const g = gauss(C[c], W, H, 1.5);
    for (let y = 0; y < H; y++) {
      const ym = refl(y - 1, H) * W, y0 = y * W, yp = refl(y + 1, H) * W;
      for (let x = 0; x < W; x++) {
        const xm = refl(x - 1, W), xp = refl(x + 1, W);
        const gx = ((g[ym + xp] - g[ym + xm]) + 2 * (g[y0 + xp] - g[y0 + xm]) + (g[yp + xp] - g[yp + xm])) / 8;
        const gy = ((g[yp + xm] - g[ym + xm]) + 2 * (g[yp + x] - g[ym + x]) + (g[yp + xp] - g[ym + xp])) / 8;
        const i = y0 + x; jxx[i] += gx * gx; jyy[i] += gy * gy; jxy[i] += gx * gy;
      }
    }
  }
  const nx = new Float32Array(n), ny = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = 0.5 * Math.atan2(2 * jxy[i], jxx[i] - jyy[i]); nx[i] = Math.cos(t); ny[i] = Math.sin(t); }
  return { nx, ny };
}
function bil(img: Float32Array, W: number, H: number, x: number, y: number): number {   // 쌍선형, 가장자리 고정 (scipy map_coordinates order 1, mode nearest)
  if (x < 0) x = 0; if (y < 0) y = 0; if (x > W - 1) x = W - 1; if (y > H - 1) y = H - 1;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1), fx = x - x0, fy = y - y0;
  return (img[y0 * W + x0] * (1 - fx) + img[y0 * W + x1] * fx) * (1 - fy) + (img[y1 * W + x0] * (1 - fx) + img[y1 * W + x1] * fx) * fy;
}
const CP = new Float32Array(63), CS = new Float32Array(21);
function crisp(S: Chan3, nx: Float32Array, ny: Float32Array, W: number, H: number, i: number): [number, number] {   // 경계를 가로지른 색 변화 중 ±1.5px 안에서 일어나는 몫 (1 = 칼 같은 경계, ~0.3 = 흐린 얼룩)
  const x = i % W, y = (i / W) | 0, vx = nx[i], vy = ny[i], T = 21, P = CP;
  for (let k = 0; k < T; k++) { const t = -5 + k * 0.5, cx = x + t * vx, cy = y + t * vy; for (let c = 0; c < 3; c++) P[k * 3 + c] = bil(S[c], W, H, cx, cy); }
  const l = [0, 0, 0], r = [0, 0, 0];
  for (let c = 0; c < 3; c++) { l[c] = (P[c] + P[3 + c] + P[6 + c]) / 3; r[c] = (P[(T - 3) * 3 + c] + P[(T - 2) * 3 + c] + P[(T - 1) * 3 + c]) / 3; }
  const d = [r[0] - l[0], r[1] - l[1], r[2] - l[2]], D = Math.hypot(d[0], d[1], d[2]) + 1e-6;
  const s = CS; for (let k = 0; k < T; k++) s[k] = ((P[k * 3] - l[0]) * d[0] + (P[k * 3 + 1] - l[1]) * d[1] + (P[k * 3 + 2] - l[2]) * d[2]) / (D * D);
  let best = 0; for (let j = 0; j + 6 < T; j++) { const t = -5 + j * 0.5; if (Math.abs(t + 1.5) > 1.01) continue; best = Math.max(best, s[j + 6] - s[j]); }
  return [best, D];
}
/* 그린 선: 양쪽보다 어둡거나 밝은 가는 능선 */
const ELL7 = [0, 2, 3, 3, 3, 2, 0];   // 7x7 타원 줄마다 반폭 (cv2.MORPH_ELLIPSE)
function greyMorph(src: Float32Array, W: number, H: number, dil: boolean): Float32Array {   // 7x7 타원으로 회색 팽창 / 침식. 바깥 픽셀은 세지 않음
  const rows: Array<Float32Array | null> = [src, null, null, null];
  for (const hw of [2, 3]) {
    const o = Float32Array.from(src);
    for (let y = 0; y < H; y++) {
      const b = y * W;
      for (let d = 1; d <= hw; d++) {
        if (dil) { for (let x = 0; x < W - d; x++) { const q = src[b + x + d]; if (q > o[b + x]) o[b + x] = q; } for (let x = d; x < W; x++) { const q = src[b + x - d]; if (q > o[b + x]) o[b + x] = q; } }
        else { for (let x = 0; x < W - d; x++) { const q = src[b + x + d]; if (q < o[b + x]) o[b + x] = q; } for (let x = d; x < W; x++) { const q = src[b + x - d]; if (q < o[b + x]) o[b + x] = q; } }
      }
    }
    rows[hw] = o;
  }
  const out = Float32Array.from(rows[3] as Float32Array);
  for (let y = 0; y < H; y++) {
    const b = y * W;
    for (let k = 0; k < 7; k++) {
      if (k >= 2 && k <= 4) continue;   // 가운데 세 줄: 3번 줄이 시작 값, 2 · 4번 줄은 아래에서
      const yy = y + k - 3; if (yy < 0 || yy >= H) continue; const R = rows[ELL7[k]] as Float32Array, rb = yy * W;
      if (dil) { for (let x = 0; x < W; x++) { const q = R[rb + x]; if (q > out[b + x]) out[b + x] = q; } }
      else { for (let x = 0; x < W; x++) { const q = R[rb + x]; if (q < out[b + x]) out[b + x] = q; } }
    }
    for (const yy of [y - 1, y + 1]) {
      if (yy < 0 || yy >= H) continue; const R = rows[3] as Float32Array, rb = yy * W;
      if (dil) { for (let x = 0; x < W; x++) { const q = R[rb + x]; if (q > out[b + x]) out[b + x] = q; } }
      else { for (let x = 0; x < W; x++) { const q = R[rb + x]; if (q < out[b + x]) out[b + x] = q; } }
    }
  }
  return out;
}
function conv1(a: Float64Array, b: Float64Array): Float64Array { const o = new Float64Array(a.length + b.length - 1); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) o[i + j] += a[i] * b[j]; return o; }
function pass1(src: Float32Array, W: number, H: number, k: Float64Array, alongX: boolean): Float32Array {   // 1-D 필터 한 번 (탭이 바깥 고리), reflect-101 테두리
  const r = (k.length - 1) >> 1, out = new Float32Array(W * H);
  if (alongX) {
    for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 0; x < W; x++) { if (x >= r && x < W - r) continue; let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * src[o + refl(x + i, W)]; out[o + x] = v; }
      for (let i = -r; i <= r; i++) { const w = k[i + r]; if (!w) continue; const so = o + i; for (let x = r; x < W - r; x++) out[o + x] += w * src[so + x]; }
    }
  } else {
    for (let y = 0; y < H; y++) { const o = y * W; for (let i = -r; i <= r; i++) { const w = k[i + r]; if (!w) continue; const so = refl(y + i, H) * W; for (let x = 0; x < W; x++) out[o + x] += w * src[so + x]; } }
  }
  return out;
}
function ridges(L: Float32Array, W: number, H: number): { rd: Float32Array; rb: Float32Array } {   // skimage sato (시그마 1, 1.6): 가우시안 미분 두 번(각 시그마 / √2)의 Hessian, 어두운 선과 밝은 선
  const n = W * H, rd = new Float32Array(n), rb = new Float32Array(n);
  for (const st of [1, 1.6]) {
    const s = st / Math.SQRT2, r = Math.ceil(4 * s), phi = new Float64Array(2 * r + 1); let sum = 0;
    for (let x = -r; x <= r; x++) { phi[x + r] = Math.exp(-x * x / (2 * s * s)); sum += phi[x + r]; }
    const d1 = new Float64Array(2 * r + 1); for (let x = -r; x <= r; x++) { phi[x + r] /= sum; } for (let x = -r; x <= r; x++) d1[x + r] = -x / (s * s) * phi[x + r];
    const Ks = conv1(phi, phi), Kd = conv1(d1, phi), Kdd = conv1(d1, d1);
    const ys = pass1(L, W, H, Ks, false), yd = pass1(L, W, H, Kd, false), ydd = pass1(L, W, H, Kdd, false);
    const hxx = pass1(ys, W, H, Kdd, true), hxy = pass1(yd, W, H, Kd, true), hyy = pass1(ydd, W, H, Ks, true), k2 = st * st;
    for (let i = 0; i < n; i++) {
      const tr = (hxx[i] + hyy[i]) / 2, h = (hxx[i] - hyy[i]) / 2, dt = Math.sqrt(h * h + hxy[i] * hxy[i]), l1 = tr + dt, l2 = tr - dt;
      if (l1 > 0 && k2 * l1 > rd[i]) rd[i] = k2 * l1; if (l2 < 0 && -k2 * l2 > rb[i]) rb[i] = -k2 * l2;
    }
  }
  return { rd, rb };
}
function hysteresis(resp: Float32Array, W: number, H: number, lo: number, hi: number): Uint8Array {   // skimage apply_hysteresis_threshold (4-이웃)
  const n = W * H, low = new Uint8Array(n); for (let i = 0; i < n; i++) low[i] = resp[i] > lo ? 1 : 0;
  const cc = labelCC(low, W, H, false), strong = new Uint8Array(cc.n + 1);
  for (let i = 0; i < n; i++) if (cc.lab[i] && resp[i] > hi) strong[cc.lab[i]] = 1;
  const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = cc.lab[i] && strong[cc.lab[i]] ? 1 : 0; return out;
}
function drawnLines(C: Chan3, W: number, H: number): { lines: Uint8Array; lineSk: Uint8Array; streaks: number } {
  const L = C[0], n = W * H;
  const close = greyMorph(greyMorph(L, W, H, true), W, H, false), open = greyMorph(greyMorph(L, W, H, false), W, H, true);
  const { rd, rb } = ridges(L, W, H);
  const hd = hysteresis(rd, W, H, 0.9, 2.2), hb = hysteresis(rb, W, H, 0.9 * 1.3, 2.2 * 1.3), m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = (hd[i] && close[i] - L[i] > 1.2) || (hb[i] && L[i] - open[i] > 1.6) ? 1 : 0;
  const cc = labelCC(m, W, H, true), sk = skeleton(m, W, H), skl = new Int32Array(cc.n + 1);
  for (let i = 0; i < n; i++) if (sk[i]) skl[cc.lab[i]]++;
  const { d2, near } = edt(m, W, H), d3 = dilateSq(m, W, H, 1), ring = new Uint8Array(n), owner = new Int32Array(n);
  for (let i = 0; i < n; i++) { ring[i] = d2[i] <= 27 && !d3[i] ? 1 : 0; owner[i] = near[i] >= 0 ? cc.lab[near[i]] : 0; }   // 선 둘레 2..5px 띠
  const line = groupMedians(cc.lab, m, C, cc.n).med, side = groupMedians(owner, ring, C, cc.n).med;
  const keep = new Uint8Array(cc.n + 1); let streaks = 0;
  for (let g = 1; g <= cc.n; g++) {
    const span = Math.max(cc.X1[g] - cc.X0[g] + 1, cc.Y1[g] - cc.Y0[g] + 1); if (span < 18) continue;
    const dE = Math.hypot(line[g * 3] - side[g * 3], line[g * 3 + 1] - side[g * 3 + 1], line[g * 3 + 2] - side[g * 3 + 2]);
    const gb = family(side[g * 3], side[g * 3 + 1], side[g * 3 + 2]) > 0;
    if (!gb || skl[g] >= 150 || dE >= 8) keep[g] = 1; else streaks++;
  }
  const lines = new Uint8Array(n), lineSk = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (keep[cc.lab[i]]) { lines[i] = 1; if (sk[i]) lineSk[i] = 1; }
  return { lines, lineSk, streaks };
}
function linkGaps(E: Uint8Array, W: number, H: number, R = 5, minLen = 8): { E: Uint8Array; links: number } {   // 끊긴 윤곽 끝을 R px 안의 가장 가까운 다른 윤곽까지 잇는다
  const cc = labelCC(E, W, H, true), sk = skeleton(E, W, H), out = new Uint8Array(E); let links = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!sk[i] || cc.area[cc.lab[i]] < minLen) continue;
    let nb = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && sk[yy * W + xx]) nb++; }
    if (nb > 1) continue;
    const c = cc.lab[i]; let best = -1, bd = R * R + 1;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const l = cc.lab[yy * W + xx]; if (!l || l === c) continue; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = yy * W + xx; }
    }
    if (best < 0) continue;
    const x1 = best % W, y1 = (best / W) | 0; let x0 = x, y0 = y; const ddx = Math.abs(x1 - x0), ddy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = ddx + ddy;
    for (;;) { out[y0 * W + x0] = 1; if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= ddy) { err += ddy; x0 += sx; } if (e2 <= ddx) { err += ddx; y0 += sy; } }
    links++;
  }
  return { E: out, links };
}
function nearestFill(ids: Int32Array, okm: Uint8Array, W: number, H: number): { near: Int32Array; d2: Float32Array } {   // 픽셀마다 가장 가까운 진짜 칸의 픽셀
  const { d2, near } = edt(okm, W, H), n = W * H, lab = new Int32Array(n);
  for (let i = 0; i < n; i++) lab[i] = near[i] >= 0 ? ids[near[i]] : 0;
  return { near: lab, d2 };
}
function innerEdges(near: Int32Array, E: Uint8Array, nx: Float32Array, ny: Float32Array, W: number, H: number): Uint8Array {   // 양쪽이 같은 칸인 경계 픽셀 (닫히지 않은 윤곽)
  const n = W * H, out = new Uint8Array(n);
  const at = (x: number, y: number) => { x = Math.round(x); y = Math.round(y); if (x < 0) x = 0; if (y < 0) y = 0; if (x >= W) x = W - 1; if (y >= H) y = H - 1; return near[y * W + x]; };
  for (let i = 0; i < n; i++) { if (!E[i]) continue; const x = i % W, y = (i / W) | 0; if (at(x - 2.5 * nx[i], y - 2.5 * ny[i]) === at(x + 2.5 * nx[i], y + 2.5 * ny[i])) out[i] = 1; }
  return out;
}
function splitLeaks(ids: Int32Array, nFill: number, med: Float32Array, S: Chan3, okm: Uint8Array, Ein: Uint8Array, W: number, H: number): number {
  const n = W * H, R = new Float32Array(n), wm = new Float32Array(n);
  for (let i = 0; i < n; i++) { if (!okm[i]) continue; const f = ids[i] * 3; R[i] = Math.hypot(S[0][i] - med[f], S[1][i] - med[f + 1], S[2][i] - med[f + 2]); wm[i] = 1; }
  const Rb = gauss(R, W, H, 1.5), wb = gauss(wm, W, H, 1.5);
  const cand = new Uint8Array(n); for (let i = 0; i < n; i++) { Rb[i] /= Math.max(wb[i], 1e-3); cand[i] = okm[i] && Rb[i] > 3.5 ? 1 : 0; }
  const cc = labelCC(cand, W, H, false), E = dilateSq(Ein, W, H, 2); let made = 0;
  for (let c = 1; c <= cc.n; c++) {
    if (cc.area[c] < 40) continue;
    const x0 = Math.max(cc.X0[c] - 2, 0), y0 = Math.max(cc.Y0[c] - 2, 0), x1 = Math.min(cc.X1[c] + 2, W - 1), y1 = Math.min(cc.Y1[c] + 2, H - 1), bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const comp = new Uint8Array(bw * bh), counts = new Map<number, number>(); let area = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; if (cc.lab[i] === c) { comp[(y - y0) * bw + x - x0] = 1; area++; counts.set(ids[i], (counts.get(ids[i]) || 0) + 1); } }
    let f = 0, fc = -1; for (const [k, v] of counts) if (v > fc) { fc = v; f = k; }
    const dil = dilateSq(comp, bw, bh, 1); let fenced = 0, open = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const j = y * bw + x; if (!dil[j] || comp[j]) continue; const i = (y + y0) * W + x + x0; if (E[i]) fenced++; else if (ids[i] === f) open++; }
    if (fenced / Math.max(fenced + open, 1) < 0.7) continue;
    const core = erodeSq(comp, bw, bh, 2); let cs = 0; for (let j = 0; j < core.length; j++) cs += core[j]; if (cs < 0.4 * area) continue;
    const rv = new Float32Array(area), sL = new Float32Array(area), sA = new Float32Array(area), sB = new Float32Array(area); let k = 0, pL = 0, pA = 0, pB = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { if (!comp[y * bw + x]) continue; const i = (y + y0) * W + x + x0; rv[k] = Rb[i]; sL[k] = S[0][i]; sA[k] = S[1][i]; sB[k] = S[2][i]; const g = ids[i] * 3; pL += med[g]; pA += med[g + 1]; pB += med[g + 2]; k++; }
    if (median(rv, area) < 4.5) continue;
    if (Math.hypot(median(sL, area) - pL / area, median(sA, area) - pA / area, median(sB, area) - pB / area) < 3.5) continue;
    const id = nFill + 1 + made; made++;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { if (!comp[y * bw + x]) continue; const i = (y + y0) * W + x + x0; if (ids[i] === f) ids[i] = id; }
  }
  return made;
}
type Model = number[][];
function gradientModels(ids: Int32Array, nFill: number, C: Chan3, cnt: Int32Array, med: Float32Array, fam: Int8Array, W: number, H: number): Map<number, Model> {   // 초록 · 갈색이 아닌 넓은 면: 깨끗한 직선 그라데이션 (하늘)
  const models = new Map<number, Model>(), minPx = 0.004 * W * H, n = W * H;
  const big = new Map<number, { step: number; seen: number; xs: number[]; ys: number[]; xmin: number; xmax: number; ymin: number; ymax: number }>();
  for (let f = 1; f <= nFill; f++) if (cnt[f] >= minPx && fam[f] === 0) big.set(f, { step: Math.max(1, Math.floor(cnt[f] / 60000)), seen: 0, xs: [], ys: [], xmin: W, xmax: 0, ymin: H, ymax: 0 });
  if (!big.size) return models;
  for (let i = 0; i < n; i++) {
    const g = big.get(ids[i]); if (!g) continue; const x = i % W, y = (i / W) | 0;
    if (x < g.xmin) g.xmin = x; if (x > g.xmax) g.xmax = x; if (y < g.ymin) g.ymin = y; if (y > g.ymax) g.ymax = y;
    if ((g.seen++ % g.step) === 0) g.xs.push(i);
  }
  for (const [f, g] of big) {
    const m = g.xs.length, X1 = new Float64Array(m), X2 = new Float64Array(m), Y = [new Float64Array(m), new Float64Array(m), new Float64Array(m)];
    for (let k = 0; k < m; k++) { const i = g.xs[k]; X1[k] = (i % W - W / 2) / W; X2[k] = (((i / W) | 0) - H / 2) / H; Y[0][k] = C[0][i]; Y[1][k] = C[1][i]; Y[2][k] = C[2][i]; }
    const keep = new Uint8Array(m).fill(1), r = new Float64Array(m);
    const fit = (): Model | null => {
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let k = 0; k < m; k++) { if (!keep[k]) continue; const x = [1, X1[k], X2[k]]; for (let a = 0; a < 3; a++) { for (let c = 0; c < 3; c++) A[a][c] += x[a] * x[c]; for (let ch = 0; ch < 3; ch++) b[ch][a] += x[a] * Y[ch][k]; } }
      const co = [solve3(A, b[0]), solve3(A, b[1]), solve3(A, b[2])]; return co[0] && co[1] && co[2] ? (co as Model) : null;
    };
    const resid = (co: Model) => { for (let k = 0; k < m; k++) { let s2 = 0; for (let ch = 0; ch < 3; ch++) { const e = Y[ch][k] - (co[ch][0] + co[ch][1] * X1[k] + co[ch][2] * X2[k]); s2 += e * e; } r[k] = Math.sqrt(s2); } };
    let co = fit(); if (!co) continue;
    for (let it = 0; it < 2; it++) {
      resid(co); const srt = Float64Array.from(r).sort(), lim = Math.max(srt[Math.floor(0.8 * (m - 1))] * 2, 1.0);
      for (let k = 0; k < m; k++) keep[k] = r[k] <= lim ? 1 : 0; const c2 = fit(); if (!c2) break; co = c2;
    }
    resid(co); const mr = Float64Array.from(r).sort()[m >> 1];
    const flat = new Float64Array(m); for (let k = 0; k < m; k++) flat[k] = Math.hypot(Y[0][k] - med[f * 3], Y[1][k] - med[f * 3 + 1], Y[2][k] - med[f * 3 + 2]);
    const fr = flat.sort()[m >> 1];
    const cf = co;
    const ev = (x: number, y: number, ch: number) => cf[ch][0] + cf[ch][1] * (x - W / 2) / W + cf[ch][2] * (y - H / 2) / H;
    const change = Math.hypot(ev(g.xmax, g.ymax, 0) - ev(g.xmin, g.ymin, 0), ev(g.xmax, g.ymax, 1) - ev(g.xmin, g.ymin, 1), ev(g.xmax, g.ymax, 2) - ev(g.xmin, g.ymin, 2));
    if (change >= 3 && mr <= 1.6 && mr < 0.7 * fr) models.set(f, co);
  }
  return models;
}
function solve3(A: number[][], b: number[]): number[] | null {
  const m = A.map((r, i) => [r[0], r[1], r[2], b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null; [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) { if (r === c) continue; const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** 노이즈 제거 결과 정보 (HTML 과 같은 이름): fills 칸 수, faint 흐린 경계, links 이은 윤곽, leaks 떼어 낸 면, streaks 선이 아닌 줄,
 * snapped 같은 물감으로 묶은 칸, gradients 그라데이션 면, origPx 원래 픽셀로 남은 몫, zone 경계 띠 몫, mixOk 섞임으로 칠한 몫, sec 걸린 초 */
export type DenoiseInfo = { fills: number; faint: number; links: number; leaks: number; streaks: number; snapped: number; gradients: number; origPx: number; zone: number; mixOk: number; sec: number };
/** 단계 이름 (HTML 그대로): '색 읽기' · '경계 찾기' · '선 찾기' · '칸 나누기' · '샌 면 찾기' · '칠하기' */
export type DenoiseStep = string;

/* ---------- 전체 ---------- */
/** HTML NZ.denoise: RGBA → 새 RGBA (입력은 바꾸지 않음, 알파는 그대로) */
export function denoise(rgba: ArrayLike<number>, W: number, H: number, progress?: (step: DenoiseStep) => void): { data: Uint8ClampedArray; info: DenoiseInfo } {
  const t0 = Date.now(), n = W * H, tick = (s: string) => { if (progress) progress(s); };
  tick('색 읽기'); const C = toLab(rgba, n);
  tick('경계 찾기'); let pre: Chan3 | null = bilateral(C, W, H);
  let ch8: Uint8Array[] | null = pre.map((c, k) => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) { const v = k === 0 ? c[i] * 2.55 : c[i] + 128; o[i] = v < 0 ? 0 : v > 255 ? 255 : v | 0; } return o; });
  pre = null; let grads: Grad[] | null = ch8.map((c) => sobel8(c, W, H)); ch8 = null;
  const TH = [[25, 60], [15, 35], [15, 35]];
  let E: Uint8Array = new Uint8Array(n), weak: Uint8Array | null = new Uint8Array(n);
  const weak0 = weak;
  grads.forEach((g, k) => { const s = canny(g, W, H, TH[k][0], TH[k][1]), w = canny(g, W, H, TH[k][0] >> 1, TH[k][1] >> 1); for (let i = 0; i < n; i++) { E[i] |= s[i]; weak0[i] |= w[i]; } }); grads = null;
  const { nx, ny } = edgeFrame(C, W, H), S = C.map((c) => gauss(c, W, H, 0.7)) as Chan3;
  // 흐리지만 또렷한 경계
  const dE3 = dilateSq(E, W, H, 1), wo = new Uint8Array(n); for (let i = 0; i < n; i++) wo[i] = weak[i] && !dE3[i] ? 1 : 0;
  const wcc = labelCC(wo, W, H, true), good = new Int32Array(wcc.n + 1); let nFaint = 0;
  for (let i = 0; i < n; i++) { if (!wo[i]) continue; const [cr, D] = crisp(S, nx, ny, W, H, i); if (cr >= 0.6 && D >= 2) good[wcc.lab[i]]++; }
  const keepW = new Uint8Array(wcc.n + 1); for (let g = 1; g <= wcc.n; g++) if (wcc.area[g] >= 12 && good[g] >= 0.6 * wcc.area[g]) { keepW[g] = 1; nFaint++; }
  for (let i = 0; i < n; i++) if (keepW[wcc.lab[i]]) E[i] = 1; weak = null;
  E = erodeSq(dilateSq(E, W, H, 1), W, H, 1);   // 1px 끊김 잇기
  tick('선 찾기'); const { lines, lineSk, streaks } = drawnLines(C, W, H);
  const lk = linkGaps(E, W, H); E = lk.E;
  tick('칸 나누기'); const free = new Uint8Array(n); for (let i = 0; i < n; i++) free[i] = E[i] || lineSk[i] ? 0 : 1;
  const cc = labelCC(free, W, H, false), ids = cc.lab; let nFill = cc.n;
  let st = groupMedians(ids, free, C, nFill), med = st.med, cnt = st.cnt;
  const okOf = () => { const okm = new Uint8Array(n); for (let i = 0; i < n; i++) okm[i] = ids[i] > 0 && cnt[ids[i]] >= 12 ? 1 : 0; return okm; };
  let okm = okOf(), leaks = 0, nf: { near: Int32Array; d2: Float32Array } | null = null;
  tick('샌 면 찾기');
  for (let round = 0; round < 3; round++) {
    nf = nearestFill(ids, okm, W, H);
    const made = splitLeaks(ids, nFill, med, S, okm, innerEdges(nf.near, E, nx, ny, W, H), W, H); if (!made) break;
    nFill += made; leaks += made; st = groupMedians(ids, free, C, nFill); med = st.med; cnt = st.cnt; okm = okOf(); nf = null;
  }
  tick('칠하기');
  const fam = new Int8Array(nFill + 1); for (let f = 1; f <= nFill; f++) fam[f] = family(med[f * 3], med[f * 3 + 1], med[f * 3 + 2]);
  const paint = Float32Array.from(med), order: number[] = []; for (let f = 1; f <= nFill; f++) if (cnt[f] >= 12 && fam[f]) order.push(f);
  order.sort((a, b) => cnt[b] - cnt[a]); const centers: Array<{ fam: number; col: number[]; w: number; members: number[] }> = []; let snapped = 0;
  for (const f of order) {   // 거의 같은 색의 초록 · 갈색 칸은 같은 물감 (큰 칸부터)
    let best: (typeof centers)[number] | null = null, bd = 6.0;
    for (const c of centers) { if (c.fam !== fam[f]) continue; const d = Math.hypot(c.col[0] - med[f * 3], c.col[1] - med[f * 3 + 1], c.col[2] - med[f * 3 + 2]); if (d < bd) { bd = d; best = c; } }
    if (!best) { centers.push({ fam: fam[f], col: [med[f * 3], med[f * 3 + 1], med[f * 3 + 2]], w: cnt[f], members: [f] }); continue; }
    for (let c = 0; c < 3; c++) best.col[c] = (best.col[c] * best.w + med[f * 3 + c] * cnt[f]) / (best.w + cnt[f]); best.w += cnt[f]; best.members.push(f); snapped++;
  }
  for (const c of centers) for (const f of c.members) { paint[f * 3] = c.col[0]; paint[f * 3 + 1] = c.col[1]; paint[f * 3 + 2] = c.col[2]; }
  if (!nf) nf = nearestFill(ids, okm, W, H); const near = nf.near;
  const P: Chan3 = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) { const f = near[i] * 3; P[0][i] = paint[f]; P[1][i] = paint[f + 1]; P[2][i] = paint[f + 2]; }
  const models = gradientModels(ids, nFill, C, cnt, med, fam, W, H);
  if (models.size) for (let i = 0; i < n; i++) { const m = models.get(near[i]); if (!m) continue; const x = (i % W - W / 2) / W, y = (((i / W) | 0) - H / 2) / H; for (let c = 0; c < 3; c++) P[c][i] = m[c][0] + m[c][1] * x + m[c][2] * y; }
  // 경계 픽셀: 원래 자리에서 양쪽 물감의 섞임
  const dist = edt(okm.map((v) => v ? 0 : 1), W, H).d2, out: Chan3 = [Float32Array.from(P[0]), Float32Array.from(P[1]), Float32Array.from(P[2])], keep = new Uint8Array(n);
  let zone = 0, okMix = 0;
  for (let i = 0; i < n; i++) {
    if (okm[i] && dist[i] > 2.25) continue; zone++;
    const x = i % W, y = (i / W) | 0, vx = nx[i], vy = ny[i];
    const ia = Math.min(H - 1, Math.max(0, Math.round(y - 2.6 * vy))) * W + Math.min(W - 1, Math.max(0, Math.round(x - 2.6 * vx)));
    const ib = Math.min(H - 1, Math.max(0, Math.round(y + 2.6 * vy))) * W + Math.min(W - 1, Math.max(0, Math.round(x + 2.6 * vx)));
    const pa0 = P[0][ia], pa1 = P[1][ia], pa2 = P[2][ia], pb0 = P[0][ib], pb1 = P[1][ib], pb2 = P[2][ib];
    const d0 = pa0 - pb0, d1 = pa1 - pb1, d2v = pa2 - pb2, dd = d0 * d0 + d1 * d1 + d2v * d2v + 1e-6;
    const w = Math.min(1, Math.max(0, (Math.sqrt(dd) - 6) / 10));
    const c0 = w * C[0][i] + (1 - w) * S[0][i], c1 = w * C[1][i] + (1 - w) * S[1][i], c2 = w * C[2][i] + (1 - w) * S[2][i];
    const al = Math.min(1, Math.max(0, ((c0 - pb0) * d0 + (c1 - pb1) * d1 + (c2 - pb2) * d2v) / dd));
    const m0 = pb0 + al * d0, m1 = pb1 + al * d1, m2 = pb2 + al * d2v;
    if (Math.hypot(c0 - m0, c1 - m1, c2 - m2) <= (dd < 4 ? 12 : 6)) { out[0][i] = m0; out[1][i] = m1; out[2][i] = m2; okMix++; } else keep[i] = 1;
  }
  const ld = dilateSq(lines, W, H, 1); let origPx = 0;
  const res = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    if (keep[i] || ld[i]) { res[i * 4] = rgba[i * 4]; res[i * 4 + 1] = rgba[i * 4 + 1]; res[i * 4 + 2] = rgba[i * 4 + 2]; origPx++; }
    else labToRgb(out[0][i], out[1][i], out[2][i], res, i * 4);
    res[i * 4 + 3] = rgba[i * 4 + 3];
  }
  return { data: res, info: { fills: nFill, faint: nFaint, links: lk.links, leaks, streaks, snapped, gradients: models.size, origPx: Math.round(origPx / n * 1000) / 1000, zone: Math.round(zone / n * 1000) / 1000, mixOk: zone ? Math.round(okMix / zone * 1000) / 1000 : 1, sec: Math.round((Date.now() - t0) / 100) / 10 } };
}
