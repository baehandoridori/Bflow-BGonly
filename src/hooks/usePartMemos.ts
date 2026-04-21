import { useCallback, useEffect, useMemo, useState } from 'react';

import { readMetadata, writeMetadata } from '@/services/supabaseService';
import type { Episode, Part, ScenesDeptFilter } from '@/types';
import {
  applyPartMemoToSheets,
  buildPartContextMenuTarget,
  getCombinedPartMemo,
  listVisiblePartMemoSheetNames,
  type PartContextMenuTarget,
} from '@/utils/partMemoHelpers';

interface UsePartMemosArgs {
  episodes: Episode[];
  selectedDepartment: ScenesDeptFilter;
  currentEpisodeNumber: number | null | undefined;
  allParts: Part[];
  parts: Part[];
}

export function usePartMemos({
  episodes,
  selectedDepartment,
  currentEpisodeNumber,
  allParts,
  parts,
}: UsePartMemosArgs) {
  const [partMemos, setPartMemos] = useState<Record<string, string>>({});

  const visibleSheetNames = useMemo(
    () => listVisiblePartMemoSheetNames(episodes, selectedDepartment),
    [episodes, selectedDepartment],
  );

  const visibleSheetNamesKey = visibleSheetNames.join('|');

  useEffect(() => {
    let cancelled = false;
    const sheetNamesToLoad = visibleSheetNamesKey ? visibleSheetNamesKey.split('|') : [];

    const loadPartMemos = async () => {
      const memos: Record<string, string> = {};
      for (const sheetName of sheetNamesToLoad) {
        try {
          const data = await readMetadata('part-memo', sheetName);
          if (data?.value) {
            memos[sheetName] = data.value;
          }
        } catch {
          // Ignore memo read failures and keep other part memos available.
        }
      }

      if (!cancelled) {
        setPartMemos(memos);
      }
    };

    loadPartMemos();
    return () => {
      cancelled = true;
    };
  }, [visibleSheetNamesKey]);

  const getPartMemoText = useCallback((sheetNames: string[]) => {
    return getCombinedPartMemo(partMemos, sheetNames);
  }, [partMemos]);

  const buildMenuTarget = useCallback((partId: string): PartContextMenuTarget | null => {
    const visibleParts = (selectedDepartment === 'all' ? allParts : parts)
      .filter((part) => part.partId === partId)
      .map((part) => ({
        partId: part.partId,
        sheetName: part.sheetName,
      }));

    return buildPartContextMenuTarget(currentEpisodeNumber, partId, visibleParts);
  }, [allParts, currentEpisodeNumber, parts, selectedDepartment]);

  const savePartMemo = useCallback(async (target: PartContextMenuTarget, memo: string) => {
    setPartMemos((prev) => applyPartMemoToSheets(prev, target.sheetNames, memo));
    try {
      await Promise.all(
        target.sheetNames.map((sheetName) => writeMetadata('part-memo', sheetName, memo.trim())),
      );
    } catch (err) {
      console.warn('[파트 메모] 시트 저장 실패', err);
    }
  }, []);

  return {
    partMemos,
    getPartMemoText,
    buildPartContextMenuTarget: buildMenuTarget,
    savePartMemo,
  };
}
