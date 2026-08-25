/** committed calendar delete는 persistence 성공 뒤 전달된다. 창 하나가 닫히는 경합으로
 * send가 실패해도 같은 프로세스의 나머지 창 전달까지 중단하면 안 된다. */
export type CalendarMarkerWindow = {
  isDestroyed(): boolean;
  webContents: {
    send(channel: string, payload: unknown): void;
  };
};

export function broadcastCommittedCalendarDeleteToWindows(
  mainWindow: CalendarMarkerWindow | null,
  widgetWindows: Iterable<CalendarMarkerWindow>,
  payload: unknown,
  onError: (error: unknown) => void = (error) => {
    console.warn('[Calendar] committed-delete window fanout failed:', error);
  },
): void {
  const send = (win: CalendarMarkerWindow): void => {
    try {
      if (!win.isDestroyed()) win.webContents.send('calendar:changed', payload);
    } catch (error) {
      // 진단 callback도 fanout의 persistence 후 best-effort 계약을 깨지 못하게 한다.
      try {
        onError(error);
      } catch {
        // no-op
      }
    }
  };

  if (mainWindow) send(mainWindow);
  for (const win of widgetWindows) send(win);
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
