type PartLike = {
  partId: string;
  department?: string;
  sheetName: string;
};

type EpisodeLike = {
  parts: PartLike[];
};

export interface PartContextMenuTarget {
  episodeNumber: number;
  partId: string;
  sheetNames: string[];
}

export function getCombinedPartMemo(
  partMemos: Record<string, string>,
  sheetNames: string[],
): string {
  const values = Array.from(
    new Set(
      sheetNames
        .map((sheetName) => partMemos[sheetName]?.trim())
        .filter((memo): memo is string => Boolean(memo)),
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

  const sheetNames = Array.from(new Set(
    parts
      .filter((part) => part.partId === partId)
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
  const next = { ...partMemos };
  const normalizedMemo = memo.trim();

  sheetNames.forEach((sheetName) => {
    if (normalizedMemo) {
      next[sheetName] = normalizedMemo;
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
  const next = { ...currentPartMemos };
  const normalizedAttempt = attemptedMemo.trim();

  failedSheetNames.forEach((sheetName) => {
    const currentMemo = currentPartMemos[sheetName]?.trim() ?? '';
    const stillShowingAttempt = normalizedAttempt
      ? currentMemo === normalizedAttempt
      : currentMemo === '';

    if (!stillShowingAttempt) return;

    const previousMemo = previousPartMemos[sheetName]?.trim() ?? '';
    if (previousMemo) {
      next[sheetName] = previousMemo;
    } else {
      delete next[sheetName];
    }
  });

  return next;
}
