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
import { buildSceneKey, getCanonicalRevision } from '@/services/revisionService';
import { buildSceneThreadKeyFromRevisionKey } from '@/utils/commentThreadKey';
import { resolveThreadPreference } from '@/utils/commentThreadFollow';
import { useCommentThreadFollowStore } from '@/stores/useCommentThreadFollowStore';
import {
  collectCounterpartAssigneeNames,
  hasUserCommentedOnScene,
  isCommentByUser,
} from '@/utils/sceneNotificationRecipients';
import { stripEntityTokens } from '@/utils/entityTokens';
import { findCommentInCache } from '@/services/commentService';
import { getCommentNotificationInboxState, getLastSeenAt, setCommentNotificationInboxState, setLastSeenAt } from '@/utils/lastSeenTracker';
import { dispatchNotification, type NotificationSettings } from '@/utils/notificationHelper';
import { getNotificationIdentity } from '@/utils/notificationIdentity';
import { getServerCommentNotificationsAvailable, setServerCommentNotificationsAvailable } from '@/utils/commentNotificationServer';
import { useNotificationStore } from '@/stores/useNotificationStore';
import {
  createNotificationDedupe,
  decideSceneCommentNotification,
  decideSceneCommentNotificationFromServer,
  normalizeSceneCommentFromServerRow,
  type NormalizedSceneComment,
  type NotificationRevisionRef,
  type NotificationSceneRef,
  type SceneCommentNotificationDeps,
  type SceneCommentNotificationDecision,
} from '@/utils/sceneCommentNotification';
import { firstRunServerRowFilter, presentServerCommentRows } from '@/utils/commentNotificationPresent';
import {
  createCommentNotificationInbox,
  type CommentNotificationInbox,
  type CommentNotificationPullMode,
  type CommentNotificationPullResult,
} from '@/utils/commentNotificationInbox';
import type { CommentNotificationCursor, CommentNotificationRow } from '@/shared/commentNotification';
import type { Scene } from '@/types';

const arrivals = createNotificationDedupe(500);
/** 실시간 답글이 원댓글 작성자를 실어 오는 방송을 기다리는 시간. 방송은 보통 0.1초 안에 온다. */
const REALTIME_REPLY_WAIT_MS = 1500;
const decisions = createNotificationDedupe(500);
/**
 * 놓친 알림 모으기가 한 번 끝난 사용자. 그 전에는 실시간 멘션이 놓친 알림 기준 시각을 옮기지 않는다(로컬 리뷰) —
 * 모으기가 실패해 다시 할 때, 그 사이 실시간 멘션 하나가 기준을 '지금'으로 옮겨 앞 구간을 건너뛰지 않게.
 */
let catchUpReadyUserId: string | null = null;

export function markSceneCommentCatchUpReady(userId: string): void {
  catchUpReadyUserId = userId;
}

/** 로그아웃·계정 전환 때 비운다(다른 사람의 알림 기억을 넘기지 않게). */
export function resetSceneCommentNotifier(): void {
  arrivals.clear();
  decisions.clear();
  catchUpReadyUserId = null;
  inbox?.dispose();
  inbox = null;
  inboxUserId = null;
  setServerCommentNotificationsAvailable(null);
}

// ─── 서버 알림 줄(씬 댓글 B안 PR 6) ─────────────────────────────────────
// 서버가 댓글 저장 순간에 받는 사람을 정해 줄을 만든다(DEVLOG/migrations/2026-11-05-comment-notifications.sql).
// 실시간 판정(아래 notifyIncomingSceneComment)은 그대로 두어 바로 뜨게 하고, 서버 줄은 그 PC 캐시에 없어 놓친 것과
// 꺼져 있던 동안 온 것을 채운다. 두 길은 같은 중복 키(decisions)·같은 알림 정체성이라 한 댓글이 두 번 뜨지 않는다.

let inbox: CommentNotificationInbox | null = null;
let inboxUserId: string | null = null;
let settingsSource: () => NotificationSettings = () => ({}) as NotificationSettings;

/** null = 아직 모름, false = 서버에 줄이 없다(DB 적용 전) → 예전 길(놓친 멘션 훑기). */
export function serverCommentNotificationsAvailable(): boolean | null {
  return getServerCommentNotificationsAvailable();
}

