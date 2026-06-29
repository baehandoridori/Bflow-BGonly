import { toast as sonnerToast } from 'sonner';
import { useNotificationStore, type NotificationType } from '@/stores/useNotificationStore';
import { hasSceneTargetHint } from '@/utils/notificationSceneNavigation';
import {
  getNotificationSceneActionLabel,
  navigateNotificationToScene,
} from '@/utils/notificationSceneAction';

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

function metadataString(
  metadata: Record<string, unknown> | undefined | null,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function hasNotificationActionTarget(
  type: NotificationType | string,
  metadata?: Record<string, unknown> | null,
): boolean {
  return hasSceneTargetHint(metadata) ||
    (type === 'revision' && Boolean(metadataString(metadata, 'retakeHubSetId')));
}

/**
 * 알림을 디스패치합니다.
 * 1. 알림 스토어에 히스토리 추가
 * 2. 기본 Sonner 토스트 (info 스타일 + 알림 타입별 이동 액션)
 * 3. OS 네이티브 알림 (앱 비활성 시)
 */
export function dispatchNotification(payload: NotifyPayload, settings?: NotificationSettings) {
  const store = useNotificationStore.getState();
  const notificationId = store.addNotification({
    type: payload.type,
    title: payload.title,
    body: payload.body,
    metadata: payload.metadata as Record<string, string | undefined>,
  });
  const canNavigate = hasNotificationActionTarget(payload.type, payload.metadata);

  // 1. Sonner 토스트 (기본 스타일)
  // 노출 시간 8초로 늘려 한솔이 인지할 시간 확보.
  sonnerToast(payload.title, {
    description: payload.body,
    duration: 8000,
    ...(canNavigate && {
      action: {
        label: getNotificationSceneActionLabel(payload.type, payload.metadata),
        onClick: () => {
          useNotificationStore.getState().markAsRead(notificationId);
          navigateNotificationToScene(payload.type, payload.metadata);
        },
      },
    }),
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
