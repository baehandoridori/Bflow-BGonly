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
