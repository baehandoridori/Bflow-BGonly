/**
 * 리테이크 세트 진행률·자동완료 순수 로직 (리테이크 허브 5단계). 순수 함수 — node:test 검증.
 *
 * 세트 하위 항목 = comp_revisions(set_id) 레코드 그 자체. 진행률 = resolved 수 / 전체 하위 수.
 * 전원 resolved(>=1) → 세트 자동완료(status='done'). 빈 세트(0개)는 자동완료하지 않는다(0/0).
 * (구조적 타입 — @/ alias 없이 node:test 가능)
 */

export interface SetItemLike {
  status: string;
}

export interface SetProgress {
  /** resolved 하위 개수 (분자) */
  done: number;
  /** 전체 하위 개수 (분모) */
  total: number;
  /** 0~100 정수 퍼센트. total 0 이면 0. */
  pct: number;
}

/** 세트 진행률 — done(resolved 수)/total(전체). 빈 세트는 {0,0,0}. */
export function computeSetProgress(items: readonly SetItemLike[]): SetProgress {
  const total = items.length;
  const done = items.reduce((n, i) => (i.status === 'resolved' ? n + 1 : n), 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

/** 하위 1개 이상 전원 resolved → 자동완료 대상. 빈 세트는 false(스펙 §9.5). */
export function isSetAutoComplete(items: readonly SetItemLike[]): boolean {
  return items.length > 0 && items.every((i) => i.status === 'resolved');
}

/** 하위 항목 상태로부터 파생되는 세트 status. 전원 resolved → 'done', 아니면 'open'(빈 세트 포함). */
export function nextSetStatus(items: readonly SetItemLike[]): 'open' | 'done' {
  return isSetAutoComplete(items) ? 'done' : 'open';
}
