// BAE경 레이어 시험의 재료 (시험 파일이 아님 — 이름이 *.test.ts 가 아니라 test:bae 가 따로 돌리지 않는다).
//  - node 의 PNG 읽고 쓰기 (8비트 RGB · RGBA, 엮지 않은 것): 엔진 codec 어댑터 자리 (화면에서는 OffscreenCanvas).
//  - 소나무 거실을 본뜬 그림: HTML v0.4.4 계획 창 시험(test_v044_layers.py)이 쓴 저장된 PD 답(sonamu_inventory2.json)의 물건 넷을
//    그 상자 자리에 단색으로 그린 1024×576 그림 + 물건을 뺀 빈 방(PD 상자와 같은 좌표라 작업 크기 = PD 크기, 배율 1).
//    화분 아래에는 그림자(바닥이 어두워짐), 벽에는 PD 가 빠뜨린 작은 시계 (네모로 더하기 시험).
//  - 가짜 SAM: 상자 가운데 색과 같은 픽셀만 (상자 안). 후보 셋 = 한 픽셀 깎음 · 그대로 · 상자 전체, 한 장짜리 = 그대로.
import { deflateSync, inflateSync, crc32 } from 'node:zlib';

/* ---------- PNG ---------- */
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
export function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 3 })), chunk('IEND', new Uint8Array(0))]));
}
export function decodePng(bytes: Uint8Array): { w: number; h: number; rgb: Uint8Array } {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength); let o = 8; let w = 0, h = 0, ct = 0; const idat: Buffer[] = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o); const type = b.toString('latin1', o + 4, o + 8); const data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[8] !== 8 || data[12] !== 0) throw new Error('8비트 · 엮지 않은 PNG 만'); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0; if (!bpp) throw new Error('RGB · RGBA PNG 만');
  const raw = inflateSync(Buffer.concat(idat)); const stride = w * bpp; const cur = new Uint8Array(stride), prev = new Uint8Array(stride); const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0; let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) { rgb[(y * w + x) * 3] = cur[x * bpp]; rgb[(y * w + x) * 3 + 1] = cur[x * bpp + 1]; rgb[(y * w + x) * 3 + 2] = cur[x * bpp + 2]; }
    prev.set(cur);
  }
  return { w, h, rgb };
}
export const rgbToRgba = (rgb: Uint8Array, n: number) => { const o = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { o[i * 4] = rgb[i * 3]; o[i * 4 + 1] = rgb[i * 3 + 1]; o[i * 4 + 2] = rgb[i * 3 + 2]; o[i * 4 + 3] = 255; } return o; };
/** 엔진 codec 어댑터의 node 판 (PD 그림은 PNG 데이터 주소 — 화면에서는 JPEG). */
export const nodeCodec = {
  async encodePng(rgba: Uint8Array, w: number, h: number) { return encodePng(rgba, w, h); },
  async decodePng(bytes: Uint8Array) { return decodePng(bytes); },
  async toDataUrl(rgb: Uint8Array, w: number, h: number) { return 'data:image/png;base64,' + Buffer.from(encodePng(rgbToRgba(rgb, w * h), w, h)).toString('base64'); },
};

