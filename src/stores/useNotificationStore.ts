import { create } from 'zustand';
import {
  dedupeNotificationsByIdentity,
  getNotificationIdentity,
  prependNotificationDeduped,
} from '../utils/notificationIdentity';
import { markNotificationDomainRead } from '../utils/notificationDomainRead';
import { notificationFileNameForUser } from '../utils/notificationPersistence';

// ─── 알림 타입 정의 ─────────────────────────────────
/**
 * 알림 타입 (v1.24.0 / v1.25.5 acting_feedback / v1.25.8 scene_assignment 추가)
 * - 'comment': 자동 알림 (씬 작업자에게 발송, 차분한 톤)
 * - 'mention': 명시적 멘션 (@-멘션·답글 자동 멘션, 강한 톤 + 펄스)
 * - 'revision': 리테이크 등록/진행/완료 알림
 * - 'acting_feedback': v1.25.5 — 액팅 씬 리테이크 대기 요청 (강한 톤, mention 과 동일 시각 처리)
 * - 'scene_assignment': v1.25.8 — 본인이 새 담당자로 배정된 씬 알림 (강한 톤, mention 과 동일 시각 처리)
 * - 'scene_change' / 'milestone' / 'system': 기존 동작 유지
 */
export type NotificationType = 'scene_change' | 'comment' | 'mention' | 'milestone' | 'system' | 'revision' | 'acting_feedback' | 'scene_assignment' | 'comment_reaction';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  metadata?: {
    episodeId?: string;
    episodeName?: string;
    partId?: string;
    sceneId?: string;
    sceneName?: string;
    sheetName?: string;
    fromStage?: string;
    toStage?: string;
    changedBy?: string;
    commentId?: string;
    /** comments.scene_id — 댓글 저장용 scene.no(sort_order). scene_uuid 없는 알림의 정확한 fallback */
    commentSceneId?: string;
    /** comments.part_id — 댓글이 저장된 Supabase part UUID */
    commentPartId?: string;
    /** v1.18.0: 리테이크 알림 — 클릭 시 해당 리테이크 패널로 이동 */
    revisionId?: string;
    /** v1.18.0: 리테이크 알림 액션 종류 (2단계: 담당 완료 추가) */
    revisionAction?: 'add' | 'in_progress' | 'assignee_done' | 'resolve' | 'comment';
    /** v1.24.0: 답글 알림이면 부모 댓글 id (점프 시 펼침 처리용) */
    parentCommentId?: string;
    /** v1.24.0: 멘션 알림 발신자 식별용 (자동 멘션과 직접 멘션 구분) */
    mentionedBy?: string;
    /** v1.25.5: 액팅 리테이크 알림 DB row id — 씬 점프 시 read_at 처리용 */
    feedbackNotificationId?: string;
    /** v1.25.5: 액팅 리테이크 알림 표시용 메타 (예: '작업중 2차 → 리테이크 대기 2차') */
    feedbackTransition?: string;
    /** v1.25.8: 씬 담당자 배정 알림 DB row id — 씬 점프 시 read_at 처리용 */
    assignmentNotificationId?: string;
    /** v1.25.8: 씬 담당자 배정 알림 표시용 메타 (예: '미배정 → 한솔') */
    assignmentTransition?: string;
    /** v1.29.0: 이모지 반응 알림 — comment_reaction_notifications row id (markRead 호출용) */
    reactionNotificationId?: string;
    /** v1.29.0: 이모지 반응 알림 — 누적된 이모지 배열 (UI 표시용, "❤️🔥👏" 묶기) */
    reactionEmojis?: string[];
    /** v1.29.0: 이모지 반응 알림 — 반응한 사람 id (자기 자신 필터링 fallback) */
    reactionActorId?: string;
  };
  isRead: boolean;
  createdAt: string; // ISO 8601
}

const MAX_NOTIFICATIONS = 50;

type NotificationDraft = Omit<AppNotification, 'id' | 'createdAt' | 'isRead'> & { createdAt?: string };

/** notifications 배열에서 unreadCount 파생 */
function countUnread(notifications: AppNotification[]): number {
  return notifications.filter((x) => !x.isRead).length;
}

/**
 * v1.24.0: 안 읽은 멘션 카운트 — 헤더 벨이 강한 펄스로 전환되는 트리거.
 * v1.25.5: acting_feedback 도 강한 톤 (검수 요청) — mention 과 동일 분기.
 * v1.25.8: scene_assignment 도 강한 톤 (담당자 배정) — mention 과 동일 분기.
 */
