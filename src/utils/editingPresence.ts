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

/** 단일 파일 기준 2명 이상 동시 편집이면 경고 톤 (자기 자신 포함 — 나+타인이면 실제 충돌) */
export function isWarnPresence(editors: EditingUser[]): boolean {
  return editors.length >= 2;
}

/**
 * 파일별 충돌 판정: 주어진 씬(파일) 중 "하나라도" 2명 이상이 동시에 열고 있으면 true.
 * 통합 카드/행처럼 BG·ACT 여러 파일을 한 요소로 묶을 때, 서로 다른 파일을 한 명씩
 * 열어둔 상황(유니온 2명)을 거짓 충돌로 경고하지 않기 위함.
 * (snapshot[uuid] 는 userId 로 이미 dedupe 되어 있음 — mergePresenceState)
 */
export function hasSceneCollision(
  snapshot: EditingPresenceSnapshot,
  sceneUuids: Array<string | null | undefined>,
): boolean {
  for (const uuid of sceneUuids) {
    if (uuid && (snapshot[uuid]?.length ?? 0) >= 2) return true;
  }
  return false;
}

/** div/motion.div 요소용 무지개 테두리 클래스 — 편집자 유무와 경고를 독립 신호로 받음. */
export function editingBeamClass(hasEditors: boolean, warn: boolean): string {
  if (!hasEditors) return '';
  return warn ? 'editing-beam editing-beam--warn' : 'editing-beam';
}

/** 테이블 <tr>용 행 전용 무지개 테두리 클래스 — 편집자 유무와 경고를 독립 신호로 받음. */
export function editingBeamRowClass(hasEditors: boolean, warn: boolean): string {
  if (!hasEditors) return '';
  return warn ? 'editing-beam-row editing-beam-row--warn' : 'editing-beam-row';
}

/** 단일 씬(파일) 편집자 배열로 무지개 테두리 클래스 (경고=같은 파일 2명+). */
export function editingBeamClassName(editors: EditingUser[]): string {
  return editingBeamClass(editors.length > 0, isWarnPresence(editors));
}

/** 단일 씬(파일) 편집자 배열로 행 무지개 테두리 클래스. */
export function editingBeamRowClassName(editors: EditingUser[]): string {
  return editingBeamRowClass(editors.length > 0, isWarnPresence(editors));
}
