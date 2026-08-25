import type { CalendarEvent, BflowCalendar } from '../types/calendar.ts';

/** 태그줄 내장 휴가 칩의 고정 id (calendar_tags 테이블에는 없음) */
export const VACATION_CHIP_ID = 'builtin-vacation';

export interface CalendarFilterState {
  visibleCalendarIds: Readonly<Record<string, boolean>>;
  enabledTagIds: Readonly<Record<string, boolean>>;
  googleVisible: boolean;
  /** 캘린더 메타데이터가 한 번 성공한 후 현재 사용자가 열람할 수 있는 B flow 캘린더 id. */
  knownCalendarIds?: ReadonlySet<string>;
  /** calendarId 가 없던 private_calendar_events 행을 현재 개인 캘린더 토글에 연결한다. */
  personalCalendarId?: string;
}

const LEGACY_PRIVATE_SOURCE_CALENDAR_ID = 'supabase-private';

function isLegacyPrivateBflowEvent(ev: CalendarEvent): boolean {
  return ev.sourceCalendarId === LEGACY_PRIVATE_SOURCE_CALENDAR_ID
    && !ev.calendarId
    && ev.source !== 'google'
    && ev.source !== 'vacation'
    && ev.type !== 'vacation';
}

function sourceOf(ev: CalendarEvent): 'bflow' | 'google' | 'vacation' {
  if (ev.source) return ev.source;
  if (ev.type === 'vacation') return 'vacation';
  if (isLegacyPrivateBflowEvent(ev)) return 'bflow';
  return ev.calendarId ? 'bflow' : 'google';
}

/** (켜진 캘린더) ∩ (켜진 태그). 태그 없는 일정은 태그 필터를 무시한다. */
export function filterCalendarEvents(
  events: readonly CalendarEvent[], state: CalendarFilterState,
): CalendarEvent[] {
  return events.filter((ev) => {
    const source = sourceOf(ev);
    if (source === 'vacation') return state.enabledTagIds[VACATION_CHIP_ID] !== false;
    if (source === 'google') return state.googleVisible;
    const calendarId = ev.calendarId
      ?? (isLegacyPrivateBflowEvent(ev) ? state.personalCalendarId : undefined);
    if (ev.calendarId && state.knownCalendarIds && !state.knownCalendarIds.has(ev.calendarId)) return false;
    if (calendarId && state.visibleCalendarIds[calendarId] === false) return false;
    if (ev.tagId && state.enabledTagIds[ev.tagId] === false) return false;
    return true;
  });
}

/** 칩 텍스트: 시간 일정 'HH:MM 제목' / 종일 '태그명 · 제목' / 태그 없음 '캘린더명 · 제목'. */
export function formatEventChipText(
  ev: CalendarEvent, tagNameById: Record<string, string>, calendarNameById: Record<string, string>,
): string {
  if (ev.allDay === false && ev.startTime) return `${ev.startTime} ${ev.title}`;
  const source = sourceOf(ev);
  const prefix = (ev.tagId ? tagNameById[ev.tagId] : undefined)
    ?? (source === 'google' ? '구글' : source === 'vacation' ? '휴가'
      : ev.calendarId ? calendarNameById[ev.calendarId] : undefined);
  return prefix ? `${prefix} · ${ev.title}` : ev.title;
}

/** 주/오늘 카드 목록 정렬: 종일 먼저, 시간 일정은 시각순(같으면 제목 가나다). */
export function sortEventsForList(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    const at = a.allDay === false && !!a.startTime;
    const bt = b.allDay === false && !!b.startTime;
    if (at !== bt) return at ? 1 : -1;
    if (at && bt && a.startTime !== b.startTime) return (a.startTime as string).localeCompare(b.startTime as string);
    return a.title.localeCompare(b.title, 'ko');
  });
}

/** 카드 부제 '14:00 – 15:00 · 태그명'. 종일이면 null. */
export function formatEventTimeRange(
  ev: CalendarEvent, tagNameById: Record<string, string>,
): string | null {
  if (ev.allDay !== false || !ev.startTime) return null;
  const range = ev.endTime && ev.endTime !== ev.startTime ? `${ev.startTime} – ${ev.endTime}` : ev.startTime;
  const tag = ev.tagId ? tagNameById[ev.tagId] : undefined;
  return tag ? `${range} · ${tag}` : range;
}

/** 레일 섹션: team=팀 전체(소유 무관) / mine=내 소유 비-team / shared=공유받음. */
export function groupCalendarsForRail(calendars: readonly BflowCalendar[], myUserId: string) {
  const mine: BflowCalendar[] = [];
  const team: BflowCalendar[] = [];
  const shared: BflowCalendar[] = [];
  for (const calendar of calendars) {
    if (calendar.visibility === 'team') team.push(calendar);
    else if (calendar.ownerId === myUserId) mine.push(calendar);
    else shared.push(calendar);
  }
  mine.sort((a, b) => Number(b.isPersonal) - Number(a.isPersonal));
  return { mine, team, shared };
}
