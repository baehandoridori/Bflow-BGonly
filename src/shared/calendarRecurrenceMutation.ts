import type { CalendarEvent } from '../types/calendar';
import type { CalendarRecurrenceScope } from './calendarRecurrenceContract';
import { getOccurrenceDates, materializeRecurrenceOccurrence, shiftRecurrenceDate } from './calendarRecurrence';

const ruleKey=(rule:CalendarEvent['recurrenceRule'],omitEnds=false)=>JSON.stringify(rule ? Object.fromEntries(Object.entries(rule).filter(([key])=>!omitEnds||!['count','until'].includes(key)).sort(([a],[b])=>a.localeCompare(b))) : null);

/** Pure preview/optimistic series operation. The database rechecks ACL and revision at commit. */
export function mutateRecurringMaster(master: CalendarEvent, action: 'update'|'delete', scope: CalendarRecurrenceScope,
  occurrenceDate: string | undefined, patch: Partial<CalendarEvent>, splitId: string): CalendarEvent[] {
  const rule = master.recurrenceRule;
  const revision = (master.recurrenceRevision ?? 0) + 1;
  if (!rule) scope = 'all';
  if (scope !== 'all') {
    if (!occurrenceDate || !getOccurrenceDates(master.startDate, rule!, occurrenceDate, occurrenceDate).includes(occurrenceDate)) {
      throw new Error('반복 일정의 날짜가 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.');
    }
  }
  if (scope === 'this') {
    const allowed=['title','memo','tagId','tagIds','allDay','startDate','endDate','startTime','endTime','location','meetingUrl','reminderMinutes'];
    if (Object.keys(patch).some(key=>!allowed.includes(key))) throw new Error('반복 규칙과 캘린더는 이후 일정 또는 전체 일정에서 변경해 주세요.');
    const exceptions = [...(master.recurrenceExceptions ?? []).filter(ex => ex.occurrenceDate !== occurrenceDate)];
    const previous = master.recurrenceExceptions?.find(ex => ex.occurrenceDate === occurrenceDate);
    exceptions.push({ occurrenceDate: occurrenceDate!, cancelled: action === 'delete', patch: action==='delete'?{}:{ ...previous?.patch, ...patch } });
    return [{ ...master, recurrenceExceptions: exceptions, recurrenceRevision: revision }];
  }
  if (scope === 'following') {
    const before = getOccurrenceDates(master.startDate, rule!, master.startDate, shiftRecurrenceDate(occurrenceDate!, -1));
    if (!before.length) scope = 'all';
    else {
      const oldRule = { ...rule!, until: shiftRecurrenceDate(occurrenceDate!, -1) }; delete oldRule.count;
      const old = { ...master, recurrenceRule: oldRule, recurrenceRevision: revision,
        recurrenceExceptions: master.recurrenceExceptions?.filter(ex => ex.occurrenceDate < occurrenceDate!) };
      if (action === 'delete') return [old];
      const nextRule = patch.recurrenceRule === undefined ? { ...rule! } : patch.recurrenceRule ? {...patch.recurrenceRule} : null;
      if (nextRule && (patch.recurrenceRule === undefined || ruleKey(patch.recurrenceRule)===ruleKey(rule)) && nextRule.count) nextRule.count -= before.length;
      const next = materializeRecurrenceOccurrence(master, occurrenceDate!)!;
      const startDate=patch.startDate??occurrenceDate!;
      const structural=ruleKey(nextRule,true)!==ruleKey(rule,true)||startDate!==occurrenceDate;
      const retained=structural?[]:master.recurrenceExceptions?.filter(ex=>ex.occurrenceDate>=occurrenceDate!&&nextRule&&getOccurrenceDates(startDate,nextRule,ex.occurrenceDate,ex.occurrenceDate).length>0);
      return [old, { ...next, ...patch, id: splitId, recurrenceSeriesId: undefined, recurrenceDate: undefined,
        recurrenceRule: nextRule, recurrenceRevision: 0,
        recurrenceExceptions: retained }];
    }
  }
  if (action === 'delete') return [];
  return [{ ...master, ...patch, recurrenceRevision: revision,
    recurrenceExceptions: (patch.recurrenceRule!==undefined && ruleKey(patch.recurrenceRule)!==ruleKey(rule)) || (patch.startDate!==undefined && patch.startDate!==master.startDate) ? [] : master.recurrenceExceptions }];
}
