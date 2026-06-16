import type { Episode } from '../types';
import type { AppNotification } from '../stores/useNotificationStore';
import { buildNotificationSceneDisplayLabel } from './notificationEpisodeLabels.ts';

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

function buildSceneLabel(context: SceneContext, episodeTitles: Record<number, string>): string {
  return buildNotificationSceneDisplayLabel({
    episodeNumber: context.episode.episodeNumber,
    partId: context.part.partId,
    sceneId: context.scene.sceneId,
    episodeTitles,
    episodes: [context.episode],
  });
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

export function buildDevPreviewNotifications(
  episodes: Episode[],
  episodeTitles: Record<number, string> = {},
): DraftNotification[] {
  const bgContext = findSceneContext(episodes, 'bg') ?? findSceneContext(episodes);
  const actingContext = findSceneContext(episodes, 'acting') ?? bgContext;
  if (!bgContext || !actingContext) return [];
  const bgLabel = buildSceneLabel(bgContext, episodeTitles);
  const actingLabel = buildSceneLabel(actingContext, episodeTitles);

  return [
    {
      type: 'mention',
      title: '[테스트] 댓글 멘션 알림',
      body: `${bgLabel} 댓글로 이동`,
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
      body: `${bgLabel} 댓글 반응으로 이동`,
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
      title: '[테스트] 리테이크 생성 알림',
      body: `${bgLabel} 32번 리테이크가 생성됨`,
      metadata: {
        ...buildBaseMetadata(bgContext),
        revisionId: 'dev-preview-retake-lifecycle',
        revisionAction: 'add',
      },
    },
    {
      type: 'revision',
      title: '[테스트] 리테이크 진행중 알림',
      body: `${bgLabel} 32번 리테이크가 진행중으로 변경됨`,
      metadata: {
        ...buildBaseMetadata(bgContext),
        revisionId: 'dev-preview-retake-lifecycle',
        revisionAction: 'in_progress',
      },
    },
    {
      type: 'revision',
      title: '[테스트] 리테이크 완료 알림',
      body: `${bgLabel} 32번 리테이크가 완료됨`,
      metadata: {
        ...buildBaseMetadata(bgContext),
        revisionId: 'dev-preview-retake-lifecycle',
        revisionAction: 'resolve',
      },
    },
    {
      type: 'revision',
      title: '[테스트] 리테이크 댓글 알림',
      body: `${bgLabel} 리테이크 탭으로 이동`,
      metadata: {
        ...buildBaseMetadata(bgContext),
        revisionId: 'dev-preview-revision',
        revisionAction: 'comment',
        commentId: 'dev-preview-revision-comment',
      },
    },
    {
      type: 'acting_feedback',
      title: '[테스트] 액팅 리테이크 알림',
      body: `${actingLabel} 리테이크 씬으로 이동`,
      metadata: {
        ...buildBaseMetadata(actingContext),
        changedBy: '테스트',
        feedbackNotificationId: 'dev-preview-feedback',
        feedbackTransition: '작업중 → 리테이크',
      },
    },
    {
      type: 'scene_assignment',
      title: '[테스트] 씬 배정 알림',
      body: `${actingLabel} 배정 씬으로 이동`,
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
  const { episodes, episodeTitles } = useDataStore.getState();
  const notifications = buildDevPreviewNotifications(episodes, episodeTitles);
  const store = useNotificationStore.getState();
  notifications.forEach((notification) => store.addNotification(notification));
  if (notifications.length > 0) store.setPanelOpen(true);
  return notifications.length;
}
