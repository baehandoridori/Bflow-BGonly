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
    // closeModal: 열려 있는 씬 상세 모달을 닫아 목적지 화 목록이 가려지지 않게 한다(코덱스 4차 P2).
    navigateToSceneView({ episodeNumber: target.episodeNumber, partId: null, department: 'all', closeModal: true });
    return;
  }
  if (target.kind === 'part') {
    // closeModal: 열려 있는 씬 상세 모달을 닫아 목적지 파트 목록이 가려지지 않게 한다(코덱스 4차 P2).
    navigateToSceneView({ episodeNumber: target.episodeNumber, partId: target.partId, department: 'all', closeModal: true });
    return;
  }
  // scene
  const episodes = useDataStore.getState().episodes;
  // target.sceneUuid(있으면) 로 같은 파트 내 sceneId 중복 row 를 정확히 구분해 연다.
  const scene = resolveSceneById(episodes, target.episodeNumber, target.partId, target.sceneId, target.sceneUuid);
  if (!scene) {
    useAppStore.getState().setToast(`${target.sceneId} 씬을 찾을 수 없습니다.`);
    return;
  }
  const useAllMode = Boolean(scene.id);
  // uuid 없는(Sheets/preview/test) 씬은 all-mode 정규화 매칭(BG ac001→merged a001)에서 누락될 수 있어,
  // 찾은 파트의 부서로 폴백한다(핫픽스 v1.41.1과 동일 회피). uuid 있으면 통합('all') 모달.
  const fallbackDept = scene.department === 'acting' ? 'acting' : scene.department === 'bg' ? 'bg' : undefined;
  navigateToSceneView({
    episodeNumber: target.episodeNumber,
    partId: target.partId,
    department: useAllMode ? 'all' : fallbackDept,
    highlightSceneId: scene.sceneId,
    modalRequest: {
      // resolve 된 scene.id 우선, 없으면 태그에 실린 sceneUuid 폴백.
      sceneUuid: scene.id ?? target.sceneUuid,
      sceneName: scene.sceneId,
      episodeNumber: target.episodeNumber,
      partId: target.partId,
      initialTab: 'detail',
      forceDeptFilter: useAllMode ? 'all' : fallbackDept,
    },
  });
}
