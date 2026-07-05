// src/utils/editingPresence.ts
import type { EditingUser, EditingPresenceSnapshot } from '@/types';

/** 렌더러 표시용 편집자 뷰모델 — 전송 타입(EditingUser)에 "나 여부"를 덧붙인다. */
export interface PresenceEditor extends EditingUser {
  isSelf: boolean;
}

/**
 * 여러 sceneUuid를 편집 중인 사용자 목록.
 * selfUserId 와 일치하는 사용자는 제외하지 않고 isSelf=true 로 태깅하며, 목록 맨 앞에 둔다.
 * (자기 자신의 '작업 중'도 본인 화면에 보이게 하기 위함 — 라벨 최대 개수에 잘려도 '나'는 항상 노출)
 */
export function selectEditorsForScenes(
  snapshot: EditingPresenceSnapshot,
  sceneUuids: Array<string | null | undefined>,
  selfUserId: string | null | undefined,
): PresenceEditor[] {
  const byId = new Map<string, PresenceEditor>();
  for (const uuid of sceneUuids) {
    if (!uuid) continue;
    for (const user of snapshot[uuid] ?? []) {
      if (byId.has(user.userId)) continue;
      byId.set(user.userId, {
        userId: user.userId,
        username: user.username,
        isSelf: !!selfUserId && user.userId === selfUserId,
      });
    }
  }
  // 자기 자신을 맨 앞으로 (sort 안정성: 나머지 순서는 삽입 순 유지)
  return [...byId.values()].sort((a, b) => (a.isSelf === b.isSelf ? 0 : a.isSelf ? -1 : 1));
}

export function formatEditorLabels<T extends EditingUser>(
  editors: T[],
  max = 2,
): { shown: T[]; overflow: number } {
  return { shown: editors.slice(0, max), overflow: Math.max(0, editors.length - max) };
}

/** 라벨/배너에 표시할 이름 — 자기 자신은 '나'. */
export function editorDisplayName(editor: PresenceEditor): string {
  return editor.isSelf ? '나' : editor.username;
}

/** 2명 이상 동시 편집이면 경고 톤 (자기 자신 포함 — 나+타인이면 실제 충돌) */
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
