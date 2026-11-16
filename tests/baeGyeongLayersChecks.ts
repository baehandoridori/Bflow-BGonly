// BAE경 6단계 레이어 검사 (시험 파일이 아님 — 이름이 *.test.ts 가 아니다). node 시험(baeGyeongLayersEdges.test.ts)과
// Electron 시험의 재기(C:\BAE_stage0\bir_port\measure.mjs)가 같이 쓴다. 엔진 · 앱 코드는 쓰지 않는다 (PSD 레이어 픽셀만 본다).
//
//  1) 책상 윗선 (계획 11 10~11절): 세로줄마다 레이어 가장자리(알파 0.5 를 지나는 곳, 픽셀 사이까지)가 그림 선(위쪽 색에서 선 색으로
//     절반 바뀐 곳, 픽셀 사이까지)보다 몇 px 아래인지. + = 아래 (책상 픽셀이 레이어 밖에 남음), - = 위.
//     세로줄은 '지금 방식' PSD 의 책상 윗변을 기준으로, 그 아래 선이 또렷한(위쪽 색과 40 넘게 다른) 곳 모두 (all). 11-03 의 재는 스크립트
//     (check_new.py)는 이 PC 에 없어서 이 정의를 11-03 PSD 넷에 대 보고 골랐다: 측면 2.25 → -0.02, 정면 3.86 → -0.01
//     (11-03 기록 2.4 → 0.05, 3.9 → -0.6). wall = 그중 위 10~4px 가 빈 배경과 같은 벽인 곳만 (의자 · TV 앞이 아닌 곳).
//  2) 레이어 하나씩 끄기 (계획 11 11절: '그 물건을 끄면 다른 레이어에 그 물건이 남는지'): 물건 레이어(와 그 그림자)를 끄고 나머지를
//     겹친 그림에서, 그 레이어 자리(알파 > 0 을 3px 넓힘) 중 다른 물건 · 그림자 레이어가 조금도 덮지 않은 곳(= 빈 배경과 BG 보정만 보이는 곳)이
//     빈 배경과 24 넘게 다르면 '벽에 남은 픽셀' (24 = 엔진이 '빈 배경과 다르다'고 보는 값). TV 를 끄면 벽에 TV 테두리 줄이 남던 것을 잰다.
//     다른 물건 레이어의 반투명 가장자리 · 가려진 부분 완성(앞 물건을 끄면 보여야 하는 것)은 세지 않는다.
//  3) 가는 부분 (교실의 책상 다리 · 가방 끈): 두 PSD 의 그 레이어에서 5×5 열기로 사라지는 픽셀(5px 보다 가는 곳)을 합쳐,
//     방식마다 그중 몇 개가 그 레이어에 들어 있나(알파 0.5 이상).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
type AnyPsd = { width: number; height: number; children?: AnyLayer[] };
type AnyLayer = { name?: string; hidden?: boolean; blendMode?: string; opacity?: number; left?: number; top?: number; children?: AnyLayer[]; imageData?: { width: number; height: number; data: Uint8ClampedArray | Uint8Array } };

export interface FlatLayer { path: string; name: string; group: string; blend: string; hidden: boolean; opacity: number; left: number; top: number; w: number; h: number; data: Uint8ClampedArray | Uint8Array }

let canvasReady = false;
/** PSD 바이트 → 맨 아래부터의 레이어 (폴더는 풀어서). */
export function readFlat(bytes: Uint8Array): { W: number; H: number; layers: FlatLayer[] } {
  const ag = require('ag-psd') as { readPsd(b: Buffer, o: Record<string, unknown>): AnyPsd; initializeCanvas(a: unknown, b: unknown): void };
  if (!canvasReady) { ag.initializeCanvas(() => { throw new Error('no canvas'); }, (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })); canvasReady = true; }
  const psd = ag.readPsd(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  const out: FlatLayer[] = [];
  const walk = (list: AnyLayer[] | undefined, group: string, hidden: boolean) => {
    for (const L of list || []) {
      const name = L.name || ''; const path = (group ? group + '/' : '') + name;
      if (L.children) { walk(L.children, path, hidden || !!L.hidden); continue; }
      const d = L.imageData;
      out.push({ path, name, group, blend: L.blendMode || 'normal', hidden: hidden || !!L.hidden, opacity: L.opacity ?? 1, left: L.left || 0, top: L.top || 0, w: d ? d.width : 0, h: d ? d.height : 0, data: d ? d.data : new Uint8Array(0) });
    }
  };
  walk(psd.children, '', false);
  return { W: psd.width, H: psd.height, layers: out };
}