/** 서버 줄 묶음을 화면 알림으로. quiet 면 목록에만(로그인·재연결·한꺼번에 여러 줄). 새로 알린 안 읽은 수를 돌려준다. */
function presentServerRows(me: { id: string; name: string }, rows: readonly CommentNotificationRow[], quiet: boolean): number {
  const settings = settingsSource();
  const deps = buildDeps(null);
  return presentServerCommentRows(rows, quiet, {
    isCurrent: () => useAuthStore.getState().currentUser?.id === me.id,
    decide: (row) => {
      const comment = normalizeSceneCommentFromServerRow(row);
      const decision = decideSceneCommentNotificationFromServer(
        comment,
        { reason: row.reason, detail: row.detail, revisionNo: row.revisionNo },
        me,
        deps,
        sceneCommentSettings(settings),
      );
      return decision ? { ...decision, createdAt: comment.createdAt ?? null } : null;
    },
    claim: (key) => decisions.claim(key),
    identityOf: (type, metadata) => getNotificationIdentity({ type, metadata }),
    isListed: (identity) => useNotificationStore.getState().notifications.some((n) => getNotificationIdentity(n) === identity),
    add: (draft) => useNotificationStore.getState().addNotification({ ...draft, metadata: draft.metadata as Record<string, string | undefined> }),
    dispatch: (payload, options) => dispatchNotification(payload, settings, options),
    // 예전 길(서버 줄이 없어진 경우의 놓친 멘션 훑기)의 기준 시각도 함께 옮긴다.
    onMention: (createdAt) => { if (catchUpReadyUserId === me.id) setLastSeenAt(me.id, createdAt); },
  });
}

/**
 * 서버 줄을 판정하기 전에 씬 목록(위치 이름·씬 대화 키)과 이 계정의 팔로우·끄기를 다 읽었는지 기다린다(리뷰 지적) —
 * 로그인 직후 씬 목록보다 먼저 판정하면 '이 씬 알림 끄기'가 무시되고 제목에 위치가 빠진 채로 본 줄이 된다.
 * 끝내 준비되지 않으면(오프라인 등) 정해 둔 시간 뒤 그대로 간다 — 알림이 아예 빠지는 것보다 낫다.
 */
const PRESENT_CONTEXT_WAIT_MS = 20_000;
function waitForPresentationContext(userId: string, timeoutMs = PRESENT_CONTEXT_WAIT_MS): Promise<void> {
  const ready = () => {
    const follow = useCommentThreadFollowStore.getState();
    return useDataStore.getState().lastSyncTime !== null && follow.loaded && follow.userId === userId;
  };
  if (ready()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const offData = useDataStore.subscribe(check);
    const offFollow = useCommentThreadFollowStore.subscribe(check);
    const timer = setTimeout(done, timeoutMs);
    function check() { if (ready()) done(); }
    function done() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      offData();
      offFollow();
      resolve();
    }
  });
}

/** 받기함이 서버 줄을 처음 고를 때(업데이트 뒤 첫 실행) 직전 몇 분의 자동 알림만 — 예전 버전이 이미 실시간으로 보여 준 것. */
const FIRST_RUN_AUTO_WINDOW_MS = 2 * 60 * 1000;

function inboxFor(me: { id: string; name: string }): CommentNotificationInbox {
  if (inbox && inboxUserId === me.id) return inbox;
  inbox?.dispose();
  inboxUserId = me.id;
  const userId = me.id;
  inbox = createCommentNotificationInbox({
    list: async (cursor, limit) => {
      const api = window.electronAPI;
      if (!api?.commentNotificationsList) return { available: false, rows: [] };
      return api.commentNotificationsList(cursor, limit);
    },
    present: (rows, quiet) => presentServerRows(me, rows, quiet),
    loadState: () => getCommentNotificationInboxState(userId),
    saveState: (state) => setCommentNotificationInboxState(userId, state),
  });
  return inbox;
}

/** 저장된 받기함 커서가 있는가 — 없으면 첫 실행(예전 놓친 알림 기준 시각에서 시작). */
export function hasServerCommentNotificationCursor(userId: string): boolean {
  return !!getCommentNotificationInboxState(userId)?.cursor;
}

/**
 * 내 서버 줄을 커서 뒤로 읽어 알림으로(catchup = 조용히, live = 실시간처럼). initial 은 저장된 커서가 없을 때 시작점.
 * 'unavailable' 이면 서버에 줄이 없다 — 호출자가 예전 길로 간다.
 */
export async function pullServerCommentNotifications(
  me: { id: string; name: string },
  getSettings: () => NotificationSettings,
  mode: CommentNotificationPullMode,
  initial: CommentNotificationCursor | null,
  overlapForFirstRun = 10 * 60 * 1000,
): Promise<CommentNotificationPullResult & { stale: boolean }> {
  settingsSource = getSettings;
  await waitForPresentationContext(me.id);
  if (useAuthStore.getState().currentUser?.id !== me.id) return { status: 'failed', presented: 0, quieted: false, stale: true };
  const box = inboxFor(me);
  // 업데이트 뒤 첫 실행: 예전 버전이 이미 보여 준(지웠을 수도 있는) 줄은 다시 넘기지 않는다.
  const show = box.hasCursor()
    ? undefined
    : firstRunServerRowFilter({
      lastSeenAt: getLastSeenAt(me.id),
      startedAt: Date.now(),
      autoWindowMs: FIRST_RUN_AUTO_WINDOW_MS,
      mentionWindowMs: Math.max(overlapForFirstRun, FIRST_RUN_AUTO_WINDOW_MS),
    });
  const result = await box.pull(mode, initial, { show });
  const stale = useAuthStore.getState().currentUser?.id !== me.id;
  if (!stale) {
    if (result.status === 'done') setServerCommentNotificationsAvailable(true);
    else if (result.status === 'unavailable') setServerCommentNotificationsAvailable(false);
  }
  return { ...result, stale };
}

