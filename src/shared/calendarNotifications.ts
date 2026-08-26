// 캘린더 알림 — 수신자 계산·문구 생성 순수 함수 (메인·렌더러·테스트 공용).
// node --test 가 직접 임포트하므로 @/ alias·외부 import 금지.

export type CalendarNotificationAction = 'create' | 'update' | 'delete';

export interface NotifCalendarShape {
  owner_id: string;
  visibility: 'private' | 'members' | 'team';
}

/** 수신자 = 해당 캘린더를 볼 수 있는 사용자 전원 - 행위자 본인.
 * team 이면 전체 users, 그 외는 소유자 + calendar_members. 중복 제거. */
export function computeCalendarNotificationRecipients(
  calendar: NotifCalendarShape,
  memberUserIds: string[],
  allUserIds: string[],
  actorId: string,
): string[] {
  const base = calendar.visibility === 'team'
    ? allUserIds
    : [calendar.owner_id, ...memberUserIds];
  return Array.from(new Set(base)).filter((id) => !!id && id !== actorId);
}

/** '2026-09-25' → '9/25'. 형식이 다르면 원문 그대로 반환. */
export function formatCalendarDateShort(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${Number(match[2])}/${Number(match[3])}`;
}

/** update 알림의 detail — 날짜가 실제로 바뀐 경우에만 'M/D → M/D'.
 * 시작일 변경 우선, 시작일이 같고 종료일만 바뀌면 종료일 기준. 그 외 변경은 null. */
export function buildCalendarChangeDetail(
  previous: { startDate: string; endDate: string },
  next: { startDate: string; endDate: string },
): string | null {
  if (previous.startDate !== next.startDate) {
    return `${formatCalendarDateShort(previous.startDate)} → ${formatCalendarDateShort(next.startDate)}`;
  }
  if (previous.endDate !== next.endDate) {
    return `${formatCalendarDateShort(previous.endDate)} → ${formatCalendarDateShort(next.endDate)}`;
  }
  return null;
}

export interface CalendarNotificationTextInput {
  actorName: string;
  calendarName: string;
  eventTitle: string;
  action: CalendarNotificationAction;
  detail: string | null;
}

/** 알림 패널 표시 문구 — realtime push 와 catchup 이 같은 문구를 쓴다. */
export function buildCalendarNotificationText(
  row: CalendarNotificationTextInput,
): { title: string; body: string } {
  switch (row.action) {
    case 'create':
      return {
        title: `${row.actorName} 님이 [${row.calendarName}] 에 일정을 추가했어요`,
        body: `'${row.eventTitle}'`,
      };
    case 'update':
      return {
        title: `${row.actorName} 님이 '${row.eventTitle}' 을 변경했어요`,
        body: row.detail ?? `[${row.calendarName}]`,
      };
    case 'delete':
      return {
        title: `${row.actorName} 님이 [${row.calendarName}] 의 일정을 삭제했어요`,
        body: `'${row.eventTitle}'`,
      };
  }
}
