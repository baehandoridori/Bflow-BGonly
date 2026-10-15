/**
 * 캐릭터 현황판 정렬 — 직접 정한 순서(카드 끌어 옮긴 순서) / 추가한 순서 / 최근 수정순, 그리고 뒤집기.
 * 순수 함수 — node --test 가 직접 import 한다('@/' alias·비순수 import 금지).
 *
 * '최근 수정' = 캐릭터 자체(이름·메모·키·폴더·보관) / 그 복장(단계·담당자·태그·메모 등) /
 *   그 복장 그림(추가·변경) 중 가장 늦은 시각. 댓글·에피소드 에셋 메모는 치지 않는다.
 *   카드 끌어 옮기기로 순서만 바뀐 캐릭터는 서버가 수정 시각을 그대로 둔다
 *   (DEVLOG/migrations/2026-10-15-characters-updated-at-ignore-sort-order.sql).
 */

export type CharacterSortMode = 'manual' | 'created' | 'modified';
export type CharacterSortState = { mode: CharacterSortMode; reversed: boolean };

export const DEFAULT_CHARACTER_SORT: CharacterSortState = { mode: 'manual', reversed: false };

export const CHARACTER_SORT_MODE_LABELS: Record<CharacterSortMode, string> = {
  manual: '직접 정한 순서',
  created: '추가한 순서',
  modified: '최근 수정순',
};

/** 뒤집기 버튼 안내 — 지금 어떤 순서로 보이는지. 직접 정한 순서는 뒤집기가 없다. */
export function characterSortDirectionLabel(mode: Exclude<CharacterSortMode, 'manual'>, reversed: boolean): string {
  if (mode === 'created') return reversed ? '최근 추가한 캐릭터부터' : '먼저 추가한 캐릭터부터';
  return reversed ? '오래 안 건드린 캐릭터부터' : '최근 수정한 캐릭터부터';
}

type CharacterLike = { id: string; createdAt: string; updatedAt: string };
type CostumeLike = { id: string; updatedAt: string };
type ImageLike = { createdAt: string; updatedAt: string };

function timeMs(value: string | null | undefined): number {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * 캐릭터의 마지막 수정 시각(ms). 대표가 아닌 그림을 추가하면 복장 시각은 그대로라 그림의 추가 시각까지 본다.
 * 시각이 하나도 읽히지 않으면 0(맨 뒤로 — 뒤집으면 맨 앞).
 */
export function characterLastModifiedMs(
  character: CharacterLike,
  costumes: readonly CostumeLike[],
  imagesByCostume: ReadonlyMap<string, readonly ImageLike[]>,
): number {
  let latest = Math.max(timeMs(character.updatedAt), timeMs(character.createdAt));
  for (const costume of costumes) {
    latest = Math.max(latest, timeMs(costume.updatedAt));
    for (const image of imagesByCostume.get(costume.id) ?? []) {
      latest = Math.max(latest, timeMs(image.createdAt), timeMs(image.updatedAt));
    }
  }
  return latest;
}

/**
 * 현황판 표시 순서. characters 는 스토어(직접 정한) 순서로 들어온다 — 같은 시각끼리는 그 순서를 지킨다.
 * 직접 정한 순서면 받은 배열을 그대로 돌려준다(뒤집기 무시).
 */
export function sortCharactersForBoard<T extends CharacterLike>(
  characters: T[],
  mode: CharacterSortMode,
  reversed: boolean,
  byCharacter: ReadonlyMap<string, readonly CostumeLike[]>,
  imagesByCostume: ReadonlyMap<string, readonly ImageLike[]>,
): T[] {
  if (mode === 'manual') return characters;
  // 추가한 순서는 오래된 것부터(오름차순), 최근 수정순은 최근 것부터(내림차순)가 기본 방향.
  const sign = (mode === 'created' ? 1 : -1) * (reversed ? -1 : 1);
  const keyed = characters.map((c, index) => ({
    c,
    index,
    key: mode === 'created'
      ? timeMs(c.createdAt)
      : characterLastModifiedMs(c, byCharacter.get(c.id) ?? [], imagesByCostume),
  }));
  keyed.sort((a, b) => (a.key - b.key) * sign || a.index - b.index);
  return keyed.map((k) => k.c);
}
