/**
 * '같은 장소'(기준 배경) 화면 쪽의 작은 규칙들 (HTML v0.4.11 script_4.js 1030~1250줄: pushBase · Parts · syncLockRow · syncNoiseBtn).
 * DOM 없이 계산만 — 재료 창 · 부품 자르기 창 · 결과 도구 · 초안이 같이 쓰고, node --test 가 바로 읽는다 ('@/' 별칭 없음).
 */
import type { BaePlaceBase, BaePlacePart, BaePlaceSwatches } from '../../../shared/bae/place/types';
import type { BaeVariant } from '../../../shared/bae/jobs';

/** HTML PART_MAX: 기준 배경 전부를 합쳐 부품은 16개까지. */
export const BAE_PART_MAX = 16;
/** 새 기준 배경의 색 견본 (엔진이 아직 안 골랐다). */
export const baeEmptySwatches = (): BaePlaceSwatches => ({ auto: null, off: [], add: [] });

/* ---------- 부품 자르기 (HTML Parts) ---------- */
/** 끈 네모(시작점 · 끝점, 0~1) → 부품 네모. */
export function baeNormBox(d: { u0: number; v0: number; u1: number; v1: number }): Omit<BaePlacePart, 'name'> {
  return { x0: Math.min(d.u0, d.u1), y0: Math.min(d.v0, d.v1), x1: Math.max(d.u0, d.u1), y1: Math.max(d.v0, d.v1) };
}
/** 누른 점 아래의 부품 (위에 그린 것부터). 없으면 -1. */
export function baeHitPart(parts: readonly Pick<BaePlacePart, 'x0' | 'y0' | 'x1' | 'y1'>[], q: { u: number; v: number }): number {
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; if (q.u >= p.x0 && q.u <= p.x1 && q.v >= p.y0 && q.v <= p.y1) return i; }
  return -1;
}
/** 너무 작은 네모(화면에서 10px 미만)는 부품으로 넣지 않는다. */
export const baeBoxBigEnough = (b: Omit<BaePlacePart, 'name'>, w: number, h: number) => (b.x1 - b.x0) * w >= 10 && (b.y1 - b.y0) * h >= 10;
/** HTML b._pk: 부품 네모가 바뀌었는지 (바뀌면 색 견본을 다시 고른다 — 견본은 부품 안을 빼고 고르므로). */
export const baePartsKey = (parts: readonly Pick<BaePlacePart, 'x0' | 'y0' | 'x1' | 'y1'>[]) => JSON.stringify(parts.map((p) => [p.x0, p.y0, p.x1, p.y1]));
export const baePartCount = (bases: readonly Pick<BaePlaceBase, 'parts'>[]) => bases.reduce((s, b) => s + b.parts.length, 0);

/** HTML ptSw 의 × : 더한 색이면 더한 것에서 빼고, 엔진 색이면 끈 색에 넣는다. */
export function baeSwatchRemove(sw: BaePlaceSwatches, hex: string): BaePlaceSwatches {
  return sw.add.includes(hex) ? { ...sw, add: sw.add.filter((v) => v !== hex) } : { ...sw, off: sw.off.includes(hex) ? sw.off : [...sw.off, hex] };
}
/** HTML 스포이드: 그림에서 찍은 색을 더한다 (끈 색이었으면 다시 켠다). */
export function baeSwatchPick(sw: BaePlaceSwatches, hex: string): BaePlaceSwatches {
  return { ...sw, off: sw.off.filter((x) => x !== hex), add: sw.add.includes(hex) ? sw.add : [...sw.add, hex] };
}
/** HTML pickAt 의 평균: 5×5 칸의 RGBA → '#RRGGBB'. */
export function baeAverageHex(rgba: ArrayLike<number>): string {
  const s = [0, 0, 0]; let n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) { s[0] += rgba[i]; s[1] += rgba[i + 1]; s[2] += rgba[i + 2]; n++; }
  const c = (v: number) => Math.round(v / Math.max(1, n)).toString(16).padStart(2, '0');
  return ('#' + c(s[0]) + c(s[1]) + c(s[2])).toUpperCase();
}

/* ---------- 재료 창의 글 ---------- */
/** 그림체 기준 줄: 기준 배경이 있으면 그것이 기준이다 (시안 '기준 배경 2장이 기준이에요'). */
export const baeStyleRowForBases = (n: number) => `기준 배경 ${n}장이 기준이에요`;

