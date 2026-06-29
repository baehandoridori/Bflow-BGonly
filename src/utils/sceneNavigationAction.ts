import { useAppStore } from '@/stores/useAppStore';
import type { ScenesDeptFilter } from '@/types';

type AppStoreState = ReturnType<typeof useAppStore.getState>;
export type SceneNavigationModalRequest = AppStoreState['pendingSceneModalRequest'];

export interface SceneViewNavigationRequest {
  episodeNumber?: number | null;
  partId?: string | null;
  department?: ScenesDeptFilter | null;
  highlightSceneId?: string | null;
  modalRequest?: SceneNavigationModalRequest;
  resetFilters?: boolean;
  toastMessage?: string;
  recordBackTarget?: boolean;
  /**
   * 현재 열려 있는 씬 상세 모달을 강제로 닫는다(#화·#파트 점프용, 4c 코덱스 4차 P2).
   * modalRequest 가 있으면(scene 점프 — 같은 호출에서 모달 reopen) 무시되어 회귀를 막는다.
   * 미지정(기본값 false)이면 기존 호출처와 동일하게 모달을 건드리지 않는다.
   */
  closeModal?: boolean;
}

/** 다른 화면/알림에서 씬 뷰로 이동할 때 필터·부서·하이라이트 정책을 한 곳에서 맞춘다. */
export function navigateToSceneView({
  episodeNumber,
  partId,
  department,
  highlightSceneId,
  modalRequest,
  resetFilters = true,
  toastMessage,
  recordBackTarget = true,
  closeModal = false,
}: SceneViewNavigationRequest): void {
  const app = useAppStore.getState();

  if (recordBackTarget) app.pushNavigationBackTarget();
  if (episodeNumber !== undefined) app.setSelectedEpisode(episodeNumber);
  if (partId !== undefined) app.setSelectedPart(partId);
  if (department) {
    app.setSelectedDepartment(department);
    app.setDashboardDeptFilter(department);
  }
  if (resetFilters) {
    app.setSelectedAssignee(null);
    app.setSearchQuery('');
    app.setStatusFilter('all');
  }
  if (highlightSceneId !== undefined) app.setHighlightSceneId(highlightSceneId);
  if (modalRequest) app.setPendingSceneModalRequest(modalRequest);
  // modalRequest(scene 점프)가 있으면 같은 호출에서 모달을 다시 열므로 닫기 신호를 보내지 않는다.
  else if (closeModal) app.requestCloseSceneModal();

  app.setView('scenes');
  if (toastMessage) app.setToast(toastMessage);
}
