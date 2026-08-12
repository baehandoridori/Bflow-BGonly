// electron/presence/sceneLinkIndex.ts
// 씬 전용 래퍼 — 실제 인덱스/해석 알고리즘은 엔티티 무관 workFileIndex 가 소유한다 (피드백 54).
import type { SupabaseSceneWorkLink } from '../supabase';
// @ts-expect-error TS5097 — Node 내장 TS 테스트는 runtime import의 .ts 확장자가 필요하고, Electron 빌드는 Vite가 번들한다.
import { buildWorkFileBasenameIndex, resolveIdsForBasenames, type WorkFileEntry } from './workFileIndex.ts';

/** scene 감지 소스 어댑터 — primary_file 링크를 WorkFileEntry 목록으로 (main 의 PresenceSource 등록용). */
export function sceneWorkFileEntries(links: SupabaseSceneWorkLink[]): WorkFileEntry[] {
  return (links ?? [])
    .filter((link) => link.linkKind === 'primary_file')
    .map((link) => ({ id: link.sceneUuid, path: link.path }));
}

/** primary_file 링크의 basename(소문자) → sceneUuid 집합 */
export function buildPrimaryFileBasenameIndex(
  links: SupabaseSceneWorkLink[],
): Map<string, Set<string>> {
  return buildWorkFileBasenameIndex(sceneWorkFileEntries(links));
}

export interface ResolveResult { sceneUuids: string[]; collisions: string[]; }

/** 정규화 basename 목록 → 매칭 sceneUuid(유니크) + 콜리전 basename 목록 */
export function resolveScenesForBasenames(
  index: Map<string, Set<string>>,
  basenames: string[],
): ResolveResult {
  const { ids, collisions } = resolveIdsForBasenames(index, basenames);
  return { sceneUuids: ids, collisions };
}
