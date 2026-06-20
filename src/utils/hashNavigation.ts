/**
 * #씬·파트·화 태그 클릭 → 해당 대상으로 이동(4c). 통합('all') 모달/뷰로 연다(핫픽스 v1.41.1 일관).
 *  - scene: resolveSceneById 로 찾아 통합 모달(uuid 있으면 forceDeptFilter='all', 없으면 부서 미지정 — 정규화 쌍 폴백).
 *  - part/episode: 모달 없이 해당 파트/화 뷰로 이동.
 * store/네비 의존이라 단위테스트 대신 resolveSceneById(cutScene.ts)를 TDD.
 */
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { navigateToSceneView } from '@/utils/sceneNavigationAction';
import { resolveSceneById } from '@/utils/cutScene';
import type { HashTarget } from '@/utils/hashEntity';

export function navigateToHashTarget(target: HashTarget): void {
  if (target.kind === 'episode') {
    // partId: null 로 선택 파트를 비운다 — 안 그러면 보던 파트(예 B)가 남아 엉뚱한 파트로 열림(코덱스 P2).
    navigateToSceneView({ episodeNumber: target.episodeNumber, partId: null, department: 'all' });
    return;
  }
  if (target.kind === 'part') {
    navigateToSceneView({ episodeNumber: target.episodeNumber, partId: target.partId, department: 'all' });
    return;
  }
  // scene
  const episodes = useDataStore.getState().episodes;
  const scene = resolveSceneById(episodes, target.episodeNumber, target.partId, target.sceneId);
  if (!scene) {
    useAppStore.getState().setToast(`${target.sceneId} 씬을 찾을 수 없습니다.`);
    return;
  }
  const useAllMode = Boolean(scene.id);
  navigateToSceneView({
    episodeNumber: target.episodeNumber,
    partId: target.partId,
    department: useAllMode ? 'all' : undefined,
    highlightSceneId: scene.sceneId,
    modalRequest: {
      sceneUuid: scene.id,
      sceneName: scene.sceneId,
      episodeNumber: target.episodeNumber,
      partId: target.partId,
      initialTab: 'detail',
      forceDeptFilter: useAllMode ? 'all' : undefined,
    },
  });
}
