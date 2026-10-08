import type { SceneAssigneeProgressMap } from '@/types';
import { readMetadata, writeMetadata } from '@/services/supabaseService';
import {
  SCENE_ASSIGNEE_PROGRESS_META_TYPE,
  mergeAssigneeProgressForWrite,
  parseAssigneeProgressValue,
  serializeAssigneeProgress,
} from '@/utils/assigneeProgress';

/**
 * 담당자별 진행률 저장.
 *
 * 한 씬의 담당자 전원이 metadata 한 행(JSON)을 공유하므로, 화면 스냅샷을 통째로 덮어쓰면
 * 그 사이 상대가 바꾼 값이 사라진다. 저장 직전에 서버 정본을 다시 읽어
 * `changedNames`(이번에 내가 바꾼 담당자)만 그 위에 얹는다.
 *
 * 저장된 맵을 반환하므로, 호출자는 이 값으로 스토어를 한 번 더 맞춰
 * 저장 도중 들어온 상대 변경까지 화면에 반영할 수 있다.
 *
 * options.beforeWrite: 정본을 읽은 뒤 쓰기 직전에 부른다. 던지면 쓰지 않는다
 * (예: 로그인 세션이 그 사이 바뀌었으면 앞 사람의 진행을 다음 사람 세션에 쓰지 않게 — 움직임 폴리싱 20번 자동 재전송).
 */
export async function saveAssigneeProgress(
  sceneUuid: string,
  localProgress: SceneAssigneeProgressMap,
  changedNames: string[],
  options: { beforeWrite?: () => void } = {},
): Promise<SceneAssigneeProgressMap> {
  const row = await readMetadata(SCENE_ASSIGNEE_PROGRESS_META_TYPE, sceneUuid);
  const serverProgress = parseAssigneeProgressValue(row?.value);
  const merged = mergeAssigneeProgressForWrite(serverProgress, localProgress, changedNames);
  options.beforeWrite?.();
  await writeMetadata(SCENE_ASSIGNEE_PROGRESS_META_TYPE, sceneUuid, serializeAssigneeProgress(merged));
  return merged;
}
