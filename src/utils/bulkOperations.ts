import { useBulkOperationsStore, type OpKind } from '@/stores/useBulkOperationsStore';
import { useDataStore } from '@/stores/useDataStore';
import type { BulkUpdateResult, MergedScene, Part, Scene } from '@/types';

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
   * stage-toggle에서 done을 켜서 4단계 완료가 된 씬의 completedBy/completedAt.
   * 성공 시 store에 반영한다.
   */
  completedMetaByUuid?: Map<string, { completedBy: string; completedAt: string }>;
  /**
   * stage-toggle에서 토글된 stage 값. 성공 시 해당 씬의 stage 필드를 store에 반영한다.
   * key=sceneUuid, value=새 stage 값.
   */
  stageValueByUuid?: Map<string, boolean>;
  /**
   * field-edit에서 적용할 필드. 성공 시 store에 반영한다.
   */
  fieldsByUuid?: Map<string, Partial<Scene>>;
};

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
      if (opts.stageValueByUuid?.has(sceneUuid) && opts.targetStage) {
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
    }
  };

  const store = useBulkOperationsStore.getState();
  store.startOp({
    id: crypto.randomUUID(),
    kind,
    totalCount: sceneUuids.length,
    pendingSceneUuids: new Set(sceneUuids),
    targetStage: opts.targetStage,
    retryExecutor: executor,
    retrySideEffect: (sceneUuid) => applySideEffect(sceneUuid),
  });

  try {
    const results = await executor(sceneUuids);
    for (const r of results) {
      if (r.success) {
        store.markConfirmed(r.sceneUuid);
        applySideEffect(r.sceneUuid);
      } else {
        store.markFailed(r.sceneUuid, r.error ?? 'Unknown error');
      }
    }
  } catch (_e) {
    store.setStatus('network-error');
  }
}
