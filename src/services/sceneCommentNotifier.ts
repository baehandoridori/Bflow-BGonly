/**
 * 씬 댓글 알림 연결부 — 실시간 행·댓글 방송(추가·수정)·놓친 멘션 복원이 모두 이것을 부른다(씬 댓글 B안 §6.1).
 *
 * 판정은 순수 함수 decideSceneCommentNotification 하나(utils/sceneCommentNotification.ts)가 하고,
 * 여기서는 스토어 조회·리테이크 단건 조회·중복 거르기·알림 띄우기만 한다.
 *
 * 중복: 같은 댓글이 실시간과 방송 두 길로 거의 동시에 온다.
 *  - arrivals: `${댓글 id}:${추가|수정}` — 두 번째로 온 것은 판정 전에 거른다(리테이크 조회도 한 번만).
 *    리테이크를 못 읽어 판정을 못 했으면 놓아 다른 길이 다시 시도한다.
 *  - decisions: 판정 결과의 `${댓글 id}:${이유}` — 놓친 멘션 복원과 실시간이 같은 알림을 두 번 만들지 않게.
 * 둘 다 세션 동안 기억한다(상한 500, 예전 3초 창 대신).
 */

import { useAuthStore } from '@/stores/useAuthStore';
import { useDataStore } from '@/stores/useDataStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { getCanonicalRevision } from '@/services/revisionService';
import {
  collectCounterpartAssigneeNames,
  hasUserCommentedOnScene,
  isCommentByUser,
} from '@/utils/sceneNotificationRecipients';
import { stripEntityTokens } from '@/utils/entityTokens';
import { setLastSeenAt } from '@/utils/lastSeenTracker';
import { dispatchNotification, type NotificationSettings } from '@/utils/notificationHelper';
import {
  createNotificationDedupe,
  decideSceneCommentNotification,
  type NormalizedSceneComment,
  type NotificationRevisionRef,
  type NotificationSceneRef,
  type SceneCommentNotificationDeps,
  type SceneCommentNotificationDecision,
} from '@/utils/sceneCommentNotification';
import type { Scene } from '@/types';

const arrivals = createNotificationDedupe(500);
const decisions = createNotificationDedupe(500);

/** 로그아웃·계정 전환 때 비운다(다른 사람의 알림 기억을 넘기지 않게). */
export function resetSceneCommentNotifier(): void {
  arrivals.clear();
  decisions.clear();
}

function findScene(comment: NormalizedSceneComment): Scene | null {
  const ds = useDataStore.getState();
  if (comment.sceneUuid) {
    const byUuid = ds.findSceneByUuid(comment.sceneUuid);
    if (byUuid) return byUuid;
  }
  if (!comment.partId || comment.sceneNo == null) return null;
  const targetNo = Number(comment.sceneNo);
  if (!Number.isFinite(targetNo)) return null;
  for (const ep of ds.episodes) {
    for (const part of ep.parts) {
      if (part.id !== comment.partId) continue;
      return part.scenes.find((s) => Number(s.no) === targetNo) ?? null;
    }
  }
  return null;
}

function sceneLabel(comment: NormalizedSceneComment, scene: NotificationSceneRef | null): string {
  const ds = useDataStore.getState();
  for (const ep of ds.episodes) {
    for (const part of ep.parts) {
      const matches = scene?.id
        ? part.scenes.some((s) => s.id === scene.id)
        : part.id === comment.partId;
      if (!matches) continue;
      const epLabel = `EP${String(ep.episodeNumber).padStart(2, '0')}`;
      return scene?.sceneId ? `${epLabel} ${scene.sceneId}` : epLabel;
    }
  }
  return scene?.sceneId ?? '';
}

function toRevisionRef(revision: { id: string; revisionNo?: number; requesterId?: string; assigneeIds?: string[] | null; notifyUserIds?: string[] | null } | null | undefined): NotificationRevisionRef | null {
  if (!revision) return null;
  return {
    id: revision.id,
    revisionNo: revision.revisionNo ?? null,
    requesterId: revision.requesterId ?? null,
    assigneeIds: revision.assigneeIds ?? [],
    notifyUserIds: revision.notifyUserIds ?? [],
  };
}

