import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { navigateToSceneView } from '@/utils/sceneNavigationAction';
import { resolveCutScene } from '@/utils/cutScene';

export interface CutContext {
  episodeNumber: number;
  partId: string;
}

/**
 * 컷 번호 칩 클릭 → 같은 EP·파트의 씬으로 이동(스펙 §10.2 4a, 방안 A).
 * 씬 컨텍스트(episodeNumber+partId)가 있는 곳에서만 호출된다(없으면 호출 측이 onCutClick 생략).
 * 못 찾으면 화면 전환 없이 toast 만 띄우고 false 반환(잘못된 점프 방지).
 */
export function navigateToCutNumber(cutNumber: number, ctx: CutContext): boolean {
  const episodes = useDataStore.getState().episodes;
  const scene = resolveCutScene(episodes, ctx.episodeNumber, ctx.partId, cutNumber);
  if (!scene) {
    useAppStore.getState().setToast(`컷${cutNumber}을(를) 찾을 수 없습니다.`);
    return false;
  }
  navigateToSceneView({
    episodeNumber: ctx.episodeNumber,
    partId: ctx.partId,
    highlightSceneId: scene.sceneId,
  });
  return true;
}
