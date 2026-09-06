import { useAppStore } from '@/stores/useAppStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useRevisionSetStore } from '@/stores/useRevisionSetStore';

/** The hub consumes the request after its data is ready and reveals the exact item. */
export function openRetakeInApp(revisionId: string, options?: { fromPopup?: boolean }): void {
  if (options?.fromPopup) {
    void window.electronAPI?.widgetNavigateMain?.({ revisionId, sheetName: '', sceneId: '', sceneUuid: '' });
    return;
  }
  const app = useAppStore.getState();
  const revision = useRevisionStore.getState().revisions.find((item) => item.id === revisionId);
  app.pushNavigationBackTarget();
  if (revision?.setId) useRevisionSetStore.getState().select(revision.setId);
  app.setPendingRetakeId(revisionId);
  // An uncached ID can belong to a hub set; wait for the canonical lookup before choosing its screen.
  if (revision) app.setView(revision.setId ? 'retake-hub' : 'compositing-revisions');
}
