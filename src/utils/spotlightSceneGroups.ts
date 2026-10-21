/**
 * Ctrl+Space 검색에서 같은 씬의 BG·ACT 를 한 줄로 묶는다(2026-10-21).
 *
 * 예전에는 같은 씬이 BG 한 줄, ACT 한 줄로 따로 나왔다. 씬 화면의 통합 보기와 똑같이 묶이도록
 * 통합 보기가 쓰는 buildMergedScenes 를 그대로 쓴다(새 묶기 규칙을 만들지 않는다 — d001/D001 같은
 * 대소문자 차이, ac001 같은 비정규 번호도 통합 보기와 같게 묶인다).
 * buildMergedScenes 는 전역 counterpart 맵을 고치므로 sceneReference.ts 처럼 스냅샷 뒤 되돌린다.
 *
 * node --test 가 그대로 import 하도록 런타임 '@/' import 를 쓰지 않는다.
 */
import { buildMergedScenes, restoreRawCounterpartState, snapshotRawCounterpartState } from './mergedSceneHelpers.ts';

interface SearchSceneLike {
  id?: string;
  no: number;
  sceneId: string;
  assignee?: string;
  lo?: boolean;
  done?: boolean;
  review?: boolean;
  png?: boolean;
}

interface SearchPartLike<TScene extends SearchSceneLike> {
  partId: string;
  department: 'bg' | 'acting';
  sheetName: string;
  scenes: TScene[];
}

interface SearchEpisodeLike<TScene extends SearchSceneLike> {
  episodeNumber: number;
  parts: SearchPartLike<TScene>[];
}

export interface SpotlightSceneGroup<TScene extends SearchSceneLike> {
  /** 검색 결과 고유 키 */
  key: string;
  episodeNumber: number;
  /** 씬 화면에서 고를 파트(BG 파트가 있으면 그 표기) */
  partId: string;
  /** 보여 줄 씬 번호(BG 가 있으면 BG 표기) */
  sceneId: string;
  bgScene: TScene | null;
  actScene: TScene | null;
  bgSheetName: string | null;
  actSheetName: string | null;
  /** 통합 보기에서 이 카드를 강조할 때 쓰는 씬 번호(matchesMergedSceneIdentity 가 BG·ACT 둘 다 본다) */
  highlightSceneId: string;
}

export function buildSpotlightSceneGroups<TScene extends SearchSceneLike>(
  episode: SearchEpisodeLike<TScene>,
): SpotlightSceneGroup<TScene>[] {
  const partsById = new Map<string, { bg: SearchPartLike<TScene> | null; act: SearchPartLike<TScene> | null }>();
  for (const part of episode.parts) {
    const key = (part.partId || '').trim().toLowerCase();
    const slot = partsById.get(key) ?? { bg: null, act: null };
    if (part.department === 'bg' && !slot.bg) slot.bg = part;
    if (part.department === 'acting' && !slot.act) slot.act = part;
    partsById.set(key, slot);
  }

  const groups: SpotlightSceneGroup<TScene>[] = [];
  for (const [partKey, { bg, act }] of partsById) {
    const partId = bg?.partId ?? act?.partId ?? partKey;
    const bgScenes = bg?.scenes ?? [];
    const actScenes = act?.scenes ?? [];
    if (bgScenes.length === 0 && actScenes.length === 0) continue;
    const snapshot = snapshotRawCounterpartState(partId);
    const merged = buildMergedScenes({
      bgScenes,
      actScenes,
      bgPartScenes: bgScenes,
      actPartScenes: actScenes,
      mergedScenePartId: partId,
      sortKey: 'no',
      sortDir: 'asc',
    });
    restoreRawCounterpartState(partId, snapshot);
    merged.forEach((item, index) => {
      const bgScene = item.bgScene ?? null;
      const actScene = item.actScene ?? null;
      const shownSceneId = bgScene?.sceneId ?? actScene?.sceneId ?? item.sceneId;
      groups.push({
        key: `${episode.episodeNumber}|${partKey}|${item.mergedKey || `${index}:${shownSceneId}`}`,
        episodeNumber: episode.episodeNumber,
        partId,
        sceneId: shownSceneId,
        bgScene,
        actScene,
        bgSheetName: bg?.sheetName ?? null,
        actSheetName: act?.sheetName ?? null,
        highlightSceneId: shownSceneId,
      });
    });
  }
  return groups;
}
