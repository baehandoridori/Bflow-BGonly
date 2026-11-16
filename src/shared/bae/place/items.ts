// 기준 배경이 요청 · 화면에서 쓰이는 규칙 (HTML v0.4.11 script_4.js 1010~1092줄 placeItems · renderBases · syncStyleForPlace · updatePlaceColors,
// 1396줄 rough.painted, 1435줄 misfit, 1982줄 기록의 base). 글자는 HTML 그대로. DOM 없음.
import { baePlaceCount, baePlaceMode } from './types';
import type { BaePlaceBase, BaePlaceMode } from './types';
import { baePlaceNearHex, baePlaceSheetSwatches } from './swatches';

/** '같은 장소' 그림의 이름표 (HTML buildPlace 의 makeItem 이름). */
export const BAE_PLACE_LABEL = { sheet: '부품 시트 (기준 배경)', basebg: '기준 배경' } as const;

/** 기준 배경 통째로 보낼 때의 긴 변 (HTML scaled(b.img, 1536)). */
export const BAE_BASE_SEND_SIDE = 1536;

/** HTML placeItems 끝: 부품 시트 한 장의 메모 = 부품을 자른 기준 배경들의 메모(앞뒤 공백 뺌)를 ' · ' 로. */
export function baePlaceSheetNote(bases: ReadonlyArray<Pick<BaePlaceBase, 'note' | 'parts'>>): string {
  return bases.filter((b) => b.parts.length).map((b) => b.note.trim()).filter(Boolean).join(' · ');
}

/** HTML placeItems 끝: 그림마다 붙는 메모. 통째로면 기준 배경마다 그 메모(손대지 않은 글), 부품 시트면 한 장에 baePlaceSheetNote. */
export function baePlaceItemNotes(mode: Exclude<BaePlaceMode, ''>, bases: ReadonlyArray<Pick<BaePlaceBase, 'note' | 'parts'>>): string[] {
  return mode === 'sheet' ? [baePlaceSheetNote(bases)] : bases.map((b) => b.note);
}

/** PD 의 부품 시트 문장(order/place.ts sheetLine)이 읽는 기준 배경 목록: 메모와 부품 이름 (HTML 은 state.bases 를 바로 읽는다). */
export function baePlaceOrderBases(bases: ReadonlyArray<Pick<BaePlaceBase, 'note' | 'parts'>>): Array<{ note: string; parts: Array<{ name: string }> }> {
  return bases.map((b) => ({ note: b.note, parts: b.parts.map((p) => ({ name: p.name })) }));
}

/** HTML buildInputs 1396줄: 러프가 '칠한 러프'인지. 흐린 사진(가이드)이 아니고, 사진 같은 그림이 아니고, 색으로 칠한 몫(Board.paintShare)이 25%를 넘으면. */
export const BAE_PAINTED_SHARE = 0.25;
export function baeRoughPainted(q: { guide: boolean; photoLike: boolean; paintShare: number }): boolean {
  return !q.guide && !q.photoLike && q.paintShare > BAE_PAINTED_SHARE;
}

/** HTML syncStyleForPlace(): 기준 배경이 있으면 스타일 예시 고르기를 숨기고 안내 글을 바꾼다. */
export interface BaeStyleForPlace { styleModeHidden: boolean; libPickHidden: boolean; hint: string }
export function baeStyleForPlace(mode: BaePlaceMode, styleMode: 'auto' | 'manual'): BaeStyleForPlace {
  const on = !!mode;
  return {
    styleModeHidden: on, libPickHidden: on || styleMode !== 'manual',
    hint: on ? '기준 배경이 이 장소의 그림체 기준이라 레퍼런스 이미지 예시는 보내지 않아요.'
      : styleMode === 'manual' ? '아래에서 최대 2장 골라주세요. 고른 순서대로 들어가요.' : '주문서를 만들 때 PD가 장면과 비슷한 팀 배경을 골라 함께 보내요.',
  };
}

