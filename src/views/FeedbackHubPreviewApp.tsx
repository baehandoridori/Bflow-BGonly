import { useEffect, useMemo } from 'react';

import { GradientBackdrop } from '@/components/common/GradientBackdrop';
import { MainLayout } from '@/components/layout/MainLayout';
import { SvgIconDefs } from '@/components/SvgIconDefs';
import { GlobalTooltipProvider } from '@/components/ui/GlobalTooltip';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDataStore } from '@/stores/useDataStore';
import { useActivityStore } from '@/stores/useActivityStore';
import { type CreateRevisionInput, useRevisionStore } from '@/stores/useRevisionStore';
import {
  hydrateLocalCommentsForPreview,
  setCommentsSheetsMode,
  type SceneComment,
} from '@/services/commentService';
import {
  COMMENT_READ_STATE_EVENT,
  primeCommentReadStateForUser,
} from '@/services/commentReadStateService';
import { buildOpenRevisionCountMap, buildSceneKey } from '@/services/revisionService';
import { buildSceneThreadKeyFromRevisionKey } from '@/utils/commentThreadKey';
import CompositingView from './CompositingView';
import { ScenesView } from './ScenesView';
import type { Activity, AppUser, CompRevision, Episode, RevisionStatus, Scene } from '@/types';

const previewUsers: AppUser[] = [
  {
    id: 'preview-user-baehan',
    name: '배한',
    slackId: 'U_PREVIEW_BAE',
    isInitialPassword: false,
    role: 'admin',
    isCompositor: true,
    createdAt: '2026-05-01T00:00:00+09:00',
  },
  {
    id: 'preview-user-seoyeon',
    name: '서연',
    slackId: 'U_PREVIEW_SEO',
    isInitialPassword: false,
    role: 'user',
    isCompositor: true,
    createdAt: '2026-05-01T00:00:00+09:00',
  },
  {
    id: 'preview-user-minji',
    name: '민지',
    slackId: 'U_PREVIEW_MIN',
    isInitialPassword: false,
    role: 'user',
    createdAt: '2026-05-01T00:00:00+09:00',
  },
  {
    id: 'preview-user-hansol',
    name: '한솔',
    slackId: 'U_PREVIEW_HAN',
    isInitialPassword: false,
    role: 'admin',
    isActingSupervisor: true,
    createdAt: '2026-05-01T00:00:00+09:00',
  },
];

const scene = (
  scope: string,
  no: number,
  sceneId: string,
  memo: string,
  assignee: string,
  done = false,
): Scene => ({
  id: `preview-scene-${scope}-${sceneId}`,
  no,
  sceneId,
  memo,
  storyboardUrl: '',
  guideUrl: '',
  assignee,
  layoutId: '',
  lo: done,
  done,
  review: done,
  png: done,
  sceneState: done ? 'done' : 'work',
  workRound: done ? 0 : 1,
  feedbackRound: 0,
  durationFrames: 96 + no * 8,
  createdAt: '2026-05-20T10:00:00+09:00',
  updatedAt: done ? '2026-05-27T17:40:00+09:00' : '2026-05-28T09:20:00+09:00',
});

