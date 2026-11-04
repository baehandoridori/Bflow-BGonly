import { create } from 'zustand';
import {
  dedupeNotificationsByIdentity,
  getNotificationIdentity,
  prependNotificationDeduped,
} from '../utils/notificationIdentity';
import { markNotificationDomainRead, markNotificationsDomainReadBatch } from '../utils/notificationDomainRead';
import { capNotifications } from '../utils/notificationCap';
import { notificationFileNameForUser } from '../utils/notificationPersistence';
import { mergeRestoredList, splitShownNotifications, type ShownNotificationMark } from '../utils/undoDelete';

// ─── 알림 타입 정의 ─────────────────────────────────
/**
 * 알림 타입 (v1.24.0 / v1.25.5 acting_feedback / v1.25.8 scene_assignment 추가)
 * - 'comment': 자동 알림 (씬 작업자에게 발송, 차분한 톤)
 * - 'mention': 명시적 멘션 (@-멘션·답글 자동 멘션, 강한 톤 + 펄스)
 * - 'revision': 리테이크 등록/진행/완료 알림
 * - 'acting_feedback': v1.25.5 — 액팅 씬 리테이크 대기 요청 (강한 톤, mention 과 동일 시각 처리)
 * - 'scene_assignment': v1.25.8 — 본인이 새 담당자로 배정된 씬 알림 (강한 톤, mention 과 동일 시각 처리)
 * - 'calendar': 공유 캘린더 일정 변경 알림 (강한 톤, mention 과 동일 시각 처리)
 * - 'scene_change' / 'milestone' / 'system': 기존 동작 유지
 */
export type NotificationType = 'scene_change' | 'comment' | 'mention' | 'milestone' | 'system' | 'revision' | 'acting_feedback' | 'scene_assignment' | 'comment_reaction' | 'calendar';

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
    revisionAction?: 'add' | 'in_progress' | 'assignee_done' | 'resolve' | 'comment' | 'reminder';
    revisionEventId?: string;
    retakeHubSetId?: string;
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
    /** PR4: 캘린더 알림 DB row id — batch mark-read IPC 호출용 */
    calendarNotificationId?: string;
    /** PR4: 캘린더 알림의 원본 캘린더 — 뮤트 필터용 */
    calendarId?: string;
    /** PR4: 캘린더 알림 클릭 시 이동할 날짜 (YYYY-MM-DD) */
    eventDate?: string;
    /** v1.146.0: 씬 댓글 알림 판정 이유(mention·reply·retake·auto·follow). */
    reason?: string;
    /** 캐릭터 댓글 알림 — 캐릭터 상세로 이동. */
    characterId?: string;
    /** 씬 부서 힌트(bg·acting). */
    department?: string;
    /** v1.146.0: 댓글 수정으로 새로 넣은 @ — 같은 댓글의 예전 알림과 따로 센다. */
    mentionEditAt?: string;
    /** v1.148.0(§9): 알림 창 카드 미리보기 '이름 본문'. */
    authorName?: string;
    /** v1.148.0(§9): 반응 카드 머리 '박정인 외 1명'. */
    reactionActorName?: string;
    /** v1.148.0(§6.4): 씬 대화 키·스레드 키 — '이 씬 알림 끄기'·팔로우. */
    sceneThreadKey?: string;
    threadKey?: string;
    /** v1.148.0(§9): 같은 사람의 5분 안 단계 변경을 한 줄로 합친 수. */
    changeCount?: number;
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
    (x) => !x.isRead && (x.type === 'mention' || x.type === 'acting_feedback' || x.type === 'scene_assignment' || x.type === 'calendar'),
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
  /**
   * v1.146.0(씬 댓글 B안 §6.3): 아직 끝내지 않은 내 담당 리테이크 수 — 알림 창 맨 위 한 줄('담당 리테이크 N건 · 허브 열기').
   * 예전엔 로그인마다 알림 목록에 최대 50개를 다시 넣어, 지워도 다음 로그인에 되살아났다. 디스크에 저장하지 않는다.
   */
  outstandingRetakeCount: number;
  /** '허브 열기'가 갈 화면 — 모두 세트 리테이크면 리테이크 허브, 세트 없는 리테이크가 하나라도 있으면 리테이크 보드. */
  outstandingRetakeView: 'retake-hub' | 'compositing-revisions';
  setOutstandingRetakeCount: (count: number, view?: 'retake-hub' | 'compositing-revisions') => void;

  // 액션
  addNotification: (n: NotificationDraft) => string;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  /** v1.148.0(§9): 알림 창 카드의 '읽음' — 여러 줄을 한 번에(서버 읽음도 종류별로 모아서). */
  markManyAsRead: (ids: readonly string[]) => void;
  removeNotification: (id: string) => void;
  /** 목록을 지금 바로 비우고 지운 알림을 돌려준다. (알림 창의 '전체 삭제'는 움직임 뒤에 지우므로 removeShownNotifications 를 쓴다.) */
  clearAll: () => AppNotification[];
  /**
   * 움직임 폴리싱 20번: 지우기 확정(줄이 사라지는 움직임이 끝난 뒤) — 누른 순간 보이던 알림(marks)만 지우고 지운 알림을 돌려준다.
   * 그 사이 실시간으로 새로 온 알림·같은 id 로 새 내용이 온 알림은 남긴다(코덱스 2차 지적 — 보지도 못한 채 읽음 처리·삭제되던 문제).
   * 서버 쪽 읽음 처리도 지운 알림에만 한다. 누른 뒤 계정이 바뀌었으면 아무것도 하지 않는다.
   */
  removeShownNotifications: (marks: readonly ShownNotificationMark[], userId: string | null) => AppNotification[];
  /**
   * 움직임 폴리싱 20번: '전체 삭제' 되돌리기 — 지운 알림을 그대로(읽음 표시까지) 되살린다.
   * 그 사이 새로 온 알림은 위에 그대로 두고, 같은 알림은 겹치지 않게 묶는다.
   * 로컬 목록만 되살린다 — 지울 때 끝난 서버 쪽 읽음 처리는 되돌리지 않는다. 계정이 바뀌었으면 하지 않는다.
   */
  restoreNotifications: (snapshot: AppNotification[], userId: string | null) => boolean;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  loadFromDisk: (userId: string | null) => Promise<void>;
  // v1.29.0: 이모지 반응 알림 — 묶음 UPSERT / 행 삭제 / catch-up
  upsertCommentReaction: (n: AppNotification) => void;
  removeNotificationById: (id: string) => void;
  /** v1.145.0: 지워진 댓글의 알림(씬 댓글·멘션·리테이크 댓글)을 뺀다. 없으면 아무것도 하지 않는다. */
  removeNotificationsForComment: (commentId: string) => void;
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

