/**
 * 캐릭터 현황판 탭·그룹 순수 헬퍼 (피드백 41).
 * character_board_tabs.groups JSONB 배열을 다루는 불변 갱신 함수 모음.
 * 주의: node --test 가 직접 import 한다 — '@/' alias import 금지(상대 경로만).
 *   node ESM 해석은 확장자를 보완해 주지 않으므로 명시적 '.ts' 를 붙인다
 *   (저장소 관행: arcade/domain.ts 등. tsconfig allowImportingTsExtensions=true).
 */
import { createUuid } from './createUuid.ts';

export interface TabGroupLike {
  id: string;
  name: string;
  /** 배열 순서 = 그룹 내 카드 표시 순서. */
  characterIds: string[];
}

/** JSONB 원시값 → 안전한 그룹 배열. 형식이 어긋난 원소는 버린다(수동 편집·구버전 방어). 중복 id 는 첫 등장만 유지. */
export function sanitizeTabGroups(raw: unknown): TabGroupLike[] {
  if (!Array.isArray(raw)) return [];
  const out: TabGroupLike[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.name !== 'string') continue;
    const ids = Array.isArray(rec.characterIds)
      ? rec.characterIds.filter((v): v is string => typeof v === 'string')
      : [];
    out.push({ id: rec.id, name: rec.name, characterIds: Array.from(new Set(ids)) });
  }
  return out;
}

/** 그룹 추가 — 새 그룹은 맨 뒤. */
export function addGroup(groups: TabGroupLike[], name: string): TabGroupLike[] {
  return [...groups, { id: createUuid(), name, characterIds: [] }];
}

export function renameGroup(groups: TabGroupLike[], groupId: string, name: string): TabGroupLike[] {
  return groups.map((g) => (g.id === groupId ? { ...g, name } : g));
}

/** 그룹 삭제 — 소속 캐릭터는 미분류로 돌아간다(멤버십만 사라짐). */
export function removeGroup(groups: TabGroupLike[], groupId: string): TabGroupLike[] {
  return groups.filter((g) => g.id !== groupId);
}

/**
 * 캐릭터를 그룹으로 이동. targetGroupId=null 이면 모든 그룹에서 제거(미분류로).
 * 항상 기존 그룹들에서 먼저 제거한 뒤 대상 그룹 맨 뒤에 추가한다.
 */
export function moveCharacterToGroup(groups: TabGroupLike[], characterId: string, targetGroupId: string | null): TabGroupLike[] {
  const stripped = groups.map((g) =>
    g.characterIds.includes(characterId)
      ? { ...g, characterIds: g.characterIds.filter((id) => id !== characterId) }
      : g,
  );
  if (targetGroupId === null) return stripped;
  return stripped.map((g) => (g.id === targetGroupId ? { ...g, characterIds: [...g.characterIds, characterId] } : g));
}

/** 같은 그룹 안에서 characterId 를 targetCharacterId 앞으로 이동 — 카드 드래그 순서 조정. 둘 중 하나라도 없으면 무변경. */
export function reorderWithinGroup(groups: TabGroupLike[], groupId: string, characterId: string, targetCharacterId: string): TabGroupLike[] {
  return groups.map((g) => {
    if (g.id !== groupId) return g;
    if (characterId === targetCharacterId) return g;
    if (!g.characterIds.includes(characterId) || !g.characterIds.includes(targetCharacterId)) return g;
    const without = g.characterIds.filter((id) => id !== characterId);
    const idx = without.indexOf(targetCharacterId);
    return { ...g, characterIds: [...without.slice(0, idx), characterId, ...without.slice(idx)] };
  });
}

/** 그룹에 배치된 캐릭터 id 전체 집합 — 미분류 섹션 계산용. */
export function groupedCharacterIdSet(groups: TabGroupLike[]): Set<string> {
  const set = new Set<string>();
  for (const g of groups) for (const id of g.characterIds) set.add(id);
  return set;
}
