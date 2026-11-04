/**
 * 씬 댓글 알림 — "누가 받나"를 정하는 순수 함수 하나 (씬 댓글 B안 인수인계 §6.1, 2026-11-04).
 *
 * 실시간 comments 이벤트·comment-added 방송·comment-updated 방송(수정으로 새로 넣은 @)·놓친 멘션 복원이
 * 모두 이 함수를 쓴다. 예전엔 App.tsx 두 블록 + 리테이크 전용 함수에 같은 판정이 복제돼 있었다.
 *
 * | 대상                                   | reason  | 앱 알림 type | 세기                        |
 * |----------------------------------------|---------|--------------|-----------------------------|
 * | 본문에 @이름 으로 직접 부른 사람          | mention | mention      | 강함                        |
 * | 답글의 루트 작성자(내 댓글에 답글)        | reply   | mention      | 강함                        |
 * | 리테이크 댓글의 요청자·담당자·알림 대상   | retake  | mention      | 강함                        |
 * | 씬 BG/ACT 담당자·상대 부서·스레드 참여자  | auto    | comment      | 조용함(토스트·소리 없음)     |
 * | 캐릭터 댓글의 직접 멘션                   | mention | mention      | 강함(캐릭터 상세로 이동)     |
 * | 팔로우한 스레드의 새 글(v1.148.0 §6.4)    | follow  | comment      | 토스트만(Windows 알림 없음)  |
 * | 작성자 본인                              | —       | 없음         |                             |
 *
 * 자동 대상(답글 상대·리테이크 요청자)은 mentions 배열이 아니라 parent_comment_id·revision 으로 판정한다.
 * 스레드 '알림 끄기'(mute)는 자동 알림만 뺀다 — 나를 직접 부른 알림(멘션·답글·리테이크)은 그대로 온다.
 * node --test 로 바로 검사하도록 런타임 의존이 없다(@/ 별칭·스토어 X).
 */

export type SceneCommentNotificationReason = 'mention' | 'reply' | 'retake' | 'auto' | 'follow';

/** 실시간·방송·복원 어느 길로 왔든 같은 모양으로 맞춘 댓글. */
export interface NormalizedSceneComment {
  commentId: string | null;
  partId: string | null;
  /** comments.scene_id = scene.no 문자열. */
  sceneNo: string | null;
  sceneUuid?: string | null;
  userId: string | null;
  userName: string | null;
  text: string;
  mentions: readonly string[];
  imageCount?: number;
  parentCommentId: string | null;
  /** 원댓글 작성자(보낸 PC 가 방송에 실어 준다). 없으면 받는 쪽 캐시로 판정. */
  parentAuthorId?: string | null;
  revisionId: string | null;
  characterId: string | null;
  createdAt?: string | null;
  /** 'edit' 이면 addedMentions(수정으로 새로 들어간 @이름)만 멘션으로 본다 — 답글·자동 알림은 만들지 않는다. */
  kind?: 'add' | 'edit';
  addedMentions?: readonly string[] | null;
}

export interface NotificationSceneRef {
  id?: string | null;
  sceneId?: string | null;
  assignee?: string | null;
}

export interface NotificationRevisionRef {
  id: string;
  revisionNo?: number | null;
  requesterId?: string | null;
  assigneeIds?: readonly string[] | null;
  notifyUserIds?: readonly string[] | null;
}

export interface SceneCommentNotificationDeps {
  findScene(comment: NormalizedSceneComment): NotificationSceneRef | null;
  /** 'EP05 a001' 같은 사람용 위치. 모르면 빈 문자열. */
  sceneLabel(comment: NormalizedSceneComment, scene: NotificationSceneRef | null): string;
  isCommentByUser(commentId: string, userId: string): boolean;
  hasUserCommentedOnScene(partId: string | null, scene: NotificationSceneRef, userId: string): boolean;
  /** 이 씬과 같은 장면 상대 부서 담당자 이름(BG↔ACT). */
  counterpartAssigneeNames(scene: NotificationSceneRef): readonly string[];
  /** 리테이크 댓글이면 그 리테이크(호출자가 미리 확보). 없으면 null → 리테이크 알림을 만들지 않는다. */
  getRevision(revisionId: string): NotificationRevisionRef | null;
  /** 이름 → 사용자 id (리테이크 댓글의 @멘션 대상 확인). */
  userIdByName(name: string): string | null;
  /** 저장 원문 → 사람이 읽는 글(태그 토큰 제거). */
  plainText(text: string): string;
  /** CommentPanel 의 씬 대화 키와 같은 규칙('EP05:A:a001'). 모르면 null(§6.4 팔로우·끄기 키). */
  sceneThreadKey?(comment: NormalizedSceneComment, scene: NotificationSceneRef | null): string | null;
  /** 이 PC 의 스레드 팔로우·끄기(스레드 → 씬 순). 없으면 null. */
  threadPreference?(ref: { threadId: string | null; sceneThreadKey: string | null }): 'follow' | 'mute' | null;
}

