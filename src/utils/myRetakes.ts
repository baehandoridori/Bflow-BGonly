import type { CompRevision } from '../types/index.ts';

export type MyRetakeState = 'pending' | 'in_progress';

/** 알림 수신자나 전체 리테이크 상태와 구분해 본인의 미완료 담당 상태만 확인한다. */
export function getMyRetakeState(revision: CompRevision, userId: string): MyRetakeState | null {
  if (!userId || revision.status === 'resolved' || revision.finalResolvedAt) return null;
  if (!revision.assigneeIds?.includes(userId)) return null;
  const state = revision.assigneeStates?.[userId]?.state ?? 'pending';
  return state === 'done' ? null : state;
}

export function selectMyRetakes(revisions: readonly CompRevision[], userId: string): CompRevision[] {
  const createdAt = (revision: CompRevision) => {
    const time = Date.parse(revision.createdAt);
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
  };
  return revisions
    .filter((revision) => getMyRetakeState(revision, userId) !== null)
    .sort((a, b) => createdAt(a) - createdAt(b) || a.id.localeCompare(b.id));
}

export function summarizeMyRetakes(revisions: readonly CompRevision[], userId: string) {
  let pending = 0;
  let inProgress = 0;
  for (const revision of revisions) {
    const state = getMyRetakeState(revision, userId);
    if (state === 'pending') ++pending;
    if (state === 'in_progress') ++inProgress;
  }
  return { pending, inProgress, total: pending + inProgress };
}

export function formatRetakeElapsed(createdAt: string, now: number): string {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created) || !Number.isFinite(now)) return '등록일 없음';
  const minutes = Math.max(0, Math.floor((now - created) / 60_000));
  if (minutes < 1) return '방금 등록';
  if (minutes < 60) return `등록 후 ${minutes}분`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `등록 후 ${hours}시간`;
  return `등록 후 ${Math.floor(hours / 24)}일`;
}