const previewEpisodes: Episode[] = [
  {
    episodeNumber: 5,
    title: 'EP.05',
    parts: [
      {
        partId: 'A',
        department: 'bg',
        sheetName: 'EP05_A_BG',
        scenes: [
          scene('ep05-a-bg', 1, 'a001', '학교 앞 골목 낮 배경', '배한'),
          scene('ep05-a-bg', 2, 'a002', '교실 창가 오후 톤', '서연', true),
          scene('ep05-a-bg', 3, 'a003', '옥상 역광 컷', '민지'),
        ],
      },
      {
        partId: 'A',
        department: 'acting',
        sheetName: 'EP05_A_ACT',
        scenes: [
          scene('ep05-a-act', 1, 'a001', '학교 앞 골목 낮 연기', '한솔'),
          scene('ep05-a-act', 2, 'a002', '교실 창가 표정 리액션', '민지', true),
          scene('ep05-a-act', 4, 'a004', '계단 합류 액팅', '서연'),
        ],
      },
      {
        partId: 'B',
        department: 'bg',
        sheetName: 'EP05_B_BG',
        scenes: [
          scene('ep05-b-bg', 1, 'b001', '복도 전환 컷', '민지'),
          scene('ep05-b-bg', 2, 'b002', '급식실 와이드', '배한'),
        ],
      },
    ],
  },
  {
    episodeNumber: 6,
    title: 'EP.06',
    parts: [
      {
        partId: 'A',
        department: 'bg',
        sheetName: 'EP06_A_BG',
        scenes: [
          scene('ep06-a-bg', 1, 'a001', '운동장 롱샷', '서연'),
          scene('ep06-a-bg', 2, 'a002', '창고 문 앞', '배한'),
        ],
      },
      {
        partId: 'B',
        department: 'acting',
        sheetName: 'EP06_B_ACT',
        scenes: [
          scene('ep06-b-act', 3, 'b003', '친구 등장 리액션', '한솔', true),
        ],
      },
    ],
  },
];

const key = (sheetName: string, sceneId: string) => buildSceneKey(sheetName, sceneId);

const previewRevisions: CompRevision[] = [
  {
    id: 'preview-rev-ep05-a001-1',
    sceneKey: key('EP05_A_BG', 'a001'),
    revisionNo: 1,
    status: 'open',
    priority: 'high',
    description: '골목 입구 그림자 경계가 너무 딱 끊겨 보여서, 캐릭터 동선 주변만 부드럽게 풀어주세요.',
    frameNo: 'F024',
    department: 'bg',
    requesterId: 'preview-user-hansol',
    requesterName: '한솔',
    assignee: '배한',
    notifyUserIds: ['preview-user-baehan', 'preview-user-seoyeon'],
    createdAt: '2026-05-28T07:35:00+09:00',
    updatedAt: '2026-05-28T07:35:00+09:00',
  },
  {
    id: 'preview-rev-ep05-a001-2',
    sceneKey: key('EP05_A_ACT', 'a001'),
    revisionNo: 2,
    status: 'in_progress',
    priority: 'normal',
    description: 'rel 2 기준으로 캐릭터 발 위치와 배경 원근이 살짝 어긋납니다. 바닥선만 맞춰주세요.',
    frameNo: 'F048',
    department: 'acting',
    requesterId: 'preview-user-seoyeon',
    requesterName: '서연',
    assignee: '배한',
    notifyUserIds: ['preview-user-baehan', 'preview-user-minji'],
    createdAt: '2026-05-27T18:20:00+09:00',
    updatedAt: '2026-05-28T08:10:00+09:00',
  },
  {
    id: 'preview-rev-ep05-a002-1',
    sceneKey: key('EP05_A_BG', 'a002'),
    revisionNo: 1,
    status: 'resolved',
    priority: 'normal',
    description: '교실 창가 오후 톤이 전 컷보다 차갑습니다. 노란 하이라이트를 조금만 더 올려주세요.',
    frameNo: 'F012',
    department: 'bg',
    requesterId: 'preview-user-minji',
    requesterName: '민지',
    assignee: '서연',
    resolvedBy: '서연',
    resolvedAt: '2026-05-27T17:40:00+09:00',
    resolvedNote: '노출과 하이라이트를 반영했습니다.',
    notifyUserIds: ['preview-user-seoyeon', 'preview-user-baehan'],
    createdAt: '2026-05-26T14:00:00+09:00',
    updatedAt: '2026-05-27T17:40:00+09:00',
  },
  {
    id: 'preview-rev-ep05-b001-1',
    sceneKey: key('EP05_B_BG', 'b001'),
    revisionNo: 1,
    status: 'open',
    priority: 'normal',
    description: '복도 전환 컷 첫 프레임에서 문틀 실루엣이 캐릭터와 붙어 보여요. 좌측만 조금 분리해주세요.',
    frameNo: 'F001',
    department: 'bg',
    requesterId: 'preview-user-baehan',
    requesterName: '배한',
    assignee: '민지',
    notifyUserIds: ['preview-user-minji', 'preview-user-seoyeon'],
    createdAt: '2026-05-28T09:05:00+09:00',
    updatedAt: '2026-05-28T09:05:00+09:00',
  },
  {
    id: 'preview-rev-ep06-a001-1',
    sceneKey: key('EP06_A_BG', 'a001'),
    revisionNo: 1,
    status: 'open',
    priority: 'urgent',
    description: '운동장 롱샷은 오늘 검수 대상입니다. 구름 레이어가 캐릭터 머리 위로 너무 밝게 지나갑니다.',
    frameNo: 'F072',
    department: 'bg',
    requesterId: 'preview-user-hansol',
    requesterName: '한솔',
    assignee: '배한',
    notifyUserIds: ['preview-user-baehan', 'preview-user-seoyeon', 'preview-user-minji'],
    createdAt: '2026-05-28T10:15:00+09:00',
    updatedAt: '2026-05-28T10:15:00+09:00',
  },
  {
    id: 'preview-rev-ep06-b003-1',
    sceneKey: key('EP06_B_ACT', 'b003'),
    revisionNo: 1,
    status: 'resolved',
    priority: 'normal',
    description: '친구 등장 리액션에서 눈 깜빡임 타이밍이 빠릅니다. 2프레임 늦춰주세요.',
    frameNo: 'F036',
    department: 'acting',
    requesterId: 'preview-user-baehan',
    requesterName: '배한',
    assignee: '한솔',
    resolvedBy: '한솔',
    resolvedAt: '2026-05-28T11:20:00+09:00',
    resolvedNote: '타이밍 수정 완료.',
    notifyUserIds: ['preview-user-hansol', 'preview-user-baehan'],
    createdAt: '2026-05-27T12:00:00+09:00',
    updatedAt: '2026-05-28T11:20:00+09:00',
  },
];