/** HTML renderBases(): 기준 배경 칸의 안내 글 · '부품 자르기' 단추 글 · 보이고 숨기기. */
export interface BaeBaseFieldView { mode: BaePlaceMode; parts: number; hint: string; partsButton: string; rowHidden: boolean; dropHidden: boolean }
export function baeBaseFieldView(bases: ReadonlyArray<Pick<BaePlaceBase, 'parts' | 'sw'>>, max = 3): BaeBaseFieldView {
  const mode = baePlaceMode(bases as readonly BaePlaceBase[]), nP = bases.reduce((s, b) => s + b.parts.length, 0);
  const hint = mode === 'sheet' ? '부품 ' + nP + '개와 색 견본 ' + baePlaceSheetSwatches(bases).length + '개를 부품 시트 한 장으로 보내요.' + (bases.some((b) => !b.parts.length) ? ' 부품이 없는 배경은 색 견본만 들어가요.' : '')
    : mode === 'base' ? '지금은 기준 배경을 통째로 보내요. 부품을 잘라 넣으면 구도가 덜 끌려가요 (추천).' : '';
  return { mode, parts: nP, hint, partsButton: nP ? '부품 고치기 (' + nP + '개)' : '부품 자르기', rowHidden: !mode, dropHidden: bases.length >= max };
}

/** HTML misfit() 의 기준 배경 줄: 주문서를 만든 뒤 기준 배경 방식이나 장 수가 바뀌었으면 그림 번호가 맞지 않는다 (메모만 고친 건 괜찮다). */
export const BAE_PLACE_MISFIT = '기준 배경이 바뀌어서, 주문서 속 그림 번호와 설명이 지금 기준 배경과 맞지 않아요.\n\'주문서 만들기\'를 다시 눌러주세요. (어느 쪽인지 적은 글만 고친 건 괜찮아요)';
export function baePlaceMisfits(orderPlace: { mode: 'sheet' | 'base'; n: number } | null | undefined, bases: readonly BaePlaceBase[]): boolean {
  return (orderPlace ? orderPlace.mode : '') !== baePlaceMode(bases) || (!!orderPlace && orderPlace.n !== baePlaceCount(bases));
}

/** 결과 기록의 base (HTML 1982줄). */
export function baePlaceRecord(place: { mode: 'sheet' | 'base'; n: number; painted?: boolean } | null | undefined, bases: ReadonlyArray<Pick<BaePlaceBase, 'note' | 'parts'>>) {
  return place ? { mode: place.mode, n: place.n, painted: !!place.painted, notes: bases.map((b) => b.note || ''), parts: bases.reduce((s, b) => s + b.parts.length, 0) } : null;
}

/* ---------- 그림판의 '기준 배경 색' (HTML updatePlaceColors) ---------- */
/** 엔진이 기준 배경의 색 견본을 고를 때 (HTML autoSwatches): 긴 변 1024 로 줄인 그림에서, 부품 네모는 빼고, 6색. */
export const BAE_AUTO_SWATCH_SIDE = 1024;
export const baeAutoSwatchOpts = (b: Pick<BaePlaceBase, 'parts'>) => ({ skip: b.parts.map((p) => [p.x0, p.y0, p.x1, p.y1]), top: 6 });
/** 부품마다 대표 색 2개 (HTML: partCanvas(b, p, 360) 에서 palette k 8 · top 2 · minShare 0.12 · minL 0). */
export const BAE_PART_COLOR_SIDE = 360;
export const BAE_PART_COLOR_OPTS = { k: 8, top: 2, minShare: 0.12, minL: 0 } as const;
export const baePartColorKey = (b: Pick<BaePlaceBase, 'id'>, p: { x0: number; y0: number; x1: number; y1: number }) => b.id + ':' + [p.x0, p.y0, p.x1, p.y1].map((v) => Math.round(v * 1000)).join(',');
/**
 * HTML updatePlaceColors 의 목록: 부품 시트 견본('벽·바닥 색') 다음에 부품마다 대표 색(이름 = 부품 이름 또는 '부품'), 거의 같은 색은 한 번, 최대 21개.
 * partColors(key) = 엔진이 그 부품에서 고른 색 ('#RRGGBB', 아직 없으면 undefined → 건너뜀).
 */
export function baePlaceColors(bases: readonly BaePlaceBase[], partColors: (key: string) => readonly string[] | undefined): Array<{ hex: string; name: string }> {
  const list = baePlaceSheetSwatches(bases).map((h) => ({ hex: h, name: '벽·바닥 색' }));
  for (const b of bases) for (const p of b.parts) for (const h of partColors(baePartColorKey(b, p)) || []) if (!list.some((o) => baePlaceNearHex(o.hex, h))) list.push({ hex: h, name: p.name || '부품' });
  return list.slice(0, 21);
}
