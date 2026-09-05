import type { CalendarViewMode } from '../types/calendar.ts';
import { fmtDate, parseDate } from './calendarDate.ts';

/** 보기 전환은 현재 보고 있던 날짜를 유지한다. '오늘' 버튼만 현재 날짜로 이동한다. */
export function calendarViewAnchor(input: {
  mode: CalendarViewMode; year: number; month: number; activeDayIndex: number;
  weekDays?: readonly Date[]; focusedDate?: string | null; previousAnchor?: string | null;
  now?: Date;
}): Date {
  if (input.mode === 'today') return new Date(input.year, 0, input.activeDayIndex + 1, 12);
  const candidates = [input.focusedDate, input.previousAnchor].filter((value): value is string => Boolean(value));
  if (input.mode === 'month') {
    const prefix = `${input.year}-${String(input.month + 1).padStart(2, '0')}-`;
    const selected = candidates.find(value => value.startsWith(prefix));
    if (selected) return parseDate(selected);
    const now = input.now ?? new Date();
    return now.getFullYear() === input.year && now.getMonth() === input.month
      ? parseDate(fmtDate(now)) : new Date(input.year, input.month, 1, 12);
  }
  const week = input.weekDays;
  if (week?.length) {
    const first = fmtDate(week[0]), last = fmtDate(week[week.length - 1]);
    const selected = candidates.find(value => value >= first && value <= last);
    if (selected) return parseDate(selected);
    // 일요일 시작 격자의 목요일은 주차 헤더와 같은 연·월을 가리킨다.
    return parseDate(fmtDate(week[4] ?? week[0]));
  }
  return new Date(input.year, input.month, 1, 12);
}
