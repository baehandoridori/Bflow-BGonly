import type { CommentReadStateRow, Episode } from '../types/index.ts';
import type { CommentsStore, SceneComment } from '../services/commentService.ts';
import { buildSceneThreadKeyFromPartScene } from '../utils/commentThreadKey.ts';
import { buildUnifiedRevisionSceneKey } from '../utils/revisionSceneKey.ts';

export interface DevPreviewCommentRow {
  id: string;
  partId: string;
  sceneId: string;
  userId: string;
  userName: string;
  text: string;
  mentions: string[];
  images?: string[];
  createdAt: string;
  editedAt: string | null;
  revisionId?: string | null;
  parentCommentId?: string | null;
}

export interface DevPreviewRevisionRow {
  id: string;
  sceneKey: string;
  revisionNo: number;
  status: string;
  priority?: string;
  description: string;
  frameNo?: string;
  imageUrl: string;
  department: string;
  requesterId: string;
  requesterName: string;
  assignee: string;
  resolvedBy: string;
  resolvedNote: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string;
  notifyUserIds?: string[] | null;
  // 리테이크 허브 2단계 — 담당자 워크플로우 (preview 카드 검증용)
  assigneeIds?: string[];
  assigneeStates?: Record<string, { state: 'pending' | 'in_progress' | 'done'; note?: string; startedAt?: string; doneAt?: string }>;
  setId?: string | null;
  finalResolvedBy?: string;
  finalResolvedAt?: string;
}

export const DEV_PREVIEW_UNREAD_COMMENT_IDS = [
  'dev-preview-comment',
  'dev-preview-comment-unread-2',
  'dev-preview-comment-unread-reply',
  'dev-preview-comment-thread-followup',
];

export const DEV_PREVIEW_REVISION_ID = 'dev-preview-revision';
export const DEV_PREVIEW_REVISION_COMMENT_ID = 'dev-preview-revision-comment';
export const DEV_PREVIEW_RESOLVED_REVISION_ID = 'dev-preview-revision-resolved';

function findPart(episodes: Episode[], sheetName: string): Episode['parts'][number] | null {
  return episodes.flatMap((episode) => episode.parts).find((part) => part.sheetName === sheetName) ?? null;
}

function findScene(part: Episode['parts'][number] | null, sceneNo: number) {
  return part?.scenes.find((scene) => scene.no === sceneNo) ?? null;
}

function row(
  part: Episode['parts'][number] | null,
  sceneNo: number,
  id: string,
  userId: string,
  userName: string,
  text: string,
  mentions: string[],
  createdAt: string,
  extra: Pick<DevPreviewCommentRow, 'revisionId' | 'parentCommentId'> = {},
): DevPreviewCommentRow | null {
  if (!part?.id || !findScene(part, sceneNo)) return null;

  return {
    id,
    partId: part.id,
    sceneId: String(sceneNo),
    userId,
    userName,
    text,
    mentions,
    createdAt,
    editedAt: null,
    revisionId: extra.revisionId ?? null,
    parentCommentId: extra.parentCommentId ?? null,
  };
}

function compactRows<T>(rows: Array<T | null>): T[] {
  return rows.filter((item): item is T => !!item);
}

export function buildDevPreviewCommentRows(episodes: Episode[]): DevPreviewCommentRow[] {
  const aBg = findPart(episodes, 'EP05_A_BG');
  const aAct = findPart(episodes, 'EP05_A_ACT');
  const bBg = findPart(episodes, 'EP05_B_BG');

  return compactRows([
    row(
      aBg,
      1,
      'dev-preview-comment-seen',
      '7',
      '원동우',
      '초기 톤은 이 방향으로 맞춰두었습니다. 이후 코멘트부터는 아직 읽지 않은 상태로 보이게 둡니다.',
      [],
      '2026-06-05T09:05:00+09:00',
    ),
    row(
      aBg,
      1,
      'dev-preview-comment',
      '8',
      '이혜민',
      '@배한솔 a001 캐릭터 발밑 그림자가 살짝 떠 보여요. 이 댓글은 테스트 알림에서 바로 이동되는 미읽음 댓글입니다.',
      ['배한솔'],
      '2026-06-05T10:05:00+09:00',
    ),
    row(
      aBg,
      1,
      'dev-preview-comment-unread-2',
      '5',
      '강선영',
      '가이드 이미지 기준으로 골목 안쪽 채도만 조금 낮추면 컷 연결이 자연스러울 것 같습니다.',
      [],
      '2026-06-05T10:12:00+09:00',
    ),
    row(
      aBg,
      1,
      'dev-preview-comment-unread-reply',
      '10',
      '김어진',
      '위 코멘트에 이어서, 수정 후에는 액팅 a001도 같이 확인해 주세요.',
      [],
      '2026-06-05T10:18:00+09:00',
      { parentCommentId: 'dev-preview-comment-unread-2' },
    ),
    row(
      aBg,
      1,
      'dev-preview-comment-thread-followup',
      '6',
      '박정인',
      '@김어진 네, 액팅 손 위치도 같이 체크해둘게요. 대댓글에 답글을 달아도 같은 스레드 아래로 모이는 테스트 댓글입니다.',
      ['김어진'],
      '2026-06-05T10:20:00+09:00',
      { parentCommentId: 'dev-preview-comment-unread-2' },
    ),
    row(
      aAct,
      1,
      'dev-preview-acting-comment-unread',
      '9',
      '이다은',
      '@배한솔 액팅 a001은 리테이크 1차 기준으로 손 위치만 다시 확인하면 될 것 같습니다.',
      ['배한솔'],
      '2026-06-05T10:22:00+09:00',
    ),
    row(
      aBg,
      1,
      DEV_PREVIEW_REVISION_COMMENT_ID,
      '6',
      '박정인',
      '리테이크 쪽 확인 댓글입니다. 리테이크 댓글 알림 테스트에서 이 id를 사용합니다.',
      [],
      '2026-06-05T10:27:00+09:00',
      { revisionId: DEV_PREVIEW_REVISION_ID },
    ),
    row(
      bBg,
      2,
      'dev-preview-b002-comment',
      '11',
      '류이레',
      'b002도 새 댓글 뱃지 확인용으로 남겨둔 테스트 코멘트입니다.',
      [],
      '2026-06-05T10:35:00+09:00',
    ),
  ]);
}

