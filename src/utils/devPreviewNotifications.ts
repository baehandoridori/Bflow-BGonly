import type { Episode } from '../types';
import type { AppNotification } from '../stores/useNotificationStore';

type DraftNotification = Omit<AppNotification, 'id' | 'createdAt' | 'isRead'>;

interface SceneContext {
  episode: Episode;
  part: Episode['parts'][number];
  scene: Episode['parts'][number]['scenes'][number];
}

function findSceneContext(episodes: Episode[], department?: 'bg' | 'acting'): SceneContext | null {
  for (const episode of episodes) {
    for (const part of episode.parts) {
      if (department && part.department !== department) continue;
      const scene = part.scenes[0];
      if (scene) return { episode, part, scene };
    }
  }
  return null;
}

function buildBaseMetadata(context: SceneContext) {
  return {
    sceneId: context.scene.id,
    sceneName: context.scene.sceneId,
    sheetName: context.part.sheetName,
  };
}

export function isDevPreviewNotificationToolsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  return Boolean(
    env?.DEV ||
    document.documentElement.dataset.devElectronApi === 'installed' ||
    new URLSearchParams(window.location.search).has('codex'),
  );
}

export function buildDevPreviewNotifications(episodes: Episode[]): DraftNotification[] {
  const bgContext = findSceneContext(episodes, 'bg') ?? findSceneContext(episodes);
  const actingContext = findSceneContext(episodes, 'acting') ?? bgContext;
  if (!bgContext || !actingContext) return [];

  return [
    {
      type: 'mention',
      title: '[테스트] 댓글 멘션 알림',
      body: `${bgContext.part.partId} ${bgContext.scene.sceneId} 댓글로 이동`,
      metadata: {
        ...buildBaseMetadata(bgContext),
        commentId: 'dev-preview-comment',
        commentSceneId: String(bgContext.scene.no),
        commentPartId: bgContext.part.id,
        mentionedBy: '테스트',
      },
    },
    {
      type: 'comment_reaction',
      title: '[테스트] 댓글 반응 알림',
      body: `${bgContext.scene.sceneId} 댓글 반응으로 이동`,
      metadata: {
        ...buildBaseMetadata(bgContext),
        commentId: 'dev-preview-comment',
        commentSceneId: String(bgContext.scene.no),
        commentPartId: bgContext.part.id,
        reactionNotificationId: 'dev-preview-reaction',
        reactionEmojis: ['✅'],
      },
    },
    {
      type: 'revision',
      title: '[테스트] 리비전 댓글 알림',
      body: `${bgContext.scene.sceneId} 리비전 탭으로 이동`,
      metadata: {
        ...buildBaseMetadata(bgContext),
        revisionId: 'dev-preview-revision',
        revisionAction: 'comment',
        commentId: 'dev-preview-revision-comment',
      },
    },
    {
      type: 'acting_feedback',
      title: '[테스트] 액팅 피드백 알림',
      body: `${actingContext.scene.sceneId} 피드백 씬으로 이동`,
      metadata: {
        ...buildBaseMetadata(actingContext),
        changedBy: '테스트',
        feedbackNotificationId: 'dev-preview-feedback',
        feedbackTransition: '작업중 → 피드백',
      },
    },
    {
      type: 'scene_assignment',
      title: '[테스트] 씬 배정 알림',
      body: `${actingContext.scene.sceneId} 배정 씬으로 이동`,
      metadata: {
        ...buildBaseMetadata(actingContext),
        changedBy: '테스트',
        assignmentNotificationId: 'dev-preview-assignment',
        assignmentTransition: '미배정 → 배한솔',
      },
    },
  ];
}

export async function addDevPreviewNotifications(): Promise<number> {
  const [{ useDataStore }, { useNotificationStore }] = await Promise.all([
    import('../stores/useDataStore.ts'),
    import('../stores/useNotificationStore.ts'),
  ]);
  const notifications = buildDevPreviewNotifications(useDataStore.getState().episodes);
  const store = useNotificationStore.getState();
  notifications.forEach((notification) => store.addNotification(notification));
  if (notifications.length > 0) store.setPanelOpen(true);
  return notifications.length;
}
