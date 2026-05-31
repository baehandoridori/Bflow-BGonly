import { useBulkOperationsStore, type OpKind } from '@/stores/useBulkOperationsStore';
import { useDataStore } from '@/stores/useDataStore';
import type { BulkUpdateResult, MergedScene, Part, Scene, ScenePhaseState, Stage } from '@/types';

// v1.25.12 — 머지드 단위 카운트 헬퍼 재노출 (테스트 격리 위해 별도 파일).
export { countSelectedScenes } from './bulkSelectionCount';

const MERGED_KEY_PREFIX = { bg: 'bg:', act: 'act:' } as const;

function findSceneInPart(part: Part | null | undefined, sceneId: string): Scene | undefined {
  if (!part) return undefined;
  return part.scenes.find((s) => s.sceneId === sceneId);
}

/**
 * 선택된 씬 ID 집합을 Supabase 씬 UUID 배열로 변환한다.
 *
 * 선택 ID 형식:
 * - `bg:${mergedKey}` — 통합 모드에서 BG 씬 선택
 * - `act:${mergedKey}` — 통합 모드에서 액팅 씬 선택
 * - `${sceneId}` (plain) — 개별 모드, human sceneId ("a001" 등)
 *
 * 개별 모드에서는 `fallbackPart`가 있으면 해당 파트 내에서만 검색하고,
 * 없으면 스토어 전체에서 첫 번째로 매치되는 씬을 반환한다.
 */
export function resolveSelectedUuids(
  selectedIds: Set<string> | Iterable<string>,
  allMergedScenes: MergedScene[],
  fallbackPart?: Part | null,
): string[] {
  const uuids: string[] = [];
  const seen = new Set<string>();

  const pushUuid = (uuid: string | undefined | null) => {
    if (!uuid) return;
    if (seen.has(uuid)) return;
    seen.add(uuid);
    uuids.push(uuid);
  };

  for (const id of selectedIds) {
    if (id.startsWith(MERGED_KEY_PREFIX.bg)) {
      const mergedKey = id.slice(MERGED_KEY_PREFIX.bg.length);
      const merged = allMergedScenes.find((m) => m.mergedKey === mergedKey);
      pushUuid(merged?.bgScene?.id);
    } else if (id.startsWith(MERGED_KEY_PREFIX.act)) {
      const mergedKey = id.slice(MERGED_KEY_PREFIX.act.length);
      const merged = allMergedScenes.find((m) => m.mergedKey === mergedKey);
      pushUuid(merged?.actScene?.id);
    } else {
      const scene = fallbackPart
        ? findSceneInPart(fallbackPart, id)
        : useDataStore.getState().findSceneBySceneId(id);
      pushUuid(scene?.id);
    }
  }

  return uuids;
}

/**
 * 선택된 씬 ID 집합을 Scene 객체 배열로 변환한다.
 * stage 토글처럼 현재 값(lo/done/review/png)이 필요한 경우 사용한다.
 *
 * `onlyDept`가 주어지면 통합 모드(bg:/act: 접두사)에서 해당 부서만 필터한다.
 * 개별 모드(plain sceneId)에서는 onlyDept를 무시한다 (현재 부서 하나만 존재).
 * `fallbackPart`가 주어지면 개별 모드에서는 해당 파트 내에서만 검색한다.
 */
export function resolveSelectedScenes(
  selectedIds: Set<string> | Iterable<string>,
  allMergedScenes: MergedScene[],
  onlyDept?: 'bg' | 'acting',
  fallbackPart?: Part | null,
): Scene[] {
  const scenes: Scene[] = [];
  const seen = new Set<string>();

  const pushScene = (scene: Scene | undefined | null) => {
    if (!scene?.id) return;
    if (seen.has(scene.id)) return;
    seen.add(scene.id);
    scenes.push(scene);
  };

  for (const id of selectedIds) {
    if (id.startsWith(MERGED_KEY_PREFIX.bg)) {
      if (onlyDept && onlyDept !== 'bg') continue;
      const mergedKey = id.slice(MERGED_KEY_PREFIX.bg.length);
      const merged = allMergedScenes.find((m) => m.mergedKey === mergedKey);
      pushScene(merged?.bgScene);
    } else if (id.startsWith(MERGED_KEY_PREFIX.act)) {
      if (onlyDept && onlyDept !== 'acting') continue;
      const mergedKey = id.slice(MERGED_KEY_PREFIX.act.length);
      const merged = allMergedScenes.find((m) => m.mergedKey === mergedKey);
      pushScene(merged?.actScene);
    } else {
      const scene = fallbackPart
        ? findSceneInPart(fallbackPart, id)
        : useDataStore.getState().findSceneBySceneId(id);
      pushScene(scene);
    }
  }

  return scenes;
}

type RunBulkOpOptions = {
  targetStage?: 'lo' | 'done' | 'review' | 'png';
  /**
   * stage-toggle에서 4단계 전체 완료/해제 상태가 바뀐 씬의 completedBy/completedAt.
   * 성공 시 store에 반영한다.
   */
  completedMetaByUuid?: Map<string, { completedBy: string; completedAt: string }>;
  /**
   * stage-toggle에서 토글된 stage 값. 성공 시 해당 씬의 stage 필드를 store에 반영한다.
   * key=sceneUuid, value=새 stage 값.
   */
  stageValueByUuid?: Map<string, boolean>;
  /**
   * stage-toggle에서 여러 stage가 함께 바뀌는 경우 성공 시 씬별 patch를 한 번에 반영한다.
   */
  stagePatchByUuid?: Map<string, Partial<Record<Stage, boolean>>>;
  /**
   * field-edit에서 적용할 필드. 성공 시 store에 반영한다.
   */
  fieldsByUuid?: Map<string, Partial<Scene>>;
  /**
   * v1.27.0: act-phase-set 의 목표 phase.
   */
  targetPhase?: ScenePhaseState;
  /**
   * v1.27.0: act-phase-set 의 성공 시 씬별 phase patch.
   * sceneState + workRound + feedbackRound + legacy boolean (lo/done/review/png) 모두 dual-write.
   * 코덱스 1차 P1 #2 fix: legacy 4 boolean 도 포함해야 calcStats / 다른 surface 의 split state 방지.
   * Pick<Scene,...> 대신 명시적 non-null 타입 — Scene.sceneState 는 optional 이라 IPC 호출부에서 컴파일 실패.
   */
  phasePatchByUuid?: Map<string, ActPhasePatch>;
};

