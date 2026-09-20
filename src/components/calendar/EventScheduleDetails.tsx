import { useEffect } from 'react';
import { GlassDropdown } from '@/components/common/GlassDropdown';
import { previewRecurrenceDates, validateCalendarRecurrenceRule, type CalendarRecurrenceRule } from '@/shared/calendarRecurrence';
import type { CalendarEvent } from '@/types/calendar';

export interface EventScheduleDetailsValue {
  recurrenceRule: CalendarRecurrenceRule | null;
  location: string;
  meetingUrl: string;
  reminderMinutes: number | null;
}
export function eventScheduleDetails(event?: Partial<CalendarEvent>): EventScheduleDetailsValue {
  return { recurrenceRule: event?.recurrenceRule ?? null, location: event?.location ?? '', meetingUrl: event?.meetingUrl ?? '', reminderMinutes: event?.reminderMinutes ?? null };
}
export function safeMeetingUrl(value: string): boolean {
  if (!value.trim()) return true;
  try { const url = new URL(value.trim()); return ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; } catch { return false; }
}
export function eventScheduleDetailsValid(value: EventScheduleDetailsValue, startDate: string): boolean {
  if (!safeMeetingUrl(value.meetingUrl)) return false;
  try { if (value.recurrenceRule) validateCalendarRecurrenceRule(value.recurrenceRule, startDate); return true; } catch { return false; }
}
/** A moved exception can fall after UNTIL; unchanged series rules still use its original occurrence. */
export function eventScheduleValidationDate(value: EventScheduleDetailsValue, event: CalendarEvent, draftStart: string): string {
  return event.recurrenceRule && JSON.stringify(value.recurrenceRule) === JSON.stringify(event.recurrenceRule)
    ? event.recurrenceDate ?? event.startDate : draftStart;
}
export function eventScheduleDetailsPatch(value: EventScheduleDetailsValue, event: CalendarEvent): Partial<CalendarEvent> {
  const original = eventScheduleDetails(event), patch: Partial<CalendarEvent> = {};
  if (JSON.stringify(value.recurrenceRule) !== JSON.stringify(original.recurrenceRule)) patch.recurrenceRule = value.recurrenceRule;
  if (value.location.trim() !== original.location) patch.location = value.location.trim();
  if (value.meetingUrl.trim() !== original.meetingUrl) patch.meetingUrl = value.meetingUrl.trim();
  if (value.reminderMinutes !== original.reminderMinutes) patch.reminderMinutes = value.reminderMinutes;
  return patch;
}
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const inputStyle = 'w-full rounded-lg border border-bg-border bg-bg-primary px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent disabled:opacity-40';
const dropdownStyle = 'w-full [&>button]:w-full [&>button]:justify-between [&>button]:text-xs';
function anchorParts(date: string) { const parsed = new Date(`${date}T12:00:00Z`); return { weekday: Number.isFinite(parsed.getTime()) ? parsed.getUTCDay() : 1, day: Number(date.slice(8, 10)) || 1 }; }

