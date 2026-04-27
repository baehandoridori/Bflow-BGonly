import { toast as sonnerToast } from 'sonner';
import { useNotificationStore, type NotificationType } from '@/stores/useNotificationStore';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';

// ─── 알림 디스패치 ───────────────────────────────────
export interface NotifyPayload {
  type: NotificationType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationSettings {
  sceneChange?: boolean;
  commentNotify?: boolean;
  osNotification?: boolean;
  sound?: boolean;
}

/** 씬 UUID로 해당 에피소드 번호를 찾아 씬 뷰로 이동 */
function navigateToScene(sceneUuid?: string, sceneName?: string) {
  if (!sceneUuid && !sceneName) return;
  const episodes = useDataStore.getState().episodes;
  for (const ep of episodes) {
    for (const part of ep.parts) {
      const found = part.scenes.find(s =>
        (sceneUuid && s.id === sceneUuid) || (sceneName && s.sceneId === sceneName),
      );
      if (found) {
        useAppStore.getState().setSelectedEpisode(ep.episodeNumber);
        useAppStore.getState().setHighlightSceneId(found.sceneId);
        useAppStore.getState().setView('scenes');
        return;
      }
    }
  }
}

/**
 * 알림을 디스패치합니다.
 * 1. 기본 Sonner 토스트 (info 스타일 + 씬 보기 액션)
 * 2. 알림 스토어에 히스토리 추가
 * 3. OS 네이티브 알림 (앱 비활성 시)
 */
export function dispatchNotification(payload: NotifyPayload, settings?: NotificationSettings) {
  const sceneId = payload.metadata?.sceneId as string | undefined;
  const sceneName = payload.metadata?.sceneName as string | undefined;
  const canNavigate = !!(sceneId || sceneName);

  // 1. Sonner 토스트 (기본 스타일)
  // 한솔 결정 (8번): 라벨 '씬 보기' → '확인' (간결). 동작은 동일하게 씬 모달로 포커스 이동.
  // 토스트 노출 시간을 8초로 늘려 한솔이 충분히 인지할 시간 확보.
  sonnerToast(payload.title, {
    description: payload.body,
    duration: 8000,
    ...(canNavigate && {
      action: {
        label: '확인',
        onClick: () => navigateToScene(sceneId, sceneName),
      },
    }),
  });

  // 2. 알림 스토어에 추가
  useNotificationStore.getState().addNotification({
    type: payload.type,
    title: payload.title,
    body: payload.body,
    metadata: payload.metadata as Record<string, string | undefined>,
  });

  // 3. OS 네이티브 알림 (앱 비활성 시)
  if (settings?.osNotification !== false) {
    window.electronAPI?.showNativeNotification?.(payload.title, payload.body || '');
  }
}

// ─── Slack 웹훅 인터페이스 (추후 구현) ─────────────────
export interface SlackNotifyPayload {
  webhookUrl: string;
  channel?: string;
  text: string;
  blocks?: unknown[];
}

export async function sendSlackNotification(_payload: SlackNotifyPayload): Promise<void> {
  // TODO: Slack 연동 Phase에서 구현
}
