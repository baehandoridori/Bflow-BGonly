import { useAppStore } from '@/stores/useAppStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useAuthStore } from '@/stores/useAuthStore';

/** The hub consumes the request after its data is ready and reveals the exact item. */
export function openRetakeInApp(revisionId: string, options?: { fromPopup?: boolean }): void {
  if (options?.fromPopup) {
    void window.electronAPI?.widgetNavigateMain?.({ revisionId, sheetName: '', sceneId: '', sceneUuid: '' });
    return;
  }
  const app = useAppStore.getState();
  const revision = useRevisionStore.getState().revisions.find((item) => item.id === revisionId);
  app.pushNavigationBackTarget();
  const requestId = app.requestRetakeNavigation(revisionId);
  // Connected navigation always verifies the latest location/deletion, including cached IDs.
  const auth = useAuthStore.getState();
  if (!app.dataConnected && revision && auth.authReady && auth.currentUser) app.finishRetakeNavigation(requestId, revision);
}