function countUnreadMentions(notifications: AppNotification[]): number {
  return notifications.filter(
    (x) => !x.isRead && (x.type === 'mention' || x.type === 'acting_feedback' || x.type === 'scene_assignment'),
  ).length;
}

/** notifications 변경 시 unreadCount + unreadMentionCount 함께 set */
function setNotifications(
  set: (partial: Partial<NotificationState>) => void,
  notifications: AppNotification[],
) {
  set({
    notifications,
    unreadCount: countUnread(notifications),
    unreadMentionCount: countUnreadMentions(notifications),
  });
}

interface NotificationState {
  activeUserId: string | null;
  notifications: AppNotification[];
  /** 파생 상태: notifications에서 계산 */
  readonly unreadCount: number;
  /** v1.24.0: 안 읽은 멘션 카운트 — 헤더 벨 강한 펄스 분기 */
  readonly unreadMentionCount: number;
  panelOpen: boolean;

  // 액션
  addNotification: (n: NotificationDraft) => string;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  loadFromDisk: (userId: string | null) => Promise<void>;
  // v1.29.0: 이모지 반응 알림 — 묶음 UPSERT / 행 삭제 / catch-up
  upsertCommentReaction: (n: AppNotification) => void;
  removeNotificationById: (id: string) => void;
  /** v1.29.0: catch-up 결과 머지.
   *  - sinceISO: catch-up 시작 시점의 lastSeen. 이 이전 알림은 보존 (이미 정합).
   *  - fetchStartedISO: fetch loop 진입 직전 시각. 이 이후 store 에 들어온 알림은
   *    catch-up race 로 인한 realtime 신규 알림이므로 stale 로 보지 말고 보존
   *    (코덱스 12차 P1). 두 시각 사이 (sinceISO < createdAt <= fetchStartedISO) 의
   *    행 중 fetched 에 없는 건 stale 로 제거.
   *  fetchStartedISO 미제공 시 purge 안전사이드로 비활성 (이전 동작 유지). */
  appendCatchupCommentReactions: (
    rows: AppNotification[],
    sinceISO?: string,
    fetchStartedISO?: string,
  ) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function persistToDisk(userId: string | null, notifications: AppNotification[]) {
  if (!userId) return;
  try {
    await window.electronAPI?.writeSettings?.(notificationFileNameForUser(userId), notifications);
  } catch {
    // 저장 실패는 무시 (로컬 파일이라 크리티컬하지 않음)
  }
}

function syncDomainRead(notification: AppNotification) {
  markNotificationDomainRead(
    notification.type,
    notification.metadata as Record<string, unknown> | undefined,
  );
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  activeUserId: null,
  notifications: [],
  unreadCount: 0,
  unreadMentionCount: 0,
  panelOpen: false,

  addNotification: (n) => {
    const notification: AppNotification = {
      ...n,
      id: generateId(),
      isRead: false,
      createdAt: n.createdAt ?? new Date().toISOString(),
    };
    const next = prependNotificationDeduped(get().notifications, notification, MAX_NOTIFICATIONS);
    setNotifications(set, next);
    persistToDisk(get().activeUserId, next);
    return notification.id;
  },

  markAsRead: (id) => {
    const current = get().notifications;
    const target = current.find((n) => n.id === id);
    if (target && !target.isRead) syncDomainRead(target);
    const next = current.map((n) =>
      n.id === id ? { ...n, isRead: true } : n
    );
    setNotifications(set, next);
    persistToDisk(get().activeUserId, next);
  },

  markAllAsRead: () => {
    const current = get().notifications;
    current.filter((n) => !n.isRead).forEach(syncDomainRead);
    const next = current.map((n) => ({ ...n, isRead: true }));
    setNotifications(set, next);
    persistToDisk(get().activeUserId, next);
  },

  removeNotification: (id) => {
    const current = get().notifications;
    const target = current.find((n) => n.id === id);
    if (target) syncDomainRead(target);
    const next = current.filter((n) => n.id !== id);
    setNotifications(set, next);
    persistToDisk(get().activeUserId, next);
  },

  clearAll: () => {
    get().notifications.forEach(syncDomainRead);
    setNotifications(set, []);
    persistToDisk(get().activeUserId, []);
  },

  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  loadFromDisk: async (userId) => {
    if (!userId) {
      set({
        activeUserId: null,
        notifications: [],
        unreadCount: 0,
        unreadMentionCount: 0,
      });
      return;
    }

    if (get().activeUserId !== userId) {
      set({
        activeUserId: userId,
        notifications: [],
        unreadCount: 0,
        unreadMentionCount: 0,
      });
    }

    try {
      const data = await window.electronAPI?.readSettings?.(notificationFileNameForUser(userId));
      if (get().activeUserId !== userId) return;
      if (Array.isArray(data)) {
        const notifications = dedupeNotificationsByIdentity(
          [...get().notifications, ...(data as AppNotification[])],
          MAX_NOTIFICATIONS,
        );
        setNotifications(set, notifications);
      }
    } catch {
      // 파일 없으면 무시
    }
  },

  // v1.29.0: 이모지 반응 알림 묶음 UPSERT.
  //   같은 id 가 이미 있어도 새 이모지로 갱신된 행은 createdAt/read_at 이 사실상 갱신된 것이므로
  //   "새 알림" 으로 취급해 **최상단으로 이동**시킨다. (코덱스 3차 P2: in-place 갱신 시 묻혀서
  //   사용자가 놓치는 문제.) 없으면 그대로 prepend.
  upsertCommentReaction: (n) => {
    const list = get().notifications;
    const identity = getNotificationIdentity(n);
    const existingReaction = list.find((x) =>
      x.id === n.id || (!!identity && getNotificationIdentity(x) === identity)
    );
    const existingRead = existingReaction?.isRead === true || n.isRead === true;
    const next = [
      { ...n, isRead: existingRead },
      ...list.filter((x) => x.id !== n.id && (!identity || getNotificationIdentity(x) !== identity)),
    ].slice(0, MAX_NOTIFICATIONS);
    setNotifications(set, next);
    persistToDisk(get().activeUserId, next);
  },

  // v1.29.0: 알림 행 단일 제거. id 없으면 no-op. removeNotification 과 동일 시맨틱이지만
  //   호출 의도 명시 + missing-ID 케이스 안전(race fallback).
  removeNotificationById: (id) => {
    const list = get().notifications;
    if (!list.some((x) => x.id === id)) return;
    const next = list.filter((x) => x.id !== id);
    setNotifications(set, next);
    persistToDisk(get().activeUserId, next);
  },

  // v1.29.0: catch-up 으로 받은 미읽음 묶음을 dedupe + prepend.
  //   기존 store 에 이미 있는 id 는 새 데이터로 갱신, 없는 건 prepend.
  appendCatchupCommentReactions: (rows, sinceISO, fetchStartedISO) => {
    // 코덱스 8차 P2: rows 자체에 같은 id 가 두 번 들어올 수 있음 (페이지네이션 경계에서
    //   같은 행이 두 페이지에 걸쳐 fetch 되는 race). Map 으로 last-wins dedupe 한 후 store 와 머지.
    const dedupedMap = new Map<string, AppNotification>();
    for (const r of rows) dedupedMap.set(r.id, r);
    const deduped = Array.from(dedupedMap.values());

    const list = get().notifications;
    const incomingIds = new Set(deduped.map((r) => r.id));
    // 코덱스 11차 P2 + 12차 P1: stale alert purge.
    //   purge 대상은 "pre-fetch snapshot 안에 있던 since 이후 행" 만.
    //   - createdAt > fetchStartedISO 면 catch-up loop 중 realtime 으로 들어온 신규 알림 → 보존.
    //   - createdAt <= sinceISO 면 since 이전이라 catch-up 대상 외 → 보존.
    //   - 그 사이 (since < createdAt <= fetchStarted) 인데 fetched 결과에 없으면 → stale 처리.
    //   sinceISO 미제공 시 purge 비활성 (기존 호출처 호환).
    const survivors = list.filter((x) => {
      if (incomingIds.has(x.id)) return false; // 새 데이터로 덮어쓸 예정
      if (!sinceISO) return true;
      if (x.type !== 'comment_reaction') return true;
      if (x.createdAt <= sinceISO) return true;                    // since 이전 — 보존
      if (fetchStartedISO && x.createdAt > fetchStartedISO) return true; // snapshot 이후 신규 — 보존
      return false; // 그 사이 → stale
    });

    if (!deduped.length && survivors.length === list.length) return;  // 변경 없음

    const merged: AppNotification[] = [...deduped, ...survivors].slice(0, MAX_NOTIFICATIONS);
    setNotifications(set, merged);
    persistToDisk(get().activeUserId, merged);
  },
}));