export interface SceneCommentNotificationSettings {
  /** 설정 '내 씬 자동 알림'(담당 씬 댓글·단계 변경). 기본 켜짐. */
  autoNotify: boolean;
  /** 설정 '리테이크 알림'. 기본 켜짐. */
  retakeNotify: boolean;
}

export interface SceneCommentNotificationDecision {
  type: 'mention' | 'comment';
  reason: SceneCommentNotificationReason;
  title: string;
  body: string;
  /** 조용한 알림 — 토스트·Windows 알림 없이 종 배지만. */
  quiet: boolean;
  /** Windows 알림까지 — 팔로우 알림은 토스트만(나를 부른 알림보다 약하게). */
  native: boolean;
  metadata: Record<string, unknown>;
  /** 같은 댓글이 두 길로 와도 한 번만(세션 동안). */
  dedupeKey: string;
}

export function parseAssigneeNames(assignee: string | null | undefined): string[] {
  if (!assignee) return [];
  return assignee.split(/[,、，]/).map((s) => s.trim()).filter(Boolean);
}

const BODY_LIMIT = 60;

export function buildNotificationBody(comment: Pick<NormalizedSceneComment, 'text' | 'imageCount'>, plainText: (t: string) => string): string {
  const plain = plainText(comment.text ?? '').replace(/\s+/g, ' ').trim();
  if (!plain) return comment.imageCount ? `(이미지 ${comment.imageCount}장)` : '';
  return plain.length > BODY_LIMIT ? `${plain.slice(0, BODY_LIMIT)}…` : plain;
}

function withLabel(title: string, label: string): string {
  return label ? `${title} · ${label}` : title;
}

