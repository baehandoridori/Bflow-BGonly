/**
 * #씬 타깃(ep, part, sceneId) → 도킹 참조용 MergedScene + 시트명.
 * buildMergedScenes(객체 인자)를 재사용 — 신규 merge 로직 없음.
 * MergedScene 엔 sheetName 이 없으므로 편집 콜백용 bgSheetName/actSheetName 을
 * Part 에서 따로 뽑아 함께 반환한다.
 * 순수 함수 — node:test 검증.
 */
import { buildMergedScenes, snapshotRawCounterpartState, restoreRawCounterpartState } from './mergedSceneHelpers.ts';
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
  // partId·sceneId 대소문자 무관 — BG 소문자(d/d001) ↔ ACT 대문자(D/D001) 도 같은 #씬 타깃으로 해석.
  const wantPart = (target.partId || '').toLowerCase();
  const wantScene = (target.sceneId || '').toLowerCase();
  const bgPart = ep.parts.find((p: any) => (p.partId || '').toLowerCase() === wantPart && p.department === 'bg');
  const actPart = ep.parts.find((p: any) => (p.partId || '').toLowerCase() === wantPart && p.department === 'acting');
  if (!bgPart && !actPart) return null;
  const bgScenes = bgPart?.scenes ?? [];
  const actScenes = actPart?.scenes ?? [];
  // buildMergedScenes 는 전역 counterpart 맵(partId 키)을 갱신한다 — 참조(다른 파트) 해석이 메인 파트를
  // 오염시키지 않게, 호출 전 스냅샷 후 복원한다(빌드 내부 등록은 그대로 두어 merged.sceneId 는 정확).
  const counterpartSnapshot = snapshotRawCounterpartState(target.partId);
  const merged = buildMergedScenes({
    bgScenes,
    actScenes,
    bgPartScenes: bgScenes,
    actPartScenes: actScenes,
    mergedScenePartId: target.partId,
    sortKey,
    sortDir,
  }) as MergedScene[];
  restoreRawCounterpartState(target.partId, counterpartSnapshot);
  // target.sceneUuid 가 있으면(화 간/부서 내 sceneId 중복 대비) 그 row(bg/act)를 품은 merged 우선,
  // 없으면 sceneId 폴백 — navigateToHashTarget(resolveSceneById)와 동일하게 정확한 row 를 연다.
  const found = (target.sceneUuid
    ? merged.find((m) => m.bgScene?.id === target.sceneUuid || m.actScene?.id === target.sceneUuid)
    : undefined)
    // sceneId 매칭은 정규 merged.sceneId 뿐 아니라 raw bg/act sceneId 도 본다 — ACT 비정규 id(ac001)가
    // 정규(a001)로 병합돼도 #ac001 태그(target.sceneId='ac001')로 찾히게(navigateToHashTarget 일관).
    ?? merged.find((m) => (m.sceneId || '').toLowerCase() === wantScene
      || (m.bgScene?.sceneId || '').toLowerCase() === wantScene
      || (m.actScene?.sceneId || '').toLowerCase() === wantScene);
  if (!found) return null;
  return {
    merged: found,
    bgSheetName: bgPart?.sheetName ?? null,
    actSheetName: actPart?.sheetName ?? null,
  };
}