export function EventScheduleDetails({ value, onChange, startDate, validationStartDate = startDate, allDay, disabled = false, onValidityChange }: {
  value: EventScheduleDetailsValue; onChange(value: EventScheduleDetailsValue): void; startDate: string; validationStartDate?: string; allDay: boolean; disabled?: boolean; onValidityChange?(valid: boolean): void;
}) {
  const rule = value.recurrenceRule;
  const valid = eventScheduleDetailsValid(value, validationStartDate);
  useEffect(() => { onValidityChange?.(valid); }, [valid, onValidityChange]);
  const update = (patch: Partial<EventScheduleDetailsValue>) => { if (!disabled) onChange({ ...value, ...patch }); };
  const updateRule = (patch: Partial<CalendarRecurrenceRule>) => { if (rule) update({ recurrenceRule: { ...rule, ...patch } }); };
  const anchor = anchorParts(startDate);
  const preset = !rule ? 'none' : rule.frequency === 'weekly' && rule.interval === 1 && JSON.stringify(rule.weekdays) === '[1,2,3,4,5]' ? 'weekdays' : rule.frequency;
  const selectPreset = (next: string) => update({ recurrenceRule: next === 'none' ? null : next === 'weekdays' ? { frequency: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] } : { frequency: next as CalendarRecurrenceRule['frequency'], interval: 1, ...(next === 'weekly' ? { weekdays: [anchor.weekday] } : next === 'monthly' ? { monthlyMode: 'date' as const, monthDay: anchor.day } : {}) } });
  let dates: string[] = [];
  try { if (rule && valid) dates = previewRecurrenceDates(startDate, rule, 5); } catch { /* Invalid drafts are kept visible and block saving. */ }
  const endMode = rule?.until !== undefined ? 'date' : rule?.count !== undefined ? 'count' : 'never';
  const setEndMode = (mode: string) => { if (!rule) return; const { until: _until, count: _count, ...rest } = rule; update({ recurrenceRule: { ...rest, ...(mode === 'date' ? { until: startDate } : mode === 'count' ? { count: 10 } : {}) } }); };
  return <section aria-label="반복·장소·알림" className="space-y-3 border-t border-bg-border/60 pt-3">
    <div><label className="mb-1 block text-[11px] text-text-secondary">반복</label><GlassDropdown label="반복" value={preset} onChange={selectPreset} disabled={disabled} portal portalOwner="calendar-quick-edit" className={dropdownStyle} options={[{ value: 'none', label: '반복 안 함' }, { value: 'daily', label: '매일' }, { value: 'weekdays', label: '평일마다' }, { value: 'weekly', label: '매주' }, { value: 'monthly', label: '매월' }, { value: 'yearly', label: '매년' }]} /></div>
    {rule && <div className="space-y-2 rounded-lg border border-bg-border/70 p-2.5">
      <label className="flex items-center gap-2 text-xs text-text-secondary"><input aria-label="반복 간격" type="number" min={1} max={99} value={rule.interval} disabled={disabled} onChange={event => updateRule({ interval: Number(event.target.value) })} className={`${inputStyle} max-w-20`} />{({ daily: '일', weekly: '주', monthly: '개월', yearly: '년' })[rule.frequency]}마다</label>
      {rule.frequency === 'weekly' && <div role="group" aria-label="반복 요일" className="flex gap-1">{weekdays.map((label, day) => <button type="button" key={day} disabled={disabled} aria-label={`${label}요일 반복`} aria-pressed={rule.weekdays?.includes(day) ?? false} onClick={() => updateRule({ weekdays: (rule.weekdays?.includes(day) ? rule.weekdays.filter(value => value !== day) : [...(rule.weekdays ?? []), day]).sort() })} className={`flex-1 rounded py-1.5 text-xs ${rule.weekdays?.includes(day) ? 'bg-accent/20 text-accent' : 'bg-bg-primary text-text-secondary'}`}>{label}</button>)}</div>}
      {rule.frequency === 'monthly' && <>
        <GlassDropdown label="월 반복 방식" value={rule.monthlyMode ?? 'date'} disabled={disabled} portal portalOwner="calendar-quick-edit" className={dropdownStyle} options={[{ value: 'date', label: '같은 날짜' }, { value: 'weekday', label: '몇 번째 요일' }, { value: 'lastDay', label: '월 마지막 날' }]} onChange={mode => { const { monthDay: _day, ordinal: _ordinal, weekday: _weekday, ...rest } = rule; update({ recurrenceRule: { ...rest, monthlyMode: mode as CalendarRecurrenceRule['monthlyMode'], ...(mode === 'date' ? { monthDay: anchor.day } : mode === 'weekday' ? { ordinal: Math.min(5, Math.ceil(anchor.day / 7)) as 1|2|3|4|5, weekday: anchor.weekday } : {}) } }); }} />
        {(rule.monthlyMode ?? 'date') === 'date' && <label className="flex items-center gap-2 text-xs text-text-secondary"><input aria-label="매월 날짜" type="number" min={1} max={31} value={rule.monthDay ?? anchor.day} disabled={disabled} onChange={event => updateRule({ monthDay: Number(event.target.value) })} className={`${inputStyle} max-w-20`} />일 · 없는 달은 건너뛰어요</label>}
        {rule.monthlyMode === 'weekday' && <div className="grid grid-cols-2 gap-2"><GlassDropdown label="몇 번째" value={String(rule.ordinal ?? 1)} disabled={disabled} portal portalOwner="calendar-quick-edit" className={dropdownStyle} onChange={value => updateRule({ ordinal: Number(value) as 1|2|3|4|5|-1 })} options={[1,2,3,4,5,-1].map(value => ({ value: String(value), label: value === -1 ? '마지막' : `${value}번째` }))} /><GlassDropdown label="월 반복 요일" value={String(rule.weekday ?? anchor.weekday)} disabled={disabled} portal portalOwner="calendar-quick-edit" className={dropdownStyle} onChange={value => updateRule({ weekday: Number(value) })} options={weekdays.map((label, day) => ({ value: String(day), label: `${label}요일` }))} /></div>}
      </>}
      <GlassDropdown label="반복 종료" value={endMode} disabled={disabled} portal portalOwner="calendar-quick-edit" className={dropdownStyle} onChange={setEndMode} options={[{ value: 'never', label: '종료 없음' }, { value: 'date', label: '날짜까지' }, { value: 'count', label: '횟수로 종료' }]} />
      {endMode === 'date' && <input type="text" aria-label="반복 종료일" placeholder="YYYY-MM-DD" value={rule.until ?? ''} disabled={disabled} onChange={event => updateRule({ until: event.target.value })} className={inputStyle} />}
      {endMode === 'count' && <label className="flex items-center gap-2 text-xs text-text-secondary"><input type="number" aria-label="반복 횟수" min={1} max={1000} value={rule.count ?? 10} disabled={disabled} onChange={event => updateRule({ count: Number(event.target.value) })} className={`${inputStyle} max-w-24`} />회 (첫 일정 포함)</label>}
      <p aria-label="다음 반복 날짜" className="text-[11px] leading-relaxed text-text-secondary">다음 일정: {dates.length ? dates.join(' · ') : valid ? '선택한 범위에 일정이 없어요' : '반복 조건을 확인해 주세요'}</p>
    </div>}
    <label className="block text-[11px] text-text-secondary">장소<input aria-label="장소" value={value.location} maxLength={500} disabled={disabled} onChange={event => update({ location: event.target.value })} placeholder="회의실 또는 주소" className={`mt-1 ${inputStyle}`} /></label>
    <label className="block text-[11px] text-text-secondary">회의 주소<input aria-label="회의 주소" type="url" value={value.meetingUrl} maxLength={2000} disabled={disabled} onChange={event => update({ meetingUrl: event.target.value })} placeholder="https://" aria-invalid={!safeMeetingUrl(value.meetingUrl)} className={`mt-1 ${inputStyle}`} /></label>
    {!safeMeetingUrl(value.meetingUrl) && <p role="alert" className="text-[11px] text-red-400">http:// 또는 https://로 시작하는 회의 주소를 입력해 주세요.</p>}
    <div><label className="mb-1 block text-[11px] text-text-secondary">알림</label><GlassDropdown label="알림" value={value.reminderMinutes === null ? 'off' : String(value.reminderMinutes)} disabled={disabled} portal portalOwner="calendar-quick-edit" className={dropdownStyle} onChange={minutes => update({ reminderMinutes: minutes === 'off' ? null : Number(minutes) })} options={[{ value: 'off', label: '알림 없음' }, { value: '0', label: '시작할 때' }, ...[5,10,15,30,60,120].map(minutes => ({ value: String(minutes), label: `${minutes}분 전` })), { value: '1440', label: '하루 전' }]} /></div>
    {allDay && <p className="text-[11px] text-text-secondary">종일 일정 알림은 시작일 오전 9시(한국 시간)를 기준으로 해요.</p>}
    {!valid && safeMeetingUrl(value.meetingUrl) && <p role="alert" className="text-[11px] text-red-400">반복 간격·요일·종료 조건을 확인해 주세요.</p>}
  </section>;
}

