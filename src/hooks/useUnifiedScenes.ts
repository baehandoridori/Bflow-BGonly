import { useEffect, useMemo, useState } from 'react';

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
}: UseUnifiedScenesArgs) {
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
    setDetailMerged((prev) => getSyncedMergedDetail(prev, allMergedScenes));
  }, [allMergedScenes]);

  return {
    allMergedScenes,
    mergedScenes,
    detailMerged,
    setDetailMerged,
  };
}
