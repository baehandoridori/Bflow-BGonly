/**
 * 에피소드 번호 다시 쓰기 (v1.150.3).
 *
 * episodes.episode_number 는 상태와 상관없이 하나뿐이다(UNIQUE). 그래서 삭제한 에피소드(status 'deleted')가
 * 번호를 쥐고 있으면 같은 번호로 새 에피소드를 만들 수 없었다 — EP13 을 지운 뒤 '에피소드 추가'가
 * "duplicate key … episodes_episode_number_key" 로 실패.
 *
 * 지운 에피소드는 내용(파트 · 씬 · 댓글)을 지우지 않고 번호만 음수 자리로 비켜 둔다(13 → -13).
 * 번호로 묶인 제목 · 메모 · 파트 메모 메타데이터는 지워서 새 에피소드가 옛 제목을 물려받지 않게 하고,
 * 옛 제목 · 메모는 비켜 둔 에피소드 줄(episodes.title · memo)에 남긴다.
 */

/** 화면이 고르는 다음 번호: 진행 중 + 보관함 번호 중 가장 큰 것 + 1. */
export function nextEpisodeNumberFrom(activeNumbers: readonly number[], archivedNumbers: readonly number[]): number {
  let max = 0;
  for (const n of [...activeNumbers, ...archivedNumbers]) if (Number.isFinite(n) && n > max) max = n;
  return max + 1;
}

/** 지운 에피소드를 비켜 둘 번호: 먼저 -n, 이미 쓰고 있으면 지금 가장 작은 번호보다 하나 작은 수. */
export function parkedEpisodeNumber(episodeNumber: number, takenNumbers: readonly number[]): number {
  const taken = new Set(takenNumbers);
  const first = -Math.abs(episodeNumber);
  if (!taken.has(first)) return first;
  let min = 0;
  for (const n of takenNumbers) if (n < min) min = n;
  return Math.min(min, first) - 1;
}

export const EPISODE_KEYED_METADATA_TYPES = ['episode-title', 'episode-memo'] as const;
export const PART_KEYED_METADATA_TYPES = ['part-memo', 'part-label', 'part-reel-worker'] as const;

const SHEET_NAME = /^EP(-?\d+)_([A-Z])_(BG|ACT)$/;

function epLabel(n: number): string {
  return `EP${String(n).padStart(2, '0')}`;
}

/**
 * 이 번호에 묶인 메타데이터 줄(에피소드 번호 key '13', 파트 시트 이름 key 'EP13_A_BG').
 * 줄은 지운다 — key 를 바꾸면 'type+key' 로 기억하는 다른 PC 의 바뀐 것만 받기 캐시에 옛 줄이 남는다
 * (줄 수가 줄어야 다른 PC 가 전부 다시 받는다). 옛 제목 · 메모는 비켜 둔 에피소드 줄에 따로 남긴다.
 */
export function episodeNumberMetadata(
  rows: readonly { id: string; type: string; key: string; value?: string | null }[],
  episodeNumber: number,
): { deleteIds: string[]; title: string | null; memo: string | null } {
  const deleteIds: string[] = [];
  let title: string | null = null;
  let memo: string | null = null;
  for (const r of rows) {
    if ((EPISODE_KEYED_METADATA_TYPES as readonly string[]).includes(r.type)) {
      if (r.key !== String(episodeNumber)) continue;
      deleteIds.push(r.id);
      if (r.type === 'episode-title' && r.value) title = r.value;
      if (r.type === 'episode-memo' && r.value) memo = r.value;
      continue;
    }
    if ((PART_KEYED_METADATA_TYPES as readonly string[]).includes(r.type)) {
      const m = SHEET_NAME.exec(r.key);
      if (m && Number(m[1]) === episodeNumber) deleteIds.push(r.id);
    }
  }
  return { deleteIds, title, memo };
}

/** 시트 이름 key 를 찾을 때 쓰는 앞머리 ('EP13_', 'EP05_'). */
export function sheetNamePrefix(episodeNumber: number): string {
  return `${epLabel(episodeNumber)}_`;
}
