export interface CalendarEventWindow { from: string; to: string }
/** The widget's unselected detail panel still shows today when browsing another month. */
export async function readCalendarWindowWithToday<T>(read: (range: CalendarEventWindow) => Promise<T[]>, range: CalendarEventWindow, today: string, identify: (event: T) => string): Promise<T[]> {
  if (today >= range.from && today <= range.to) return read(range);
  const [visible, fallback] = await Promise.all([read(range), read({ from: today, to: today })]);
  return [...new Map([...visible, ...fallback].map(event => [identify(event), event])).values()];
}
function date(year: number, month: number, day: number) { const value = new Date(0); value.setUTCFullYear(year, month, day); value.setUTCHours(12, 0, 0, 0); return value; }
function iso(value: Date) { return value.toISOString().slice(0, 10); }
function shift(value: Date, days: number) { const result = new Date(value); result.setUTCDate(result.getUTCDate() + days); return result; }
/** Month grids include adjacent days. Scrolling schedule views expose the whole year. */
export function scheduleEventWindow(mode: string, year: number, month: number): CalendarEventWindow {
  if (mode !== 'month') return { from: iso(date(year, 0, -6)), to: iso(date(year + 1, 0, 7)) };
  const first = date(year, month, 1), start = shift(first, -first.getUTCDay());
  return { from: iso(start), to: iso(shift(start, 41)) };
}
/** Widget carousel includes its dimmed surrounding weeks/days, not only the center. */
export function widgetEventWindow(mode: string, year: number, month: number, weekOffset: number, dayOffset: number, today: string): CalendarEventWindow {
  if (mode === 'month') return scheduleEventWindow(mode, year, month);
  const now = new Date(`${today}T12:00:00Z`);
  if (mode === 'today') return { from: iso(shift(now, dayOffset - 1)), to: iso(shift(now, dayOffset + 1)) };
  const sunday = shift(now, -now.getUTCDay());
  const start = shift(sunday, mode === '2week' ? weekOffset * 14 - 7 : weekOffset * 7 - 14);
  return { from: iso(start), to: iso(shift(start, 34)) };
}
