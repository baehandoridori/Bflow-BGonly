/**
 * 씬 댓글 알림 '받는 사람' — 서버 함수 comment_notifications_recipients 의 TypeScript 짝(씬 댓글 B안 PR 6).
 *
 * 운영에서는 서버가 댓글 저장 순간에 계산한다(DEVLOG/migrations/2026-11-05-comment-notifications.sql).
 * 이 파일은 미리보기(?preview=1)가 같은 규칙으로 줄을 만들 때 쓰고, tests/commentNotificationsDatabase.test.ts 가
 * 같은 예제로 SQL 과 결과를 대조한다 — 규칙을 바꾸면 두 곳을 함께 바꾼다.
 *
 * 규칙(한 사람은 한 댓글에 가장 강한 이유 한 줄):
 *   캐릭터 댓글: mention 만. 리테이크 댓글: mention → retake(요청자·알림 대상, 담당자는 알림 대상 안에 있을 때만).
 *   일반 댓글: mention → reply(원댓글 작성자) → auto(담당 > 상대 부서 담당 > 그 씬·상대 부서 같은 씬에 댓글 단 사람).
 *   자동은 활성 에피소드·활성 파트의 씬만. 작성자 본인과 users 에 없는 사람은 뺀다. 이름이 같으면 모두 받는다.
 * 런타임 import 가 없다.
 */

import type { CommentNotificationDetail, CommentNotificationReason } from './commentNotification.ts';

export interface RecipientWorldUser { id: string; name: string }
export interface RecipientWorldEpisode { id: string; active: boolean }
export interface RecipientWorldPart {
  id: string;
  episodeId: string;
  /** 파트 글자('A'). */
  partLetter: string;
  /** 'bg' | 'acting'. */
  department: string;
  active: boolean;
}
export interface RecipientWorldScene {
  id: string;
  partId: string;
  sceneNumber: string;
  sortOrder: number;
  assignee: string | null;
}
export interface RecipientWorldComment {
  id: string;
  userId: string;
  partId: string | null;
  /** 씬 순서 글자. */
  sceneId: string | null;
  sceneUuid: string | null;
  mentions: unknown;
  parentCommentId: string | null;
  revisionId: string | null;
  characterId: string | null;
}
export interface RecipientWorldRevision {
  id: string;
  requesterId: string | null;
  assigneeIds: unknown;
  notifyUserIds: unknown;
}
export interface RecipientWorld {
  users: readonly RecipientWorldUser[];
  episodes: readonly RecipientWorldEpisode[];
  parts: readonly RecipientWorldPart[];
  scenes: readonly RecipientWorldScene[];
  comments: readonly RecipientWorldComment[];
  revisions: readonly RecipientWorldRevision[];
}

export interface CommentNotificationRecipient {
  recipientId: string;
  reason: CommentNotificationReason;
  detail: CommentNotificationDetail | null;
}

/** SQL comment_notifications_names: 배열 안의 빈 글자 아닌 글자만. */
export function notificationNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];
}

/** SQL btrim(x) — 앞뒤 '공백 문자'만(탭·줄바꿈은 그대로). */
const btrim = (value: string): string => value.replace(/^ +| +$/g, '');
const ASSIGNEE_SPLIT = /[,、，]/;

function sceneNo(sceneId: string | null): number | null {
  if (sceneId == null) return null;
  const trimmed = btrim(sceneId);
  return /^-?[0-9]{1,9}$/.test(trimmed) ? Number(trimmed) : null;
}

