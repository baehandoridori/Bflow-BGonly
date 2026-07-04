// electron/presence/sceneLinkIndex.ts
import path from 'path';
import type { SupabaseSceneWorkLink } from '../supabase';

/** primary_file 링크의 basename(소문자) → sceneUuid 집합 */
export function buildPrimaryFileBasenameIndex(
  links: SupabaseSceneWorkLink[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const link of links ?? []) {
    if (link.linkKind !== 'primary_file' || !link.path) continue;
    const base = path.win32.basename(link.path).toLowerCase();
    if (!base) continue;
    let set = index.get(base);
    if (!set) index.set(base, (set = new Set()));
    set.add(link.sceneUuid);
  }
  return index;
}

export interface ResolveResult { sceneUuids: string[]; collisions: string[]; }

/** 정규화 basename 목록 → 매칭 sceneUuid(유니크) + 콜리전 basename 목록 */
export function resolveScenesForBasenames(
  index: Map<string, Set<string>>,
  basenames: string[],
): ResolveResult {
  const sceneSet = new Set<string>();
  const collisions: string[] = [];
  for (const base of basenames ?? []) {
    const set = index.get(base);
    if (!set || set.size === 0) continue;
    if (set.size > 1) collisions.push(base);
    for (const uuid of set) sceneSet.add(uuid);
  }
  return { sceneUuids: [...sceneSet], collisions };
}
