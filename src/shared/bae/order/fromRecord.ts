/**
 * 기록으로 남은 그림의 주문서를 이어받아 고치기 (2026-11-23 한솔: '한글로 주문서 고치기는 어딨어').
 * 앱을 다시 켜면 방금 그린 작업도 서버 기록이 되어 작업대가 '보기만'으로 보여 줬다. 기록에 남은 PD 글(요약 · 메모 · 영어 주문서 ·
 * 고친 기록 · 지문)과 재료 요약으로 HTML state.order 모양을 다시 세워, 고치기(reviseInput)가 이전 주문서처럼 쓰게 한다.
 * 재료(러프 · 레퍼런스 · 기준 배경)는 지금 재료 창의 것을 보낸다 — 그래서 고치기 전에 재료 창이 그 그림 때와 같은지 따로 본다.
 */
import type { BaeJob } from '../jobs';
import type { BaeOrder } from './types';

/** 이 기록의 주문서를 고칠 수 없는 까닭 ('' = 고칠 수 있음). 내 기록인지와 진행 중인 작업은 부르는 쪽이 본다. */
export function baeRecordReviseBlock(rec: Pick<BaeJob, 'kind' | 'status' | 'pd'>): string {
  if (rec.kind !== 'new' && rec.kind !== 'same') return '이 기록은 주문서로 그린 그림이 아니에요.';
  if (rec.status !== 'done' && rec.status !== 'failed' && rec.status !== 'stopped') return '아직 만드는 중인 기록이에요.';
  if (!rec.pd?.prompt?.trim() || !rec.pd.summaryKo?.trim()) return '이 기록에는 주문서가 남아 있지 않아요.';
  return '';
}

/**
 * 기록 → 이전 주문서 (BaeOrder). refIdsNow = 지금 재료 창의 레퍼런스 번호들: 그 그림 때와 개수가 같으면 그대로 써서
 * '주문서와 재료가 맞지 않아요' 검사를 지나가게 하고, 다르면 그때 개수만큼 자리표시를 둔다 (고친 뒤 새 주문서는 지금 재료로 다시 맞춰진다).
 */
export function baeOrderFromRecord(rec: Pick<BaeJob, 'summary' | 'pd'>, refIdsNow: ReadonlyArray<number | string>): BaeOrder {
  const pd = rec.pd ?? {}; const sm = rec.summary ?? {};
  const nRefs = Array.isArray(sm.refNotes) ? sm.refNotes.length : 0;
  const refIds: Array<number | string> = refIdsNow.length === nRefs ? refIdsNow.slice() : Array.from({ length: nRefs }, (_, i) => `rec-${i}`);
  const b = sm.base;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    summary: pd.summaryKo ?? '', notes: list(pd.notesKo), raw: pd.raw ?? '', prompt: pd.prompt ?? '',
    picks: list(sm.picks), refIds, reason: pd.reason ?? '', cost: null, doneMsg: '', dirty: false,
    revisions: list(pd.revisions), revTexts: list(pd.revTexts), carried: [], roughKey: '',
    manualVer: sm.manualVer ?? '', blocksVer: sm.fixedVer ?? '', rulesKo: '',
    director: pd.director ? { ko: list(pd.director.ko), revKo: [], en: list(pd.director.en), replaced: list(pd.director.replaced) } : null,
    place: b && (b.mode === 'sheet' || b.mode === 'base') ? { mode: b.mode, n: Number(b.n) || 0, painted: !!b.painted } : null,
    tilt: typeof sm.tilt === 'number' ? sm.tilt : 0,
  };
}

/**
 * 두 작은 회색 그림(0~1, 같은 크기)의 차이. 러프는 거의 흰 종이라 흰 칸끼리는 빼고, 어느 한쪽에라도 선이 있는 칸만 평균 낸다
 * (다른 러프면 한쪽 선 자리가 다른 쪽에선 흰 종이라 크게 벌어진다). 크기가 다르면 1, 둘 다 빈 종이면 0.
 */
export function baeGrayDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a.length || a.length !== b.length) return 1;
  let s = 0; let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.min(a[i], b[i]) > 0.92) continue;
    s += Math.abs(a[i] - b[i]); n++;
  }
  return n ? s / n : 0;
}
/** 재료 창의 러프가 기록의 러프 미리보기와 같은 그림으로 볼 만큼 가까운지 (미리보기는 JPEG 로 다시 저장돼 조금 다르다). */
export const BAE_ROUGH_SAME_MAX = 0.08;
