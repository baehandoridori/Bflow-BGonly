/**
 * 외부 캘린더(ICS) 구독 — 파싱·반복 전개.
 *
 * 이 파일은 node --test가 직접 import하므로 'electron' top-level import를 두지 않는다.
 * 파일 IO·fetch·경로가 필요한 부분은 전부 주입(DI)으로 받는다.
 */
import icalModule from 'node-ical';

/** 한 구독이 만들어 낼 수 있는 일정 수 상한. 넘으면 가까운 회차부터 채우고 잘라 낸다. */
export const ICS_EVENTS_PER_SUBSCRIPTION_LIMIT = 500;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const UNTITLED_ICS_EVENT = '(제목 없음)';

export interface IcsExpandWindow {
  /** YYYY-MM-DD (inclusive) */
  from: string;
  /** YYYY-MM-DD (inclusive) */
  to: string;
}

export interface IcsExpandedEvent {
  uid: string;
  title: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD (inclusive) */
  endDate: string;
  allDay: boolean;
  /** HH:MM — 종일 일정은 null */
  startTime: string | null;
  /** HH:MM — 종일 일정은 null */
  endTime: string | null;
}

export interface IcsExpansion {
  events: IcsExpandedEvent[];
  truncated: boolean;
}

type IcsVevent = {
  type?: string;
  uid?: unknown;
  summary?: unknown;
  start?: Date & { dateOnly?: boolean };
  end?: Date & { dateOnly?: boolean };
  rrule?: { between(after: Date, before: Date, inclusive?: boolean): Date[] };
  exdate?: Record<string, unknown>;
  recurrences?: Record<string, IcsVevent>;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 구글 경로의 fromRfc3339ToKstFields(src/services/calendarService.ts)와 같은 규칙.
 * 호스트 시간대와 무관하게 항상 KST 벽시계로 읽는다.
 */
function toKstFields(instant: Date): { date: string; time: string } {
  const kst = new Date(instant.getTime() + KST_OFFSET_MS);
  return {
    date: `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`,
    time: `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`,
  };
}

/**
 * VALUE=DATE는 node-ical이 "그 날 로컬 자정"으로 만든다. 따라서 로컬 필드로 되읽어야
 * 어느 시간대에서 돌려도 원래 적힌 날짜가 그대로 나온다.
 */
function toDateOnlyString(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(shifted.getTime())) return date;
  return new Date(shifted.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / DAY_MS);
}

function addMinutesToTime(time: string, minutes: number): { time: string; dayOffset: number } {
  const [hours, mins] = time.split(':').map(Number);
  const total = (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(mins) ? mins : 0) + minutes;
  const dayOffset = Math.floor(total / (24 * 60));
  const withinDay = total - dayOffset * 24 * 60;
  return { time: `${pad(Math.floor(withinDay / 60))}:${pad(withinDay % 60)}`, dayOffset };
}

function isVevent(value: unknown): value is IcsVevent {
  return Boolean(value) && typeof value === 'object' && (value as IcsVevent).type === 'VEVENT';
}

function readText(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim() !== '') return value;
  // node-ical은 파라미터가 붙은 속성을 { params, val } 형태로 준다.
  if (value && typeof value === 'object' && typeof (value as { val?: unknown }).val === 'string') {
    const inner = (value as { val: string }).val;
    if (inner.trim() !== '') return inner;
  }
  return fallback;
}

type IcsBaseFields = Pick<IcsExpandedEvent, 'startDate' | 'endDate' | 'allDay' | 'startTime' | 'endTime'>;

function readBaseFields(event: IcsVevent): IcsBaseFields | null {
  const start = event.start;
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return null;
  const end = event.end instanceof Date && !Number.isNaN(event.end.getTime()) ? event.end : undefined;

  if (start.dateOnly) {
    const startDate = toDateOnlyString(start);
    // ICS의 종일 DTEND는 exclusive다. B flow는 inclusive를 쓰므로 하루 뺀다.
    // DTEND가 없거나 같은 날이면 하루짜리로 본다.
    const rawEnd = end?.dateOnly ? toDateOnlyString(end) : startDate;
    const inclusiveEnd = shiftDate(rawEnd, -1);
    return {
      startDate,
      endDate: inclusiveEnd < startDate ? startDate : inclusiveEnd,
      allDay: true,
      startTime: null,
      endTime: null,
    };
  }

  const startFields = toKstFields(start);
  // DTEND가 없는 시각 일정은 시간표 렌더와 같은 1시간 기본값으로 채운다.
  const endFields = end && end.getTime() > start.getTime()
    ? toKstFields(end)
    : toKstFields(new Date(start.getTime() + 60 * 60 * 1000));
  return {
    startDate: startFields.date,
    endDate: endFields.date,
    allDay: false,
    startTime: startFields.time,
    endTime: endFields.time,
  };
}

