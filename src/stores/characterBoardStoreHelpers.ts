/**
 * 캐릭터 현황판 store 순수 헬퍼.
 *
 * useCharacterBoardStore 에서 window/zustand/모듈 전역 상태에 의존하지 않는
 * 순수 함수·타입만 분리한 파일 — node --test 로 직접 단위 테스트한다
 * (tests/characterBoardStoreHelpers.test.ts).
 *
 * pending 버킷(Map 3종: 캐릭터/복장/에피소드 링크)은 store 모듈이 소유하고,
 * 여기 함수들은 버킷을 파라미터로 받아서만 동작한다.
 */

import type { Character, CharacterCostume, CharacterCostumeImage, EpisodeCharacterLink } from '@/types';

/** 낙관적 쓰기 직후 realtime echo/재로드가 로컬 변경을 되돌리지 않도록 보호하는 필드 단위 항목. */
export type PendingLocalField = { value: unknown; expiresAt: number };
/** pending 보호 TTL — 이 시간이 지나면 서버 값이 이긴다. */
export const PENDING_LOCAL_FIELD_MS = 15_000;

export function buildByCharacter(costumes: CharacterCostume[]): Map<string, CharacterCostume[]> {
  const map = new Map<string, CharacterCostume[]>();
  for (const c of costumes) {
    const arr = map.get(c.characterId);
    if (arr) arr.push(c);
    else map.set(c.characterId, [c]);
  }
  for (const arr of map.values()) {
    arr.sort(compareCostumes);
  }
  return map;
}

/**
 * byCharacter 파생 Map 재계산 + 구조적 공유 (H-3).
 * buildByCharacter 와 동일한 결과 값을 만들되, 캐릭터별 새 배열이 prev 의 해당 배열과
 * 길이·원소 참조까지 전부 같으면 prev 배열 참조를 그대로 재사용한다 —
 * 변경 없는 캐릭터의 costumes prop identity 를 유지해 React.memo 가 실효하도록.
 */
export function rebuildByCharacter(
  prev: Map<string, CharacterCostume[]>,
  costumes: CharacterCostume[],
): Map<string, CharacterCostume[]> {
  const next = buildByCharacter(costumes);
  if (prev.size === 0) return next;
  for (const [characterId, arr] of next) {
    const prevArr = prev.get(characterId);
    if (!prevArr || prevArr.length !== arr.length) continue;
    let same = true;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== prevArr[i]) { same = false; break; }
    }
    if (same) next.set(characterId, prevArr);
  }
  return next;
}

export function compareNullableText(a: string | null | undefined, b: string | null | undefined): number {
  return String(a ?? '').localeCompare(String(b ?? ''));
}

export function compareCharacters(a: Character, b: Character): number {
  return a.sortOrder - b.sortOrder
    || compareNullableText(a.createdAt, b.createdAt)
    || compareNullableText(a.name, b.name)
    || compareNullableText(a.id, b.id);
}

export function compareCostumes(a: CharacterCostume, b: CharacterCostume): number {
  return a.sortOrder - b.sortOrder
    || compareNullableText(a.createdAt, b.createdAt)
    || compareNullableText(a.name, b.name)
    || compareNullableText(a.id, b.id);
}

export function compareCostumeImages(a: CharacterCostumeImage, b: CharacterCostumeImage): number {
  return a.sortOrder - b.sortOrder
    || compareNullableText(a.createdAt, b.createdAt)
    || compareNullableText(a.id, b.id);
}

export function sortCharacters(characters: Character[]): Character[] {
  return characters.slice().sort(compareCharacters);
}

export function sortCostumes(costumes: CharacterCostume[]): CharacterCostume[] {
  return costumes.slice().sort(compareCostumes);
}

export function sortCostumeImages(images: CharacterCostumeImage[]): CharacterCostumeImage[] {
  return images.slice().sort(compareCostumeImages);
}

/** costumeId → 이미지 배열 (sort_order 오름차순). buildByCharacter 와 동일 구조. */
export function buildImagesByCostume(images: CharacterCostumeImage[]): Map<string, CharacterCostumeImage[]> {
  const map = new Map<string, CharacterCostumeImage[]>();
  for (const img of images) {
    const arr = map.get(img.costumeId);
    if (arr) arr.push(img);
    else map.set(img.costumeId, [img]);
  }
  for (const arr of map.values()) {
    arr.sort(compareCostumeImages);
  }
  return map;
}

