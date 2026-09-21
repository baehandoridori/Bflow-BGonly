import type { Scene, SceneAssigneeProgressMap } from '@/types';
import { readMetadata, writeMetadata } from '@/services/supabaseService';
import {
  SCENE_ASSIGNEE_PROGRESS_META_TYPE,
  hasMultiAssigneeProgress,
  mergeAssigneeProgressForWrite,
  parseAssigneeNames,
  parseAssigneeProgressValue,
  serializeAssigneeProgress,
  updateAllAssigneeProgressEntries,
} from '@/utils/assigneeProgress';
import { deriveActingPhaseFromStages, type SequentialStagePatch } from '@/utils/sceneStageProgression';

/**
 * 담당자별 진행률 저장.
 *
 * 한 씬의 담당자 전원이 metadata 한 행(JSON)을 공유하므로, 화면 스냅샷을 통째로 덮어쓰면
 * 그 사이 상대가 바꾼 값이 사라진다. 저장 직전에 서버 정본을 다시 읽어
 * `changedNames`(이번에 내가 바꾼 담당자)만 그 위에 얹는다.
 *
 * 저장된 맵을 반환하므로, 호출자는 이 값으로 스토어를 한 번 더 맞춰
 * 저장 도중 들어온 상대 변경까지 화면에 반영할 수 있다.
 */
export async function saveAssigneeProgress(
  sceneUuid: string,
  localProgress: SceneAssigneeProgressMap,
  changedNames: string[],
): Promise<SceneAssigneeProgressMap> {
  const row = await readMetadata(SCENE_ASSIGNEE_PROGRESS_META_TYPE, sceneUuid);
  const serverProgress = parseAssigneeProgressValue(row?.value);
  const merged = mergeAssigneeProgressForWrite(serverProgress, localProgress, changedNames);
  await writeMetadata(SCENE_ASSIGNEE_PROGRESS_META_TYPE, sceneUuid, serializeAssigneeProgress(merged));
  return merged;
}

/**
 * 씬 단위 단계 토글(나의 할 일 위젯·컴포지팅 모달 등)을 담당자별 진행률에도 반영한다.
 *
 * 다중 담당 씬은 화면에 보이는 단계가 담당자별 기록에서 다시 계산되기 때문에,
 * 씬 컬럼만 바꾸면 다음 동기화 때 원래대로 되돌아간다.
 *
 * 이 두 화면의 체크박스는 담당자별 값이 아니라 **씬 집계값**을 그린다. 그리고 집계는
 * BG 가 담당자 전원 AND, 액팅이 최저 단계다. 그래서 누른 사람 항목만 바꾸면 집계가 움직이지 않아
 * 눌러도 그대로 되돌아간다 — 씬 뷰의 씬 단위 토글과 똑같이 **담당자 전원**을 맞춰야 한다.
 * (누른 사람만 기록하려면 두 화면이 담당자별 값을 그리도록 먼저 바꿔야 한다.)
 *
 * 액팅 씬은 단계 상태가 정본이므로 체크 4개에서 단계 상태를 역산해 넣는다.
 * 단계 상태를 비우면 담당자별 스택의 대기/작업중/피드백/완료 표시와 차수가 사라진다.
 *
 * 다중 담당이 아니거나 씬 UUID 가 없으면 null — 호출자는 기존 씬 컬럼 저장만 하면 된다.
 */
export function buildSceneStagePatchProgress(
  scene: Scene,
  stagePatch: SequentialStagePatch,
  actorName: string | undefined,
  isActingScene: boolean,
): { progress: SceneAssigneeProgressMap; changedNames: string[] } | null {
  if (!scene.id || !hasMultiAssigneeProgress(scene)) return null;
  const update = isActingScene
    ? { kind: 'phase' as const, ...deriveActingPhaseFromStages(scene, stagePatch) }
    : { kind: 'stagePatch' as const, patch: stagePatch };
  return {
    progress: updateAllAssigneeProgressEntries(scene, update, actorName),
    changedNames: parseAssigneeNames(scene.assignee),
  };
}