/** 커서가 처음일 때 시작점 — 예전 놓친 알림 기준 시각(없으면 지금)에서 겹침 몫만큼 앞. */
export function initialServerCommentNotificationCursor(userId: string, overlapMs: number, now = Date.now()): CommentNotificationCursor | null {
  if (hasServerCommentNotificationCursor(userId)) return null;
  const lastSeen = getLastSeenAt(userId);
  const base = lastSeen && Number.isFinite(Date.parse(lastSeen)) ? Date.parse(lastSeen) : now;
  return { at: new Date(base - overlapMs).toISOString(), id: null };
}

/**
 * 서버 신호를 받았을 때 — 놓친 알림 모으기가 끝난 사용자만 내 줄을 다시 읽는다(실시간처럼 띄운다).
 * 한꺼번에 여러 줄이면 조용히 넣고 그 수를 돌려준다(호출자가 요약 한 번).
 */
export async function pullLiveServerCommentNotifications(
  getSettings: () => NotificationSettings,
  overlapMs: number,
): Promise<number> {
  const me = useAuthStore.getState().currentUser;
  if (!me || catchUpReadyUserId !== me.id) return 0;
  const result = await pullServerCommentNotifications(
    { id: me.id, name: me.name },
    getSettings,
    'live',
    initialServerCommentNotificationCursor(me.id, overlapMs),
    overlapMs,
  );
  return !result.stale && result.status === 'done' && result.quieted ? result.presented : 0;
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

/**
 * 씬 대화 키(§6.4 팔로우·끄기) — 씬 상세가 댓글 패널에 넘기는 것과 같은 규칙
 * (SceneDetailModal: buildSceneThreadKeyFromRevisionKey(buildSceneKey(시트, 씬 번호))).
 */
function sceneThreadKeyFor(comment: NormalizedSceneComment, scene: NotificationSceneRef | null): string | null {
  const ds = useDataStore.getState();
  for (const ep of ds.episodes) {
    for (const part of ep.parts) {
      const match = scene?.id
        ? part.scenes.find((s) => s.id === scene.id)
        : part.id === comment.partId && comment.sceneNo != null
          ? part.scenes.find((s) => Number(s.no) === Number(comment.sceneNo))
          : undefined;
      if (!match) continue;
      try {
        return buildSceneThreadKeyFromRevisionKey(buildSceneKey(part.sheetName, match.sceneId)) || null;
      } catch {
        return null;
      }
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
    sceneThreadKey: sceneThreadKeyFor,
    threadPreference: (ref) => resolveThreadPreference(useCommentThreadFollowStore.getState().prefs, ref),
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
  options: { source?: 'realtime' | 'broadcast' } = {},
): void {
  if (!comment?.commentId) return;
  const me = useAuthStore.getState().currentUser;
  if (!me || !comment.userId || comment.userId === me.id) return;
  // 실시간 행에는 원댓글 작성자가 없다 — 원댓글이 내 캐시에 없으면 그것을 실어 오는 방송을 잠깐 기다린다(코덱스 2차).
  //   방송이 먼저 오면 그쪽이 판정하고, 이 길은 같은 도착 키라 건너뛴다. 방송이 끝내 안 오면 캐시로 판정한다.
  if (options.source === 'realtime' && comment.kind !== 'edit' && comment.parentCommentId && !comment.parentAuthorId
    && !findCommentInCache(comment.parentCommentId)) {
    setTimeout(() => notifyIncomingSceneComment({ ...comment }, getSettings, {}), REALTIME_REPLY_WAIT_MS);
    return;
  }
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
    }, settings, { quiet: decision.quiet, native: decision.native });
    // 실시간으로 받은 '나를 부른 알림'도 놓친 알림 기준 시각을 옮긴다 — 다음 로그인 때 '놓친 알림 N개'가 거짓으로 뜨지 않게(§6.3).
    if (decision.type === 'mention' && catchUpReadyUserId === me.id) {
      setLastSeenAt(me.id, comment.createdAt || new Date().toISOString());
    }
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
