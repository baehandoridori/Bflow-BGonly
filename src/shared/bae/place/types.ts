/**
 * BAE경 '같은 장소' 재료의 모양 (3단계). HTML v0.4.11 의 state.bases 와 같은 뜻:
 *   { id, img, url, note, parts: [{x0,y0,x1,y1,name}], sw: { auto, off, add } }  (script_4.js pushBase)
 * 엔진(색 맞춤 · 노이즈) · 재료(부품 시트 · 요청) · 화면이 이 모양 하나를 같이 쓴다.
 */

/** 부품 상자: 기준 배경 그림 안의 비율 좌표(0~1). name 은 사람이 붙인 이름(없으면 ''). */
export interface BaePlacePart { x0: number; y0: number; x1: number; y1: number; name: string }

/** 기준 배경의 색 견본: auto = 엔진이 고른 색(아직 안 골랐으면 null), off = 사람이 끈 색, add = 사람이 더한 색. 모두 '#rrggbb'. */
export interface BaePlaceSwatches { auto: string[] | null; off: string[]; add: string[] }

/** 기준 배경 한 장 (최대 BAE_BASE_MAX 장). src 는 그림 주소(data URL 또는 blob URL), w · h 는 원래 크기. */
export interface BaePlaceBase {
  id: number;
  src: string;
  w: number;
  h: number;
  /** '어느 쪽을 본 그림인지' 같은 메모 (PD에게 감) */
  note: string;
  parts: BaePlacePart[];
  sw: BaePlaceSwatches;
}

/** 기준 배경 묶음이 요청에서 쓰이는 방식: '' = 없음, 'base' = 통째로(장마다 한 그림), 'sheet' = 부품 시트 한 장 (부품이 하나라도 있으면). */
export type BaePlaceMode = '' | 'base' | 'sheet';

export const BAE_BASE_MAX = 3;

/** HTML placeMode(): 기준 배경이 없으면 '', 부품을 자른 장이 하나라도 있으면 'sheet', 아니면 'base'. */
export function baePlaceMode(bases: readonly BaePlaceBase[]): BaePlaceMode {
  return !bases.length ? '' : bases.some((b) => b.parts.length) ? 'sheet' : 'base';
}

/** HTML placeCount(): 요청에 들어가는 '같은 장소' 그림 수. */
export function baePlaceCount(bases: readonly BaePlaceBase[]): number {
  const m = baePlaceMode(bases);
  return m === 'sheet' ? 1 : m === 'base' ? bases.length : 0;
}
