import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type CalendarEditScope = 'this' | 'following' | 'all';
type Request = { context: string; action: 'edit' | 'delete'; run(scope: CalendarEditScope): void; ruleChanged: boolean; resetsExceptions: boolean; calendarChange: boolean };
/** A scope choice never starts a write. A changed event/session invalidates the choice. */
export function useRecurrenceScope(context: string, recurring: boolean) {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null), current = useRef(context);
  current.current = context;
  useEffect(() => { pending.current = null; setRequest(null); }, [context]);
  const cancel = () => { pending.current = null; setRequest(null); };
  return {
    ask(action: Request['action'], run: Request['run'], ruleChanged = false, resetsExceptions = false, calendarChange = false) {
      if (!recurring) return false;
      if (pending.current) return true;
      const next = { context, action, run, ruleChanged, resetsExceptions, calendarChange };
      pending.current = next; setRequest(next); return true;
    },
    dialog: request && request.context === context ? <RecurrenceScopeDialog action={request.action} calendarChange={request.calendarChange} ruleChanged={request.ruleChanged} resetsExceptions={request.resetsExceptions} onCancel={cancel} onChoose={scope => {
      if (pending.current !== request || current.current !== request.context) { cancel(); return; }
      cancel(); request.run(scope);
    }} /> : null,
  };
}

export function RecurrenceScopeDialog({ action, ruleChanged, resetsExceptions, calendarChange = false, onCancel, onChoose }: { action: 'edit'|'delete'; ruleChanged: boolean; resetsExceptions: boolean; calendarChange?: boolean; onCancel(): void; onChoose(scope: CalendarEditScope): void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); onCancel(); }
      if (event.key === 'Tab') {
        const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        if (!buttons.length) return;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div data-calendar-recurrence-scope className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-4" onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onCancel(); }}>
    <div ref={root} role="dialog" aria-modal="true" aria-label="반복 일정 적용 범위" className="w-full max-w-sm rounded-xl border border-bg-border bg-bg-card p-5 shadow-2xl">
      <h3 className="text-sm font-semibold text-text-primary">어떤 일정을 {action === 'delete' ? '삭제' : '변경'}할까요?</h3>
      <p className="mt-2 text-xs leading-relaxed text-text-secondary">선택한 범위의 반복 일정에 적용돼요.</p>
      {ruleChanged && <p className="mt-2 text-xs text-text-secondary">반복 방식은 이후 일정 또는 전체 일정에서 바꿀 수 있어요.</p>}
      {calendarChange && <p className="mt-2 text-xs text-text-secondary">캘린더는 이후 일정 또는 전체 일정 단위로 옮길 수 있어요.</p>}
      {resetsExceptions && <p className="mt-2 text-xs leading-relaxed text-text-secondary">날짜나 반복 방식을 바꾸면 선택한 범위에서 따로 수정·취소했던 회차가 새 규칙으로 다시 만들어져요.</p>}
      <div className="mt-4 space-y-2">{([{ value: 'this', label: '이 일정만' }, { value: 'following', label: '이후 일정' }, { value: 'all', label: '전체 일정' }] as const).filter(option => (!ruleChanged && !calendarChange) || option.value !== 'this').map(option => <button type="button" key={option.value} className="w-full rounded-lg border border-bg-border px-3 py-2 text-left text-xs text-text-primary hover:bg-accent/15" onClick={() => onChoose(option.value)}>{option.label}</button>)}</div>
      <button type="button" className="mt-3 w-full py-2 text-xs text-text-secondary" onClick={onCancel}>범위 선택 취소</button>
    </div>
  </div>, document.body);
}
