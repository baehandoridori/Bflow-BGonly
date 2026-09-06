export interface CharacterCommentSummary {
  count: number;
  latestOtherCreatedAt: string | null;
}

export type CharacterCommentSummaries = Record<string, CharacterCommentSummary>;
export const CHARACTER_COMMENT_SUMMARY_MAX_IDS = 200;

/** Accept UUIDs and local preview IDs, without allowing arbitrary query fragments or unbounded requests. */
export function validateCharacterCommentIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > CHARACTER_COMMENT_SUMMARY_MAX_IDS) {
    throw new Error('캐릭터 댓글 요약은 한 번에 최대 200개까지 조회할 수 있어요.');
  }
  const ids = value.map((id) => {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) {
      throw new Error('캐릭터 ID를 확인해주세요.');
    }
    return id;
  });
  return [...new Set(ids)];
}

export function createCharacterCommentSummaries(characterIds: readonly string[]): CharacterCommentSummaries {
  return Object.fromEntries(characterIds.map((id) => [id, { count: 0, latestOtherCreatedAt: null }]));
}

export function addCharacterCommentSummaryRows(
  summaries: CharacterCommentSummaries,
  rows: readonly { characterId?: string | null; userId?: string | null; createdAt?: string | null }[],
  currentUserId: string,
): void {
  for (const row of rows) {
    if (!row.characterId || !Object.prototype.hasOwnProperty.call(summaries, row.characterId)) continue;
    const summary = summaries[row.characterId];
    summary.count += 1;
    if (row.userId === currentUserId) continue;
    const timestamp = row.createdAt ? Date.parse(row.createdAt) : NaN;
    if (!Number.isFinite(timestamp)) continue;
    if (!summary.latestOtherCreatedAt || timestamp > Date.parse(summary.latestOtherCreatedAt)) {
      summary.latestOtherCreatedAt = new Date(timestamp).toISOString();
    }
  }
}
