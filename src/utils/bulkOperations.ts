import { useBulkOperationsStore, type OpKind } from '@/stores/useBulkOperationsStore';
import { useDataStore } from '@/stores/useDataStore';
import type { BulkUpdateResult, MergedScene, Scene } from '@/types';

const MERGED_KEY_PREFIX = { bg: 'bg:', act: 'act:' } as const;

/**
 * 선택된 씬 ID 집합을 Supabase 씬 UUID 배열로 변환한다.
 *
 * 선택 ID 형식:
 * - `bg:${mergedKey}` — 통합 모드에서 BG 씬 선택
 * - `act:${mergedKey}` — 통합 모드에서 액팅 씬 선택
 * - `${sceneId}` (plain) — 개별 모드, human sceneId ("a001" 등)
 *
 * 개별 모드(plain sceneId)를 해석하려면 현재 파트의 씬 목록을 순회해야 하므로,
 * allMergedScenes 외에도 useDataStore를 fall-back으로 사용한다.
 */
export function resolveSelectedUuids(
  selectedIds: Set<string> | Iterable<string>,
  allMergedScenes: MergedScene[],
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
      // 개별 모드: plain sceneId → 스토어 전체 검색
      const scene = useDataStore.getState().findSceneBySceneId(id);
      pushUuid(scene?.id);
    }
  }

  return uuids;
}

/**
 * 선택된 씬 ID 집합을 Scene 객체 배열로 변환한다.
 * stage 토글처럼 현재 값(lo/done/review/png)이 필요한 경우 사용한다.
 */
export function resolveSelectedScenes(
  selectedIds: Set<string> | Iterable<string>,
  allMergedScenes: MergedScene[],
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
      const mergedKey = id.slice(MERGED_KEY_PREFIX.bg.length);
      const merged = allMergedScenes.find((m) => m.mergedKey === mergedKey);
      pushScene(merged?.bgScene);
    } else if (id.startsWith(MERGED_KEY_PREFIX.act)) {
      const mergedKey = id.slice(MERGED_KEY_PREFIX.act.length);
      const merged = allMergedScenes.find((m) => m.mergedKey === mergedKey);
      pushScene(merged?.actScene);
    } else {
      const scene = useDataStore.getState().findSceneBySceneId(id);
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

  const store = useBulkOperationsStore.getState();
  store.startOp({
    id: crypto.randomUUID(),
    kind,
    totalCount: sceneUuids.length,
    pendingSceneUuids: new Set(sceneUuids),
    targetStage: opts.targetStage,
  });

  try {
    const results = await executor(sceneUuids);
    for (const r of results) {
      if (r.success) {
        store.markConfirmed(r.sceneUuid);
        if (kind === 'delete') {
          useDataStore.getState().removeSceneByUuid(r.sceneUuid);
        }
        if (kind === 'stage-toggle' && opts.completedMetaByUuid) {
          const meta = opts.completedMetaByUuid.get(r.sceneUuid);
          if (meta) {
            useDataStore.getState().updateSceneByUuid(r.sceneUuid, {
              completedBy: meta.completedBy,
              completedAt: meta.completedAt,
            });
          }
        }
      } else {
        store.markFailed(r.sceneUuid, r.error ?? 'Unknown error');
      }
    }
  } catch (_e) {
    store.setStatus('network-error');
  }
}
