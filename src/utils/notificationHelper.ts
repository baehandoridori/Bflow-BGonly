import { toast as sonnerToast } from 'sonner';
import { useNotificationStore, type NotificationType } from '@/stores/useNotificationStore';

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

/**
 * 알림을 디스패치합니다.
 * 1. Sonner 토스트 표시
 * 2. 알림 스토어에 히스토리 추가
 * 3. OS 네이티브 알림 (앱 비활성 시)
 * 4. [추후] Slack 웹훅
 */
export function dispatchNotification(payload: NotifyPayload, settings?: NotificationSettings) {
  // 1. Sonner 토스트
  const toastFn = payload.type === 'milestone' ? sonnerToast.success
    : payload.type === 'system' ? sonnerToast.info
    : sonnerToast.info;
  toastFn(payload.title, {
    description: payload.body,
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

  // 4. [추후] 사운드 재생 — settings?.sound

  // 5. [추후] Slack 웹훅
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
