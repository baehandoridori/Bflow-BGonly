import { createContext, lazy, Suspense, useCallback, useContext, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useDataStore } from '@/stores/useDataStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { resolveNotificationSceneTarget, type NotificationSceneTarget } from '@/utils/notificationSceneNavigation';
import { isGeneralRevisionSceneKey } from '@/utils/revisionGeneral';

const CompositingSceneModal = lazy(() => import('../compositing-dashboard/modal/CompositingSceneModal'));

interface RetakeSceneRequest {
  sceneKey: string;
  department?: 'bg' | 'acting' | null;
  sceneUuid?: string;
  focusRevisionId?: string;
}

type OpenRetakeScene = (request: RetakeSceneRequest) => boolean;
const RetakeSceneContext = createContext<OpenRetakeScene | null>(null);

/** Keeps the board selection and filters mounted behind the existing scene card. */
export function RetakeSceneModalProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<(NotificationSceneTarget & { focusRevisionId?: string }) | null>(null);
  const openScene = useCallback<OpenRetakeScene>((request) => {
    if (isGeneralRevisionSceneKey(request.sceneKey)) {
      toast.info('전반 항목은 연결된 씬이 없어 현재 허브에서 확인해주세요.');
      return false;
    }
    const revision = request.focusRevisionId
      ? useRevisionStore.getState().revisions.find((item) => item.id === request.focusRevisionId)
      : undefined;
    const next = resolveNotificationSceneTarget({
      // A board's combined scene summary can point at BG; the focused retake owns its department/raw scene key.
      sceneId: revision ? undefined : request.sceneUuid,
      sceneName: revision?.sceneKey ?? request.sceneKey,
      department: revision?.department ?? request.department,
    }, useDataStore.getState().episodes);
    if (!next) {
      toast.error('연결된 씬을 찾지 못했어요.');
      return false;
    }
    setTarget({ ...next, focusRevisionId: request.focusRevisionId });
    return true;
  }, []);

  return (
    <RetakeSceneContext.Provider value={openScene}>
      {children}
      {target && (
        <Suspense fallback={<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 text-text-primary" role="status">씬 상세를 여는 중…</div>}>
          <CompositingSceneModal
            key={`${target.sceneUuid ?? target.sceneName}:${target.focusRevisionId ?? ''}`}
            sceneKey={`${target.episodeNumber}:${target.sceneName}`}
            episodeNumber={target.episodeNumber}
            sceneTarget={{ partId: target.partId, sceneUuid: target.sceneUuid }}
            isCompositor={false}
            showCompositingSection={false}
            initialTab="revisions"
            focusRevisionId={target.focusRevisionId}
            onClose={() => setTarget(null)}
          />
        </Suspense>
      )}
    </RetakeSceneContext.Provider>
  );
}

export function useRetakeSceneModal(): OpenRetakeScene | null {
  return useContext(RetakeSceneContext);
}
