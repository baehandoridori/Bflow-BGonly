import { create } from 'zustand';

// ─── 알림 타입 정의 ─────────────────────────────────
/**
 * 알림 타입 (v1.24.0 / v1.25.5 acting_feedback / v1.25.8 scene_assignment 추가)
 * - 'comment': 자동 알림 (씬 작업자에게 발송, 차분한 톤)
 * - 'mention': 명시적 멘션 (@-멘션·답글 자동 멘션, 강한 톤 + 펄스)
 * - 'revision': 리비전 등록/진행/완료 알림
 * - 'acting_feedback': v1.25.5 — 액팅 씬 피드백 대기 요청 (강한 톤, mention 과 동일 시각 처리)
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
    /** v1.18.0: 리비전 알림 — 클릭 시 해당 리비전 패널로 이동 */
    revisionId?: string;
    /** v1.18.0: 리비전 알림 액션 종류 */
    revisionAction?: 'add' | 'in_progress' | 'resolve' | 'comment';
    /** v1.24.0: 답글 알림이면 부모 댓글 id (점프 시 펼침 처리용) */
    parentCommentId?: string;
    /** v1.24.0: 멘션 알림 발신자 식별용 (자동 멘션과 직접 멘션 구분) */
    mentionedBy?: string;
    /** v1.25.5: 액팅 피드백 알림 DB row id — 씬 점프 시 read_at 처리용 */
    feedbackNotificationId?: string;
    /** v1.25.5: 액팅 피드백 알림 표시용 메타 (예: '작업중 2차 → 피드백 대기 2차') */
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
const NOTIFICATIONS_FILE = 'notifications.json';

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
  notifications: AppNotification[];
  /** 파생 상태: notifications에서 계산 */
  readonly unreadCount: number;
  /** v1.24.0: 안 읽은 멘션 카운트 — 헤더 벨 강한 펄스 분기 */
  readonly unreadMentionCount: number;
  panelOpen: boolean;

  // 액션
  addNotification: (n: Omit<AppNotification, 'id' | 'createdAt' | 'isRead'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  loadFromDisk: () => Promise<void>;
  // v1.29.0: 이모지 반응 알림 — 묶음 UPSERT / 행 삭제 / catch-up
  upsertCommentReaction: (n: AppNotification) => void;
  removeNotificationById: (id: string) => void;
  appendCatchupCommentReactions: (rows: AppNotification[]) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function persistToDisk(notifications: AppNotification[]) {
  try {
    await window.electronAPI?.writeSettings?.(NOTIFICATIONS_FILE, notifications);
  } catch {
    // 저장 실패는 무시 (로컬 파일이라 크리티컬하지 않음)
  }
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  unreadMentionCount: 0,
  panelOpen: false,

  addNotification: (n) => {
    const notification: AppNotification = {
      ...n,
      id: generateId(),
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    const next = [notification, ...get().notifications].slice(0, MAX_NOTIFICATIONS);
    setNotifications(set, next);
    persistToDisk(next);
  },

  markAsRead: (id) => {
    const next = get().notifications.map((n) =>
      n.id === id ? { ...n, isRead: true } : n
    );
    setNotifications(set, next);
    persistToDisk(next);
  },

  markAllAsRead: () => {
    const next = get().notifications.map((n) => ({ ...n, isRead: true }));
    setNotifications(set, next);
    persistToDisk(next);
  },

  removeNotification: (id) => {
    const next = get().notifications.filter((n) => n.id !== id);
    setNotifications(set, next);
    persistToDisk(next);
  },

  clearAll: () => {
    setNotifications(set, []);
    persistToDisk([]);
  },

  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  loadFromDisk: async () => {
    try {
      const data = await window.electronAPI?.readSettings?.(NOTIFICATIONS_FILE);
      if (Array.isArray(data)) {
        const notifications = data.slice(0, MAX_NOTIFICATIONS) as AppNotification[];
        setNotifications(set, notifications);
      }
    } catch {
      // 파일 없으면 무시
    }
  },

  // v1.29.0: 이모지 반응 알림 묶음 UPSERT.
  //   같은 id 가 이미 있으면 emojis·메타 갱신 + 안 읽음 리셋 (이미 읽었어도).
  //   없으면 최상단에 prepend.
  upsertCommentReaction: (n) => {
    const list = get().notifications;
    const idx = list.findIndex((x) => x.id === n.id);
    let next: AppNotification[];
    if (idx >= 0) {
      next = [...list];
      next[idx] = { ...n };
    } else {
      next = [n, ...list].slice(0, MAX_NOTIFICATIONS);
    }
    setNotifications(set, next);
    persistToDisk(next);
  },

  // v1.29.0: 알림 행 단일 제거. id 없으면 no-op. removeNotification 과 동일 시맨틱이지만
  //   호출 의도 명시 + missing-ID 케이스 안전(race fallback).
  removeNotificationById: (id) => {
    const list = get().notifications;
    if (!list.some((x) => x.id === id)) return;
    const next = list.filter((x) => x.id !== id);
    setNotifications(set, next);
    persistToDisk(next);
  },

  // v1.29.0: catch-up 으로 받은 미읽음 묶음을 dedupe + prepend.
  //   기존 store 에 이미 있는 id 는 새 데이터로 갱신, 없는 건 prepend.
  appendCatchupCommentReactions: (rows) => {
    if (!rows.length) return;
    const list = get().notifications;
    const incomingIds = new Set(rows.map((r) => r.id));
    const merged: AppNotification[] = [
      ...rows,
      ...list.filter((x) => !incomingIds.has(x.id)),
    ].slice(0, MAX_NOTIFICATIONS);
    setNotifications(set, merged);
    persistToDisk(merged);
  },
}));
