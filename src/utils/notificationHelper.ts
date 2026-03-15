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
 * 1. Sonner 토스트 표시 (클릭 시 씬 이동)
 * 2. 알림 스토어에 히스토리 추가
 * 3. OS 네이티브 알림 (앱 비활성 시)
 */
export function dispatchNotification(payload: NotifyPayload, settings?: NotificationSettings) {
  // 1. Sonner 토스트 (클릭 시 해당 씬으로 이동)
  const toastFn = payload.type === 'milestone' ? sonnerToast.success
    : payload.type === 'system' ? sonnerToast.info
    : sonnerToast.info;

  const sceneId = payload.metadata?.sceneId as string | undefined;
  const sceneName = payload.metadata?.sceneName as string | undefined;

  toastFn(payload.title, {
    description: payload.body,
    action: (sceneId || sceneName) ? {
      label: '씬 보기',
      onClick: () => navigateToScene(sceneId, sceneName),
    } : undefined,
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

/**
 * Slack 웹훅으로 알림 전송 (추후 구현)
 * IPC → main → fetch(webhookUrl, POST)
 */
export async function sendSlackNotification(_payload: SlackNotifyPayload): Promise<void> {
  // TODO: Slack 연동 Phase에서 구현
  // const result = await window.electronAPI?.sendSlackWebhook?.(payload);
}
