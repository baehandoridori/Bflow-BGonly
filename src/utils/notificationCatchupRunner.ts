export interface CatchupGuardRef {
  current: string | null;
}

export interface CatchupPageRequest {
  before?: string;
  limit: number;
}

export interface FetchCatchupPagesOptions<T> {
  pageSize?: number;
  safeCap?: number;
  fetchPage: (request: CatchupPageRequest) => Promise<T[]>;
  getCursor: (row: T) => string | undefined;
}

export interface FetchCatchupPagesResult<T> {
  rows: T[];
  cappedOut: boolean;
}

export function beginCatchupRun(ref: CatchupGuardRef, userId: string): boolean {
  if (ref.current === userId) return false;
  ref.current = userId;
  return true;
}

export function resetCatchupRun(ref: CatchupGuardRef): void {
  ref.current = null;
}

export function releaseCatchupRunOnError(ref: CatchupGuardRef, userId: string): void {
  if (ref.current === userId) ref.current = null;
}

export async function fetchCatchupPages<T>({
  pageSize = 100,
  safeCap = 1000,
  fetchPage,
  getCursor,
}: FetchCatchupPagesOptions<T>): Promise<FetchCatchupPagesResult<T>> {
  const rows: T[] = [];
  let before: string | undefined;
  let cappedOut = false;

  while (true) {
    const batch = await fetchPage({ before, limit: pageSize });
    if (!batch || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;

    before = getCursor(batch[batch.length - 1]);
    if (!before) break;
    if (rows.length >= safeCap) {
      cappedOut = true;
      break;
    }
  }

  return { rows, cappedOut };
}