export function decideSceneCommentNotification(
  comment: NormalizedSceneComment,
  me: { id: string; name: string } | null | undefined,
  deps: SceneCommentNotificationDeps,
  settings: SceneCommentNotificationSettings,
): SceneCommentNotificationDecision | null {
  if (!me?.id || !comment.commentId) return null;
  if (!comment.userId || comment.userId === me.id) return null;

  const author = comment.userName || '누군가';
  const isEdit = comment.kind === 'edit';
  const mentionNames = isEdit ? (comment.addedMentions ?? []) : comment.mentions;
  const isMentioned = mentionNames.includes(me.name);
  const body = buildNotificationBody(comment, deps.plainText);

  // 캐릭터 댓글 — 직접 멘션만(씬 담당·스레드 개념 없음). 누르면 캐릭터 상세로.
  if (comment.characterId) {
    if (!isMentioned) return null;
    return {
      type: 'mention',
      reason: 'mention',
      title: `${author}님이 나를 태그했습니다`,
      body,
      quiet: false,
      native: true,
      metadata: {
        characterId: comment.characterId,
        commentId: comment.commentId,
        mentionedBy: author,
        reason: 'mention',
        // 수정으로 다시 넣은 @ 는 그 댓글의 예전 알림과 따로 센다(씬 댓글과 같게 — 코덱스 4차).
        ...(isEdit ? { mentionEditAt: comment.createdAt ?? 'edit' } : {}),
      },
      dedupeKey: `${comment.commentId}:mention${isEdit ? `:edit:${comment.createdAt ?? ''}` : ''}`,
    };
  }

  const scene = deps.findScene(comment);
  const label = deps.sceneLabel(comment, scene);
  const sceneThreadKey = deps.sceneThreadKey?.(comment, scene) ?? null;
  // 스레드 id — 리테이크 댓글은 're:{id}', 답글은 원댓글, 원댓글은 자기 id(utils/commentThreadFollow 와 같은 규칙).
  const threadId = comment.revisionId ? `re:${comment.revisionId}` : (comment.parentCommentId || comment.commentId);
  const pref = deps.threadPreference?.({ threadId, sceneThreadKey }) ?? null;
  const baseMetadata: Record<string, unknown> = {
    sceneId: scene?.id ?? comment.sceneUuid ?? undefined,
    sceneName: scene?.sceneId ?? undefined,
    // 알림 센터의 씬 묶음 미리보기('김어진 …')·'이 씬 알림 끄기'·팔로우 키.
    authorName: comment.userName ?? undefined,
    ...(sceneThreadKey ? { sceneThreadKey, threadKey: `${sceneThreadKey}#${threadId}` } : {}),
    commentId: comment.commentId,
    commentSceneId: comment.sceneNo ?? undefined,
    commentPartId: comment.partId ?? undefined,
    ...(comment.parentCommentId ? { parentCommentId: comment.parentCommentId } : {}),
    ...(comment.revisionId ? { revisionId: comment.revisionId } : {}),
  };
  const decision = (
    reason: SceneCommentNotificationReason,
    title: string,
    extra: Record<string, unknown> = {},
  ): SceneCommentNotificationDecision => ({
    type: reason === 'auto' || reason === 'follow' ? 'comment' : 'mention',
    reason,
    title: withLabel(title, label),
    body,
    quiet: reason === 'auto',
    native: reason !== 'auto' && reason !== 'follow',
    metadata: { ...baseMetadata, reason, ...(reason === 'auto' || reason === 'follow' ? {} : { mentionedBy: author }), ...extra },
    dedupeKey: `${comment.commentId}:${reason}${isEdit ? `:edit:${comment.createdAt ?? ''}` : ''}`,
  });

  // 수정으로 새로 넣은 @이름 — 그 사람에게만 멘션 알림. 답글·자동 알림은 처음 쓸 때 이미 판정했다.
  //   알림 정체성을 따로 잡도록 수정 시각을 싣는다(utils/notificationIdentity.ts).
  if (isEdit) {
    return isMentioned
      ? decision('mention', `${author}님이 나를 태그했습니다`, { mentionEditAt: comment.createdAt ?? 'edit' })
      : null;
  }

  if (comment.revisionId) {
    // 리테이크 댓글 — 일반 댓글 자동 알림(담당·참여자)과 섞지 않는다(예전과 같게).
    if (isMentioned) return decision('mention', `${author}님이 나를 태그했습니다`);
    const revision = deps.getRevision(comment.revisionId);
    const followDecision = () => (pref === 'follow' ? decision('follow', `${author}님이 팔로우 중인 리테이크에 댓글을 남겼습니다`) : null);
    if (!revision || !settings.retakeNotify) return followDecision();
    const targets = new Set<string>([
      ...(revision.requesterId ? [revision.requesterId] : []),
      ...(revision.assigneeIds ?? []),
      ...(revision.notifyUserIds ?? []),
    ]);
    if (!targets.has(me.id)) return followDecision();
    const reLabel = revision.revisionNo != null ? `re#${revision.revisionNo}` : '리테이크';
    return decision('retake', `${author}님이 ${reLabel} 에 댓글을 남겼습니다`);
  }

  if (isMentioned) return decision('mention', `${author}님이 나를 태그했습니다`);
  if (comment.parentCommentId && (comment.parentAuthorId === me.id || deps.isCommentByUser(comment.parentCommentId, me.id))) {
    return decision('reply', `${author}님이 내 댓글에 답글을 남겼습니다`);
  }
  // §6.4: 끈 스레드·씬은 자동 알림을 빼고(멘션·답글은 위에서 이미), 팔로우한 스레드는 새 글마다 알린다(설정 '내 씬 자동 알림'과 무관).
  if (pref === 'mute') return null;
  if (pref === 'follow') return decision('follow', `${author}님이 팔로우 중인 스레드에 댓글을 남겼습니다`);
  if (!settings.autoNotify || !scene) return null;
  const isAssignee = parseAssigneeNames(scene.assignee).includes(me.name);
  const isCounterpart = !isAssignee && deps.counterpartAssigneeNames(scene).includes(me.name);
  const isParticipant = !isAssignee && !isCounterpart && deps.hasUserCommentedOnScene(comment.partId, scene, me.id);
  if (!isAssignee && !isCounterpart && !isParticipant) return null;
  const phrase = isAssignee ? '내 씬에 댓글을 남겼습니다' : isCounterpart ? '함께 작업 중인 씬에 댓글을 남겼습니다' : '내가 댓글 단 씬에 새 댓글을 남겼습니다';
  return decision('auto', `${author}님이 ${phrase}`);
}

/** 세션 동안 같은 알림을 한 번만 — 상한을 넘으면 가장 오래된 것부터 잊는다. */
export function createNotificationDedupe(limit = 500) {
  const seen = new Set<string>();
  return {
    /** 처음이면 true(기록), 이미 봤으면 false. */
    claim(key: string): boolean {
      if (seen.has(key)) return false;
      seen.add(key);
      if (seen.size > limit) {
        const first = seen.values().next().value;
        if (first !== undefined) seen.delete(first);
      }
      return true;
    },
    has(key: string): boolean { return seen.has(key); },
    /** 처리하지 못했으면 놓아 다음 도착이 다시 시도하게. */
    release(key: string): void { seen.delete(key); },
    clear(): void { seen.clear(); },
  };
}

