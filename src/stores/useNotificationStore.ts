import { create } from 'zustand';

// ─── 알림 타입 정의 ─────────────────────────────────
/**
 * 알림 타입 (v1.24.0)
 * - 'comment': 자동 알림 (씬 작업자에게 발송, 차분한 톤)
 * - 'mention': 명시적 멘션 (@-멘션·답글 자동 멘션, 강한 톤 + 펄스)
 * - 'revision': 리비전 등록/진행/완료 알림
 * - 'scene_change' / 'milestone' / 'system': 기존 동작 유지
 */
export type NotificationType = 'scene_change' | 'comment' | 'mention' | 'milestone' | 'system' | 'revision';

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
    /** v1.18.0: 리비전 알림 — 클릭 시 해당 리비전 패널로 이동 */
    revisionId?: string;
    /** v1.18.0: 리비전 알림 액션 종류 */
    revisionAction?: 'add' | 'in_progress' | 'resolve' | 'comment';
    /** v1.24.0: 답글 알림이면 부모 댓글 id (점프 시 펼침 처리용) */
    parentCommentId?: string;
    /** v1.24.0: 멘션 알림 발신자 식별용 (자동 멘션과 직접 멘션 구분) */
    mentionedBy?: string;
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
 * type==='mention' 만 멘션으로 간주 (자동 'comment' 알림은 차분한 톤).
 */
function countUnreadMentions(notifications: AppNotification[]): number {
  return notifications.filter((x) => !x.isRead && x.type === 'mention').length;
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
}));
