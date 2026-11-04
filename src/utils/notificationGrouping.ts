/**
 * 알림 창 묶음 — 씬 댓글 B안 §9 (v1.148.0). 순수 함수(타입만 가져온다), node --test 로 검사.
 *
 * 카드 네 종류:
 *   - thread   : 같은 씬의 댓글·멘션(답글·자동 알림 포함) 한 장 — 'EP05 · a001 · 새 댓글 N · 멘션 M' + 최근 세 줄.
 *   - revision : 같은 리테이크(re#N) 한 장 — 상태 알림(등록·진행·완료)과 그 리테이크 댓글을 함께. 상태가 바뀌어도 새 장을 만들지 않는다.
 *   - reaction : 같은 씬 내 댓글에 달린 반응 한 장('👍 반응 · 박정인 외 1명'), 조용함.
 *   - scene    : 같은 씬의 단계 변경·배정·피드백(두 개 이상일 때만 묶는다).
 * 묶음은 보여 주기만 한다 — 저장소의 알림 한 줄 한 줄(읽음·지우기·서버 읽음 처리)은 그대로다.
 * (같은 씬 댓글을 저장소에서 한 줄로 합치면 '이미 목록에 있음'으로 보고 다음 댓글의 토스트가 사라진다.)
 */

import type { AppNotification } from '@/stores/useNotificationStore';

export type NotificationCardVariant = 'thread' | 'revision' | 'reaction' | 'scene';

export interface NotificationCardGroup {
  kind: 'group';
  key: string;
  variant: NotificationCardVariant;
  /** 예전 묶음 제목(씬 묶음 머리 대체 문구). */
  title: string;
  /** 최신이 앞. */
  notifications: AppNotification[];
  unreadCount: number;
  latestCreatedAt: string;
  /** 댓글로 센 줄(댓글·멘션·리테이크 댓글). */
  commentCount: number;
  /** 그중 안 읽은 줄. */
  unreadCommentCount: number;
  /** 안 읽은 '나를 부른' 줄(멘션·답글·리테이크 댓글 — type 'mention'). */
  unreadMentionCount: number;
  revisionId?: string;
}

export type NotificationDisplayItem =
  | { kind: 'item'; notification: AppNotification }
  | NotificationCardGroup;

