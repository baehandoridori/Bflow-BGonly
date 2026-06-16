import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import type { NotificationType } from '@/stores/useNotificationStore';
import {
  buildNotificationSceneModalRequest,
  hasSceneTargetHint,
  resolveNotificationSceneDepartmentFilter,
  resolveNotificationSceneTarget,
} from '@/utils/notificationSceneNavigation';
import { navigateToSceneView } from '@/utils/sceneNavigationAction';

export interface NotificationSceneActionResult {
  attempted: boolean;
  matched: boolean;
  openedModal: boolean;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataValue(metadata: Record<string, unknown> | undefined | null, key: string): unknown {
  return metadata ? metadata[key] : undefined;
}

export function markNotificationDomainRead(
  type: NotificationType | string,
  metadata?: Record<string, unknown> | null,
) {
  const reactionNotificationId = asString(metadataValue(metadata, 'reactionNotificationId'));
  if (type === 'comment_reaction' && reactionNotificationId) {
    import('@/services/supabaseService')
      .then(({ markCommentReactionRead }) => markCommentReactionRead(reactionNotificationId))
      .catch((err) => console.warn('[notificationSceneAction] markCommentReactionRead 실패:', err));
  }

  const feedbackNotificationId = asString(metadataValue(metadata, 'feedbackNotificationId'));
  if (type === 'acting_feedback' && feedbackNotificationId) {
    import('@/services/supabaseService')
      .then(({ markFeedbackNotificationRead }) => markFeedbackNotificationRead(feedbackNotificationId))
      .catch((err) => console.warn('[notificationSceneAction] markFeedbackNotificationRead 실패:', err));
  }

  const assignmentNotificationId = asString(metadataValue(metadata, 'assignmentNotificationId'));
  if (type === 'scene_assignment' && assignmentNotificationId) {
    import('@/services/supabaseService')
      .then(({ markAssignmentNotificationRead }) => markAssignmentNotificationRead(assignmentNotificationId))
      .catch((err) => console.warn('[notificationSceneAction] markAssignmentNotificationRead 실패:', err));
  }
}

export function getNotificationSceneActionLabel(
  type: NotificationType | string,
  metadata?: Record<string, unknown> | null,
): string {
  if (type === 'comment' || type === 'mention' || type === 'comment_reaction') return '댓글 보기';
  if (type === 'revision' && asString(metadataValue(metadata, 'revisionAction')) === 'comment') return '리테이크 댓글';
  if (type === 'revision') return '리테이크 보기';
  return '씬 보기';
}

/** 알림 클릭/토스트 액션의 단일 씬 이동 경로. */
export function navigateNotificationToScene(
  type: NotificationType | string,
  metadata?: Record<string, unknown> | null,
): NotificationSceneActionResult {
  markNotificationDomainRead(type, metadata);

  if (!hasSceneTargetHint(metadata)) {
    return { attempted: false, matched: false, openedModal: false };
  }

  const episodes = useDataStore.getState().episodes;
  const target = resolveNotificationSceneTarget(metadata, episodes);
  const app = useAppStore.getState();

  if (!target) {
    console.warn('[navigateNotificationToScene] 씬 매칭 실패', {
      metadata,
      episodeCount: episodes.length,
      sampleSceneIds: episodes[0]?.parts[0]?.scenes.slice(0, 3).map((s) => ({
        id: s.id,
        sceneId: s.sceneId,
      })),
    });
    app.setView('scenes');
    app.setToast?.({
      type: 'warning',
      message: '씬을 자동으로 찾지 못했어요. 씬 뷰에서 직접 확인해주세요.',
    });
    return { attempted: true, matched: false, openedModal: false };
  }

  const modalRequest = buildNotificationSceneModalRequest(type, metadata, target);
  const targetDeptFilter = resolveNotificationSceneDepartmentFilter(type, modalRequest, target);

  navigateToSceneView({
    episodeNumber: target.episodeNumber,
    partId: target.partId,
    department: targetDeptFilter,
    highlightSceneId: target.sceneName,
    modalRequest,
  });

  return { attempted: true, matched: true, openedModal: Boolean(modalRequest) };
}
