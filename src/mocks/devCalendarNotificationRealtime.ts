import type { CalendarNotificationPushRow } from '../shared/calendarNotifications';

export interface DevCalendarNotificationRealtimeEvent {
  table: 'calendar_notifications';
  payload: { notification: CalendarNotificationPushRow };
}

/** v1.145.0: 미리보기의 comments 실시간 메아리(실제 앱은 자기 쓰기도 postgres_changes 로 다시 받는다). */
export interface DevCommentRealtimeEvent {
  table: 'comments';
  payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Record<string, unknown>; old: Record<string, unknown> };
}

type RealtimeListener = (event: DevCalendarNotificationRealtimeEvent | DevCommentRealtimeEvent) => void;

/** Preview의 calendar_notifications Realtime IPC 경로만 재현한다. */
export function createDevCalendarNotificationRealtimeListeners(
  onListenerError: (error: unknown) => void = (error) => {
    console.warn('[dev preview realtime] listener failed:', error);
  },
) {
  const listeners = new Set<RealtimeListener>();

  return {
    subscribe(callback: RealtimeListener): () => void {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    emitCommentChange(event: DevCommentRealtimeEvent): void {
      for (const callback of listeners) {
        try {
          callback(event);
        } catch (error) {
          onListenerError(error);
        }
      }
    },
    emitCalendarNotification(notification: CalendarNotificationPushRow): void {
      const event: DevCalendarNotificationRealtimeEvent = {
        table: 'calendar_notifications',
        payload: { notification },
      };
      for (const callback of listeners) {
        try {
          callback(event);
        } catch (error) {
          onListenerError(error);
        }
      }
    },
  };
}
