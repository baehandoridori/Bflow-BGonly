import type { SceneAssigneeProgressMap } from '@/types';

/**
 * 저장 직전에 서버 정본 위에 "이번에 내가 바꾼 담당자 항목"만 얹는다.
 *
 * 한 씬의 담당자별 진행률은 담당자 전원이 metadata 한 행(JSON)에 같이 들어 있다.
 * 내 화면 스냅샷을 통째로 덮어쓰면, 내가 화면을 그린 뒤 상대가 바꾼 값이 조용히 사라진다.
 * (= "둘이 같이 작업하면 간헐적으로 체크가 되돌아온다")
 * 그래서 내가 건드리지 않은 담당자는 항상 서버 값을 그대로 둔다.
 *
 * - 서버에만 있는 담당자(담당자 목록에서 잠시 빠진 사람 등)의 기록도 지우지 않고 보존한다.
 * - 서버에 없는 담당자는 로컬에서 합성한 값을 쓴다(서버에 지킬 기록이 애초에 없다).
 */
export function mergeAssigneeProgressForWrite(
  serverProgress: SceneAssigneeProgressMap | null | undefined,
  localProgress: SceneAssigneeProgressMap,
  changedNames: string[],
): SceneAssigneeProgressMap {
  const merged: SceneAssigneeProgressMap = { ...localProgress, ...(serverProgress ?? {}) };
  for (const name of changedNames) {
    const mine = localProgress[name];
    if (mine) merged[name] = mine;
  }
  return merged;
}
