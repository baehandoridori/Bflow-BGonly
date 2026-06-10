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
}: SceneViewNavigationRequest): void {
  const app = useAppStore.getState();

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

  app.setView('scenes');
  if (toastMessage) app.setToast(toastMessage);
}