export const PLATE_NAME = '배경 (빈 방)';
/** 엔진이 붙이는 이름은 'BG 보정 (빈 배경이 달라진 곳)' */
export const BG_FIX_NAME = 'BG 보정';
export const isBgFix = (L: FlatLayer) => L.name.startsWith(BG_FIX_NAME);
export const isShadow = (L: FlatLayer) => L.name.endsWith(' 그림자') || L.blend === 'multiply';
/** 물건 레이어 (빈 배경 · BG 보정 · 그림자 · 원경 폴더 UL 이 아닌 것) */
export const isProp = (L: FlatLayer) => L.name !== PLATE_NAME && !isBgFix(L) && !isShadow(L) && !L.path.startsWith('UL/');

/** 레이어의 알파 (그림 크기, 0..1) */
export function alphaOf(L: FlatLayer, W: number, H: number): Float32Array {
  const a = new Float32Array(W * H);
  for (let y = 0; y < L.h; y++) { const gy = y + L.top; if (gy < 0 || gy >= H) continue; for (let x = 0; x < L.w; x++) { const gx = x + L.left; if (gx < 0 || gx >= W) continue; a[gy * W + gx] = L.data[(y * L.w + x) * 4 + 3] / 255 * L.opacity; } }
  return a;
}
/** 겹친 그림 (RGB, 0..255 실수). skip 이 참인 레이어는 끈다. 곱하기(multiply) 그림자도 그대로. */
export function composite(layers: FlatLayer[], W: number, H: number, skip: (L: FlatLayer) => boolean = () => false): Float32Array {
  const c = new Float32Array(W * H * 3).fill(255);
  for (const L of layers) {
    if (L.hidden || skip(L)) continue; const mul = L.blend === 'multiply';
    for (let y = 0; y < L.h; y++) { const gy = y + L.top; if (gy < 0 || gy >= H) continue;
      for (let x = 0; x < L.w; x++) { const gx = x + L.left; if (gx < 0 || gx >= W) continue; const s = (y * L.w + x) * 4; const a = L.data[s + 3] / 255 * L.opacity; if (!a) continue; const g = (gy * W + gx) * 3;
        for (let k = 0; k < 3; k++) { const src = L.data[s + k]; const dst = c[g + k]; c[g + k] = mul ? dst * (1 - a) + dst * src / 255 * a : dst * (1 - a) + src * a; } } }
  }
  return c;
}
const dilate = (m: Uint8Array, W: number, H: number, r: number) => {
  const t = new Uint8Array(W * H), o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { let last = -1e9; for (let x = 0; x < W; x++) { if (m[y * W + x]) last = x; t[y * W + x] = x - last <= r ? 1 : 0; } last = 1e9; for (let x = W - 1; x >= 0; x--) { if (m[y * W + x]) last = x; if (last - x <= r) t[y * W + x] = 1; } }
  for (let x = 0; x < W; x++) { let last = -1e9; for (let y = 0; y < H; y++) { if (t[y * W + x]) last = y; o[y * W + x] = y - last <= r ? 1 : 0; } last = 1e9; for (let y = H - 1; y >= 0; y--) { if (t[y * W + x]) last = y; if (last - y <= r) o[y * W + x] = 1; } }
  return o;
};
const erode = (m: Uint8Array, W: number, H: number, r: number) => { const inv = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) inv[i] = m[i] ? 0 : 1; const d = dilate(inv, W, H, r); for (let i = 0; i < W * H; i++) d[i] = d[i] ? 0 : 1; return d; };