const previewCommentCounts = new Map<string, number>([
  ['preview-rev-ep05-a001-1', 3],
  ['preview-rev-ep05-a001-2', 1],
  ['preview-rev-ep05-a002-1', 1],
  ['preview-rev-ep05-b001-1', 0],
  ['preview-rev-ep06-a001-1', 2],
  ['preview-rev-ep06-b003-1', 1],
]);

const previewCommentSeen = new Map<string, boolean>([
  ['preview-rev-ep05-a001-2', true],
  ['preview-rev-ep05-a002-1', true],
  ['preview-rev-ep06-b003-1', true],
]);

const previewCommentReadState: Record<string, string> = {
  [buildSceneThreadKeyFromRevisionKey(key('EP05_A_BG', 'a001'))]: '2026-05-28T08:20:00+09:00',
  [buildSceneThreadKeyFromRevisionKey(key('EP05_A_BG', 'a002'))]: '2026-05-27T18:00:00+09:00',
  [buildSceneThreadKeyFromRevisionKey(key('EP06_B_ACT', 'b003'))]: '2026-05-28T11:40:00+09:00',
};

const comment = (
  id: string,
  userId: string,
  userName: string,
  text: string,
  createdAt: string,
  revisionId?: string,
): SceneComment => ({
  id,
  userId,
  userName,
  text,
  mentions: [],
  createdAt,
  revisionId: revisionId ?? null,
});

