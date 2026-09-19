export interface CalendarDateRange { startDate: string; endDate: string }
const pad = (value: number) => String(value).padStart(2, '0');
export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}
export function formatCalendarDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
export function todayCalendarDate(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
export function normalizeCalendarDate(value: string): string | null {
  const text = value.trim();
  const digits = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  const separated = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(text);
  const match = digits ?? separated;
  if (!match) return null;
  const result = `${match[1]}-${pad(Number(match[2]))}-${pad(Number(match[3]))}`;
  return parseCalendarDate(result) ? result : null;
}
export function shiftCalendarDate(value: string, days: number): string {
  const date = parseCalendarDate(value); if (!date) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return formatCalendarDate(date);
}
export function shiftCalendarMonth(value: string, months: number): string {
  const date = parseCalendarDate(value); if (!date) return value;
  const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)).getUTCDate();
  date.setUTCDate(Math.min(day, last));return formatCalendarDate(date);
}
export function calendarMonthDays(month: string): string[] {
  const first = `${month.slice(0, 7)}-01`, date = parseCalendarDate(first);
  if (!date) return [];
  const beginning = shiftCalendarDate(first, -date.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => shiftCalendarDate(beginning, index));
}
export function selectCalendarRange(range: CalendarDateRange, selected: string, edge: 'start' | 'end', sameDay = false): CalendarDateRange {
  if (sameDay) return { startDate: selected, endDate: selected };
  if (edge === 'start') return { startDate: selected, endDate: !parseCalendarDate(range.endDate) || range.endDate < selected ? selected : range.endDate };
  if (!parseCalendarDate(range.startDate)) return { startDate: selected, endDate: selected };
  return selected < range.startDate ? { startDate: selected, endDate: range.startDate || selected } : { startDate: range.startDate, endDate: selected };
}
/** Compact input is accepted only when complete; one/two digit hours normalize on blur. */
export function normalizeCalendarTime(value: string, allowHourOnly = false): string | null {
  const text = value.trim(); let hours: number, minutes: number;
  const colon = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (colon) { hours = Number(colon[1]); minutes = Number(colon[2]); }
  else if (/^\d{3,4}$/.test(text)) { hours = Number(text.slice(0, -2)); minutes = Number(text.slice(-2)); }
  else if (allowHourOnly && /^\d{1,2}$/.test(text)) { hours = Number(text); minutes = 0; }
  else return null;
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60 ? `${pad(hours)}:${pad(minutes)}` : null;
}
export function addCalendarDuration(startDate: string, startTime: string, minutes: number): { endDate: string; endTime: string } | null {
  if (!parseCalendarDate(startDate) || !Number.isSafeInteger(minutes) || minutes < 0) return null;
  const time = normalizeCalendarTime(startTime);if (!time) return null;
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + minutes;
  return { endDate: shiftCalendarDate(startDate, Math.floor(total / 1440)), endTime: `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}` };
}
export function calendarGridKey(date: string, key: string, shift = false): string | null {
  if (key === 'ArrowLeft') return shiftCalendarDate(date, -1);
  if (key === 'ArrowRight') return shiftCalendarDate(date, 1);
  if (key === 'ArrowUp') return shiftCalendarDate(date, -7);
  if (key === 'ArrowDown') return shiftCalendarDate(date, 7);
  if (key === 'PageUp' || key === 'PageDown') return shiftCalendarMonth(date, (key === 'PageUp' ? -1 : 1) * (shift ? 12 : 1));
  const parsed = parseCalendarDate(date);if (!parsed) return null;
  if (key === 'Home') return shiftCalendarDate(date, -parsed.getUTCDay());
  if (key === 'End') return shiftCalendarDate(date, 6 - parsed.getUTCDay());
  return null;
}
export function calendarPopoverPosition(anchor: { left: number; top: number; bottom: number; width: number }, viewport: { width: number; height: number }, preferredWidth: number, height: number) {
  const width = Math.max(0, Math.min(preferredWidth, viewport.width - 16));
  const roomBelow = Math.max(0, viewport.height - anchor.bottom - 14), roomAbove = Math.max(0, anchor.top - 14);
  const maxHeight = Math.min(height, Math.max(0, viewport.height - 16));
  // Keep the full picker visible even when neither side of the anchor can fit it.
  const above = roomBelow < maxHeight && roomAbove >= maxHeight;
  return { width, maxHeight, left: Math.max(8, Math.min(anchor.left, viewport.width - width - 8)), top: Math.max(8, Math.min(above ? anchor.top - maxHeight - 6 : anchor.bottom + 6, viewport.height - maxHeight - 8)) };
}
