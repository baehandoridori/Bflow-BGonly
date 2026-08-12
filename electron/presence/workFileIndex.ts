// electron/presence/workFileIndex.ts
// 엔티티 무관 "작업 파일 basename → 소유 엔티티 id" 인덱스 (피드백 54).
// 씬(scene_work_links.primary_file)과 캐릭터 복장(character_costumes.work_file_path)이 같은 알고리즘을
// 공유하며, 이후 다른 엔티티(예: 릴 파일)에 파일 열림 감지를 붙일 때도 이 모듈을 재사용한다.
import path from 'path';

export interface WorkFileEntry {
  /** 이 파일이 열려 있으면 "편집 중"으로 표시할 엔티티의 uuid. */
  id: string;
  path: string | null | undefined;
}

/** path 의 basename(소문자) → id 집합. path 없는 항목은 건너뛴다. */
export function buildWorkFileBasenameIndex(entries: WorkFileEntry[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const entry of entries ?? []) {
    if (!entry?.id || !entry.path) continue;
    const base = path.win32.basename(entry.path).toLowerCase();
    if (!base) continue;
    let set = index.get(base);
    if (!set) index.set(base, (set = new Set()));
    set.add(entry.id);
  }
  return index;
}

export interface ResolveIdsResult {
  ids: string[];
  /** 동명 파일이 서로 다른 엔티티 2개+에 걸린 basename 목록(진단 로그용). */
  collisions: string[];
}

/** 열린 basename 목록 → 매칭된 엔티티 id 유니온 + 콜리전 보고. */
export function resolveIdsForBasenames(
  index: Map<string, Set<string>>,
  basenames: string[],
): ResolveIdsResult {
  const idSet = new Set<string>();
  const collisions: string[] = [];
  for (const base of basenames ?? []) {
    const set = index.get(base);
    if (!set || set.size === 0) continue;
    if (set.size > 1) collisions.push(base);
    for (const id of set) idSet.add(id);
  }
  return { ids: [...idSet], collisions };
}
