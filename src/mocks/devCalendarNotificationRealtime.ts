import type { CalendarNotificationPushRow } from '../shared/calendarNotifications';

export interface DevCalendarNotificationRealtimeEvent {
  table: 'calendar_notifications';
  payload: { notification: CalendarNotificationPushRow };
}

type RealtimeListener = (event: DevCalendarNotificationRealtimeEvent) => void;

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