const previewComments: Record<string, SceneComment[]> = {
  'EP05_A_BG:1': [
    comment(
      'preview-comment-a001-r1-1',
      'preview-user-baehan',
      '배한',
      '그림자 경계는 캐릭터 발 주변만 feather를 더 주면 될 것 같습니다.',
      '2026-05-28T07:48:00+09:00',
      'preview-rev-ep05-a001-1',
    ),
    comment(
      'preview-comment-a001-r1-2',
      'preview-user-hansol',
      '한솔',
      '톤은 유지하고 경계만 부드럽게 풀어주세요. 전체 노출은 그대로 갑니다.',
      '2026-05-28T08:02:00+09:00',
      'preview-rev-ep05-a001-1',
    ),
    comment(
      'preview-comment-a001-r1-3',
      'preview-user-seoyeon',
      '서연',
      '수정 후 rel 2에 같이 반영되는지 확인하겠습니다.',
      '2026-05-28T08:14:00+09:00',
      'preview-rev-ep05-a001-1',
    ),
    comment(
      'preview-comment-a001-r2-1',
      'preview-user-seoyeon',
      '서연',
      '발 위치 기준선은 맞췄고, 원근 보정만 진행 중입니다.',
      '2026-05-28T08:25:00+09:00',
      'preview-rev-ep05-a001-2',
    ),
  ],
  'EP05_A_BG:2': [
    comment(
      'preview-comment-a002-r1-1',
      'preview-user-minji',
      '민지',
      '완료 확인했습니다. 다음 컷과 톤 연결도 자연스럽습니다.',
      '2026-05-27T17:52:00+09:00',
      'preview-rev-ep05-a002-1',
    ),
  ],
  'EP06_A_BG:1': [
    comment(
      'preview-comment-ep06-a001-r1-1',
      'preview-user-hansol',
      '한솔',
      '구름 레이어는 머리 위 라인만 낮추면 됩니다.',
      '2026-05-28T10:22:00+09:00',
      'preview-rev-ep06-a001-1',
    ),
    comment(
      'preview-comment-ep06-a001-r1-2',
      'preview-user-baehan',
      '배한',
      '오전 중 반영하고 상태 변경해두겠습니다.',
      '2026-05-28T10:31:00+09:00',
      'preview-rev-ep06-a001-1',
    ),
  ],
  'EP06_B_ACT:3': [
    comment(
      'preview-comment-ep06-b003-r1-1',
      'preview-user-hansol',
      '한솔',
      '타이밍 수정 완료했고 리액션 컷 흐름도 확인했습니다.',
      '2026-05-28T11:24:00+09:00',
      'preview-rev-ep06-b003-1',
    ),
  ],
};

function countOpenRevisions(revisions: CompRevision[]): number {
  return revisions.filter((revision) => revision.status !== 'resolved').length;
}

function findPreviewSceneContext(
  sceneKey: string,
  preferredDepartment?: string,
): {
  episode: Episode;
  part: Episode['parts'][number];
  scene: Scene;
} | null {
  let fallback: { episode: Episode; part: Episode['parts'][number]; scene: Scene } | null = null;

  for (const episode of previewEpisodes) {
    for (const part of episode.parts) {
      for (const previewScene of part.scenes) {
        if (key(part.sheetName, previewScene.sceneId) !== sceneKey) continue;
        const match = { episode, part, scene: previewScene };
        if (!fallback) fallback = match;
        if (!preferredDepartment || part.department === preferredDepartment) return match;
      }
    }
  }

  return fallback;
}

function makePreviewActivity(
  revision: CompRevision,
  actionType: 'revision_add' | 'revision_in_progress' | 'revision_resolve',
  createdAt: string,
  actor?: string | { userId: string; userName: string },
  resolvedNote?: string,
): Activity {
  const context = findPreviewSceneContext(revision.sceneKey, revision.department);
  const actorUserId = typeof actor === 'object' ? actor.userId : revision.requesterId;
  const actorUserName = typeof actor === 'object' ? actor.userName : actor ?? revision.requesterName;

  return {
    id: `preview-activity-${actionType}-${revision.id}-${createdAt}`,
    userId: actorUserId,
    userName: actorUserName,
    actionType,
    actionGroup: 'memo',
    sceneId: context?.scene.id ?? null,
    sceneLabel: context ? `${context.episode.title} ${context.part.partId} ${context.scene.sceneId}` : null,
    episodeNumber: context?.episode.episodeNumber ?? null,
    department: (revision.department === 'bg' || revision.department === 'acting')
      ? revision.department
      : context?.part.department ?? null,
    detail: {
      revisionId: revision.id,
      revisionNumber: revision.revisionNo,
      descriptionPreview: revision.description,
      resolvedNote,
    },
    createdAt,
  };
}

