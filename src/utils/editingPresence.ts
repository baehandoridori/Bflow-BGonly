// src/utils/editingPresence.ts
import type { EditingUser, EditingPresenceSnapshot } from '@/types';

export function selectEditorsForScenes(
  snapshot: EditingPresenceSnapshot,
  sceneUuids: Array<string | null | undefined>,
  excludeUserId: string | null | undefined,
): EditingUser[] {
  const byId = new Map<string, EditingUser>();
  for (const uuid of sceneUuids) {
    if (!uuid) continue;
    for (const user of snapshot[uuid] ?? []) {
      if (excludeUserId && user.userId === excludeUserId) continue;
      if (!byId.has(user.userId)) byId.set(user.userId, user);
    }
  }
  return [...byId.values()];
}

export function formatEditorLabels(editors: EditingUser[], max = 2): { shown: EditingUser[]; overflow: number } {
  return { shown: editors.slice(0, max), overflow: Math.max(0, editors.length - max) };
}

/** 2명 이상 동시 편집이면 경고 톤 */
export function isWarnPresence(editors: EditingUser[]): boolean {
  return editors.length >= 2;
}

/** div/motion.div 요소에 붙일 무지개 테두리 클래스 (편집자 0명이면 '') */
export function editingBeamClassName(editors: EditingUser[]): string {
  if (!editors.length) return '';
  return isWarnPresence(editors) ? 'editing-beam editing-beam--warn' : 'editing-beam';
}

/** 테이블 <tr>에 붙일 행 전용 무지개 테두리 클래스 (편집자 0명이면 '') */
export function editingBeamRowClassName(editors: EditingUser[]): string {
  if (!editors.length) return '';
  return isWarnPresence(editors) ? 'editing-beam-row editing-beam-row--warn' : 'editing-beam-row';
}