/* ---------- 결과 도구 (HTML syncLockRow · syncNoiseBtn · lockSw · btnDenoise) ---------- */
/** 색 맞춤 스위치를 누르면: 맞춘 그림 ↔ GPT 그림, 노이즈 제거는 켠 채로 (다른 그림에 다시 한다). */
export const baeLockNext = (v: BaeVariant): BaeVariant => ({ alt: !v.alt, noise: v.noise });
/** 노이즈 제거를 누르면: 켜고 끄기 (끄면 지우기 전 그림). */
export const baeNoiseNext = (v: BaeVariant): BaeVariant => ({ alt: v.alt, noise: !v.noise });
/** HTML syncLockRow 의 글. on = 지금 맞춘 그림이 보임. */
export function baeLockText(on: boolean, moved: number): { label: string; title: string } {
  return on
    ? { label: '색 맞춤 켬', title: `넓은 면 ${moved}곳(벽·바닥·소파 같은)을 기준 배경 색에 맞췄어요. 끄면 GPT가 그린 색 그대로예요` }
    : { label: '색 맞춤 끔', title: `GPT가 그린 색 그대로예요. 켜면 넓은 면 ${moved}곳을 기준 배경 색에 맞춰요` };
}
/** HTML syncNoiseBtn 의 글. */
export function baeNoiseText(on: boolean, sec: number | null | undefined): { label: string; title: string } {
  return on
    ? { label: '노이즈 제거됨', title: `얼룩과 붓 자국을 면마다 한 색으로 정리한 그림이에요 (${sec ?? ''}초). 다시 누르면 지우기 전 그림으로 돌아가요` }
    : { label: '노이즈 제거', title: 'GPT 그림의 얼룩덜룩한 번짐과 붓 자국 덩어리를 면마다 한 색으로 정리해요. 선과 또렷한 윤곽은 그대로예요 · 이 PC에서 계산해서 0원, 몇 초' };
}
/** HTML lockSw 뒤의 알림 글. */
export const baeLockToast = (on: boolean, noise: boolean) => (on ? '색 맞춤한 그림이에요' : 'GPT가 그린 색 그대로예요') + (noise ? ' · 노이즈 제거도 다시 했어요' : '');

/* ---------- 초안 (HTML draft 의 bases: url · note · parts · sw) ---------- */
const DATA_URL_RE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
/** data URL → 바이트 (PNG · JPEG 만). 아니면 null. */
export function baeDataUrlBytes(u: string): { bytes: Uint8Array; ext: 'png' | 'jpg' } | null {
  const m = DATA_URL_RE.exec(u); if (!m) return null;
  const bin = atob(m[2]); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, ext: m[1] === 'png' ? 'png' : 'jpg' };
}
/** 바이트 → data URL. */
export function baeBytesDataUrl(bytes: Uint8Array, ext: 'png' | 'jpg'): string {
  let bin = ''; const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return `data:image/${ext === 'png' ? 'png' : 'jpeg'};base64,${btoa(bin)}`;
}
export interface BaeBaseDraft { id: number; file: string; w: number; h: number; note: string; parts: BaePlacePart[]; sw: BaePlaceSwatches }
/** 초안에 남길 기준 배경: 글은 data 에, 그림은 base_N.png/jpg 파일로 (보관함이 받는 이름). 그림을 못 읽으면 뺀다. */
export function baeBasesToDraft(bases: readonly BaePlaceBase[]): { list: BaeBaseDraft[]; images: Record<string, Uint8Array> } {
  const list: BaeBaseDraft[] = []; const images: Record<string, Uint8Array> = {};
  bases.slice(0, 3).forEach((b, i) => {
    const d = baeDataUrlBytes(b.src); if (!d) return;
    const file = `base_${i + 1}.${d.ext}`; images[file] = d.bytes;
    list.push({ id: b.id, file, w: b.w, h: b.h, note: b.note, parts: b.parts.map((p) => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, name: p.name || '' })), sw: { auto: b.sw.auto ? b.sw.auto.slice() : null, off: b.sw.off.slice(), add: b.sw.add.slice() } });
  });
  return { list, images };
}
const num01 = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const hexList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^#[0-9a-fA-F]{6}$/.test(x)).slice(0, 24) : []);
/** 초안에서 기준 배경을 되살린다 (모양이 틀린 것은 버린다). 엔진 색이 없으면 auto = null → 다시 고른다. */
export function baeBasesFromDraft(list: unknown, images: Record<string, Uint8Array>): BaePlaceBase[] {
  const out: BaePlaceBase[] = [];
  for (const r of (Array.isArray(list) ? list : []).slice(0, 3)) {
    const b = r as Partial<BaeBaseDraft> | null;
    if (!b || typeof b.file !== 'string' || !/^base_[1-3]\.(png|jpg)$/.test(b.file) || !images[b.file]) continue;
    const parts = (Array.isArray(b.parts) ? b.parts : []).filter((p) => p && num01(p.x0) && num01(p.y0) && num01(p.x1) && num01(p.y1) && p.x1 > p.x0 && p.y1 > p.y0).slice(0, BAE_PART_MAX)
      .map((p) => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, name: typeof p.name === 'string' ? p.name.slice(0, 40) : '' }));
    const sw = b.sw && typeof b.sw === 'object' ? b.sw : baeEmptySwatches();
    out.push({ id: typeof b.id === 'number' && Number.isFinite(b.id) ? b.id : out.length + 1, src: baeBytesDataUrl(images[b.file], b.file.endsWith('.png') ? 'png' : 'jpg'),
      w: Number(b.w) || 0, h: Number(b.h) || 0, note: typeof b.note === 'string' ? b.note.slice(0, 200) : '', parts,
      sw: { auto: Array.isArray(sw.auto) ? hexList(sw.auto) : null, off: hexList(sw.off), add: hexList(sw.add) } });
  }
  return out;
}