function metadataString(notification: AppNotification, key: string): string | undefined {
  const value = (notification.metadata as Record<string, unknown> | undefined)?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** 같은 씬을 가리키는 열쇠 — 댓글 저장 위치(파트 + 씬 번호)가 가장 정확하고, 없으면 씬 uuid, 시트 + 씬 이름. */
function commentSceneKey(notification: AppNotification): string | null {
  const partId = metadataString(notification, 'commentPartId');
  const sceneNo = metadataString(notification, 'commentSceneId');
  if (partId && sceneNo) return `${partId}:${sceneNo}`;
  const sceneUuid = metadataString(notification, 'sceneId');
  if (sceneUuid) return `uuid:${sceneUuid}`;
  const sheetName = metadataString(notification, 'sheetName');
  const sceneName = metadataString(notification, 'sceneName');
  if (sheetName && sceneName) return `${sheetName}:${sceneName}`;
  return null;
}

function isCommentRow(notification: AppNotification): boolean {
  if (notification.type === 'comment' || notification.type === 'mention') return true;
  return notification.type === 'revision' && metadataString(notification, 'revisionAction') === 'comment';
}

export function getNotificationGroupKey(notification: AppNotification): string | null {
  const revisionId = metadataString(notification, 'revisionId');
  // 리테이크 상태 알림 + 그 리테이크에 달린 댓글(멘션·리테이크 댓글 알림) → 리테이크 한 장.
  if (revisionId && (notification.type === 'revision' || notification.type === 'mention' || notification.type === 'comment')) {
    return `revision:${revisionId}`;
  }

  if (notification.type === 'comment' || notification.type === 'mention') {
    // 캐릭터 댓글은 씬이 없다 — 낱개 줄로.
    if (metadataString(notification, 'characterId') && !metadataString(notification, 'commentPartId')) return null;
    const scene = commentSceneKey(notification);
    return scene ? `thread:${scene}` : null;
  }

  if (notification.type === 'comment_reaction') {
    const scene = commentSceneKey(notification);
    return scene ? `reaction:${scene}` : null;
  }

  if (notification.type === 'scene_change' || notification.type === 'scene_assignment' || notification.type === 'acting_feedback') {
    const sceneUuid = metadataString(notification, 'sceneId');
    if (sceneUuid) return `scene:${sceneUuid}`;
    const sheetName = metadataString(notification, 'sheetName');
    const sceneName = metadataString(notification, 'sceneName') ?? metadataString(notification, 'commentSceneId');
    if (sheetName && sceneName) return `scene:${sheetName}:${sceneName}`;
  }

  return null;
}

function variantOf(key: string): NotificationCardVariant {
  if (key.startsWith('revision:')) return 'revision';
  if (key.startsWith('thread:')) return 'thread';
  if (key.startsWith('reaction:')) return 'reaction';
  return 'scene';
}

function titleForGroup(variant: NotificationCardVariant, count: number): string {
  if (variant === 'revision') return `리테이크 알림 ${count}건`;
  if (variant === 'thread') return `댓글 알림 ${count}건`;
  if (variant === 'reaction') return `반응 ${count}건`;
  return `씬 알림 ${count}건`;
}

function timeOf(iso: string): number {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : 0;
}

export function buildNotificationDisplayGroups(notifications: AppNotification[]): NotificationDisplayItem[] {
  const grouped = new Map<string, AppNotification[]>();
  const singles: NotificationDisplayItem[] = [];

  notifications.forEach((notification) => {
    const key = getNotificationGroupKey(notification);
    if (!key) {
      singles.push({ kind: 'item', notification });
      return;
    }
    const bucket = grouped.get(key) ?? [];
    bucket.push(notification);
    grouped.set(key, bucket);
  });

  const groups: NotificationDisplayItem[] = [];
  grouped.forEach((members, key) => {
    const variant = variantOf(key);
    const first = members[0];
    if (!first) return;
    // 씬 묶음(단계 변경 등)만 두 개 이상일 때 묶는다 — 댓글·리테이크·반응은 한 개여도 카드(시안 §9).
    if (variant === 'scene' && members.length < 2) {
      groups.push({ kind: 'item', notification: first });
      return;
    }
    const sorted = [...members].sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
    const commentRows = sorted.filter(isCommentRow);
    groups.push({
      kind: 'group',
      key,
      variant,
      title: titleForGroup(variant, members.length),
      notifications: sorted,
      unreadCount: sorted.filter((item) => !item.isRead).length,
      latestCreatedAt: sorted[0]!.createdAt,
      commentCount: commentRows.length,
      unreadCommentCount: commentRows.filter((item) => !item.isRead).length,
      unreadMentionCount: sorted.filter((item) => !item.isRead && item.type === 'mention').length,
      ...(variant === 'revision' ? { revisionId: key.slice('revision:'.length) } : {}),
    });
  });

  return [...groups, ...singles].sort((a, b) => {
    const aTime = a.kind === 'group' ? a.latestCreatedAt : a.notification.createdAt;
    const bTime = b.kind === 'group' ? b.latestCreatedAt : b.notification.createdAt;
    return timeOf(bTime) - timeOf(aTime);
  });
}

// ─── 카드 안에 보일 글 ─────────────────────────────

export interface NotificationPreviewLine {
  id: string;
  /** 굵게 보일 이름(없으면 글만). */
  name: string | null;
  text: string;
  /** 나를 부른 줄(멘션·답글·리테이크 댓글). */
  mention: boolean;
  isRead: boolean;
}

/** 최근 줄 미리보기(최신이 앞, 최대 max 줄). 이름을 아는 댓글은 '이름 + 본문', 모르면(예전 알림) 제목. */
export function notificationPreviewLines(card: NotificationCardGroup, max = 3): NotificationPreviewLine[] {
  return card.notifications.slice(0, Math.max(0, max)).map((notification) => {
    const name = isCommentRow(notification)
      ? metadataString(notification, 'authorName') ?? metadataString(notification, 'mentionedBy') ?? null
      : notification.type === 'comment_reaction'
        ? metadataString(notification, 'reactionActorName') ?? null
        : null;
    const body = notification.body?.trim();
    return {
      id: notification.id,
      name,
      text: name && body ? body : notification.title,
      mention: notification.type === 'mention',
      isRead: notification.isRead,
    };
  });
}

const REVISION_ACTION_LABEL: Record<string, string> = {
  add: '등록',
  in_progress: '작업 시작',
  assignee_done: '담당 완료',
  resolve: '해결',
  reminder: '다시 알림',
};

/** 리테이크 카드 한 줄 — '등록 → 작업 시작 · 댓글 2'(오래된 것부터, 같은 단계가 이어지면 한 번만). */
export function revisionTimeline(card: NotificationCardGroup): string {
  const steps: string[] = [];
  [...card.notifications].reverse().forEach((notification) => {
    if (notification.type !== 'revision') return;
    const label = REVISION_ACTION_LABEL[metadataString(notification, 'revisionAction') ?? ''];
    if (label && steps[steps.length - 1] !== label) steps.push(label);
  });
  const parts = [steps.join(' → ')].filter(Boolean);
  if (card.commentCount > 0) parts.push(`댓글 ${card.commentCount}`);
  return parts.join(' · ');
}

/** 마지막 상태 알림의 단계 — 리테이크를 아직 불러오지 못했을 때 상태 칩 대신. */
export function latestRevisionAction(card: NotificationCardGroup): string | null {
  const latest = card.notifications.find((notification) => notification.type === 'revision' && metadataString(notification, 'revisionAction') !== 'comment');
  return latest ? metadataString(latest, 'revisionAction') ?? null : null;
}

/** 반응 카드 머리 — '박정인' / '박정인 외 1명'(최근에 반응한 사람이 앞). 이름을 모르면 빈 글. */
export function reactionActorSummary(card: NotificationCardGroup): string {
  const names: string[] = [];
  card.notifications.forEach((notification) => {
    const name = metadataString(notification, 'reactionActorName');
    if (name && !names.includes(name)) names.push(name);
  });
  if (names.length === 0) return '';
  return names.length === 1 ? names[0]! : `${names[0]} 외 ${names.length - 1}명`;
}

/** 반응 카드에 보일 이모지(최근 것부터, 겹치지 않게, 최대 max 개). */
export function reactionEmojis(card: NotificationCardGroup, max = 6): string[] {
  const emojis: string[] = [];
  card.notifications.forEach((notification) => {
    const list = (notification.metadata as { reactionEmojis?: unknown } | undefined)?.reactionEmojis;
    if (!Array.isArray(list)) return;
    [...list].reverse().forEach((emoji) => {
      if (typeof emoji === 'string' && emoji && !emojis.includes(emoji)) emojis.push(emoji);
    });
  });
  return emojis.slice(0, max);
}
