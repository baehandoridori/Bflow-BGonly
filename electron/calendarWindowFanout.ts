/** committed calendar delete는 persistence 성공 뒤 전달된다. 창 하나가 닫히는 경합으로
 * send가 실패해도 같은 프로세스의 나머지 창 전달까지 중단하면 안 된다. */
export type CalendarMarkerWindow = {
  isDestroyed(): boolean;
  webContents: {
    send(channel: string, payload: unknown): void;
  };
};

export type SharedCalendarSignalChannel =
  | 'calendar:changed'
  | 'supabase:realtime-event'
  | 'supabase:broadcast-event';

const SHARED_CALENDAR_TABLES = new Set([
  'calendars',
  'calendar_members',
  'calendar_events',
  'calendar_tags',
]);

function broadcastCalendarPayloadToWindows(
  channel: SharedCalendarSignalChannel,
  mainWindow: CalendarMarkerWindow | null,
  widgetWindows: Iterable<CalendarMarkerWindow>,
  payload: unknown,
  onError: (error: unknown) => void,
): void {
  const send = (win: CalendarMarkerWindow): void => {
    try {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    } catch (error) {
      try {
        onError(error);
      } catch {
        // 진단 callback도 다음 BrowserWindow 전달을 막지 않는다.
      }
    }
  };

  if (mainWindow) send(mainWindow);
  for (const win of widgetWindows) send(win);
}

/** 공유 캘린더 정본 갱신에 쓰는 세 main→renderer 채널만 destination별로 격리한다. */
export function broadcastSharedCalendarSignalToWindows(
  channel: SharedCalendarSignalChannel,
  mainWindow: CalendarMarkerWindow | null,
  widgetWindows: Iterable<CalendarMarkerWindow>,
  payload: unknown,
  onError: (error: unknown) => void = (error) => {
    console.warn(`[Calendar] ${channel} window fanout failed:`, error);
  },
): void {
  broadcastCalendarPayloadToWindows(channel, mainWindow, widgetWindows, payload, onError);
}

/** main persistence가 만든 uppercase 일반 신호만 이 경로로 모든 로컬 창에 전달한다. */
export function broadcastTrustedSharedCalendarChangeToWindows(
  mainWindow: CalendarMarkerWindow | null,
  widgetWindows: Iterable<CalendarMarkerWindow>,
  payload: unknown,
  onError: (error: unknown) => void = (error) => {
    console.warn('[Calendar] trusted shared-change window fanout failed:', error);
  },
): void {
  broadcastCalendarPayloadToWindows('calendar:changed', mainWindow, widgetWindows, payload, onError);
}

export function broadcastCommittedCalendarDeleteToWindows(
  mainWindow: CalendarMarkerWindow | null,
  widgetWindows: Iterable<CalendarMarkerWindow>,
  payload: unknown,
  onError: (error: unknown) => void = (error) => {
    console.warn('[Calendar] committed-delete window fanout failed:', error);
  },
): void {
  broadcastCalendarPayloadToWindows('calendar:changed', mainWindow, widgetWindows, payload, onError);
}

export function isCommittedCalendarDeleteMarker(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const marker = payload as Record<string, unknown>;
  if (
    marker.action !== 'delete'
    || typeof marker.eventId !== 'string'
    || marker.eventId.trim().length === 0
  ) return false;
  if (marker.committedGoogleDelete === true) {
    return typeof marker.calendarId === 'string' && marker.calendarId.trim().length > 0;
  }
  if (marker.committedPrivacyReplacementDelete !== true) return false;
  if (marker.storage === 'bflow') {
    return typeof marker.calendarId === 'string' && marker.calendarId.trim().length > 0;
  }
  if (marker.storage === 'legacy-private') {
    return marker.calendarId === undefined
      && typeof marker.ownerId === 'string'
      && marker.ownerId.trim().length > 0;
  }
  return false;
}

/** exact delete marker는 전용 relay로 남기고, 일반 calendar/data invalidation만 고른다. */
export function isSharedCalendarBroadcastSignal(event: string, payload: unknown): boolean {
  if (event === 'calendar-changed') return !isCommittedCalendarDeleteMarker(payload);
  if (event !== 'data-change' || !payload || typeof payload !== 'object') return false;
  const table = (payload as { table?: unknown }).table;
  return typeof table === 'string' && SHARED_CALENDAR_TABLES.has(table);
}

/** Supabase self-echo가 아닌 remote exact marker도 창별 best-effort 경로로 전달한다.
 *  일반 broadcast는 false를 돌려 기존 supabase:broadcast-event 경로를 그대로 쓴다. */
export function relayIncomingCommittedCalendarDeleteToWindows(
  event: string,
  payload: unknown,
  mainWindow: CalendarMarkerWindow | null,
  widgetWindows: Iterable<CalendarMarkerWindow>,
  onError?: (error: unknown) => void,
): boolean {
  if (event !== 'calendar-changed' || !isCommittedCalendarDeleteMarker(payload)) return false;
  broadcastCommittedCalendarDeleteToWindows(mainWindow, widgetWindows, payload, onError);
  return true;
}
