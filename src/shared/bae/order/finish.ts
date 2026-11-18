// PD 답을 받은 뒤 주문서 마무리 (HTML runPD 1922~1943줄)와 그 둘레 (고치기 재료 · 이어 받기 · 기다림 문구).
import { DIR_MARKERS } from './constants';
import { expandBlocks, fillPlaceholders, toMarkers } from './blocks';
import { stripDirLine, withDirLine } from './director';
import { addTilt, samePlace } from './place';
import { withRatio, effRatio } from './sizes';
import { won } from './text';
import type { BaeOrder, LibEntry, OrderInputs, OrderMaterials, PdAnswer, ReviseInput, StyleMode } from './types';

type OrderLike = Pick<BaeOrder, 'refIds' | 'place' | 'picks'>;

/** HTML mappingText(): 이전 주문서의 그림 번호 ↔ 자리표시. */
export function mappingText(o: OrderLike): string {
  const nR = o.refIds.length + (o.place ? o.place.n : 0), nP = o.picks.length; const parts: string[] = [];
  if (nP >= 1) parts.push('image ' + (nR + 2) + ' = {S1}'); if (nP >= 2) parts.push('image ' + (nR + 3) + ' = {S2}'); parts.push('image ' + (nR + 2 + nP) + ' = {BASE}');
  return parts.join(', ');
}

/** HTML carryList(): 같은 러프로 새 주문서를 만들 때 이어 보낼 이전 수정 요청 (최대 6개). roughKey = 지금 rough.key. */
export function carryList(o: Pick<BaeOrder, 'roughKey' | 'carried' | 'revTexts'> | null, roughKey: string | null | undefined): string[] {
  if (!o || !roughKey || o.roughKey !== roughKey) return [];
  const all = (o.carried || []).concat(o.revTexts || []).map((t) => String(t).replace(/\s+/g, ' ').trim()).filter(Boolean).map((t) => t.length > 300 ? t.slice(0, 300) + '…' : t);
  return [...new Set(all)].slice(-6);
}

/** HTML orderPhrases(): 주문서를 기다리는 동안 보일 말. activeLibCount = 켜 둔 예시 수. */
export function orderPhrases(inp: Pick<OrderInputs, 'rough' | 'place' | 'refs'>, mode: StyleMode, activeLibCount: number): string[] {
  const p = ['PD가 러프를 읽는 중'];
  if (inp.rough.noteCount) p.push('빨간 메모 읽는 중');
  if (inp.place) p.push(inp.place.mode === 'sheet' ? '부품 시트 보는 중' : '기준 배경 보는 중');
  if (inp.refs.length) p.push('레퍼런스 보는 중');
  if (!inp.place && mode === 'auto' && activeLibCount) p.push('비슷한 팀 배경 찾는 중');
  p.push('영어 주문서 쓰는 중'); return p;
}

/** 고치기 기다림 말 (HTML runPD 의 Wait.open). */
export const revisePhrases = (withReview: boolean) => withReview ? ['PD가 검수 표시를 보는 중', '고칠 곳 찾는 중', '주문서 고치는 중'] : ['PD가 고치는 중', '바꾼 점 정리하는 중'];

/** HTML runPD 의 revise 재료: promptText = 화면의 영어 주문서 그대로. */
export function reviseInput(revText: string, promptText: string, prevOrder: BaeOrder, fixedText: string, reviewImage: string | null = null): ReviseInput {
  return {
    text: revText.trim(),
    prev: toMarkers(stripDirLine(promptText), prevOrder.refIds.length + (prevOrder.place ? prevOrder.place.n : 0), prevOrder.picks.length, prevOrder.place, fixedText),
    picks: prevOrder.picks.slice(),
    mapping: mappingText(prevOrder),
    reviewImage: reviewImage || null,
  };
}

export interface FinishOrderInput {
  obj: PdAnswer;
  cost: number | null;
  /** 고치기면 고칠 내용(문자열), 새 주문서면 null. */
  revText: string | null;
  /** 검수에서 온 고치기의 이름표 (opts.label). */
  label?: string | null;
  materials: Pick<OrderMaterials, 'time' | 'place' | 'ratio' | 'tier' | 'tilt'>;
  fixedText: string;
  inputs: Pick<OrderInputs, 'rough' | 'refs' | 'refIds' | 'place'>;
  styleMode: StyleMode;
  library: LibEntry[];
  manualIds: string[];
  /** dirFor(...) */
  dir: { ko: string[]; revKo: string[] };
  carry: string[];
  carryExtra: string[];
  prevOrder: BaeOrder | null;
  /** 설정 책장 prices.krwPerUsd */
  rate: number;
  /** PD 를 기다리는 동안 재료가 바뀌었는지 (HTML snapAll() !== before) */
  dirty: boolean;
  manualVer: string;
  blocksVer: string;
  rulesKo: string;
  /** 지금 직접 고른 예시 (state.manualPicks). 비어 있으면 PD 가 쓴 것으로 채운다. */
  manualPicks: string[];
}

