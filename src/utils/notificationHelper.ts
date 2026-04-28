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

/** 씬 UUID/이름으로 해당 에피소드 번호를 찾아 씬 뷰로 이동.
 *  매칭 실패 시 fallback: 씬 뷰로만이라도 이동 + 안내 토스트 (한솔이 직접 찾을 수 있게). */
function navigateToScene(sceneUuid?: string, sceneName?: string) {
  if (!sceneUuid && !sceneName) return;
  const episodes = useDataStore.getState().episodes;
  for (const ep of episodes) {
    for (const part of ep.parts) {
      const found = part.scenes.find(s =>
        (sceneUuid && s.id === sceneUuid) || (sceneName && s.sceneId === sceneName),
      );
      if (found) {
        // 한솔 보고 (v1.15.4): part 도 같이 이동해야 다른 파트의 씬으로 가도 펄스 이펙트가 보임.
        // 기존엔 setSelectedEpisode 만 호출 → 현재 part 의 시트가 그대로라 highlight 매칭 실패.
        useAppStore.getState().setSelectedEpisode(ep.episodeNumber);
        useAppStore.getState().setSelectedPart(part.partId);
        useAppStore.getState().setHighlightSceneId(found.sceneId);
        useAppStore.getState().setView('scenes');
        return;
      }
    }
  }
  // 매칭 실패 — 씬 뷰로만이라도 이동 + 디버그 로그 (한솔이 콘솔에서 원인 파악 가능)
  console.warn('[navigateToScene] 매칭 실패', {
    sceneUuid,
    sceneName,
    episodeCount: episodes.length,
    sampleSceneIds: episodes[0]?.parts[0]?.scenes.slice(0, 3).map((s) => ({ id: s.id, sceneId: s.sceneId })),
  });
  useAppStore.getState().setView('scenes');
  useAppStore.getState().setToast?.({
    type: 'warning',
    message: '씬을 자동으로 찾지 못했어요. 씬 뷰에서 직접 확인해주세요.',
  });
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
  // 라벨 '씬 보기' 그대로 유지. 노출 시간 8초로 늘려 한솔이 인지할 시간 확보.
  sonnerToast(payload.title, {
    description: payload.body,
    duration: 8000,
    ...(canNavigate && {
      action: {
        label: '씬 보기',
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