export function EventScheduleDetailsSummary({ event }: { event: CalendarEvent }) {
  return <div className="space-y-1 text-xs text-text-secondary">
    {event.recurrenceRule && <p>반복 일정 · {({ daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년' })[event.recurrenceRule.frequency]}</p>}
    {event.location && <p>장소 · {event.location}</p>}
    {event.meetingUrl && safeMeetingUrl(event.meetingUrl) && <a href={event.meetingUrl.trim()} target="_blank" rel="noopener noreferrer" onClick={async click => {
      if (!window.electronAPI?.openExternal) return;
      click.preventDefault();
      try {
        const result = await window.electronAPI.openExternal(event.meetingUrl!.trim());
        if (!result.ok) window.alert('회의 주소를 열지 못했어요. 주소를 복사해 브라우저에서 열어 주세요.');
      } catch { window.alert('회의 주소를 열지 못했어요. 주소를 복사해 브라우저에서 열어 주세요.'); }
    }} className="block break-all text-accent">회의 참여 · {event.meetingUrl}</a>}
    {event.reminderMinutes != null && <p>알림 · {event.reminderMinutes === 0 ? '시작할 때' : `${event.reminderMinutes}분 전`}{event.allDay ? ' (오전 9시, 한국 시간 기준)' : ''}</p>}
  </div>;
}
