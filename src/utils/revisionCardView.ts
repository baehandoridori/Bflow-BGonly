/**
 * 리테이크 카드(시안 A) 표현용 순수 함수 모음.
 *
 * - UI/DB/store 의존 없음 — 입력 → 출력만.
 * - 카드와 5단계 허브 시안B 테이블이 공유한다.
 *
 * ⚠️ node --test 호환: 런타임 값 import 금지(import type 만). import type 라인은 트랜스파일 시
 *   strip 되므로 @/ alias 여도 무해(revisionWorkflow.ts 와 동일 패턴).
 *
 * spec: docs/superpowers/specs/2026-06-17-retake-hub-redesign-design.md §8
 */

import type { RevisionStatus, RevisionAssigneeState } from '@/types';

type StateMap = Readonly<Record<string, RevisionAssigneeState>>;

/** §8.1 좌측 색막대 — status별 CSS 클래스 접미사. */
export function sideBarColorClass(status: RevisionStatus): string {
  switch (status) {
    case 'in_progress':
      return 'rev-side-bar-progress';
    case 'assignee_done':
      return 'rev-side-bar-assignee-done';
    case 'resolved':
      return 'rev-side-bar-done';
    case 'open':
    default:
      return 'rev-side-bar-open';
  }
}

export interface AssigneeSummary {
  total: number;
  doneCount: number;
  /** 담당자 1명+ 전원 done 일 때만 true (빈 세트는 false). 최종완료 바 활성 게이트. */
  allDone: boolean;
}

/** 담당자 집계. state 누락은 pending 취급(derive 규칙과 동일). */
export function summarizeAssignees(assigneeIds: readonly string[], states: StateMap): AssigneeSummary {
  const total = assigneeIds.length;
  const doneCount = assigneeIds.filter((id) => (states[id]?.state ?? 'pending') === 'done').length;
  return { total, doneCount, allDone: total > 0 && doneCount === total };
}

/** done + note 가 있는 담당자의 완료멘트를 assigneeIds 순서로 수집 (대표 멘트 표시용). */
export function collectAssigneeNotes(
  assigneeIds: readonly string[],
  states: StateMap,
): Array<{ userId: string; note: string }> {
  const out: Array<{ userId: string; note: string }> = [];
  for (const id of assigneeIds) {
    const s = states[id];
    if (s?.state === 'done' && s.note) out.push({ userId: id, note: s.note });
  }
  return out;
}

/**
 * 최종완료 바를 카드에 그릴지 — 담당자 1명+ 일 때만(0명 항목은 단순 흐름).
 * 활성/잠금·권한은 호출측이 allDone + canFinalResolveRevision 으로 따로 결정한다.
 */
export function canShowFinalResolveBar(
  assigneeIds: readonly string[],
  _finalResolvedAt: string | null | undefined,
): boolean {
  return assigneeIds.length > 0;
}