/* ---------- 소나무 거실을 본뜬 그림 ---------- */
export const SONAMU_INV = {
  background_en: 'The cream-colored walls, brown baseboards, and light wooden floor remain as the empty background.',
  groups: [
    { group: '소파', en: 'the reddish-brown upholstered sofa', see_through: false }, { group: '액자', en: 'the framed tiger painting', see_through: false },
    { group: '화분', en: 'the leafy plant in a white pot', see_through: true }, { group: '에어컨', en: 'the white floor-standing air conditioner', see_through: false },
  ],
  objects: [
    { group: '소파', name: '적갈색 소파', en: 'the reddish-brown tufted sofa in the center', box: [385, 230, 859, 441], layer: 'ML', on: '' },
    { group: '액자', name: '호랑이 그림 액자', en: 'the brown-framed tiger painting above the sofa', box: [502, 65, 706, 204], layer: 'ML', on: '' },
    { group: '화분', name: '왼쪽 흰색 화분', en: 'the broad-leaved green plant in a white pot to the left of the sofa', box: [263, 182, 418, 406], layer: 'OL', on: '' },
    { group: '에어컨', name: '오른쪽 스탠드 에어컨', en: 'the tall white floor-standing air conditioner on the right', box: [892, 94, 998, 444], layer: 'ML', on: '' },
  ],
  far: [] as unknown[],
};
export const SCENE_W = 1024, SCENE_H = 576;
const WALL = [236, 226, 204], FLOOR = [196, 160, 118];
/** 그림 · 빈 방 (RGB). 물건은 상자 안쪽에 단색 (서로 닿지 않게 몇 픽셀 띄움). */
export function sonamuScene(): { orig: Uint8Array; plate: Uint8Array; clockBox: number[] } {
  const W = SCENE_W, H = SCENE_H, N = W * H; const plate = new Uint8Array(N * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = y < 380 ? WALL : FLOOR; plate.set(c, (y * W + x) * 3); }
  const orig = plate.slice();
  const rect = (b: number[], c: number[]) => { for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) orig.set(c, (y * W + x) * 3); };
  rect([392, 236, 852, 436], [138, 58, 40]);        // 소파 (화분과 닿지 않게 왼쪽을 띄움 — 화분 상자는 소파 상자와 겹친다)
  rect([510, 72, 698, 198], [120, 84, 50]);         // 액자
  rect([270, 190, 372, 400], [70, 140, 70]);        // 화분
  rect([898, 100, 992, 438], [244, 246, 248]);      // 에어컨
  const clockBox = [376, 110, 408, 142]; rect(clockBox, [40, 40, 160]);   // PD 가 빠뜨린 시계
  // 화분 그림자: 발치의 바닥이 어두워짐 (빈 방에는 없음)
  for (let y = 400; y < 416; y++) for (let x = 262; x < 384; x++) {
    const dx = (x - 321) / 60, dy = (y - 404) / 12; if (dx * dx + dy * dy > 1) continue;
    const i = (y * W + x) * 3; if (orig[i] !== plate[i]) continue; for (let c = 0; c < 3; c++) orig[i + c] = Math.round(plate[i + c] * 0.6);
  }
  return { orig, plate, clockBox };
}

/* ---------- 가짜 SAM ---------- */
interface BMLike { x0: number; y0: number; w: number; h: number; d: Uint8Array; readonly empty: boolean; box(): number[] | null }
export function fakeSam(fromCrop: (sub: Uint8Array, box: number[]) => BMLike) {
  let cur: { key: string; rgb: Uint8Array; W: number; H: number } | null = null; const keys: string[] = []; const stats = { runs: 0, setImage: 0 };
  const near = (rgb: Uint8Array, i: number, c: number[]) => Math.max(Math.abs(rgb[i] - c[0]), Math.abs(rgb[i + 1] - c[1]), Math.abs(rgb[i + 2] - c[2])) <= 6;
  function masksFor(box: number[]) {
    const { rgb, W, H } = cur!; const b = [Math.max(0, Math.floor(box[0])), Math.max(0, Math.floor(box[1])), Math.min(W, Math.ceil(box[2])), Math.min(H, Math.ceil(box[3]))];
    const cw = b[2] - b[0], ch = b[3] - b[1]; const cx = Math.floor((b[0] + b[2]) / 2), cy = Math.floor((b[1] + b[3]) / 2); const ci = (cy * W + cx) * 3; const col = [rgb[ci], rgb[ci + 1], rgb[ci + 2]];
    const exact = new Uint8Array(cw * ch); for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (near(rgb, ((y + b[1]) * W + x + b[0]) * 3, col)) exact[y * cw + x] = 1;
    const thin = new Uint8Array(cw * ch); for (let y = 1; y < ch - 1; y++) for (let x = 1; x < cw - 1; x++) { const i = y * cw + x; thin[i] = exact[i] & exact[i - 1] & exact[i + 1] & exact[i - cw] & exact[i + cw]; }
    const all = new Uint8Array(cw * ch).fill(1);
    return [fromCrop(thin, b), fromCrop(exact, b), fromCrop(all, b), fromCrop(exact, b)];
  }
  return {
    keys, stats,
    get ep() { return 'fake'; },
    async setImage(key: string, rgb: Uint8Array, W: number, H: number) { stats.setImage++; keys.push(key); cur = { key, rgb, W, H }; },
    async predict(o: { box?: number[]; multimask?: boolean }) { stats.runs++; const m = masksFor(o.box!); return o.multimask === false ? [{ mask: m[3], conf: 0.95 }] : m.slice(0, 3).map((mask, k) => ({ mask, conf: [0.9, 0.95, 0.6][k] })); },
    async predictAll(o: { box?: number[] }) { stats.runs++; const m = masksFor(o.box!); return { multi: m.slice(0, 3).map((mask, k) => ({ mask, conf: [0.9, 0.95, 0.6][k] })), single: { mask: m[3], conf: 0.95, token: 0 } }; },
    async dispose() { cur = null; },
  };
}