/** v1.27.0: bulk ACT phase set 의 씬별 패치 (롤백·낙관 업데이트·success side-effect 공용). */
export interface ActPhasePatch {
  sceneState: ScenePhaseState;
  workRound: number;
  feedbackRound: number;
  lo: boolean;
  done: boolean;
  review: boolean;
  png: boolean;
}

/**
 * 일괄 작업 공통 실행 래퍼.
 * - `useBulkOperationsStore`에 op을 등록하고
 * - 실행 결과에 따라 markConfirmed / markFailed 처리.
 * - delete 성공 시 useDataStore의 removeSceneByUuid를 호출해 정리.
 * - stage-toggle 성공 시 completedMetaByUuid의 메타를 updateSceneByUuid로 반영.
 */
export async function runBulkOp(
  kind: OpKind,
  sceneUuids: string[],
  executor: (uuids: string[]) => Promise<BulkUpdateResult[]>,
  opts: RunBulkOpOptions = {},
): Promise<void> {
  if (sceneUuids.length === 0) return;

  // kind별 성공 시 데이터 스토어 반영 클로저. opts(completedMetaByUuid 등)를 캡처.
  // 최초 실행과 "다시 시도" 모두 동일한 sideeffect를 호출해 UI가 stale되지 않도록 함.
  const applySideEffect = (sceneUuid: string): void => {
    if (kind === 'delete') {
      useDataStore.getState().removeSceneByUuid(sceneUuid);
      return;
    }
    if (kind === 'stage-toggle') {
      const patch: Partial<Scene> = {};
      const stagePatch = opts.stagePatchByUuid?.get(sceneUuid);
      if (stagePatch) {
        Object.assign(patch, stagePatch);
      } else if (opts.stageValueByUuid?.has(sceneUuid) && opts.targetStage) {
        (patch as Record<string, boolean>)[opts.targetStage] =
          opts.stageValueByUuid.get(sceneUuid) as boolean;
      }
      const meta = opts.completedMetaByUuid?.get(sceneUuid);
      if (meta) {
        patch.completedBy = meta.completedBy;
        patch.completedAt = meta.completedAt;
      }
      if (Object.keys(patch).length > 0) {
        useDataStore.getState().updateSceneByUuid(sceneUuid, patch);
      }
      return;
    }
    if (kind === 'field-edit' && opts.fieldsByUuid) {
      const fields = opts.fieldsByUuid.get(sceneUuid);
      if (fields) {
        useDataStore.getState().updateSceneByUuid(sceneUuid, fields);
      }
      return;
    }
    if (kind === 'act-phase-set' && opts.phasePatchByUuid) {
      const patch = opts.phasePatchByUuid.get(sceneUuid);
      if (patch) {
        useDataStore.getState().updateSceneByUuid(sceneUuid, patch);
      }
    }
  };

  // opId를 로컬에 보관해 async 응답 처리 시점에 "내가 시작한 op이 여전히 활성인지" 검증.
  // 사용자가 취소 + 새 op 시작 등의 상황에서 이전 요청의 응답이 새 op에 새어들어가지 않도록 scope 제한. (Codex 리뷰 #8)
  const opId = crypto.randomUUID();
  const isStillActive = () => useBulkOperationsStore.getState().activeOp?.id === opId;

  const store = useBulkOperationsStore.getState();
  store.startOp({
    id: opId,
    kind,
    totalCount: sceneUuids.length,
    pendingSceneUuids: new Set(sceneUuids),
    targetStage: opts.targetStage,
    targetPhase: opts.targetPhase,
    retryExecutor: executor,
    retrySideEffect: (sceneUuid) => applySideEffect(sceneUuid),
  });

  try {
    const results = await executor(sceneUuids);
    if (!isStillActive()) return; // 이미 취소되었거나 새 op으로 교체됨 — 응답 무시
    // 순차 애니메이션 효과를 위해 각 항목 처리 사이에 짧은 interval 삽입.
    // 삭제는 DOM 제거라 CSS transition이 자연 적용 안 돼 한꺼번에 사라져 보이는 문제가 있었음.
    // 50개 이상일 땐 간격을 줄여 총 시간이 너무 길지 않게 조정.
    const stagger = results.length > 50 ? 15 : results.length > 20 ? 30 : 60;
    for (let i = 0; i < results.length; i++) {
      if (!isStillActive()) return;
      const r = results[i];
      if (r.success) {
        store.markConfirmed(r.sceneUuid);
        applySideEffect(r.sceneUuid);
      } else {
        store.markFailed(r.sceneUuid, r.error ?? 'Unknown error');
      }
      if (i < results.length - 1) {
        await new Promise((res) => setTimeout(res, stagger));
      }
    }
  } catch (_e) {
    if (!isStillActive()) return;
    store.setStatus('network-error');
  }
}
