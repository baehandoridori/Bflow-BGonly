import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { useRevisionSetStore } from '@/stores/useRevisionSetStore';
import type { NotificationType } from '@/stores/useNotificationStore';
import { markNotificationDomainRead } from '@/utils/notificationDomainRead';
import {
  buildNotificationSceneModalRequest,
  hasSceneTargetHint,
  resolveNotificationSceneDepartmentFilter,
  resolveNotificationSceneTarget,
} from '@/utils/notificationSceneNavigation';
import { navigateToSceneView } from '@/utils/sceneNavigationAction';

export { markNotificationDomainRead } from '@/utils/notificationDomainRead';

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

  // '전반' 리테이크 알림 — 씬 컨텍스트가 없으므로 리테이크 허브로 보낸다(코덱스 P2).
  const retakeHubSetId = asString(metadataValue(metadata, 'retakeHubSetId'));
  if (type === 'revision' && retakeHubSetId) {
    useAppStore.getState().setView('retake-hub');
    try {
      useRevisionSetStore.getState().select(retakeHubSetId);
    } catch {
      /* 세트 스토어 미로드 — 허브 진입 후 자동 로드/선택 */
    }
    return { attempted: true, matched: true, openedModal: false };
  }

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
