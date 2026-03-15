import { toast as sonnerToast } from 'sonner';
import { X } from 'lucide-react';
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

// ─── 타입별 색상 ─────────────────────────────────────
function typeColor(type: NotificationType): string {
  switch (type) {
    case 'scene_change': return '#74B9FF';
    case 'comment': return '#6C5CE7';
    case 'milestone': return '#00B894';
    case 'system': return '#8B8DA3';
  }
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

// ─── 커스텀 토스트 (WelcomeToast 스타일) ─────────────
function BflowToast({ id, type, title, body, sceneId, sceneName }: {
  id: string | number;
  type: NotificationType;
  title: string;
  body?: string;
  sceneId?: string;
  sceneName?: string;
}) {
  const color = typeColor(type);
  const canNavigate = !!(sceneId || sceneName);

  return (
    <div
      className="relative w-[356px] rounded-2xl overflow-hidden cursor-default"
      style={{
        background: 'rgba(26, 29, 39, 0.78)',
        backdropFilter: 'blur(20px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.6)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: `0 24px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 40px ${color}12`,
      }}
    >
      {/* 상단 빛 반사 */}
      <div
        className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, transparent 10%, rgba(255,255,255,0.4) 50%, transparent 90%)',
        }}
      />

      {/* 좌측 액센트 바 */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: color }}
      />

      {/* 닫기 버튼 */}
      <button
        onClick={() => sonnerToast.dismiss(id)}
        className="absolute top-2.5 right-2.5 p-1 rounded-md transition-all duration-150 cursor-pointer z-10
                   bg-white/[0.06] border border-white/[0.08] text-[#8B8DA3]
                   hover:bg-white/[0.12] hover:text-[#E8E8EE]"
      >
        <X size={12} />
      </button>

      {/* 콘텐츠 */}
      <div className="flex items-start gap-3 px-4 py-3.5 pl-5">
        {/* 액센트 도트 */}
        <div className="relative flex-shrink-0 mt-1">
          <div className="w-2 h-2 rounded-full" style={{ background: color }} />
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: color,
              animation: 'bflow-dot-ping 1.5s ease-out 1',
            }}
          />
        </div>

        {/* 텍스트 */}
        <div className="flex-1 min-w-0 pr-5">
          <p className="text-[13px] font-medium text-text-primary leading-snug">{title}</p>
          {body && (
            <p className="text-[11px] text-text-secondary/50 mt-1 leading-relaxed truncate">{body}</p>
          )}
          {canNavigate && (
            <button
              onClick={() => {
                navigateToScene(sceneId, sceneName);
                sonnerToast.dismiss(id);
              }}
              className="text-[11px] mt-1.5 font-medium transition-opacity cursor-pointer hover:opacity-70"
              style={{ color }}
            >
              씬 보기 →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 알림을 디스패치합니다.
 * 1. 커스텀 Sonner 토스트 (WelcomeToast 스타일)
 * 2. 알림 스토어에 히스토리 추가
 * 3. OS 네이티브 알림 (앱 비활성 시)
 */
export function dispatchNotification(payload: NotifyPayload, settings?: NotificationSettings) {
  const sceneId = payload.metadata?.sceneId as string | undefined;
  const sceneName = payload.metadata?.sceneName as string | undefined;

  // 1. 커스텀 Sonner 토스트
  sonnerToast.custom((id) => (
    <BflowToast
      id={id}
      type={payload.type}
      title={payload.title}
      body={payload.body}
      sceneId={sceneId}
      sceneName={sceneName}
    />
  ));

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
