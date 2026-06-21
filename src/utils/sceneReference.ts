/**
 * #씬 타깃(ep, part, sceneId) → 도킹 참조용 MergedScene + 시트명.
 * buildMergedScenes(객체 인자)를 재사용 — 신규 merge 로직 없음.
 * MergedScene 엔 sheetName 이 없으므로 편집 콜백용 bgSheetName/actSheetName 을
 * Part 에서 따로 뽑아 함께 반환한다.
 * 순수 함수 — node:test 검증.
 */
import { buildMergedScenes } from './mergedSceneHelpers.ts';
import type { HashTarget } from './hashEntity.ts';
import type { MergedScene } from '@/types';

export interface ReferenceResolution {
  merged: MergedScene;
  bgSheetName: string | null;
  actSheetName: string | null;
}

type SortKeyLike = 'no' | 'assignee' | 'progress' | 'incomplete';
type SortDirLike = 'asc' | 'desc';

export function resolveReferenceMergedScene(
  target: HashTarget,
  episodes: readonly any[],
  sortKey: SortKeyLike,
  sortDir: SortDirLike,
): ReferenceResolution | null {
  if (target.kind !== 'scene') return null;
  const ep = episodes.find((e) => e.episodeNumber === target.episodeNumber);
  if (!ep) return null;
  const bgPart = ep.parts.find((p: any) => p.partId === target.partId && p.department === 'bg');
  const actPart = ep.parts.find((p: any) => p.partId === target.partId && p.department === 'acting');
  if (!bgPart && !actPart) return null;
  const bgScenes = bgPart?.scenes ?? [];
  const actScenes = actPart?.scenes ?? [];
  const merged = buildMergedScenes({
    bgScenes,
    actScenes,
    bgPartScenes: bgScenes,
    actPartScenes: actScenes,
    mergedScenePartId: target.partId,
    sortKey,
    sortDir,
  }) as MergedScene[];
  const found = merged.find((m) => m.sceneId === target.sceneId);
  if (!found) return null;
  return {
    merged: found,
    bgSheetName: bgPart?.sheetName ?? null,
    actSheetName: actPart?.sheetName ?? null,
  };
}