export function buildDevPreviewRevisionRows(episodes: Episode[]): DevPreviewRevisionRow[] {
  const aBg = findPart(episodes, 'EP05_A_BG');
  const a001 = findScene(aBg, 1);
  if (!aBg || !a001) return [];

  const sceneKey = buildUnifiedRevisionSceneKey(aBg.sheetName, a001.sceneId, {
    siblingSceneIds: aBg.scenes.map((scene) => scene.sceneId),
  });

  return [
    {
      id: DEV_PREVIEW_REVISION_ID,
      sceneKey,
      revisionNo: 1,
      status: 'in_progress',
      priority: 'normal',
      description: '[테스트] 리테이크 댓글 알림이 이 카드로 이동합니다. 카드 안 댓글 스레드에서 새 댓글 강조를 확인하세요.',
      frameNo: '',
      imageUrl: '',
      department: 'bg',
      requesterId: '5',
      requesterName: '강선영',
      assignee: '',
      resolvedBy: '',
      resolvedNote: '',
      createdAt: '2026-06-05T10:24:00+09:00',
      updatedAt: '2026-06-05T10:26:00+09:00',
      resolvedAt: '',
      notifyUserIds: ['1', '6', '7', '8'],
    },
    {
      id: DEV_PREVIEW_RESOLVED_REVISION_ID,
      sceneKey,
      revisionNo: 2,
      status: 'resolved',
      priority: 'normal',
      description: '[테스트] 라이트 모드 댓글창에서 완료 리테이크 문구 대비를 확인하는 샘플입니다.',
      frameNo: '',
      imageUrl: '',
      department: 'bg',
      requesterId: '8',
      requesterName: '이혜민',
      assignee: '',
      resolvedBy: '배한솔',
      resolvedNote: '라이트 모드에서 완료 문구가 선명하게 보이는지 확인했습니다.',
      createdAt: '2026-06-05T10:28:00+09:00',
      updatedAt: '2026-06-05T10:31:00+09:00',
      resolvedAt: '2026-06-05T10:31:00+09:00',
      notifyUserIds: ['1', '6', '8'],
    },
  ];
}

function collectPartsById(episodes: Episode[]): Map<string, Episode['parts'][number]> {
  const parts = new Map<string, Episode['parts'][number]>();
  for (const part of episodes.flatMap((episode) => episode.parts)) {
    if (part.id) parts.set(part.id, part);
  }
  return parts;
}

export function buildDevPreviewLocalCommentStore(episodes: Episode[]): CommentsStore {
  const partsById = collectPartsById(episodes);
  const store: CommentsStore = {};

  for (const comment of buildDevPreviewCommentRows(episodes)) {
    const part = partsById.get(comment.partId);
    if (!part) continue;

    const sceneKey = `${part.sheetName}:${comment.sceneId}`;
    const localComment: SceneComment = {
      id: comment.id,
      userId: comment.userId,
      userName: comment.userName,
      text: comment.text,
      mentions: comment.mentions,
      images: comment.images,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt ?? undefined,
      revisionId: comment.revisionId ?? null,
      parentCommentId: comment.parentCommentId ?? null,
      storageKey: sceneKey,
    };

    if (!store[sceneKey]) store[sceneKey] = [];
    store[sceneKey].push(localComment);
  }

  return store;
}

export function buildDevPreviewCommentReadStates(
  userId: string,
  episodes: Episode[],
): CommentReadStateRow[] {
  const aBg = findPart(episodes, 'EP05_A_BG');
  const aAct = findPart(episodes, 'EP05_A_ACT');
  const bBg = findPart(episodes, 'EP05_B_BG');
  const a001 = findScene(aBg, 1);
  const actA001 = findScene(aAct, 1);
  const b002 = findScene(bBg, 2);
  const now = '2026-06-05T09:40:00+09:00';

  return compactRows([
    aBg && a001 ? {
      userId,
      sceneThreadKey: buildSceneThreadKeyFromPartScene(episodes, aBg, a001, 'EP05_A_BG:1'),
      lastReadAt: now,
      updatedAt: now,
    } : null,
    aAct && actA001 ? {
      userId,
      sceneThreadKey: buildSceneThreadKeyFromPartScene(episodes, aAct, actA001, 'EP05_A_ACT:1'),
      lastReadAt: now,
      updatedAt: now,
    } : null,
    bBg && b002 ? {
      userId,
      sceneThreadKey: buildSceneThreadKeyFromPartScene(episodes, bBg, b002, 'EP05_B_BG:2'),
      lastReadAt: '2026-06-05T10:00:00+09:00',
      updatedAt: '2026-06-05T10:00:00+09:00',
    } : null,
  ] as Array<CommentReadStateRow | null>);
}
