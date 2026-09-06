/** Saving a revision and delivering its notifications are separate results. */
export interface RevisionUpdateResult {
  affected: boolean;
}

export function assertRevisionUpdated(result: unknown): asserts result is RevisionUpdateResult & { affected: true } {
  if (!result || typeof result !== 'object' || (result as RevisionUpdateResult).affected !== true) {
    throw new Error('리테이크를 저장하지 못했어요. 삭제되었거나 변경된 항목인지 확인해주세요.');
  }
}
