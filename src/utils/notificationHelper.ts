import { createElement, type ReactNode } from 'react';
import { toast as sonnerToast } from 'sonner';
import { useNotificationStore, type NotificationType } from '@/stores/useNotificationStore';
import { hasSceneTargetHint } from '@/utils/notificationSceneNavigation';
import {
  getNotificationSceneActionLabel,
  navigateNotificationToScene,
} from '@/utils/notificationSceneAction';
import { markLiveNotificationArrival, notificationToastClassName } from '@/utils/notificationArrival';
import { notificationTypeVisual } from '@/utils/notificationTypeVisual';
import { getNotificationIdentity } from '@/utils/notificationIdentity';
import { parseNativeNotificationJump, type NativeNotificationJump } from '@/shared/nativeNotificationJump';

/**
 * 실시간으로 방금 받은 알림이 안 읽은 수를 늘렸으면 헤더 종·배지에 알린다(움직임 폴리싱 18번).
 * 앱 시작 때 불러오거나 놓친 알림을 모아 오는 경로에서는 부르지 않는다 — 그때는 종이 흔들리지 않는다.
 */
export function noteLiveNotificationArrival(
  type: NotificationType,
  unreadBefore: number,
  metadata?: { revisionAction?: unknown } | null,
): void {
  const state = useNotificationStore.getState();
  if (state.unreadCount > unreadBefore) markLiveNotificationArrival(type, state.activeUserId, undefined, metadata);
}

/** 알림 카드(오른쪽 아래)의 종류별 왼쪽 색 막대 클래스 + 16px 아이콘. */
export function notificationToastDecor(type: NotificationType): { className: string; icon: ReactNode } {
  const visual = notificationTypeVisual(type);
  return {
    className: notificationToastClassName(type),
    icon: createElement(visual.icon, { size: 16, style: { color: visual.color }, 'aria-hidden': true }),
  };
}

// ─── 알림 디스패치 ───────────────────────────────────
export interface NotifyPayload {
  type: NotificationType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export { resolveNotificationSettings, type NotificationSettings } from '@/utils/notificationSettings';
import type { NotificationSettings } from '@/utils/notificationSettings';

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
    (type === 'mention' && Boolean(metadataString(metadata, 'characterId'))) ||
    (type === 'revision' && Boolean(metadataString(metadata, 'retakeHubSetId') || metadataString(metadata, 'revisionId')));
}

/**
 * 알림을 디스패치합니다.
 * 1. 알림 스토어에 히스토리 추가
 * 2. 기본 Sonner 토스트 (info 스타일 + 알림 타입별 이동 액션)
 * 3. OS 네이티브 알림 (앱 비활성 시)
 */
export interface DispatchNotificationOptions {
  /** 조용한 알림 — 종 배지만(토스트·Windows 알림 없음). 담당 씬 자동 알림 등. */
  quiet?: boolean;
  /** false 면 토스트만(Windows 알림 없음) — 팔로우한 스레드 알림(§6.4, 나를 부른 알림보다 약하게). 기본 true. */
  native?: boolean;
}

export function dispatchNotification(payload: NotifyPayload, settings?: NotificationSettings, options: DispatchNotificationOptions = {}) {
  const store = useNotificationStore.getState();
  const unreadBefore = store.unreadCount;
  // 같은 씬 댓글 알림이 이미 목록에 있으면 스토어가 합친다 — 그때는 토스트를 다시 띄우지 않는다(§6.1).
  //   씬 댓글만 — 리테이크 진행·피드백처럼 같은 정체성으로 새 소식이 오는 알림은 예전처럼 토스트를 낸다(로컬 리뷰).
  const identity = getNotificationIdentity({ type: payload.type, metadata: payload.metadata });
  const alreadyListed = !!identity && identity.startsWith('scene_comment:')
    && store.notifications.some((n) => getNotificationIdentity(n) === identity);
  const notificationId = store.addNotification({
    type: payload.type,
    title: payload.title,
    body: payload.body,
    metadata: payload.metadata as Record<string, string | undefined>,
  });
  noteLiveNotificationArrival(payload.type, unreadBefore, payload.metadata);
  if (alreadyListed || options.quiet) return;
  const canNavigate = hasNotificationActionTarget(payload.type, payload.metadata);

  // 1. Sonner 토스트 (기본 스타일 + 종류별 왼쪽 색 막대·아이콘)
  // 노출 시간 8초로 늘려 한솔이 인지할 시간 확보.
  sonnerToast(payload.title, {
    ...notificationToastDecor(payload.type),
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

  // 3. OS 네이티브 알림 (앱 비활성 시) — v1.148.0: 누르면 토스트의 '댓글 보기'와 같은 곳으로(§9).
  if (settings?.osNotification !== false && options.native !== false) {
    const jump: NativeNotificationJump | undefined = canNavigate
      ? {
          notificationId,
          userId: useNotificationStore.getState().activeUserId ?? null,
          type: payload.type,
          metadata: (parseNativeNotificationJump({ notificationId, type: payload.type, metadata: payload.metadata })?.metadata) ?? {},
        }
      : undefined;
    window.electronAPI?.showNativeNotification?.(payload.title, payload.body || '', jump);
  }
}

/**
 * Windows 알림을 눌렀다(메인이 창을 올린 뒤 이동 묶음을 돌려줌) — 그 알림을 읽음으로 하고 씬·댓글로 간다.
 * 그사이 계정이 바뀌었으면 이동하지 않는다(창만 올라온 상태). 목록에서 지워졌어도 받은 값으로 간다.
 */
export function handleNativeNotificationClick(raw: unknown): void {
  const jump = parseNativeNotificationJump(raw);
  if (!jump) return;
  const store = useNotificationStore.getState();
  if (jump.userId && store.activeUserId !== jump.userId) return;
  const target = store.notifications.find((n) => n.id === jump.notificationId);
  if (target && !target.isRead) store.markAsRead(target.id);
  const type = (target?.type ?? jump.type) as NotificationType;
  const metadata = (target?.metadata ?? jump.metadata) as Record<string, unknown>;
  if (type === 'calendar') return;
  navigateNotificationToScene(type, metadata);
}