/**
 * imagesByCostume 파생 Map 재계산 + 구조적 공유 (rebuildByCharacter 미러).
 * 변경 없는 복장의 이미지 배열 참조를 유지해 React.memo 가 실효하도록.
 */
export function rebuildImagesByCostume(
  prev: Map<string, CharacterCostumeImage[]>,
  images: CharacterCostumeImage[],
): Map<string, CharacterCostumeImage[]> {
  const next = buildImagesByCostume(images);
  if (prev.size === 0) return next;
  for (const [costumeId, arr] of next) {
    const prevArr = prev.get(costumeId);
    if (!prevArr || prevArr.length !== arr.length) continue;
    let same = true;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== prevArr[i]) { same = false; break; }
    }
    if (same) next.set(costumeId, prevArr);
  }
  return next;
}

/**
 * 복장 드래그 재배치(B10): orderedIds 순서대로 sortOrder 를 0..n-1 재부여하고,
 * 값이 바뀐 복장만 { id, sortOrder } 로 돌려준다(불필요한 쓰기 최소화).
 * orderedIds 에 없는 복장은 건드리지 않는다.
 */
export function reorderedCostumeSortOrders(
  costumes: ReadonlyArray<{ id: string; sortOrder: number }>,
  orderedIds: ReadonlyArray<string>,
): Array<{ id: string; sortOrder: number }> {
  const byId = new Map(costumes.map((c) => [c.id, c]));
  const changes: Array<{ id: string; sortOrder: number }> = [];
  orderedIds.forEach((id, index) => {
    const current = byId.get(id);
    if (current && current.sortOrder !== index) changes.push({ id, sortOrder: index });
  });
  return changes;
}

/**
 * 드래그로 dragId 를 targetId 위치로 옮긴 새 순서 배열(B10).
 * 방향에 따라 삽입 위치를 정한다 — 아래로 드래그(from<to)면 대상 '뒤', 위로면 대상 '앞'.
 * (대상 '앞' 고정이면 바로 다음 항목으로 드롭 시 원위치로 돌아가 no-op 이 되는 버그.)
 */
export function moveCostumeInOrder(
  orderedIds: ReadonlyArray<string>,
  dragId: string,
  targetId: string,
): string[] {
  const ids = orderedIds.slice();
  if (dragId === targetId) return ids;
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return ids;
  ids.splice(from, 1);
  const newTargetIdx = ids.indexOf(targetId);
  ids.splice(from < to ? newTargetIdx + 1 : newTargetIdx, 0, dragId);
  return ids;
}

/**
 * 드래그 중 targetId 카드/복장의 어느 쪽에 삽입선을 그릴지 결정한다.
 * moveCostumeInOrder 와 같은 방향 규칙(아래로 드래그=대상 뒤 'after', 위로=대상 앞 'before')을 써서
 * 화면에 보이는 삽입선이 실제 드롭 결과와 항상 일치하게 한다.
 * 드래그 대상 자신 위(또는 미존재 id)에서는 표시하지 않는다(null).
 */
export function dropEdgeFor(
  orderedIds: ReadonlyArray<string>,
  dragId: string | null,
  targetId: string,
): 'before' | 'after' | null {
  if (!dragId || dragId === targetId) return null;
  const from = orderedIds.indexOf(dragId);
  const to = orderedIds.indexOf(targetId);
  if (from < 0 || to < 0) return null;
  return from < to ? 'after' : 'before';
}

export type RawMapping = {
  characterId: string;
  episodeNumber: number;
  memo: string | null;
  costumeId: string | null;
};

/** 매핑 목록 → characterId → EpisodeCharacterLink[] (episodeNumber 오름차순). */
export function buildEpisodeLinks(mappings: RawMapping[]): Map<string, EpisodeCharacterLink[]> {
  const map = new Map<string, EpisodeCharacterLink[]>();
  for (const m of mappings) {
    const link: EpisodeCharacterLink = {
      episodeNumber: m.episodeNumber,
      memo: m.memo ?? null,
      costumeId: m.costumeId ?? null,
    };
    const arr = map.get(m.characterId);
    if (arr) arr.push(link);
    else map.set(m.characterId, [link]);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.episodeNumber - b.episodeNumber);
  }
  return map;
}