function overlapsWindow(fields: Pick<IcsBaseFields, 'startDate' | 'endDate'>, window: IcsExpandWindow): boolean {
  return fields.endDate >= window.from && fields.startDate <= window.to;
}

function excludedOccurrenceKeys(event: IcsVevent): Set<string> {
  const keys = new Set<string>();
  const exdate = event.exdate;
  if (!exdate || typeof exdate !== 'object') return keys;
  for (const value of Object.values(exdate)) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) continue;
    const fields = toKstFields(value);
    keys.add(fields.date);
    keys.add(`${fields.date}T${fields.time}`);
  }
  return keys;
}

/**
 * node-ical의 rrule 전개는 TZID 처리에서 벽시계 시각이 밀릴 수 있다. 전개 결과에서는
 * 날짜만 취하고 시각은 원본 DTSTART의 벽시계를 그대로 쓴다.
 */
function occurrenceFields(base: IcsBaseFields, occurrenceDate: string): IcsBaseFields {
  const span = Math.max(0, daysBetween(base.startDate, base.endDate));
  return {
    ...base,
    startDate: occurrenceDate,
    endDate: shiftDate(occurrenceDate, span),
  };
}

function collectVevent(event: IcsVevent, window: IcsExpandWindow, out: IcsExpandedEvent[]): void {
  const base = readBaseFields(event);
  if (!base) return;
  const uid = readText(event.uid, '');
  const title = readText(event.summary, UNTITLED_ICS_EVENT);

  if (!event.rrule || typeof event.rrule.between !== 'function') {
    if (overlapsWindow(base, window)) out.push({ uid, title, ...base });
    return;
  }

  // 조회 창 경계에 걸친 회차를 잃지 않도록 하루씩 넉넉히 전개한 뒤 날짜로 다시 거른다.
  const after = new Date(`${shiftDate(window.from, -1)}T00:00:00Z`);
  const before = new Date(`${shiftDate(window.to, 1)}T00:00:00Z`);
  let occurrences: Date[] = [];
  try {
    occurrences = event.rrule.between(after, before, true) ?? [];
  } catch {
    occurrences = [];
  }

  const excluded = excludedOccurrenceKeys(event);
  const overrides = event.recurrences && typeof event.recurrences === 'object' ? event.recurrences : {};
  const seen = new Set<string>();

  for (const occurrence of occurrences) {
    if (!(occurrence instanceof Date) || Number.isNaN(occurrence.getTime())) continue;
    const occurrenceKst = toKstFields(occurrence);
    if (excluded.has(occurrenceKst.date) || excluded.has(`${occurrenceKst.date}T${occurrenceKst.time}`)) continue;
    if (seen.has(occurrenceKst.date)) continue;
    seen.add(occurrenceKst.date);

    const override = Object.prototype.hasOwnProperty.call(overrides, occurrenceKst.date)
      ? overrides[occurrenceKst.date]
      : undefined;
    const fields = isVevent(override)
      ? readBaseFields(override) ?? occurrenceFields(base, occurrenceKst.date)
      : occurrenceFields(base, occurrenceKst.date);
    if (!overlapsWindow(fields, window)) continue;

    out.push({
      uid: uid ? `${uid}:${fields.startDate}` : fields.startDate,
      title: isVevent(override) ? readText(override.summary, title) : title,
      ...fields,
    });
  }
}

function parseCalendar(icsText: string): Record<string, unknown> | null {
  if (typeof icsText !== 'string' || !icsText.includes('BEGIN:VEVENT')) return null;
  try {
    const parsed = (icalModule as unknown as {
      sync: { parseICS(text: string): Record<string, unknown> };
    }).sync.parseICS(icsText);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * ICS 본문을 조회 창 안의 일정 목록으로 전개한다. 반복 일정은 회차별로 펼치고,
 * 상한을 넘으면 가까운 회차부터 채운 뒤 잘라 냈다는 사실을 함께 알린다.
 */
export function expandIcsToEvents(icsText: string, window: IcsExpandWindow): IcsExpansion {
  const parsed = parseCalendar(icsText);
  if (!parsed) return { events: [], truncated: false };

  const collected: IcsExpandedEvent[] = [];
  for (const component of Object.values(parsed)) {
    if (!isVevent(component)) continue;
    collectVevent(component, window, collected);
  }

  collected.sort((left, right) => {
    if (left.startDate !== right.startDate) return left.startDate < right.startDate ? -1 : 1;
    const leftTime = left.startTime ?? '';
    const rightTime = right.startTime ?? '';
    if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
    return left.uid.localeCompare(right.uid);
  });

  if (collected.length <= ICS_EVENTS_PER_SUBSCRIPTION_LIMIT) {
    return { events: collected, truncated: false };
  }
  return { events: collected.slice(0, ICS_EVENTS_PER_SUBSCRIPTION_LIMIT), truncated: true };
}
