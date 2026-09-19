import { createElement, isValidElement, type ReactNode } from 'react';

// Parent-only historical harnesses use this boundary adapter. Real input drafts,
// blur normalization and parent submission are exercised in calendarInputForms.
export const calendarInputsTestModule = {
  CalendarDateRangePicker: 'test-calendar-date-range',
  CalendarTimeInput: 'test-calendar-time',
  CalendarDurationButtons: 'test-calendar-duration',
};
export function resolveCalendarInputs(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return node;
  const props = node.props as any;
  if (node.type === 'test-calendar-date-range') return createElement('div', null,
    ...['start', 'end'].map((edge) => createElement('input', {
      key: edge, type: 'text', 'aria-label': edge === 'start' ? '시작일' : '종료일',
      value: edge === 'start' ? props.startDate : props.endDate,
      disabled: props.disabled || edge === 'end' && props.endDisabled,
      onChange: (event: any) => props.onChange({ startDate: edge === 'start' ? event.target.value : props.startDate, endDate: edge === 'end' ? event.target.value : props.endDisabled ? event.target.value : props.endDate }),
    })));
  if (node.type === 'test-calendar-time') return createElement('input', {
    type: 'text', inputMode: 'numeric', 'aria-label': props.label,
    value: props.value, disabled: props.disabled, onChange: (event: any) => props.onChange(event.target.value),
  });
  if (node.type === 'test-calendar-duration') return null;
  return node;
}
