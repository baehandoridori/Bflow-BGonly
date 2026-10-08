import { useCallback, useEffect, useMemo, useState } from 'react';

import { readPartMetadataMaps, writeMetadata } from '@/services/supabaseService';
import type { Episode, Part, ScenesDeptFilter } from '@/types';
import {
  applyPartLabelToSheets,
  applyPartMemoToSheets,
  applyPartReelWorkerToSheets,
  buildPartContextMenuTarget,
  getCombinedPartLabel,
  getCombinedPartMemo,
  getCombinedPartReelWorker,
  listVisiblePartMemoSheetNames,
  pickPartMetadataMaps,
  rollbackFailedPartLabelSheets,
  rollbackFailedPartMemoSheets,
  rollbackFailedPartReelWorkerSheets,
  type PartContextMenuTarget,
} from '@/utils/partMemoHelpers';
import { partIdMatches } from '@/utils/partId';

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
  const [partReelWorkers, setPartReelWorkers] = useState<Record<string, string>>({});
  // 파트 표시 이름(별칭). 내부 partId 는 그대로 두고 화면 이름만 덮어쓴다.
  const [partLabels, setPartLabels] = useState<Record<string, string>>({});

  const visibleSheetNames = useMemo(
    () => listVisiblePartMemoSheetNames(episodes, selectedDepartment),
    [episodes, selectedDepartment],
  );

  const visibleSheetNamesKey = visibleSheetNames.join('|');

  useEffect(() => {
    let cancelled = false;
    const sheetNamesToLoad = visibleSheetNamesKey ? visibleSheetNamesKey.split('|') : [];

    // 파트마다 따로 읽지 않고 한 번에 읽는다 (partMemoHelpers 의 PART_METADATA_TYPES 주석 — 2026-10-02 사고).
    // 읽기에 실패하면 지금 보이는 값을 그대로 둔다(빈 값으로 덮지 않는다).
    const loadPartMetadata = async () => {
      if (sheetNamesToLoad.length === 0) {
        setPartMemos({});
        setPartReelWorkers({});
        setPartLabels({});
        return;
      }
      let maps;
      try {
        maps = pickPartMetadataMaps(await readPartMetadataMaps(), sheetNamesToLoad);
      } catch {
        return;
      }
      if (!cancelled) {
        setPartMemos(maps.memos);
        setPartReelWorkers(maps.reelWorkers);
        setPartLabels(maps.labels);
      }
    };

    loadPartMetadata();
    return () => {
      cancelled = true;
    };
  }, [visibleSheetNamesKey]);

  const getPartMemoText = useCallback((sheetNames: string[]) => {
    return getCombinedPartMemo(partMemos, sheetNames);
  }, [partMemos]);
  const getPartReelWorkerText = useCallback((sheetNames: string[]) => {
    return getCombinedPartReelWorker(partReelWorkers, sheetNames);
  }, [partReelWorkers]);
  const getPartLabelText = useCallback((sheetNames: string[]) => {
    return getCombinedPartLabel(partLabels, sheetNames);
  }, [partLabels]);

  const buildMenuTarget = useCallback((partId: string): PartContextMenuTarget | null => {
    const visibleParts = (selectedDepartment === 'all' ? allParts : parts)
      .filter((part) => partIdMatches(part.partId, partId))
      .map((part) => ({
        partId: part.partId,
        sheetName: part.sheetName,
      }));

    return buildPartContextMenuTarget(currentEpisodeNumber, partId, visibleParts);
  }, [allParts, currentEpisodeNumber, parts, selectedDepartment]);

  const savePartMemo = useCallback(async (target: PartContextMenuTarget, memo: string) => {
    const previousPartMemos = partMemos;
    const normalizedMemo = memo.trim();
    setPartMemos((prev) => applyPartMemoToSheets(prev, target.sheetNames, memo));

    const results = await Promise.allSettled(
      target.sheetNames.map((sheetName) => writeMetadata('part-memo', sheetName, normalizedMemo)),
    );
    const failedSheetNames = target.sheetNames.filter((_, index) => results[index].status === 'rejected');

    if (failedSheetNames.length > 0) {
      console.warn('[파트 메모] 일부 시트 저장 실패', failedSheetNames);
      setPartMemos((current) =>
        rollbackFailedPartMemoSheets(current, previousPartMemos, failedSheetNames, normalizedMemo),
      );
    }
  }, [partMemos]);

  const savePartReelWorker = useCallback(async (target: PartContextMenuTarget, worker: string) => {
    const previousPartReelWorkers = partReelWorkers;
    const normalizedWorker = worker.trim();
    setPartReelWorkers((prev) => applyPartReelWorkerToSheets(prev, target.sheetNames, worker));

    const results = await Promise.allSettled(
      target.sheetNames.map((sheetName) => writeMetadata('part-reel-worker', sheetName, normalizedWorker)),
    );
    const failedSheetNames = target.sheetNames.filter((_, index) => results[index].status === 'rejected');

    if (failedSheetNames.length > 0) {
      console.warn('[파트 릴 담당] 일부 시트 저장 실패', failedSheetNames);
      setPartReelWorkers((current) =>
        rollbackFailedPartReelWorkerSheets(current, previousPartReelWorkers, failedSheetNames, normalizedWorker),
      );
    }
  }, [partReelWorkers]);

  const savePartLabel = useCallback(async (target: PartContextMenuTarget, label: string) => {
    const previousPartLabels = partLabels;
    const normalizedLabel = label.trim();
    setPartLabels((prev) => applyPartLabelToSheets(prev, target.sheetNames, label));

    const results = await Promise.allSettled(
      target.sheetNames.map((sheetName) => writeMetadata('part-label', sheetName, normalizedLabel)),
    );
    const failedSheetNames = target.sheetNames.filter((_, index) => results[index].status === 'rejected');

    if (failedSheetNames.length > 0) {
      console.warn('[파트 이름] 일부 시트 저장 실패', failedSheetNames);
      setPartLabels((current) =>
        rollbackFailedPartLabelSheets(current, previousPartLabels, failedSheetNames, normalizedLabel),
      );
    }
  }, [partLabels]);

  return {
    partMemos,
    partReelWorkers,
    partLabels,
    getPartMemoText,
    getPartReelWorkerText,
    getPartLabelText,
    buildPartContextMenuTarget: buildMenuTarget,
    savePartMemo,
    savePartReelWorker,
    savePartLabel,
  };
}
