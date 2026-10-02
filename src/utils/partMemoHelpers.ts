type PartLike = {
  partId: string;
  department?: string;
  sheetName: string;
};

type EpisodeLike = {
  parts: PartLike[];
};

function normalizePartId(partId: string | null | undefined): string {
  return (partId ?? '').trim().toLowerCase();
}

export interface PartContextMenuTarget {
  episodeNumber: number;
  partId: string;
  sheetNames: string[];
}

export function getCombinedPartMemo(
  partMemos: Record<string, string>,
  sheetNames: string[],
): string {
  return getCombinedPartMetadata(partMemos, sheetNames);
}

export function getCombinedPartReelWorker(
  partReelWorkers: Record<string, string>,
  sheetNames: string[],
): string {
  return getCombinedPartMetadata(partReelWorkers, sheetNames);
}

export function getCombinedPartLabel(
  partLabels: Record<string, string>,
  sheetNames: string[],
): string {
  return getCombinedPartMetadata(partLabels, sheetNames);
}

function getCombinedPartMetadata(
  metadataBySheetName: Record<string, string>,
  sheetNames: string[],
): string {
  const values = Array.from(
    new Set(
      sheetNames
        .map((sheetName) => metadataBySheetName[sheetName]?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return values.join(' / ');
}

export function listVisiblePartMemoSheetNames(
  episodes: EpisodeLike[],
  selectedDepartment: string,
): string[] {
  const sheetNames = episodes.flatMap((episode) =>
    episode.parts
      .filter((part) => selectedDepartment === 'all' || part.department === selectedDepartment)
      .map((part) => part.sheetName),
  );

  return Array.from(new Set(sheetNames)).sort();
}

export function buildPartContextMenuTarget(
  episodeNumber: number | null | undefined,
  partId: string,
  parts: Pick<PartLike, 'partId' | 'sheetName'>[],
): PartContextMenuTarget | null {
  if (episodeNumber == null || parts.length === 0) {
    return null;
  }

  const targetPartId = normalizePartId(partId);
  const sheetNames = Array.from(new Set(
    parts
      .filter((part) => normalizePartId(part.partId) === targetPartId)
      .map((part) => part.sheetName),
  ));

  if (sheetNames.length === 0) {
    return null;
  }

  return {
    episodeNumber,
    partId,
    sheetNames,
  };
}

export function applyPartMemoToSheets(
  partMemos: Record<string, string>,
  sheetNames: string[],
  memo: string,
): Record<string, string> {
  return applyPartMetadataToSheets(partMemos, sheetNames, memo);
}

export function applyPartReelWorkerToSheets(
  partReelWorkers: Record<string, string>,
  sheetNames: string[],
  worker: string,
): Record<string, string> {
  return applyPartMetadataToSheets(partReelWorkers, sheetNames, worker);
}

export function applyPartLabelToSheets(
  partLabels: Record<string, string>,
  sheetNames: string[],
  label: string,
): Record<string, string> {
  return applyPartMetadataToSheets(partLabels, sheetNames, label);
}

function applyPartMetadataToSheets(
  metadataBySheetName: Record<string, string>,
  sheetNames: string[],
  value: string,
): Record<string, string> {
  const next = { ...metadataBySheetName };
  const normalizedValue = value.trim();

  sheetNames.forEach((sheetName) => {
    if (normalizedValue) {
      next[sheetName] = normalizedValue;
    } else {
      delete next[sheetName];
    }
  });

  return next;
}

export function rollbackFailedPartMemoSheets(
  currentPartMemos: Record<string, string>,
  previousPartMemos: Record<string, string>,
  failedSheetNames: string[],
  attemptedMemo: string,
): Record<string, string> {
  return rollbackFailedPartMetadataSheets(currentPartMemos, previousPartMemos, failedSheetNames, attemptedMemo);
}

export function rollbackFailedPartReelWorkerSheets(
  currentPartReelWorkers: Record<string, string>,
  previousPartReelWorkers: Record<string, string>,
  failedSheetNames: string[],
  attemptedWorker: string,
): Record<string, string> {
  return rollbackFailedPartMetadataSheets(
    currentPartReelWorkers,
    previousPartReelWorkers,
    failedSheetNames,
    attemptedWorker,
  );
}

export function rollbackFailedPartLabelSheets(
  currentPartLabels: Record<string, string>,
  previousPartLabels: Record<string, string>,
  failedSheetNames: string[],
  attemptedLabel: string,
): Record<string, string> {
  return rollbackFailedPartMetadataSheets(
    currentPartLabels,
    previousPartLabels,
    failedSheetNames,
    attemptedLabel,
  );
}

function rollbackFailedPartMetadataSheets(
  currentMetadata: Record<string, string>,
  previousMetadata: Record<string, string>,
  failedSheetNames: string[],
  attemptedValue: string,
): Record<string, string> {
  const next = { ...currentMetadata };
  const normalizedAttempt = attemptedValue.trim();

  failedSheetNames.forEach((sheetName) => {
    const currentValue = currentMetadata[sheetName]?.trim() ?? '';
    const stillShowingAttempt = normalizedAttempt
      ? currentValue === normalizedAttempt
      : currentValue === '';

    if (!stillShowingAttempt) return;

    const previousValue = previousMetadata[sheetName]?.trim() ?? '';
    if (previousValue) {
      next[sheetName] = previousValue;
    } else {
      delete next[sheetName];
    }
  });

  return next;
}

// ─── 파트 메타(메모 · 릴 담당 · 표시 이름) 묶어 읽기 ─────────────────────
// 파트마다 readMetadata 를 따로 부르지 않는다. 2026-10-02 공유 DB 과부하 사고:
// 검색창이 데이터 새로고침(15초)마다 "파트 수 × 3" 건의 단건 조회를 모든 PC 에서 돌려
// DB 를 멈춰 세웠다. 전체 메타 목록 한 번에서 아래 세 종류만 골라 쓴다.

export const PART_METADATA_TYPES = {
  memo: 'part-memo',
  reelWorker: 'part-reel-worker',
  label: 'part-label',
} as const;

export interface PartMetadataMaps {
  memos: Record<string, string>;
  reelWorkers: Record<string, string>;
  labels: Record<string, string>;
}

/** 전체 메타 행에서 파트 메모 · 릴 담당 · 표시 이름만 sheetName → 값 으로 고른다. 빈 값은 넣지 않는다. */
export function buildPartMetadataMaps(
  rows: ReadonlyArray<{ type: string; key: string; value?: string | null }>,
): PartMetadataMaps {
  const maps: PartMetadataMaps = { memos: {}, reelWorkers: {}, labels: {} };
  for (const row of rows) {
    if (!row.value) continue;
    if (row.type === PART_METADATA_TYPES.memo) maps.memos[row.key] = row.value;
    else if (row.type === PART_METADATA_TYPES.reelWorker) maps.reelWorkers[row.key] = row.value;
    else if (row.type === PART_METADATA_TYPES.label) maps.labels[row.key] = row.value;
  }
  return maps;
}

/** 주어진 sheetName 들의 값만 남긴다 (씬 뷰는 보이는 파트 몫만 들고 있는다). */
export function pickPartMetadataMaps(
  maps: PartMetadataMaps,
  sheetNames: readonly string[],
): PartMetadataMaps {
  const pick = (source: Record<string, string>) => {
    const picked: Record<string, string> = {};
    for (const sheetName of sheetNames) {
      if (source[sheetName]) picked[sheetName] = source[sheetName];
    }
    return picked;
  };
  return { memos: pick(maps.memos), reelWorkers: pick(maps.reelWorkers), labels: pick(maps.labels) };
}
