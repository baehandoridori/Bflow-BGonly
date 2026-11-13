/**
 * 페인트통과 색 판정의 순수 계산 (HTML v0.4.11 script_4.js `Board` 375~412, 529~533, 735~739줄).
 * 픽셀 배열만 다룬다 (DOM 없음).
 */

export function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h) || [0, '000000']; const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r: number, g: number, b: number): string => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

/** 선을 r 픽셀만큼 두껍게 (선 둘레 정사각형): 페인트통이 선 사이 틈을 넘지 않게 */
export function grow(m: Uint8Array, r: number, W: number, H: number): Uint8Array {
  const t = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W; let c = 0; for (let x = 0; x < Math.min(r, W); x++) c += m[row + x];
    for (let x = 0; x < W; x++) { if (x + r < W) c += m[row + x + r]; if (x - r - 1 >= 0) c -= m[row + x - r - 1]; t[row + x] = c > 0 ? 1 : 0; }
  }
  for (let x = 0; x < W; x++) {
    let c = 0; for (let y = 0; y < Math.min(r, H); y++) c += t[y * W + x];
    for (let y = 0; y < H; y++) { if (y + r < H) c += t[(y + r) * W + x]; if (y - r - 1 >= 0) c -= t[(y - r - 1) * W + x]; out[y * W + x] = c > 0 ? 1 : 0; }
  }
  return out;
}

/** ok 인 칸을 (x0, y0)에서 이어서 채운다 (줄 단위 채우기) */
export function scanFill(ok: Uint8Array, x0: number, y0: number, W: number, H: number): Uint8Array {
  const mask = new Uint8Array(W * H), stack = [x0, y0];
  while (stack.length) {
    const y = stack.pop() as number, x = stack.pop() as number, row = y * W;
    let l = x; while (l >= 0 && !mask[row + l] && ok[row + l]) l--; l++;
    let r = x; while (r < W && !mask[row + r] && ok[row + r]) r++; r--;
    if (l > r) continue;
    for (let i = l; i <= r; i++) mask[row + i] = 1;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= H) continue; const nr = ny * W; let i = l;
      while (i <= r) { let started = false; while (i <= r && !mask[nr + i] && ok[nr + i]) { if (!started) { stack.push(i, ny); started = true; } i++; } i++; }
    }
  }
  return mask;
}

/**
 * 페인트통이 칠할 칸. src = 배경+칠 층을 합친 RGBA, gap = 틈 메우기(0 그대로 · 4 작은 틈 · 10 큰 틈).
 * 누른 곳이 이미 그 색이거나 종이 밖이면 null (칠하지 않음).
 */
export function floodMask(src: Uint8ClampedArray, W: number, H: number, x0: number, y0: number, rgb: [number, number, number], gap: number): Uint8Array | null {
  if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return null;
  const i0 = (y0 * W + x0) * 4, r0 = src[i0], g0 = src[i0 + 1], b0 = src[i0 + 2];
  const [fr, fg, fb] = rgb;
  if (Math.abs(fr - r0) + Math.abs(fg - g0) + Math.abs(fb - b0) < 6) return null;
  const tol = 70, N = W * H, ok = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const k = i * 4; ok[i] = Math.abs(src[k] - r0) + Math.abs(src[k + 1] - g0) + Math.abs(src[k + 2] - b0) <= tol ? 1 : 0; }
  let mask: Uint8Array | null = null;
  if (gap > 0) { // 선을 gap 만큼 두껍게 해서 채우고, 채운 곳을 같은 색 위로 다시 넓힌다
    const wall = new Uint8Array(N); for (let i = 0; i < N; i++) wall[i] = ok[i] ? 0 : 1;
    const thick = grow(wall, gap, W, H);
    if (!thick[y0 * W + x0]) {
      const open = new Uint8Array(N); for (let i = 0; i < N; i++) open[i] = ok[i] && !thick[i] ? 1 : 0;
      const back = grow(scanFill(open, x0, y0, W, H), gap + 1, W, H); mask = new Uint8Array(N); for (let i = 0; i < N; i++) mask[i] = back[i] && ok[i] ? 1 : 0;
    }
  }
  if (!mask) mask = scanFill(ok, x0, y0, W, H);
  return mask;
}

/** 칠 층 픽셀(d)에 mask 를 칠한다. 선 가장자리 한 칸 밑까지 들어가되, 이미 진하게 칠한 칸은 덮지 않는다 */
export function applyFillMask(d: Uint8ClampedArray, mask: Uint8Array, W: number, H: number, rgb: [number, number, number]): void {
  const [fr, fg, fb] = rgb;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let hit = mask[i];
    if (!hit) hit = (x > 0 && mask[i - 1]) || (x < W - 1 && mask[i + 1]) || (y > 0 && mask[i - W]) || (y < H - 1 && mask[i + W]) ? 2 : 0;
    if (!hit || (hit === 2 && d[i * 4 + 3] > 200)) continue;
    d[i * 4] = fr; d[i * 4 + 1] = fg; d[i * 4 + 2] = fb; d[i * 4 + 3] = 255;
  }
}

/** paintShare: 러프에서 색으로 칠한 몫 (흰 종이도, 어두운 선도 아닌 곳). d = 배경+칠 층 RGBA */
export function paintShareOf(d: Uint8ClampedArray): number {
  let n = 0, k = 0;
  for (let i = 0; i < d.length; i += 4 * 5) { k++; const r = d[i], g = d[i + 1], b = d[i + 2]; const mn = Math.min(r, g, b), lum = 0.299 * r + 0.587 * g + 0.114 * b; if (mn < 236 && lum > 90) n++; }
  return k ? n / k : 0;
}

/** hasColor: 칠 층에 채도 있는 색이 150 칸(7칸마다 하나) 넘게 있는지. d = 칠 층 RGBA */
export function hasColorOf(d: Uint8ClampedArray): boolean {
  let n = 0;
  for (let i = 0; i < d.length; i += 4 * 7) { if (d[i + 3] < 128) continue; const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx > 40 && (mx - mn) / mx > 0.18 && ++n > 150) return true; }
  return false;
}