/** 새 댓글 하나의 받는 사람(받는 사람 id 순). */
export function commentNotificationRecipients(world: RecipientWorld, commentId: string): CommentNotificationRecipient[] {
  const comment = world.comments.find((item) => item.id === commentId);
  if (!comment) return [];
  const usersById = new Set(world.users.map((user) => user.id));
  const idsByName = (name: string) => world.users.filter((user) => user.name === name).map((user) => user.id);
  const candidates: Array<CommentNotificationRecipient & { rank: number }> = [];
  const push = (recipientId: string | null | undefined, reason: CommentNotificationReason, detail: CommentNotificationDetail | null, rank: number) => {
    if (recipientId) candidates.push({ recipientId, reason, detail, rank });
  };

  for (const name of notificationNames(comment.mentions)) for (const id of idsByName(name)) push(id, 'mention', null, 1);

  if (!comment.characterId && !comment.revisionId && comment.parentCommentId) {
    const parent = world.comments.find((item) => item.id === comment.parentCommentId);
    push(parent?.userId, 'reply', null, 2);
  }

  if (!comment.characterId && comment.revisionId) {
    const revision = world.revisions.find((item) => item.id === comment.revisionId);
    if (revision) {
      const notify = notificationNames(revision.notifyUserIds);
      push(revision.requesterId, 'retake', null, 2);
      for (const id of notify) push(id, 'retake', null, 2);
      for (const id of notificationNames(revision.assigneeIds)) if (notify.includes(id)) push(id, 'retake', null, 2);
    }
  }

  if (!comment.characterId && !comment.revisionId) {
    const partById = new Map(world.parts.map((part) => [part.id, part]));
    const episodeById = new Map(world.episodes.map((episode) => [episode.id, episode]));
    const activePart = (partId: string) => {
      const part = partById.get(partId);
      return part && part.active && episodeById.get(part.episodeId)?.active ? part : null;
    };
    const no = sceneNo(comment.sceneId);
    const scene = world.scenes
      .filter((item) => (comment.sceneUuid != null && item.id === comment.sceneUuid)
        || (comment.partId != null && item.partId === comment.partId && no !== null && item.sortOrder === no))
      .filter((item) => activePart(item.partId))
      .sort((a, b) => Number(b.id === comment.sceneUuid) - Number(a.id === comment.sceneUuid) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    if (scene) {
      const part = activePart(scene.partId)!;
      const sceneKey = btrim(scene.sceneNumber).toLowerCase();
      const counterpartScenes = sceneKey === '' ? [] : world.scenes.filter((item) => {
        const other = activePart(item.partId);
        if (!other || other.episodeId !== part.episodeId || other.partLetter !== part.partLetter) return false;
        const opposite = part.department === 'acting' ? other.department !== 'acting' : other.department === 'acting';
        return opposite && btrim(item.sceneNumber).toLowerCase() === sceneKey;
      });
      const names = (assignee: string | null) => (assignee ?? '').split(ASSIGNEE_SPLIT).map(btrim).filter(Boolean);
      for (const name of names(scene.assignee)) for (const id of idsByName(name)) push(id, 'auto', 'assignee', 3);
      for (const other of counterpartScenes) for (const name of names(other.assignee)) for (const id of idsByName(name)) push(id, 'auto', 'counterpart', 4);
      const onScene = (item: RecipientWorldComment, target: RecipientWorldScene) => item.sceneUuid === target.id
        || (item.partId === target.partId && item.sceneId != null && btrim(item.sceneId) === String(target.sortOrder));
      for (const other of world.comments) {
        if (other.id === comment.id) continue;
        if (onScene(other, scene) || counterpartScenes.some((target) => onScene(other, target))) push(other.userId, 'auto', 'participant', 5);
      }
    }
  }

  const best = new Map<string, CommentNotificationRecipient & { rank: number }>();
  for (const candidate of candidates) {
    if (candidate.recipientId === comment.userId || !usersById.has(candidate.recipientId)) continue;
    const current = best.get(candidate.recipientId);
    if (!current || candidate.rank < current.rank) best.set(candidate.recipientId, candidate);
  }
  return [...best.values()]
    .sort((a, b) => (a.recipientId < b.recipientId ? -1 : a.recipientId > b.recipientId ? 1 : 0))
    .map(({ recipientId, reason, detail }) => ({ recipientId, reason, detail }));
}

/** 수정으로 새로 들어간 @이름의 사람(받는 사람 id 순). SQL 의 수정 트리거와 같다. */
export function commentNotificationEditRecipients(
  world: RecipientWorld,
  commentId: string,
  previousMentions: unknown,
  nextMentions: unknown,
): string[] {
  const comment = world.comments.find((item) => item.id === commentId);
  if (!comment) return [];
  const before = new Set(notificationNames(previousMentions));
  const added = [...new Set(notificationNames(nextMentions).filter((name) => !before.has(name)))];
  const ids = new Set(world.users.filter((user) => added.includes(user.name) && user.id !== comment.userId).map((user) => user.id));
  return [...ids].sort();
}
