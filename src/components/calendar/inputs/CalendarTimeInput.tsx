import { useEffect, useId, useRef, useState } from 'react';
import { Clock3, ChevronDown } from 'lucide-react';
import { CalendarInputPopover } from './CalendarInputPopover';
import { normalizeCalendarTime } from './calendarInputModel';
import './calendarInputs.css';

export interface CalendarTimeInputProps {
  label: string; value: string; onChange(value: string): void; disabled?: boolean; onValidityChange?(valid: boolean): void;
}
const choices = Array.from({length:96},(_,index)=>`${String(Math.floor(index/4)).padStart(2,'0')}:${String(index%4*15).padStart(2,'0')}`);
export function CalendarTimeInput({ label, value, onChange, disabled = false, onValidityChange }: CalendarTimeInputProps) {
  const [draft, setDraft] = useState(value), [invalid, setInvalid] = useState(!normalizeCalendarTime(value));
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const dirty = useRef(false), previous = useRef(value), validity = useRef(onValidityChange);validity.current = onValidityChange;
  const id = useId();
  useEffect(() => {
    if (previous.current !== value) { previous.current = value;dirty.current = false;setDraft(value);setInvalid(!normalizeCalendarTime(value)); }
  }, [value]);
  useEffect(() => { validity.current?.(disabled || !invalid); }, [invalid, disabled]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-time-index="${active}"]`)?.scrollIntoView({block:'nearest'}); }, [open, active]);
  const close = (restore = false) => { setOpen(false);if (restore) input.current?.focus({preventScroll:true}); };
  const show = () => {
    if (disabled) return;
    const canonical = normalizeCalendarTime(draft) ?? normalizeCalendarTime(value) ?? '09:00';
    const minutes = Number(canonical.slice(0,2))*60+Number(canonical.slice(3));setActive(Math.min(95,Math.round(minutes/15)));setOpen(true);
  };
  const edit = (text: string, blur = false) => {
    if (disabled) return;
    const canonical = normalizeCalendarTime(text, blur);dirty.current = !blur;
    setDraft(blur && canonical ? canonical : text);setInvalid(!canonical);
    if (canonical) { previous.current = canonical;onChange(canonical);validity.current?.(true); }
    else validity.current?.(false);
  };
  const choose = (time: string) => { dirty.current = false;previous.current = time;setDraft(time);setInvalid(false);onChange(time);validity.current?.(true);close(true); };
  const keyboard = (event: React.KeyboardEvent) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();event.stopPropagation();if (!open) show();else setActive((index)=>Math.max(0,Math.min(95,index+(event.key==='ArrowDown'?1:-1))));
    } else if (open && (event.key === 'Home' || event.key === 'End')) { event.preventDefault();setActive(event.key==='Home'?0:95); }
    else if (event.key === 'Enter') { event.preventDefault();event.stopPropagation();if (open) choose(choices[active]);else edit(draft,true); }
    else if (event.key === 'Tab') close();
  };
  return <div className="calendar-input-field calendar-time-input" ref={root} onKeyDown={keyboard}>
    <label htmlFor={id}>{label}</label><div className={`calendar-input-shell ${invalid ? 'invalid' : ''}`}><Clock3 size={15} className="calendar-time-icon"/>
      <input ref={input} id={id} type="text" aria-label={label} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open?`${id}-options`:undefined} aria-activedescendant={open?`${id}-time-${active}`:undefined} aria-invalid={invalid} aria-describedby={invalid?`${id}-error`:undefined} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="09:30" disabled={disabled} value={draft} onChange={(event)=>edit(event.target.value)} onBlur={(event)=>edit(event.target.value,true)}/>
      <button type="button" tabIndex={-1} aria-label={`${label} 목록 열기`} disabled={disabled} onMouseDown={(event)=>event.preventDefault()} onClick={()=>open?close(true):show()}><ChevronDown size={15}/></button>
    </div>
    {invalid && !disabled && <p id={`${id}-error`} className="calendar-input-error" role="status">00:00–23:59 사이로 입력해 주세요.</p>}
    {open && <CalendarInputPopover anchor={input} owner={root} width={208} height={272} role="listbox" label={`${label} · 15분 간격`} onClose={close}>
      <div className="calendar-time-menu" id={`${id}-options`} ref={list}><p>24시간 · 직접 입력도 가능</p>{choices.map((time,index)=><button key={time} type="button" id={`${id}-time-${index}`} data-time-index={index} role="option" aria-selected={normalizeCalendarTime(value)===time} className={index===active?'active':''} tabIndex={-1} onMouseDown={(event)=>event.preventDefault()} onPointerMove={()=>setActive(index)} onClick={()=>choose(time)}>{time}{normalizeCalendarTime(value)===time&&<span>✓</span>}</button>)}</div>
    </CalendarInputPopover>}
  </div>;
}
