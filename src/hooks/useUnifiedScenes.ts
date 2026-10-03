import { useEffect, useMemo, useRef, useState } from 'react';

import type { SortKey } from '@/stores/useAppStore';
import type { MergedScene, Part, Scene, ScenesDeptFilter } from '@/types';
import {
  buildMergedScenes,
  filterMergedScenesBySourceScenes,
  getSyncedMergedDetail,
} from '@/utils/mergedSceneHelpers';

interface UseUnifiedScenesArgs {
  selectedDepartment: ScenesDeptFilter;
  bgPart: Part | null;
  actPart: Part | null;
  bgScenes: Scene[];
  actScenes: Scene[];
  mergedScenePartId: string;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  /**
   * 상세 창이 가라앉는 동안(닫기 신호 ~ onClose) true. 그동안은 열린 씬을 새 목록과 맞추지 않고 그대로 둔다 —
   * 점프·돌아가기로 파트가 바뀌면 새 목록에 그 씬이 없어 null 이 되고 창이 가라앉지 못한 채 뚝 사라졌다(acc-scene-flow-3).
   */
  holdDetail?: boolean;
}

export function useUnifiedScenes({
  selectedDepartment,
  bgPart,
  actPart,
  bgScenes,
  actScenes,
  mergedScenePartId,
  sortKey,
  sortDir,
  holdDetail = false,
}: UseUnifiedScenesArgs) {
  const holdDetailRef = useRef(holdDetail);
  holdDetailRef.current = holdDetail;
  const allMergedScenes = useMemo(() => {
    if (selectedDepartment !== 'all') {
      return [] as MergedScene[];
    }

    return buildMergedScenes({
      bgScenes: bgPart?.scenes ?? [],
      actScenes: actPart?.scenes ?? [],
      bgPartScenes: bgPart?.scenes ?? [],
      actPartScenes: actPart?.scenes ?? [],
      mergedScenePartId,
      sortKey,
      sortDir,
    }) as MergedScene[];
  }, [
    actPart?.scenes,
    bgPart?.scenes,
    mergedScenePartId,
    selectedDepartment,
    sortDir,
    sortKey,
  ]);

  const mergedScenes = useMemo(() => {
    if (selectedDepartment !== 'all') {
      return [] as MergedScene[];
    }

    return filterMergedScenesBySourceScenes(allMergedScenes, bgScenes, actScenes) as MergedScene[];
  }, [
    allMergedScenes,
    actScenes,
    bgScenes,
    selectedDepartment,
  ]);

  const [detailMerged, setDetailMerged] = useState<MergedScene | null>(null);

  useEffect(() => {
    if (holdDetailRef.current) return; // 가라앉는 중 — 보던 씬 그대로(닫히면 onClose 가 비운다)
    setDetailMerged((prev) => getSyncedMergedDetail(prev, allMergedScenes));
  }, [allMergedScenes]);

  return {
    allMergedScenes,
    mergedScenes,
    detailMerged,
    setDetailMerged,
  };
}
