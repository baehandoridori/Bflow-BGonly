// 휴가(VacationEvent) → 캘린더 이벤트 변환 공용화.
// 기존 3중복: ScheduleView('vac')/CalendarWidget('wvac')/CalendarView('gvac') — 접두만 달랐음.
// node --test 가 직접 import 하는 모듈: @/ alias 금지, 상대 import 만.
import type { CalendarEvent } from '../types/calendar.ts';
import { VACATION_COLOR, type VacationEvent } from '../types/vacation.ts';

export type VacationIdPrefix = 'vac' | 'wvac' | 'gvac';

export function mapVacationEvents(raw: VacationEvent[], idPrefix: VacationIdPrefix): CalendarEvent[] {
  return raw.map((v, i) => ({
    id: `${idPrefix}-${v.name}-${v.startDate}-${i}`,
    title: `${v.name} ${v.type}`,
    memo: '',
    color: VACATION_COLOR,
    type: 'vacation' as const,
    startDate: v.startDate,
    endDate: v.endDate,
    createdBy: v.name,
    createdAt: new Date().toISOString(),
    vacationType: v.type,
    vacationUserName: v.name,
    isReadOnly: true,
  }));
}
