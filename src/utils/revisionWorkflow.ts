/**
 * 리테이크(CompRevision) 워크플로우 순수 함수 모음.
 *
 * - UI/DB 의존 없음 — 입력 → 출력만.
 * - 모든 함수 불변: 입력 객체를 직접 수정하지 않음.
 *
 * spec: docs/superpowers/specs/2026-06-17-retake-hub-redesign-design.md
 */

import type { RevisionStatus, RevisionAssigneeState, AppUser, CompRevision } from '@/types';
import { isCompositorForCompositing } from './compositingLabels.ts';

// ─── 상태 파생 ────────────────────────────────

/**
 * 전체 status 파생 (권위). 위에서부터 먼저 만족하는 것:
 * 1. final_resolved_at 있으면 → resolved
 * 2. 담당자 0명 또는 전원 pending → open
 * 3. 담당자 전원 done → assignee_done
 * 4. 그 외 → in_progress
 */
export function deriveRevisionStatus(
  assigneeIds: readonly string[],
  assigneeStates: Readonly<Record<string, RevisionAssigneeState>>,
  finalResolvedAt: string | null | undefined,
): RevisionStatus {
  if (finalResolvedAt) return 'resolved';
  if (assigneeIds.length === 0) return 'open';
  const states = assigneeIds.map((id) => assigneeStates[id]?.state ?? 'pending');
  if (states.every((s) => s === 'pending')) return 'open';
  if (states.every((s) => s === 'done')) return 'assignee_done';
  return 'in_progress';
}

// ─── 불변식 복원 ──────────────────────────────

/**
 * 불변식 assignee_ids ⊆ notify_user_ids 복원.
 * notify에 없는 담당자는 제거, state 없는 담당자는 pending으로 채움.
 */
export function sanitizeAssignees(
  assigneeIds: readonly string[],
  assigneeStates: Readonly<Record<string, RevisionAssigneeState>>,
  notifyUserIds: readonly string[],
): { assigneeIds: string[]; assigneeStates: Record<string, RevisionAssigneeState> } {
  const allowed = new Set(notifyUserIds);
  const cleanIds = assigneeIds.filter((id) => allowed.has(id));
  const cleanStates: Record<string, RevisionAssigneeState> = {};
  for (const id of cleanIds) {
    cleanStates[id] = assigneeStates[id] ?? { state: 'pending' };
  }
  return { assigneeIds: cleanIds, assigneeStates: cleanStates };
}

// ─── 담당 상태 전이 ───────────────────────────

type StateMap = Record<string, RevisionAssigneeState>;

export function startAssignee(states: Readonly<StateMap>, userId: string, now: string): StateMap {
  const prev = states[userId] ?? { state: 'pending' };
  return { ...states, [userId]: { ...prev, state: 'in_progress', startedAt: prev.startedAt ?? now } };
}

export function completeAssignee(states: Readonly<StateMap>, userId: string, note: string, now: string): StateMap {
  const prev = states[userId] ?? { state: 'pending' };
  return { ...states, [userId]: { ...prev, state: 'done', note, doneAt: now } };
}

export function revertAssignee(states: Readonly<StateMap>, userId: string): StateMap {
  const prev = states[userId] ?? { state: 'pending' };
  const next: RevisionAssigneeState = { ...prev, state: 'in_progress' };
  // doneAt은 done 상태에서만 존재 — 되돌릴 때 항상 제거. (JSONB 저장 시 undefined 필드는 mapRevision/직렬화에서 strip)
  delete next.doneAt;
  return { ...states, [userId]: next };
}

// ─── 권한 가드 ────────────────────────────────

// 재배정·최종완료 권한은 동일 정책(요청자 본인 또는 컴포지터급). 의미 구분을 위해 별도 export 유지.
/** 컴포지터급(컴포지터/admin/배한솔) 또는 리테이크 요청자 본인. */
function isRequesterOrCompositor(
  user: AppUser | null | undefined,
  revision: Pick<CompRevision, 'requesterId'>,
): boolean {
  if (!user) return false;
  if (revision.requesterId && revision.requesterId === user.id) return true;
  return isCompositorForCompositing(user);
}

export function canReassignRevision(
  user: AppUser | null | undefined,
  revision: Pick<CompRevision, 'requesterId'>,
): boolean {
  return isRequesterOrCompositor(user, revision);
}

export function canFinalResolveRevision(
  user: AppUser | null | undefined,
  revision: Pick<CompRevision, 'requesterId'>,
): boolean {
  return isRequesterOrCompositor(user, revision);
}

export function canActAsAssignee(
  user: AppUser | null | undefined,
  revision: Pick<CompRevision, 'assigneeIds'>,
): boolean {
  if (!user) return false;
  return (revision.assigneeIds ?? []).includes(user.id);
}
