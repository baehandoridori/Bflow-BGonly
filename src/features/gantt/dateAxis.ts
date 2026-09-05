const DAY = 86400000;
const stamp = (date: string) => Date.parse(`${date}T00:00:00Z`);
const addDays = (date: string, days: number) => new Date(stamp(date) + days * DAY).toISOString().slice(0, 10);

// Shared by the sticky header, dependency paths and row-drop hit testing.
export const GANTT_RULER_HEIGHT = 72;

export function monthStart(date: string, offset = 0): string {
  const value = new Date(stamp(date));
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

export function isoWeek(date: string): { year: number; week: number } {
  const thursday = new Date(stamp(date));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - (thursday.getUTCDay() + 6) % 7);
  const year = thursday.getUTCFullYear();
  return { year, week: Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7) };
}

export interface WeekBand { offset: number; days: number; start: string; end: string; year: number; week: number }
export function weekBands(base: string, days: number): WeekBand[] {
  const result: WeekBand[] = [];
  for (let offset = 0; offset < days;) {
    const start = addDays(base, offset), weekday = (new Date(stamp(start)).getUTCDay() + 6) % 7;
    const count = Math.min(7 - weekday, days - offset);
    result.push({ offset, days: count, start, end: addDays(start, count - 1), ...isoWeek(start) });
    offset += count;
  }
  return result;
}

/** Expand before scrolling so a browser cannot clamp a new destination to the old axis. */
export function navigationRange(base: string, end: string, target: string, dayWidth: number, viewportWidth: number, alignment: 'start' | 'center') {
  const visibleDays = Math.max(1, Math.ceil(viewportWidth / dayWidth));
  const before = addDays(target, -Math.ceil(visibleDays / 2) - 7);
  const after = addDays(target, visibleDays + 7);
  const nextBase = base < before ? base : before;
  return {
    base: nextBase,
    end: end > after ? end : after,
    scrollLeft: Math.max(0, (Math.round((stamp(target) - stamp(nextBase)) / DAY) + (alignment === 'center' ? .5 : 0)) * dayWidth - (alignment === 'center' ? viewportWidth / 2 : 0)),
  };
}
