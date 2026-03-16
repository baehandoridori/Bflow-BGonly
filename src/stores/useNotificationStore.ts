import { create } from 'zustand';

// ─── 알림 타입 정의 ─────────────────────────────────
export type NotificationType = 'scene_change' | 'comment' | 'milestone' | 'system';

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
    fromStage?: string;
    toStage?: string;
    changedBy?: string;
    commentId?: string;
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

/** notifications 변경 시 unreadCount 함께 set */
function setNotifications(
  set: (partial: Partial<NotificationState>) => void,
  notifications: AppNotification[],
) {
  set({ notifications, unreadCount: countUnread(notifications) });
}

interface NotificationState {
  notifications: AppNotification[];
  /** 파생 상태: notifications에서 계산 */
  readonly unreadCount: number;
  panelOpen: boolean;

  // 액션
  addNotification: (n: Omit<AppNotification, 'id' | 'createdAt' | 'isRead'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
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