/** 레이어 하나씩 끄기: 물건 레이어마다 남은 픽셀 (그중 BG 보정에 있는 것). plate = '배경 (빈 방)' 레이어의 RGB. */
export function hideOneCheck(layers: FlatLayer[], W: number, H: number, plate: Uint8Array | Float32Array): Array<{ name: string; path: string; px: number; leftover: number; inBgFix: number; boxes: number[] | null }> {
  const props = layers.filter(isProp); const bgFix = layers.find(isBgFix);
  const bgA = bgFix ? alphaOf(bgFix, W, H) : null;
  const alphas = new Map(layers.filter((L) => L.name !== PLATE_NAME && !isBgFix(L)).map((L) => [L, alphaOf(L, W, H)] as const));
  const out: Array<{ name: string; path: string; px: number; leftover: number; inBgFix: number; boxes: number[] | null }> = [];
  for (const P of props) {
    const own = new Set<FlatLayer>([P, ...layers.filter((L) => isShadow(L) && L.group === P.group && L.name === P.name + ' 그림자')]);
    const C = composite(layers, W, H, (L) => own.has(L));
    const aP = alphas.get(P)!; const m = new Uint8Array(W * H); let px = 0; for (let i = 0; i < W * H; i++) if (aP[i] > 0) { m[i] = 1; px++; }
    const foot = dilate(m, W, H, 3);
    const cover = new Float32Array(W * H); for (const [L, a] of alphas) { if (own.has(L)) continue; for (let i = 0; i < W * H; i++) if (a[i] > cover[i]) cover[i] = a[i]; }
    let left = 0, inBg = 0; let bx: number[] | null = null;
    for (let i = 0; i < W * H; i++) {
      if (!foot[i] || cover[i] > 0) continue;
      const g = i * 3; const d = Math.max(Math.abs(C[g] - plate[g]), Math.abs(C[g + 1] - plate[g + 1]), Math.abs(C[g + 2] - plate[g + 2]));
      if (d <= 24) continue; left++; if (bgA && bgA[i] > 0) inBg++;
      const x = i % W, y = (i / W) | 0; bx = bx ? [Math.min(bx[0], x), Math.min(bx[1], y), Math.max(bx[2], x + 1), Math.max(bx[3], y + 1)] : [x, y, x + 1, y + 1];
    }
    out.push({ name: P.name, path: P.path, px, leftover: left, inBgFix: inBg, boxes: bx });
  }
  return out;
}
/** 다 켠 그림과 원래 그림의 차이: 평균 · 24 넘는 픽셀 비율 */
export function stackDiff(layers: FlatLayer[], W: number, H: number, orig: Uint8Array): { mean: number; over24: number } {
  const C = composite(layers, W, H); let s = 0, n24 = 0;
  for (let i = 0; i < W * H; i++) { const g = i * 3; const d = Math.max(Math.abs(C[g] - orig[g]), Math.abs(C[g + 1] - orig[g + 1]), Math.abs(C[g + 2] - orig[g + 2])); s += (Math.abs(C[g] - orig[g]) + Math.abs(C[g + 1] - orig[g + 1]) + Math.abs(C[g + 2] - orig[g + 2])) / 3; if (d > 24) n24++; }
  return { mean: +(s / (W * H)).toFixed(3), over24: +(n24 / (W * H)).toFixed(5) };
}

/**
 * 책상 윗선 (벽 앞): 세로줄마다 레이어 가장자리 - 그림 선 (px, + = 아래). ref = 세로줄을 고를 레이어의 알파 (지금 방식 PSD 의 책상).
 * 돌려주는 것: 쓴 세로줄 수, 레이어마다 평균 · 가운데값, 그리고 기울기가 1/3 이 넘는 곳(비스듬한 선)만의 평균.
 */
