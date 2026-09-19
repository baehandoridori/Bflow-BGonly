import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { CalendarInputPopover } from './CalendarInputPopover';
import { calendarGridKey, calendarMonthDays, normalizeCalendarDate, parseCalendarDate, selectCalendarRange, shiftCalendarDate, shiftCalendarMonth, todayCalendarDate, type CalendarDateRange } from './calendarInputModel';
import './calendarInputs.css';

export interface CalendarDateRangePickerProps extends CalendarDateRange {
  onChange(range: CalendarDateRange): void; disabled?: boolean; endDisabled?: boolean; onValidityChange?(valid: boolean): void;
}
export function CalendarDateRangePicker({ startDate, endDate, onChange, disabled = false, endDisabled = false, onValidityChange }: CalendarDateRangePickerProps) {
  const [drafts, setDrafts] = useState({ start: startDate, end: endDate });
  const [invalid, setInvalid] = useState({ start: !parseCalendarDate(startDate), end: !parseCalendarDate(endDate) });
  const [open, setOpen] = useState(false), [edge, setEdge] = useState<'start' | 'end'>('start');
  const [focusDate, setFocusDate] = useState(parseCalendarDate(startDate) ? startDate : todayCalendarDate());
  const [month, setMonth] = useState(focusDate.slice(0, 7));
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement | null>(null), grid = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null), endButton = useRef<HTMLButtonElement>(null);
  const id = useId(), validity = useRef(onValidityChange);validity.current = onValidityChange;
  const dirty = useRef({ start: false, end: false });
  const latest = useRef({ startDate, endDate });latest.current = { startDate, endDate };
  useEffect(() => { if (!dirty.current.start) { setDrafts((value) => ({ ...value, start: startDate }));setInvalid((value) => ({ ...value, start: !parseCalendarDate(startDate) })); } }, [startDate]);
  useEffect(() => { if (!dirty.current.end) { setDrafts((value) => ({ ...value, end: endDate }));setInvalid((value) => ({ ...value, end: !parseCalendarDate(endDate) })); } }, [endDate]);
  useEffect(() => { validity.current?.(disabled || (!invalid.start && (endDisabled || !invalid.end) && startDate <= endDate)); }, [invalid.start, invalid.end, disabled, endDisabled, startDate, endDate]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open) grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`)?.focus({ preventScroll: true }); }, [focusDate, month, open]);
  const close = (restore = false) => { setOpen(false);if (restore) trigger.current?.focus({ preventScroll: true }); };
  const commit = (range: CalendarDateRange) => {
    dirty.current = { start: false, end: false };setDrafts({ start: range.startDate, end: range.endDate });setInvalid({ start: false, end: false });
    onChange(range);validity.current?.(true);
  };
  const show = (part: 'start' | 'end') => {
    if (disabled || part === 'end' && endDisabled) return;
    trigger.current = part === 'start' ? startButton.current : endButton.current;
    const value = part === 'start' ? startDate : endDate;
    const date = parseCalendarDate(value) ? value : todayCalendarDate();setEdge(part);setFocusDate(date);setMonth(date.slice(0, 7));setOpen(true);
  };
  const typed = (part: 'start' | 'end', text: string, blur = false) => {
    if (disabled || part === 'end' && endDisabled) return;
    dirty.current[part] = true;
    const normalized = normalizeCalendarDate(text);
    setDrafts((value) => ({ ...value, [part]: blur && normalized ? normalized : text }));
    setInvalid((value) => ({ ...value, [part]: !normalized }));
    if (!normalized) { validity.current?.(false);return; }
    const range = endDisabled ? { startDate: normalized, endDate: normalized } : { ...latest.current, [part === 'start' ? 'startDate' : 'endDate']: normalized };
    if (blur) dirty.current[part] = false;
    onChange(range);validity.current?.((!invalid[part === 'start' ? 'end' : 'start'] || endDisabled) && range.startDate <= range.endDate);
    if (endDisabled) setDrafts((value) => ({ ...value, end: range.endDate }));
  };
  const choose = (date: string) => {
    commit(selectCalendarRange({ startDate, endDate }, date, edge, endDisabled));
    setFocusDate(date);setMonth(date.slice(0, 7));
    if (edge === 'start' && !endDisabled) setEdge('end');else close(true);
  };
  const browse = (months: number) => {
    const date = shiftCalendarMonth(focusDate, months);if (!parseCalendarDate(date)) return;
    setMonth(date.slice(0, 7));setFocusDate(date);
  };
  const today = todayCalendarDate();
  return <div ref={root} className="calendar-date-range">
    <div className="calendar-date-fields">{(['start', 'end'] as const).map((part) => <div key={part} className="calendar-input-field"><label htmlFor={`${id}-${part}`}>{part === 'start' ? '시작일' : '종료일'}</label><div className={`calendar-input-shell ${invalid[part] ? 'invalid' : ''}`}>
      <input id={`${id}-${part}`} type="text" aria-label={part === 'start' ? '시작일' : '종료일'} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="YYYY-MM-DD" aria-invalid={invalid[part]} aria-describedby={invalid[part] ? `${id}-error` : undefined} disabled={disabled || part === 'end' && endDisabled} value={drafts[part]}
        onChange={(event) => typed(part, event.target.value)} onBlur={(event) => typed(part, event.target.value, true)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault();show(part); } if (event.key === 'Enter') { event.preventDefault();event.stopPropagation();typed(part, event.currentTarget.value, true); } }} />
      <button ref={part === 'start' ? startButton : endButton} type="button" aria-label={`${part === 'start' ? '시작일' : '종료일'} 달력 열기`} aria-haspopup="dialog" aria-expanded={open && edge === part} disabled={disabled || part === 'end' && endDisabled} onClick={() => open && edge === part ? close(true) : show(part)}><CalendarDays size={16} /></button>
    </div></div>)}</div>
    {(invalid.start || !endDisabled && invalid.end || startDate > endDate) && <p id={`${id}-error`} className="calendar-input-error" role="status">{startDate > endDate ? '종료일은 시작일과 같거나 뒤여야 해요.' : '날짜를 YYYY-MM-DD 형식으로 끝까지 입력해 주세요.'}</p>}
    {open && <CalendarInputPopover anchor={trigger} owner={root} label="일정 날짜 선택" onClose={close} height={520}>
      <div className="calendar-picker-edges"><button type="button" aria-pressed={edge === 'start'} onClick={() => setEdge('start')}>시작일 <strong>{startDate}</strong></button><span>→</span><button type="button" disabled={endDisabled} aria-pressed={edge === 'end'} onClick={() => setEdge('end')}>종료일 <strong>{endDate}</strong></button></div>
      <div className="calendar-picker-nav"><button type="button" aria-label="이전 연도" onClick={() => browse(-12)}><ChevronsLeft size={15}/></button><button type="button" aria-label="이전 달" onClick={() => browse(-1)}><ChevronLeft size={16}/></button><strong aria-live="polite">{month.slice(0,4)}년 {Number(month.slice(5))}월</strong><button type="button" aria-label="다음 달" onClick={() => browse(1)}><ChevronRight size={16}/></button><button type="button" aria-label="다음 연도" onClick={() => browse(12)}><ChevronsRight size={15}/></button></div>
      <div className="calendar-picker-weekdays" aria-hidden="true">{['일','월','화','수','목','금','토'].map((day) => <span key={day}>{day}</span>)}</div>
      <div ref={grid} className="calendar-picker-grid" role="grid" aria-label="날짜" onKeyDown={(event) => { const next = calendarGridKey(focusDate, event.key, event.shiftKey);if (next && parseCalendarDate(next)) { event.preventDefault();event.stopPropagation();setFocusDate(next);setMonth(next.slice(0,7)); } }}>
        {Array.from({length:6},(_,week) => <div role="row" key={week}>{calendarMonthDays(`${month}-01`).slice(week*7,week*7+7).map((date) => <div role="gridcell" aria-selected={date >= startDate && date <= endDate} key={date} className={`${date >= startDate && date <= endDate ? 'in-range' : ''} ${date === startDate ? 'range-start' : ''} ${date === endDate ? 'range-end' : ''}`}><button type="button" data-date={date} aria-label={date} aria-current={date === today ? 'date' : undefined} tabIndex={focusDate === date ? 0 : -1} className={`${date.slice(0,7) !== month ? 'outside-month' : ''} ${date === startDate || date === endDate ? 'range-edge' : ''}`} onFocus={() => setFocusDate(date)} onClick={() => choose(date)}>{Number(date.slice(-2))}</button></div>)}</div>)}
      </div>
      <div className="calendar-picker-shortcuts">{[{name:'오늘',days:0},{name:'내일',days:1},{name:'다음 주',days:7}].map((item) => <button type="button" key={item.name} onClick={() => { const date = shiftCalendarDate(today,item.days);commit({startDate:date,endDate:date});close(true); }}>{item.name}</button>)}</div>
      <p className="calendar-picker-hint">{endDisabled ? '선택한 날짜 하루로 지정해요.' : edge === 'start' ? '시작일을 선택한 뒤 종료일을 선택하세요.' : '종료일을 선택하세요. 선택한 날짜까지 포함해요.'}</p>
    </CalendarInputPopover>}
  </div>;
}