const revById = (id: string) => previewRevisions.find((revision) => revision.id === id)!;

const previewActivities: Activity[] = [
  makePreviewActivity(revById('preview-rev-ep05-a001-1'), 'revision_add', '2026-05-28T07:35:00+09:00'),
  makePreviewActivity(revById('preview-rev-ep05-a001-2'), 'revision_add', '2026-05-27T18:20:00+09:00'),
  makePreviewActivity(revById('preview-rev-ep05-a001-2'), 'revision_in_progress', '2026-05-28T08:10:00+09:00', '배한'),
  makePreviewActivity(
    revById('preview-rev-ep05-a002-1'),
    'revision_add',
    '2026-05-28T07:37:00+09:00',
    { userId: 'preview-user-hansol', userName: '한솔' },
  ),
  makePreviewActivity(revById('preview-rev-ep05-a002-1'), 'revision_in_progress', '2026-05-27T10:35:00+09:00', '서연'),
  makePreviewActivity(
    revById('preview-rev-ep05-a002-1'),
    'revision_resolve',
    '2026-05-27T17:40:00+09:00',
    '서연',
    '노출과 하이라이트를 반영했습니다.',
  ),
  makePreviewActivity(revById('preview-rev-ep06-a001-1'), 'revision_add', '2026-05-28T10:15:00+09:00'),
  makePreviewActivity(
    revById('preview-rev-ep06-b003-1'),
    'revision_resolve',
    '2026-05-28T11:20:00+09:00',
    '한솔',
    '타이밍 수정 완료.',
  ),
].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

function prependPreviewActivity(activity: Activity) {
  useActivityStore.setState((state) => ({
    activities: [activity, ...state.activities.filter((item) => item.id !== activity.id)]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    lastSeenCreatedAt: activity.createdAt,
    isLoading: false,
    error: null,
  }));
}

function nextRevisionNo(sceneKey: string): number {
  const existing = useRevisionStore.getState().revisions.filter((revision) => revision.sceneKey === sceneKey);
  return existing.reduce((max, revision) => Math.max(max, revision.revisionNo), 0) + 1;
}

function setPreviewRevisions(revisions: CompRevision[]) {
  useRevisionStore.setState({
    revisions,
    revisionCountByScene: buildOpenRevisionCountMap(revisions),
    totalOpenRevisionCount: countOpenRevisions(revisions),
    isLoading: false,
    lastLoadTime: Date.now(),
  });
}