export function deskTopLine(o: { orig: Uint8Array; plate: Uint8Array | Float32Array; W: number; H: number; ref: Float32Array; layers: Record<string, Float32Array> }) {
  const { orig, plate, W, H, ref } = o; const names = Object.keys(o.layers);
  const tops = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (ref[y * W + x] >= .5) { tops[x] = y; break; }
  const rows: Array<{ x: number; pe: number; slope: number; wall: boolean; le: Record<string, number> }> = [];
  for (let x = 2; x < W - 2; x++) {
    const yT = tops[x]; if (yT < 12 || yT > H - 12) continue;
    // 벽 앞인가 (wall 에만): 위 10~4px 가 빈 배경과 같다 (의자 · TV 가 아님)
    let wall = true;
    for (let y = yT - 10; y <= yT - 4 && wall; y++) { const g = (y * W + x) * 3; for (let k = 0; k < 3; k++) if (Math.abs(orig[g + k] - plate[g + k]) > 16) wall = false; }
    const wr = [0, 0, 0]; for (let y = yT - 10; y <= yT - 6; y++) { const g = (y * W + x) * 3; for (let k = 0; k < 3; k++) wr[k] += orig[g + k] / 5; }
    const d = (y: number) => { const g = (y * W + x) * 3; return Math.max(Math.abs(orig[g] - wr[0]), Math.abs(orig[g + 1] - wr[1]), Math.abs(orig[g + 2] - wr[2])); };
    let D = 0; for (let y = yT - 2; y <= yT + 3; y++) D = Math.max(D, d(y)); if (D < 40) continue;
    let pe = NaN; for (let y = yT - 6; y <= yT + 6; y++) { const a = d(y - 1), b = d(y); if (b >= D / 2 && a < D / 2) { pe = (y - 1) + (D / 2 - a) / (b - a); break; } }
    if (!Number.isFinite(pe)) continue;
    const le: Record<string, number> = {}; let all = true;
    for (const n of names) { const A = o.layers[n]; let v = NaN; for (let y = yT - 8; y <= yT + 8; y++) { const a = A[(y - 1) * W + x], b = A[y * W + x]; if (b >= .5 && a < .5) { v = (y - 1) + (.5 - a) / (b - a); break; } } if (!Number.isFinite(v)) { all = false; break; } le[n] = v - pe; }
    if (!all) continue;
    const slope = tops[x - 2] >= 0 && tops[x + 2] >= 0 ? Math.abs(tops[x + 2] - tops[x - 2]) / 4 : 0;
    rows.push({ x, pe, slope, wall, le });
  }
  const stat = (vals: number[]) => { if (!vals.length) return { n: 0, mean: NaN, median: NaN }; const s = vals.slice().sort((a, b) => a - b); return { n: vals.length, mean: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2), median: +s[s.length >> 1].toFixed(2) }; };
  const out: Record<string, { all: ReturnType<typeof stat>; wall: ReturnType<typeof stat>; slanted: ReturnType<typeof stat> }> = {};
  for (const n of names) out[n] = { all: stat(rows.map((r) => r.le[n])), wall: stat(rows.filter((r) => r.wall).map((r) => r.le[n])), slanted: stat(rows.filter((r) => r.slope > 1 / 3).map((r) => r.le[n])) };
  return { columns: rows.length, byLayer: out };
}

/**
 * 가는 부분: 두 레이어 알파(지금 방식 a · 새 방식 b)에서 5×5 열기로 사라지는 픽셀을 합쳐, 방식마다 레이어에 든 수.
 * content 를 주면 그중 원본이 빈 배경과 24 넘게 다른 픽셀만 (그려진 다리 · 끈. 빈 배경과 같은 픽셀은 레이어를 꺼도 똑같이 보여서
 * 빠져도 잃는 것이 없다 — 새 방식은 일부러 뺀다, 계획 11 9절 'BiRefNet이 뺀 픽셀은 빈 배경과 비슷할 때만 빼고').
 */
export function thinParts(a: Float32Array, b: Float32Array, W: number, H: number, content?: { orig: Uint8Array; plate: Uint8Array | Float32Array }) {
  const thinOf = (A: Float32Array) => { const m = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) m[i] = A[i] >= .5 ? 1 : 0; const op = dilate(erode(m, W, H, 2), W, H, 2); const t = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) t[i] = m[i] && !op[i] ? 1 : 0; return t; };
  const drawn = (i: number) => { if (!content) return true; const { orig, plate } = content; const g = i * 3; return Math.max(Math.abs(orig[g] - plate[g]), Math.abs(orig[g + 1] - plate[g + 1]), Math.abs(orig[g + 2] - plate[g + 2])) > 24; };
  const ta = thinOf(a), tb = thinOf(b); let union = 0, inA = 0, inB = 0;
  for (let i = 0; i < W * H; i++) { if (!(ta[i] || tb[i]) || !drawn(i)) continue; union++; if (a[i] >= .5) inA++; if (b[i] >= .5) inB++; }
  return { union, inA, inB };
}
