// 그림 크기: 비율 × 크기 단계, 화면 기울기면 더 큰 종이에 수평으로 그린 뒤 돌려서 자른다 (HTML drawSizes · effRatio · renderSizeSel).
import { BASE_PX, RATIOS, TIERS } from './constants';
import type { RatioId, TierId } from './constants';

export interface DrawSizes { gen: [number, number]; out: [number, number]; tilt: number }

/** HTML currentSize(): 지금 비율 · 크기 단계의 결과 크기. */
export function currentSize(ratio: RatioId, tier: TierId): [number, number] {
  const r = RATIOS[ratio] || RATIOS['16:9'];
  const s = (r.sizes as Record<string, [number, number]>)[tier] || RATIOS[ratio].sizes.m;
  return s;
}

export const ratioNum = (r: string) => { const [a, b] = r.split(':').map(Number); return a / b; };

/** HTML drawSizes(): gen = 그림 모델에게 부탁하는 크기, out = 마지막 그림 크기. */
export function drawSizes(ratio: RatioId, tier: TierId, boardTilt: number): DrawSizes {
  const out0 = currentSize(ratio, tier), tilt = boardTilt || 0, t = Math.abs(tilt) * Math.PI / 180;
  if (!t) return { gen: [out0[0], out0[1]], out: [out0[0], out0[1]], tilt: 0 };
  let s = 1;
  for (let i = 0; i < 8; i++) {
    const w = out0[0] * s, h = out0[1] * s;
    const gw = Math.ceil((w * Math.cos(t) + h * Math.sin(t)) / 16) * 16, gh = Math.ceil((w * Math.sin(t) + h * Math.cos(t)) / 16) * 16;
    const k = Math.min(1, 3840 / gw, 3840 / gh, Math.sqrt(8294400 / (gw * gh)));
    if (k >= 0.9999) return { gen: [gw, gh], out: [Math.round(w), Math.round(h)], tilt };
    s *= k * 0.995;
  }
  return { gen: [out0[0], out0[1]], out: [out0[0], out0[1]], tilt: 0 };
}

/** HTML effRatio(): 기울기면 그리는 종이의 비율('1.55:1'), 아니면 고른 비율. */
export function effRatio(ratio: RatioId, tier: TierId, boardTilt: number): string {
  const z = drawSizes(ratio, tier, boardTilt);
  return z.tilt ? (Math.round(z.gen[0] / z.gen[1] * 100) / 100) + ':1' : ratio;
}

/** HTML withRatio(): 주문서 속 'Aspect ratio …' 를 지금 비율로. */
export const withRatio = (p: string, ratioText: string) => p.replace(/Aspect ratio\s*\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?/gi, () => 'Aspect ratio ' + ratioText);

/** HTML levelMap(): 러프의 한 점(0..1) → 수평으로 돌린 큰 종이 위의 같은 점(0..1). PD 메모 목록에 쓴다. */
export function levelMap(tilt: number, z: DrawSizes): (u: number, v: number) => [number, number] {
  const a = tilt * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return (u, v) => { const dx = (u - 0.5) * z.out[0], dy = (v - 0.5) * z.out[1]; return [(z.gen[0] / 2 + dx * c - dy * s) / z.gen[0], (z.gen[1] / 2 + dx * s + dy * c) / z.gen[1]]; };
}

/** HTML renderSizeSel(): 크기 고르기 칸의 항목 글과 아래 안내 글. */
export function sizeChoices(ratio: RatioId, tier: TierId, boardTilt: number): { options: Array<{ value: TierId; text: string; selected: boolean }>; hint: string } {
  const sz = RATIOS[ratio].sizes;
  const options = TIERS.map(([k, label]) => ({ value: k, text: label + ' · ' + sz[k][0] + '×' + sz[k][1], selected: k === tier }));
  const z = drawSizes(ratio, tier, boardTilt); const [w, h] = currentSize(ratio, tier); const mult = (z.gen[0] * z.gen[1]) / BASE_PX; const t = TIERS.find((x) => x[0] === tier);
  const parts = ['그림 비용 약 ×' + (Math.round(mult * 10) / 10) + ' (3:2 보통 기준)'];
  if (z.tilt) parts.push('기울기 ' + z.tilt + '°: ' + z.gen.join('×') + '로 수평으로 그린 뒤 돌려서 ' + z.out.join('×') + '로 잘라요');
  if (t && t[2]) parts.push(t[2]);
  const fhd = RATIOS[ratio].fhd;
  if (fhd && w >= fhd[0] && h >= fhd[1]) parts.push('결과를 ' + fhd.join('×') + '로 줄여서 저장할 수 있어요');
  return { options, hint: parts.join(' · ') };
}
