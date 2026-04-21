import { useEffect, useMemo, useState } from 'react';

import type { SortKey } from '@/stores/useAppStore';
import type { MergedScene, Part, Scene, ScenesDeptFilter } from '@/types';
import {
  buildMergedScenes,
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
  const mergedScenes = useMemo(() => {
    if (selectedDepartment !== 'all') {
      return [] as MergedScene[];
    }

    return buildMergedScenes({
      bgScenes,
      actScenes,
      bgPartScenes: bgPart?.scenes ?? [],
      actPartScenes: actPart?.scenes ?? [],
      mergedScenePartId,
      sortKey,
      sortDir,
    }) as MergedScene[];
  }, [
    actPart?.scenes,
    actScenes,
    bgPart?.scenes,
    bgScenes,
    mergedScenePartId,
    selectedDepartment,
    sortDir,
    sortKey,
  ]);

  const [detailMerged, setDetailMerged] = useState<MergedScene | null>(null);

  useEffect(() => {
    setDetailMerged((prev) => getSyncedMergedDetail(prev, mergedScenes));
  }, [mergedScenes]);

  return {
    mergedScenes,
    detailMerged,
    setDetailMerged,
  };
}
