/** External read-only feed; authorized viewers may re-read the current bearer URL. */
export interface CalendarFeedStatus {
  calendarId: string;
  enabled: boolean;
  issuedAt: string | null;
  revision: string | null;
  preview?: boolean;
  url?: string;
}
export interface CalendarFeedRequest {
  calendarId: string;
  action: 'enable' | 'rotate' | 'revoke';
  expectedRevision: string | null;
}
export interface CalendarFeedResult extends CalendarFeedStatus { url?: string }
export function validateCalendarFeedRequest(input: unknown): asserts input is CalendarFeedRequest {
  const request = input as CalendarFeedRequest | null;
  if (!request || typeof request !== 'object'
    || !isCalendarFeedId(request.calendarId)
    || !['enable', 'rotate', 'revoke'].includes(request.action)
    || !(request.expectedRevision === null || isCalendarFeedId(request.expectedRevision))
    || Object.keys(request).some(key => !['calendarId', 'action', 'expectedRevision'].includes(key))) {
    throw new Error('구독 요청이 올바르지 않습니다. 설정을 다시 열어 주세요.');
  }
}
export function isCalendarFeedId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