/** 여러 줄의 서버 읽음 — 종류별로 모아 한 번에(v1.148.0 §9). remaining = 처리 뒤 이 PC 에 남는 목록. */
function syncDomainReadMany(rows: readonly AppNotification[], remaining: readonly AppNotification[], recipientId: string | null) {
  markNotificationsDomainReadBatch(rows, {
    recipientId,
    // 남는 줄에 안 읽은 반응이 없을 때만 '받는 사람의 반응 전부 읽음'을 쓴다.
    everyReaction: !remaining.some((n) => n.type === 'comment_reaction' && !n.isRead),
  });
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  activeUserId: null,
  notifications: [],
  unreadCount: 0,
  unreadMentionCount: 0,
  panelOpen: false,
  outstandingRetakeCount: 0,
  outstandingRetakeView: 'retake-hub',
  setOutstandingRetakeCount: (count, view = 'retake-hub') => set({
    outstandingRetakeCount: Math.max(0, Math.floor(count)),
    outstandingRetakeView: view,
  }),

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
    const identity = getNotificationIdentity(notification);
    const storedNotification = identity
      ? next.find((x) => getNotificationIdentity(x) === identity)
      : next.find((x) => x.id === notification.id);
    return storedNotification?.id ?? notification.id;
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
    const next = current.map((n) => ({ ...n, isRead: true }));
    syncDomainReadMany(current.filter((n) => !n.isRead), next, get().activeUserId);
    setNotifications(set, next);
    persistToDisk(get().activeUserId, next);
  },

  markManyAsRead: (ids) => {
    const wanted = new Set(ids);
    const current = get().notifications;
    const targets = current.filter((n) => wanted.has(n.id) && !n.isRead);
    if (targets.length === 0) return;
    const next = current.map((n) => (wanted.has(n.id) ? { ...n, isRead: true } : n));
    syncDomainReadMany(targets, next, get().activeUserId);
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
    const removed = get().notifications;
    syncDomainReadMany(removed, [], get().activeUserId);
    setNotifications(set, []);
    persistToDisk(get().activeUserId, []);
    return removed;
  },

  removeShownNotifications: (marks, userId) => {
    const { activeUserId, notifications } = get();
    if (marks.length === 0 || activeUserId !== userId) return [];
    const { kept, removed } = splitShownNotifications(notifications, marks);
    if (removed.length === 0) return [];
    syncDomainReadMany(removed, kept, activeUserId);
    setNotifications(set, kept);
    persistToDisk(activeUserId, kept);
    return removed;
  },

  restoreNotifications: (snapshot, userId) => {
    const { activeUserId, notifications } = get();
    if (snapshot.length === 0 || !userId || activeUserId !== userId) return false;
    const next = dedupeNotificationsByIdentity(mergeRestoredList(notifications, snapshot), MAX_NOTIFICATIONS);
    setNotifications(set, next);
    persistToDisk(activeUserId, next);
    return true;
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
    const existingReactionAt = existingReaction ? Date.parse(existingReaction.createdAt) : NaN;
    const incomingReactionAt = Date.parse(n.createdAt);
    const incomingReactionIsNewer =
      Number.isFinite(existingReactionAt) &&
      Number.isFinite(incomingReactionAt) &&
      incomingReactionAt > existingReactionAt;
    const existingRead = n.isRead === true || (existingReaction?.isRead === true && !incomingReactionIsNewer);
    const next = [
      { ...n, isRead: existingRead },
      ...list.filter((x) => x.id !== n.id && (!identity || getNotificationIdentity(x) !== identity)),
    ];
    // v1.148.0(§9): 상한은 버리는 순서대로 — 방금 온 반응도 안 읽은 멘션보다 먼저 밀린다.
    const capped = capNotifications(next, MAX_NOTIFICATIONS);
    setNotifications(set, capped);
    persistToDisk(get().activeUserId, capped);
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

  removeNotificationsForComment: (commentId) => {
    if (!commentId) return;
    const list = get().notifications;
    const next = list.filter((n) => {
      const identity = getNotificationIdentity(n);
      if (!identity) return true;
      if (identity === `scene_comment:${commentId}` || identity.startsWith(`scene_comment:${commentId}:edit:`)) return false;
      return !(identity.startsWith('revision_comment:') && identity.endsWith(`:${commentId}`));
    });
    if (next.length === list.length) return;
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

    const merged: AppNotification[] = capNotifications([...deduped, ...survivors], MAX_NOTIFICATIONS);
    setNotifications(set, merged);
    persistToDisk(get().activeUserId, merged);
  },
}));
