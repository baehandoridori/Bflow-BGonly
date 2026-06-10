import { useCallback } from 'react';
import { toast as sonnerToast } from 'sonner';
import type { Scene } from '@/types';
import { updateSceneFieldInSupabase } from '@/services/supabaseService';
import { useDataStore } from '@/stores/useDataStore';

export type SceneImageType = 'storyboard' | 'guide';

interface PersistLatestImageUrlRequest {
  sceneUuid?: string | null;
  imageType: SceneImageType;
  url: string;
  previousUrl?: string | null;
  onRollback?: (rollbackUrl: string) => void;
}

export function useOptimisticSceneImageUrl(sourceLabel: string) {
  const updateSceneByUuid = useDataStore((s) => s.updateSceneByUuid);

  const persistLatestImageUrl = useCallback(
    ({ sceneUuid, imageType, url, previousUrl, onRollback }: PersistLatestImageUrlRequest) => {
      if (!sceneUuid) return;

      const field = imageType === 'storyboard' ? 'storyboardUrl' : 'guideUrl';
      const patch: Partial<Scene> = { [field]: url };
      updateSceneByUuid(sceneUuid, patch);

      void updateSceneFieldInSupabase(sceneUuid, field, url).catch((err) => {
        console.error(`[${sourceLabel}] 최신 이미지 URL 저장 실패`, err);
        const rollbackUrl = previousUrl ?? '';
        const rollbackPatch: Partial<Scene> = { [field]: rollbackUrl };
        updateSceneByUuid(sceneUuid, rollbackPatch);
        onRollback?.(rollbackUrl);
        sonnerToast.error('이미지 최신화 저장에 실패했습니다. 새로고침 후 다시 확인해 주세요.');
      });
    },
    [sourceLabel, updateSceneByUuid],
  );

  return { persistLatestImageUrl };
}