/** HTML runPD 마무리: style_picks 고르기 → [SAME PLACE] → 고정 문장 펴기 → 기울기 문장 → 지문 줄 → 그림 번호 → state.order. */
export function finishOrder(q: FinishOrderInput): { order: BaeOrder; promptText: string; picks: string[]; manualPicks: string[] } {
  const { obj, cost, inputs: inp, library: lib } = q; const isRev = typeof q.revText === 'string'; const dir = q.dir;
  const extra = q.carryExtra || []; const carry = q.carry || [];
  const asked = inp.place ? [] : [...new Set(q.styleMode === 'manual' ? q.manualIds : (obj.style_picks || []))];
  const unknown = asked.filter((id) => !lib.some((e) => e.id === id));
  const ids = asked.filter((id) => lib.some((e) => e.id === id)).slice(0, 2);
  const prev = q.prevOrder;
  const prevDir = isRev && prev && prev.director ? prev.director : null;
  const dirEn = dir.ko.length ? (obj.director_en || []).map((t) => String(t).replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
  const dirRep = dir.ko.length ? [...new Set(((prevDir && prevDir.replaced) || []).concat(obj.director_replaced || []))].filter((k) => (DIR_MARKERS as readonly string[]).includes(k)) : [];
  const placeNotes: string[] = []; const placed = inp.place ? samePlace(obj.prompt, inp.place, placeNotes) : obj.prompt;
  const expd = expandBlocks(placed, ids.length, { fixedText: q.fixedText, time: q.materials.time, place: q.materials.place }, { replaced: dirRep });
  if (inp.rough.tilt) expd.text = addTilt(expd.text);
  const filled = fillPlaceholders(dir.ko.length ? withDirLine(expd.text, dirEn.length ? dirEn : dir.ko) : stripDirLine(expd.text), inp.refs.length + (inp.place ? inp.place.n : 0), ids.length);
  const notes = (obj.notes_ko || []).slice().concat(placeNotes, expd.notes);
  if (carry.length > extra.length) notes.push('이전 수정 요청 ' + (carry.length - extra.length) + '개를 이어서 PD에게 알려 줬어요.');
  if (extra.length) notes.push('검수 내용을 넣어서 주문서를 새로 만들었어요.');
  if (unknown.length) notes.push('PD가 라이브러리에 없는 예시(' + unknown.join(', ') + ')를 골라서 뺐어요.');
  if (filled.leftover) notes.push('주문서에 레퍼런스 이미지 예시 문장이 있었는데 고른 예시가 없어서, 그 문장은 기준 이미지를 가리키게 됐어요. 필요하면 영어 주문서에서 그 문장을 지워주세요.');
  const prevCost = isRev && prev ? (prev.cost || 0) : 0;
  const doneMsg = (isRev ? '고친 주문서 완료' : '주문서 완료') + (cost != null ? ' · 해석 비용 ' + won(cost, q.rate) : '') + '. 확인하고 \'그림 만들기\'를 눌러주세요.';
  const revText = isRev ? (q.revText as string) : '';
  const promptText = withRatio(filled.text, effRatio(q.materials.ratio, q.materials.tier, q.materials.tilt));
  const order: BaeOrder = {
    summary: obj.summary_ko as string, notes, raw: obj.prompt, prompt: promptText, picks: ids, refIds: inp.refIds, reason: obj.style_reason_ko || '',
    cost: cost != null ? cost + prevCost : (prevCost || null), doneMsg, dirty: q.dirty,
    revisions: isRev ? ((prev && prev.revisions) || []).concat(q.label || revText.trim()) : [], revTexts: isRev ? ((prev && prev.revTexts) || []).concat(revText.trim()) : [],
    carried: isRev ? ((prev && prev.carried) || []) : carry, roughKey: inp.rough.key, manualVer: q.manualVer, blocksVer: q.blocksVer, rulesKo: q.rulesKo || '',
    director: dir.ko.length ? { ko: dir.ko, revKo: dir.revKo, en: dirEn, replaced: dirRep } : null,
    place: inp.place ? { mode: inp.place.mode, n: inp.place.n, painted: !!inp.place.painted } : null, tilt: inp.rough.tilt || 0,
  };
  const manualPicks = q.styleMode === 'manual' && !q.manualPicks.length ? ids.slice() : q.manualPicks.slice();
  return { order, promptText, picks: ids, manualPicks };
}

/** HTML currentPickIds(): 그림 요청에 넣을 예시 id (null = 아직 모름: 자동인데 주문서가 없음). */
export function currentPickIds(placeMode: '' | 'sheet' | 'base', styleMode: StyleMode, manualPicks: string[], order: Pick<BaeOrder, 'picks'> | null, lib: LibEntry[]): string[] | null {
  if (placeMode) return [];
  const ids = styleMode === 'manual' ? manualPicks : (order ? order.picks : null);
  return ids === null ? null : ids.filter((id) => lib.some((e) => e.id === id));
}

/** HTML finalList(): 그림 모델에게 보내는 순서 = 러프, 기준 배경, 레퍼런스, 고른 예시, 그림체 띠. */
export function finalList<T>(inp: { rough: T; place: { items: T[] } | null; refs: T[]; base: T }, picks: T[]): T[] {
  return [inp.rough, ...(inp.place ? inp.place.items : []), ...inp.refs, ...picks, inp.base];
}