export function rowToRealtimeMapping(row: Record<string, unknown> | null): RawMapping | null {
  if (!row || typeof row !== 'object') return null;
  const characterId = typeof row.character_id === 'string' ? row.character_id : null;
  const episodeNumber = typeof row.episode_number === 'number' ? row.episode_number : null;
  if (!characterId || episodeNumber == null) return null;
  return {
    characterId,
    episodeNumber,
    memo: typeof row.memo === 'string' ? row.memo : null,
    costumeId: typeof row.costume_id === 'string' ? row.costume_id : null,
  };
}

export function pendingLinkKey(characterId: string, episodeNumber: number): string {
  return `${characterId}:${episodeNumber}`;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function cleanupPending(bucket: Map<string, Map<string, PendingLocalField>>, id: string) {
  const fields = bucket.get(id);
  if (!fields) return;
  const now = Date.now();
  for (const [field, pending] of fields) {
    if (pending.expiresAt <= now) fields.delete(field);
  }
  if (fields.size === 0) bucket.delete(id);
}

export function trackPendingFields(
  bucket: Map<string, Map<string, PendingLocalField>>,
  id: string,
  updates: Record<string, unknown>,
) {
  cleanupPending(bucket, id);
  let fields = bucket.get(id);
  if (!fields) {
    fields = new Map();
    bucket.set(id, fields);
  }
  const expiresAt = Date.now() + PENDING_LOCAL_FIELD_MS;
  for (const [field, value] of Object.entries(updates)) {
    fields.set(field, { value, expiresAt });
  }
}

export function mergeIncomingWithPending<T extends { id: string; updatedAt?: string | null }>(
  bucket: Map<string, Map<string, PendingLocalField>>,
  existing: T | undefined,
  incoming: T,
): T {
  if (existing && incoming.updatedAt && existing.updatedAt && Date.parse(incoming.updatedAt) < Date.parse(existing.updatedAt)) {
    return existing;
  }

  cleanupPending(bucket, incoming.id);
  const fields = bucket.get(incoming.id);
  if (!existing || !fields) return incoming;

  const merged = { ...incoming } as Record<string, unknown>;
  const existingRecord = existing as unknown as Record<string, unknown>;
  const incomingRecord = incoming as unknown as Record<string, unknown>;
  for (const [field, pending] of fields) {
    if (valuesEqual(incomingRecord[field], pending.value)) {
      fields.delete(field);
    } else if (valuesEqual(existingRecord[field], pending.value)) {
      merged[field] = existingRecord[field];
    }
  }
  if (fields.size === 0) bucket.delete(incoming.id);
  return merged as T;
}

/**
 * 에피소드 링크 patch 에 pending 보호 적용.
 * bucket 은 store 가 소유한 에피소드 링크 pending 버킷 — 키는 pendingLinkKey(characterId, episodeNumber).
 */
export function mergeEpisodeLinkPatchWithPending(
  bucket: Map<string, Map<string, PendingLocalField>>,
  links: Map<string, EpisodeCharacterLink[]>,
  characterId: string,
  episodeNumber: number,
  patch: Partial<Pick<EpisodeCharacterLink, 'memo' | 'costumeId'>>,
): Partial<Pick<EpisodeCharacterLink, 'memo' | 'costumeId'>> {
  const key = pendingLinkKey(characterId, episodeNumber);
  cleanupPending(bucket, key);
  const fields = bucket.get(key);
  if (!fields) return patch;

  const current = links.get(characterId)?.find((link) => link.episodeNumber === episodeNumber) ?? null;
  if (!current) return patch;

  const merged = { ...patch } as Record<string, unknown>;
  for (const [field, pending] of fields) {
    const incoming = merged[field];
    if (valuesEqual(incoming, pending.value)) {
      fields.delete(field);
    } else if (valuesEqual((current as unknown as Record<string, unknown>)[field], pending.value)) {
      merged[field] = (current as unknown as Record<string, unknown>)[field];
    }
  }
  if (fields.size === 0) bucket.delete(key);
  return merged as Partial<Pick<EpisodeCharacterLink, 'memo' | 'costumeId'>>;
}