function seedFeedbackHubPreview() {
  const previewFlow = new URLSearchParams(window.location.search).get('flow');
  const openRetakeCommentThread = previewFlow === 'retake-comment-thread';

  useAuthStore.setState({
    currentUser: previewUsers[0],
    users: previewUsers,
    authReady: true,
    isAdminMode: true,
  });
  useDataStore.getState().setEpisodes(previewEpisodes);
  useDataStore.getState().setEpisodeTitles({
    5: 'EP.05',
    6: 'EP.06',
  });
  useDataStore.getState().setEpisodeMemos({
    5: '리테이크 허브 메인 플로우 확인용 더미 에피소드',
    6: '에피소드 필터와 상태 전환 확인용 더미 에피소드',
  });
  useAppStore.setState({
    currentView: openRetakeCommentThread ? 'scenes' : 'compositing-revisions',
    selectedEpisode: openRetakeCommentThread ? 5 : null,
    selectedPart: openRetakeCommentThread ? 'A' : null,
    selectedDepartment: 'all',
    dashboardDeptFilter: 'all',
    pendingSceneModalRequest: openRetakeCommentThread
      ? {
        sceneName: 'a001',
        episodeNumber: 5,
        partId: 'A',
        initialTab: 'revisions',
        focusRevisionId: 'preview-rev-ep05-a001-1',
        forceDeptFilter: 'all',
      }
      : null,
    dataConnected: false,
    activeDataSource: 'supabase',
    colorMode: 'dark',
    toast: null,
  });
  setCommentsSheetsMode(false);
  hydrateLocalCommentsForPreview(previewComments);
  primeCommentReadStateForUser(previewUsers[0].id, previewCommentReadState);
  window.dispatchEvent(new CustomEvent(COMMENT_READ_STATE_EVENT, {
    detail: { userId: previewUsers[0].id },
  }));
  useActivityStore.setState({
    activities: previewActivities,
    lastSeenCreatedAt: previewActivities[0]?.createdAt ?? null,
    isLoading: false,
    error: null,
    hasMore: false,
  });
  setPreviewRevisions(previewRevisions);
  useRevisionStore.setState({
    loadRevisions: async () => {
      setPreviewRevisions(useRevisionStore.getState().revisions);
    },
    createRevision: async (input: CreateRevisionInput) => {
      const now = new Date().toISOString();
      // 허브 '전반' 항목은 sceneKey 미지정 → '' (특정 씬에 안 매임).
      const sceneKey = input.sceneKey ?? '';
      const context = findPreviewSceneContext(sceneKey, input.department);
      const revision: CompRevision = {
        id: `preview-rev-${Date.now()}`,
        sceneKey,
        revisionNo: nextRevisionNo(sceneKey),
        status: 'open',
        priority: 'normal',
        description: input.description,
        imageUrl: input.imageUrl,
        department: input.department,
        requesterId: input.requesterId,
        requesterName: input.requesterName,
        assignee: context?.scene.assignee,
        notifyUserIds: input.notifyUserIds,
        assigneeIds: input.assigneeIds,
        setId: input.setId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      useRevisionStore.getState().addRevisionOptimistic(revision);
      prependPreviewActivity(makePreviewActivity(revision, 'revision_add', now, input.requesterName));
      return revision;
    },
    updateStatus: async (
      id: string,
      sceneKey: string,
      status: RevisionStatus,
      extra?: { resolvedBy?: string; resolvedNote?: string },
    ) => {
      const now = new Date().toISOString();
      const existing = useRevisionStore.getState().revisions.find((revision) => revision.id === id);
      useRevisionStore.getState().updateRevisionOptimistic(id, sceneKey, {
        status,
        updatedAt: now,
        ...(status === 'resolved'
          ? { resolvedAt: now, resolvedBy: extra?.resolvedBy, resolvedNote: extra?.resolvedNote }
          : { resolvedAt: undefined, resolvedBy: undefined, resolvedNote: undefined }),
      });
      if (existing && status === 'in_progress') {
        prependPreviewActivity(makePreviewActivity(existing, 'revision_in_progress', now, extra?.resolvedBy ?? useAuthStore.getState().currentUser?.name));
      }
      if (existing && status === 'resolved') {
        prependPreviewActivity(makePreviewActivity(existing, 'revision_resolve', now, extra?.resolvedBy ?? useAuthStore.getState().currentUser?.name, extra?.resolvedNote));
      }
    },
  });
}

export function FeedbackHubPreviewApp() {
  useMemo(() => seedFeedbackHubPreview(), []);
  const currentView = useAppStore((s) => s.currentView);

  useEffect(() => {
    document.title = 'B flow - 리테이크 허브 프리뷰';
  }, []);

  return (
    <>
      <SvgIconDefs />
      <GradientBackdrop enabled intensity="normal" />
      <MainLayout onRefresh={seedFeedbackHubPreview}>
        {currentView === 'scenes' ? (
          <ScenesView />
        ) : (
          <CompositingView
            previewMode
            previewCommentCountByRev={previewCommentCounts}
            previewCommentSeenByRev={previewCommentSeen}
          />
        )}
      </MainLayout>
      <GlobalTooltipProvider />
    </>
  );
}