function buildDeps(revision: NotificationRevisionRef | null): SceneCommentNotificationDeps {
  return {
    findScene: (comment) => findScene(comment),
    sceneLabel,
    isCommentByUser,
    hasUserCommentedOnScene: (partId, scene, userId) => hasUserCommentedOnScene(partId, scene as Scene, userId),
    counterpartAssigneeNames: (scene) => collectCounterpartAssigneeNames(scene as Scene),
    getRevision: (id) => (revision && revision.id === id ? revision : null),
    userIdByName: (name) => useAuthStore.getState().users.find((u) => u.name === name)?.id ?? null,
    plainText: stripEntityTokens,
  };
}

export function sceneCommentSettings(settings: NotificationSettings | undefined) {
  return {
    autoNotify: settings?.sceneAuto !== false,
    retakeNotify: settings?.retake !== false,
  };
}

/** 판정만(알림을 띄우지 않는다) — 놓친 멘션 복원이 제목·이동 정보를 같은 규칙으로 만들 때 쓴다. */
export function decideIncomingSceneComment(
  comment: NormalizedSceneComment | null,
  settings: NotificationSettings | undefined,
  revision: NotificationRevisionRef | null = null,
): SceneCommentNotificationDecision | null {
  const me = useAuthStore.getState().currentUser;
  if (!me || !comment) return null;
  return decideSceneCommentNotification(comment, { id: me.id, name: me.name }, buildDeps(revision), sceneCommentSettings(settings));
}

/** 이미 보여 준 알림인가(복원이 실시간과 겹치지 않게). 처음이면 기록한다. */
export function claimSceneCommentDecision(decision: SceneCommentNotificationDecision): boolean {
  return decisions.claim(decision.dedupeKey);
}

/**
 * 받은 댓글로 알림을 띄운다(필요하면 리테이크 하나만 조회). 판정은 캐시를 고치기 전에 해야 하므로
 * 호출자는 이 함수를 먼저 부르고 그다음 캐시를 고친다(리테이크 조회를 기다리는 동안 캐시가 바뀌어도 판정에 쓰지 않는다).
 */
export function notifyIncomingSceneComment(
  comment: NormalizedSceneComment | null,
  getSettings: () => NotificationSettings,
): void {
  if (!comment?.commentId) return;
  const me = useAuthStore.getState().currentUser;
  if (!me || !comment.userId || comment.userId === me.id) return;
  // 수정은 수정마다 따로(코덱스 1차) — 같은 수정의 두 길(실시간·방송)만 겹친다.
  const arrivalKey = comment.kind === 'edit'
    ? `${comment.commentId}:edit:${comment.createdAt ?? ''}`
    : `${comment.commentId}:add`;
  if (!arrivals.claim(arrivalKey)) return;

  const finish = (revision: NotificationRevisionRef | null) => {
    if (useAuthStore.getState().currentUser?.id !== me.id) return;
    const settings = getSettings();
    const decision = decideIncomingSceneComment(comment, settings, revision);
    if (!decision || !decisions.claim(decision.dedupeKey)) return;
    dispatchNotification({
      type: decision.type,
      title: decision.title,
      body: decision.body || undefined,
      metadata: decision.metadata,
    }, settings, { quiet: decision.quiet });
    // 실시간으로 받은 '나를 부른 알림'도 놓친 알림 기준 시각을 옮긴다 — 다음 로그인 때 '놓친 알림 N개'가 거짓으로 뜨지 않게(§6.3).
    if (decision.type === 'mention') setLastSeenAt(me.id, comment.createdAt || new Date().toISOString());
  };

  const mentionsMe = (comment.kind === 'edit' ? comment.addedMentions ?? [] : comment.mentions).includes(me.name);
  if (!comment.revisionId || comment.kind === 'edit' || mentionsMe) {
    finish(null);
    return;
  }
  // 리테이크 댓글 — 스토어에 있으면 그대로, 없으면 그 리테이크 하나만 서버에서(전량 조회 금지, §7.5).
  const cached = useRevisionStore.getState().revisions.find((r) => r.id === comment.revisionId);
  if (cached) {
    finish(toRevisionRef(cached));
    return;
  }
  void getCanonicalRevision(comment.revisionId).then((revision) => {
    if (!revision) {
      arrivals.release(arrivalKey);
      return;
    }
    finish(toRevisionRef(revision));
  }).catch(() => {
    // 못 읽었으면 같은 댓글의 다른 길(실시간/방송)이 다시 시도하게 놓는다.
    arrivals.release(arrivalKey);
  });
}
