// 캘린더 주말 숨김(주 5일 보기)과 이벤트 바 배치.
// node --test 가 직접 import 하는 모듈: @/ alias·외부 의존 금지.

import type { CalendarEvent } from '../types/calendar';
import { daysBetween, fmtDate } from './calendarDate.ts';
import { calendarEventIdentityKey } from './calendarEventIdentity.ts';

/** 일요일(0)·토요일(6). */
export function isWeekendDate(date: Date): boolean {
  const dow = date.getDay();
  return dow === 0 || dow === 6;
}

/**
 * 그 주에서 실제로 그릴 날짜만 남긴다.
 * 주말을 보여줄 때는 원본 배열을 그대로 돌려줘 상위 useMemo 의 참조가 흔들리지 않게 한다.
 */
export function visibleWeekDays(days: readonly Date[], showWeekends: boolean): readonly Date[] {
  if (showWeekends) return days;
  return days.filter((day) => !isWeekendDate(day));
}

/** 이벤트의 연속 바 레이아웃 계산 */
export interface EventBar {
  event: CalendarEvent;
  row: number;
  startCol: number; // days 안에서의 0-indexed 위치
  span: number;     // 몇 칸을 차지하는지
  isStart: boolean; // 이 구간에서 시작하는가(아니면 앞에서 이어져 온 것)
  isEnd: boolean;   // 이 구간에서 끝나는가
}

function isVacationEvent(event: CalendarEvent): boolean {
  return event.type === 'vacation' || event.source === 'vacation';
}

/** 막대 동률을 가를 이름 — 휴가는 사람 이름, 그 밖의 일정은 제목 */
function eventBarName(event: CalendarEvent): string {
  return event.vacationUserName ?? event.title ?? '';
}

/**
 * 막대 쌓는 순서: 기간 긴 순 → 시작일 → (일반 일정 먼저, 휴가 나중) → 이름 가나다순 → 제목.
 *
 * 예전에는 기간·시작일이 같으면 입력 순서를 따랐다. 휴가는 등록 순으로 들어오므로 새로 등록한 휴가가
 * 늘 아래 줄로 밀려, 휴가가 몰린 날 '+N 더보기' 뒤로 숨었다. 이제 이름 순으로 결정적이다.
 * 일반 일정·휴가 묶음 순서는 화면이 넘겨주던 순서(일반 일정 뒤에 휴가)를 그대로 지켜,
 * 같은 날 팀 일정이 휴가 이름에 밀려 가려지는 일은 없다.
 */
export function compareEventBarOrder(a: CalendarEvent, b: CalendarEvent): number {
  const dSpan = daysBetween(b.startDate, b.endDate) - daysBetween(a.startDate, a.endDate);
  if (dSpan !== 0) return dSpan;
  const dStart = a.startDate.localeCompare(b.startDate);
  if (dStart !== 0) return dStart;
  const dKind = Number(isVacationEvent(a)) - Number(isVacationEvent(b));
  if (dKind !== 0) return dKind;
  const dName = eventBarName(a).localeCompare(eventBarName(b), 'ko');
  if (dName !== 0) return dName;
  return (a.title ?? '').localeCompare(b.title ?? '', 'ko');
}

/**
 * 주어진 **보이는 날짜 목록** 위에 이벤트 바를 배치한다.
 *
 * 열 번호는 날짜 목록 안에서의 index다. 주말을 숨기면 금·월 칸이 격자에서 맞붙으므로
 * 금~월 일정은 끊기지 않은 막대 하나가 된다. 반대로 주말에만 걸친 일정은 보일 칸이
 * 없어 결과에서 빠진다(주말 숨김의 의도된 동작).
 */
export function layoutEventBars(events: CalendarEvent[], days: readonly Date[]): EventBar[] {
  if (days.length === 0) return [];

  const dayStrings = days.map(fmtDate);
  const first = dayStrings[0];
  const last = dayStrings[dayStrings.length - 1];

  const relevant = events
    .filter((e) => e.endDate >= first && e.startDate <= last)
    .sort(compareEventBarOrder);

  const cols = days.length;
  const rows: string[][] = []; // rows[row][col] = identityKey or ''
  const bars: EventBar[] = [];

  for (const ev of relevant) {
    const startCol = dayStrings.findIndex((dateStr) => dateStr >= ev.startDate);
    let endCol = -1;
    for (let index = dayStrings.length - 1; index >= 0; index--) {
      if (dayStrings[index] <= ev.endDate) {
        endCol = index;
        break;
      }
    }
    // 숨긴 날짜에만 걸친 일정은 그릴 칸이 없다.
    if (startCol === -1 || endCol === -1 || endCol < startCol) continue;
    const span = endCol - startCol + 1;

    // 모든 칸이 비어 있는 줄을 찾는다.
    let placed = -1;
    for (let r = 0; r < rows.length; r++) {
      let free = true;
      for (let c = startCol; c <= endCol; c++) {
        if (rows[r][c]) { free = false; break; }
      }
      if (free) { placed = r; break; }
    }
    if (placed === -1) {
      placed = rows.length;
      rows.push(new Array(cols).fill(''));
    }
    for (let c = startCol; c <= endCol; c++) {
      rows[placed][c] = calendarEventIdentityKey(ev);
    }

    bars.push({
      event: ev,
      row: placed,
      startCol,
      span,
      isStart: ev.startDate >= first,
      isEnd: ev.endDate <= last,
    });
  }

  return bars;
}
