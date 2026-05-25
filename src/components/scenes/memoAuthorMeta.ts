import type { Activity } from '@/types';

export interface MemoAuthorMeta {
  userName: string;
  createdAt: string;
}

export function findLatestMemoActivity(
  activities: readonly Activity[],
  sceneId: string | null | undefined,
): MemoAuthorMeta | null {
  if (!sceneId) return null;
  const latest = activities
    .filter((activity) => activity.actionType === 'memo_update' && activity.sceneId === sceneId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (!latest) return null;
  return {
    userName: latest.userName,
    createdAt: latest.createdAt,
  };
}