// ─── 세 길(실시간 행·추가 방송·수정 방송)을 같은 모양으로 ─────────────────

type UnknownRecord = Record<string, unknown>;

function asText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function asNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function imageCountOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** Supabase 실시간 comments INSERT 행(snake_case). */
export function normalizeSceneCommentFromRealtimeRow(row: unknown): NormalizedSceneComment | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as UnknownRecord;
  const commentId = asText(r.id);
  if (!commentId) return null;
  return {
    commentId,
    partId: asText(r.part_id),
    sceneNo: r.scene_id == null ? null : String(r.scene_id),
    sceneUuid: asText(r.scene_uuid),
    userId: asText(r.user_id),
    userName: asText(r.user_name),
    text: typeof r.text === 'string' ? r.text : '',
    mentions: asNames(r.mentions),
    imageCount: imageCountOf(r.images),
    parentCommentId: asText(r.parent_comment_id),
    // 실시간 행에는 원댓글 작성자가 없다(방송이 실어 온다).
    parentAuthorId: null,
    revisionId: asText(r.revision_id),
    characterId: asText(r.character_id),
    createdAt: asText(r.created_at),
    kind: 'add',
  };
}

/** comment-added 방송(camelCase). 캐릭터 댓글은 sceneId='char:{id}' 로 오기도 한다. */
export function normalizeSceneCommentFromAddedBroadcast(payload: unknown): NormalizedSceneComment | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as UnknownRecord;
  const commentId = asText(p.commentId);
  if (!commentId) return null;
  const rawScene = p.sceneId == null ? null : String(p.sceneId);
  const characterId = asText(p.characterId)
    ?? (rawScene && rawScene.startsWith('char:') ? rawScene.slice('char:'.length) || null : null);
  return {
    commentId,
    partId: asText(p.partId),
    sceneNo: characterId ? null : rawScene,
    sceneUuid: asText(p.sceneUuid),
    userId: asText(p.userId),
    userName: asText(p.userName),
    text: typeof p.text === 'string' ? p.text : '',
    mentions: asNames(p.mentions),
    imageCount: imageCountOf(p.images),
    parentCommentId: asText(p.parentCommentId),
    parentAuthorId: asText(p.parentAuthorId),
    revisionId: asText(p.revisionId),
    characterId,
    createdAt: asText(p.createdAt),
    kind: 'add',
  };
}

/** comment-updated 방송 — 수정으로 새로 들어간 @이름(addedMentions)만 알림 대상. */
export function normalizeSceneCommentFromUpdatedBroadcast(payload: unknown): NormalizedSceneComment | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as UnknownRecord;
  const commentId = asText(p.commentId);
  if (!commentId) return null;
  const addedMentions = asNames(p.addedMentions);
  if (addedMentions.length === 0) return null;
  return {
    commentId,
    partId: asText(p.partId),
    sceneNo: p.sceneId == null ? null : String(p.sceneId),
    sceneUuid: null,
    userId: asText(p.userId),
    userName: asText(p.userName),
    text: typeof p.text === 'string' ? p.text : '',
    mentions: asNames(p.mentions),
    imageCount: imageCountOf(p.images),
    // 알림을 누르면 그 답글 스레드·리테이크 탭으로 가게(판정은 addedMentions 만 본다).
    parentCommentId: asText(p.parentCommentId),
    revisionId: asText(p.revisionId),
    characterId: asText(p.characterId),
    createdAt: asText(p.editedAt),
    kind: 'edit',
    addedMentions,
  };
}

/** 놓친 멘션 복원 행(메인 fetchMissedMentions — camelCase). */
export function normalizeSceneCommentFromMissedRow(row: unknown): NormalizedSceneComment | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as UnknownRecord;
  const commentId = asText(r.id);
  if (!commentId) return null;
  return {
    commentId,
    partId: asText(r.partId),
    sceneNo: r.sceneId == null ? null : String(r.sceneId),
    sceneUuid: asText(r.sceneUuid),
    userId: asText(r.userId),
    userName: asText(r.userName),
    text: typeof r.text === 'string' ? r.text : '',
    mentions: asNames(r.mentions),
    imageCount: imageCountOf(r.images),
    parentCommentId: asText(r.parentCommentId),
    parentAuthorId: asText(r.parentAuthorId),
    revisionId: asText(r.revisionId),
    characterId: null,
    createdAt: asText(r.createdAt),
    kind: 'add',
  };
}
