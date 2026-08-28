/**
 * 외부 캘린더(ICS) 구독 — 파싱·반복 전개.
 *
 * 이 파일은 node --test가 직접 import하므로 'electron' top-level import를 두지 않는다.
 * 파일 IO·fetch·경로가 필요한 부분은 전부 주입(DI)으로 받는다.
 */
import icalModule from 'node-ical';
// node --test가 이 파일을 직접 import하므로 src/shared에서는 타입만 가져온다.
// 값 import는 확장자 없는 상대 경로를 런타임에 해석하지 못한다.
import type {
  IcsSubscription,
  IcsSubscriptionAddInput,
  IcsSubscriptionEvents,
  IcsSubscriptionUpdateInput,
} from '../src/shared/icsApiContract';

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

export interface IcsExpandOptions {
  /**
   * 상한을 넘겨 잘라 낼 때의 기준일(YYYY-MM-DD). 이 날짜 이후 회차를 먼저 채우고
   * 남는 자리에만 지난 회차를 넣는다. 없으면 창 시작일을 기준으로 본다.
   */
  today?: string;
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
  status?: unknown;
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

/** STATUS:CANCELLED 인 일정·회차는 캘린더에 남기지 않는다. */
function isCancelled(event: IcsVevent): boolean {
  return readText(event.status, '').trim().toUpperCase() === 'CANCELLED';
}

/**
 * node-ical은 VALUE=DATE를 "호스트 로컬 자정 + dateOnly 마커"로 준다.
 * 인스턴트에 +9h를 더해 읽으면 UTC+10 이상 호스트에서 하루 밀리므로,
 * 같은 파일의 비반복 경로(toDateOnlyString)와 규칙을 맞춘다.
 */
function occurrenceDateKey(value: Date & { dateOnly?: boolean }): string {
  return value.dateOnly === true ? toDateOnlyString(value) : toKstFields(value).date;
}

function excludedOccurrenceKeys(event: IcsVevent): Set<string> {
  const keys = new Set<string>();
  const exdate = event.exdate;
  if (!exdate || typeof exdate !== 'object') return keys;
  for (const value of Object.values(exdate)) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) continue;
    const dated = value as Date & { dateOnly?: boolean };
    keys.add(occurrenceDateKey(dated));
    if (dated.dateOnly !== true) {
      const fields = toKstFields(dated);
      keys.add(`${fields.date}T${fields.time}`);
    }
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

/**
 * RECURRENCE-ID 수정본 조회. node-ical은 오버라이드를 **원본 시간대의 달력 날짜** 키로
 * 저장하고, DATE-TIME 오버라이드는 full ISO 키로도 이중 저장한다. KST 날짜로만 찾으면
 * 원본 TZ 날짜와 KST 날짜가 다른 회차(UTC 피드의 KST 새벽 등)의 수정본을 통째로 놓친다.
 */
function findOverride(
  overrides: Record<string, IcsVevent>,
  occurrence: Date & { dateOnly?: boolean },
  occurrenceKstDate: string,
): IcsVevent | undefined {
  const candidates = occurrence.dateOnly === true
    ? [toDateOnlyString(occurrence), occurrenceKstDate]
    : [
      occurrence.toISOString(), // 미이동 회차의 인스턴트 = RECURRENCE-ID 인스턴트
      occurrence.toISOString().slice(0, 10), // 원본 TZ 미해석 폴백
      occurrenceKstDate,
    ];
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
  }
  return undefined;
}

function collectVevent(event: IcsVevent, window: IcsExpandWindow, out: IcsExpandedEvent[]): void {
  if (isCancelled(event)) return;
  const base = readBaseFields(event);
  if (!base) return;
  const uid = readText(event.uid, '');
  const title = readText(event.summary, UNTITLED_ICS_EVENT);

  if (!event.rrule || typeof event.rrule.between !== 'function') {
    if (overlapsWindow(base, window)) out.push({ uid, title, ...base });
    return;
  }

  // 조회 창 경계에 걸친 회차를 잃지 않도록 넉넉히 전개한 뒤 날짜로 다시 거른다.
  // 패딩이 1일 고정이면 2일 이상 이어지는 회차가 창 시작 경계에서 통째로 빠진다.
  const spanDays = Math.max(0, daysBetween(base.startDate, base.endDate)) + 1;
  const after = new Date(`${shiftDate(window.from, -spanDays)}T00:00:00Z`);
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
    const occurrenceDate = occurrenceDateKey(occurrence as Date & { dateOnly?: boolean });
    if (excluded.has(occurrenceDate) || excluded.has(`${occurrenceKst.date}T${occurrenceKst.time}`)) continue;
    if (seen.has(occurrenceDate)) continue;
    seen.add(occurrenceDate);

    const override = findOverride(overrides, occurrence, occurrenceDate);
    // 오버라이드가 취소면 그 회차 자체를 건너뛴다(원본으로 되살리지 않는다).
    if (isVevent(override) && isCancelled(override)) continue;
    const fields = isVevent(override)
      ? readBaseFields(override) ?? occurrenceFields(base, occurrenceDate)
      : occurrenceFields(base, occurrenceDate);
    if (!overlapsWindow(fields, window)) continue;

    out.push({
      // 접미는 '옮긴 뒤 날짜'가 아니라 원 회차 날짜다. 수정본이 다른 회차 날짜 위로
      // 옮겨지면 두 회차가 같은 식별자가 되어 렌더러 이벤트 id까지 충돌한다.
      uid: uid ? `${uid}:${occurrenceDate}` : occurrenceDate,
      title: isVevent(override) ? readText(override.summary, title) : title,
      ...fields,
    });
  }
}

/**
 * 응답이 캘린더 형식인지 먼저 가리고 파싱한다. 로그인 페이지 같은 비-ICS 200 응답을
 * '일정 0건 성공'으로 접으면 멀쩡한 캐시를 빈 목록으로 덮어쓰게 되므로 실패로 던진다.
 */
function parseIcsCalendarOrThrow(icsText: string): Record<string, unknown> {
  if (typeof icsText !== 'string' || !icsText.includes('BEGIN:VCALENDAR')) {
    throw new Error('외부 캘린더 응답이 일정 형식이 아닙니다');
  }
  const parsed = (icalModule as unknown as {
    sync: { parseICS(text: string): Record<string, unknown> };
  }).sync.parseICS(icsText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('외부 캘린더 응답이 일정 형식이 아닙니다');
  }
  return parsed;
}

function parseCalendar(icsText: string): Record<string, unknown> | null {
  try {
    return parseIcsCalendarOrThrow(icsText);
  } catch {
    return null;
  }
}

/**
 * ICS 본문을 조회 창 안의 일정 목록으로 전개한다. 반복 일정은 회차별로 펼치고,
 * 상한을 넘으면 가까운 회차부터 채운 뒤 잘라 냈다는 사실을 함께 알린다.
 */
export function expandIcsToEvents(
  icsText: string,
  window: IcsExpandWindow,
  options: IcsExpandOptions = {},
): IcsExpansion {
  const parsed = parseCalendar(icsText);
  if (!parsed) return { events: [], truncated: false };
  return expandParsedCalendar(parsed, window, options);
}

/**
 * `expandIcsToEvents`와 같지만 파싱 실패를 삼키지 않고 던진다. 주기 갱신은 이 쪽을 써서
 * 파싱 실패가 전송 실패와 같은 경로(사유 기록 + 직전 캐시 보존)로 합류하게 한다.
 */
export function expandIcsToEventsStrict(
  icsText: string,
  window: IcsExpandWindow,
  options: IcsExpandOptions = {},
): IcsExpansion {
  return expandParsedCalendar(parseIcsCalendarOrThrow(icsText), window, options);
}

function expandParsedCalendar(
  parsed: Record<string, unknown>,
  window: IcsExpandWindow,
  options: IcsExpandOptions,
): IcsExpansion {
  const collected: IcsExpandedEvent[] = [];
  for (const component of Object.values(parsed)) {
    if (!isVevent(component)) continue;
    collectVevent(component, window, collected);
  }

  const byDate = (left: IcsExpandedEvent, right: IcsExpandedEvent): number => {
    if (left.startDate !== right.startDate) return left.startDate < right.startDate ? -1 : 1;
    const leftTime = left.startTime ?? '';
    const rightTime = right.startTime ?? '';
    if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
    return left.uid.localeCompare(right.uid);
  };
  collected.sort(byDate);

  if (collected.length <= ICS_EVENTS_PER_SUBSCRIPTION_LIMIT) {
    return { events: collected, truncated: false };
  }

  // 앞에서부터 자르면 매일 반복처럼 회차가 많은 구독은 지난 일정으로 자리를 다 채우고
  // 정작 다가오는 일정을 잘라 낸다. 기준일 이후를 먼저 채우고 남는 자리만 과거로 메운다.
  const today = options.today ?? window.from;
  const upcoming = collected.filter((event) => event.endDate >= today);
  const past = collected.filter((event) => event.endDate < today);
  const kept = upcoming.slice(0, ICS_EVENTS_PER_SUBSCRIPTION_LIMIT);
  if (kept.length < ICS_EVENTS_PER_SUBSCRIPTION_LIMIT) {
    // 과거는 최근 것부터 채운다.
    kept.push(...past.slice(-(ICS_EVENTS_PER_SUBSCRIPTION_LIMIT - kept.length)));
  }
  kept.sort(byDate);
  return { events: kept, truncated: true };
}


/* ═══════════════════════════════════════════════════
   구독 저장 · 갱신
   ═══════════════════════════════════════════════════ */

/** 조회 창 기본값 — 설계 SSOT(D14) "과거 1개월 ~ 미래 6개월". */
const ICS_WINDOW_PAST_MONTHS = 1;
const ICS_WINDOW_FUTURE_MONTHS = 6;
const ICS_STORE_VERSION = 1;
/** 주소 형식 거절 사유. 메인 프로세스가 권한 있는 판정을 내린다. */
export const ICS_URL_ERROR = '캘린더 주소는 http 또는 https로 시작해야 합니다';

export interface IcsSubscriptionStoreDeps {
  /**
   * 저장 파일 내용. **파일이 없을 때만 null**, 그 밖의 읽기 오류(백신 EBUSY/EPERM 등)는
   * 반드시 reject해야 한다. 오류를 null로 접으면 store가 빈 목록을 확정 캐시하고
   * 다음 저장이 멀쩡한 파일을 통째로 지운다.
   */
  readSubscriptionsFile(): Promise<string | null>;
  writeSubscriptionsFile(contents: string): Promise<void>;
  /** 저장 파일이 깨졌을 때 첫 덮어쓰기 전에 원본을 옮겨 둔다(있을 때만 호출). */
  backupSubscriptionsFile?(): Promise<void>;
  /** 정규화된 https URL의 본문을 가져온다. 리다이렉트·크기 제한은 구현 쪽 책임. */
  fetchText(url: string): Promise<string>;
  createId(): string;
  now(): Date;
  /** 갱신이 끝났음을 렌더러에 알린다. */
  publishChanged?(payload: { subId: string | null }): void;
  /** 조회 창 재정의(테스트·특수 목적). 없으면 now() 기준 기본 창을 쓴다. */
  resolveWindow?(now: Date): IcsExpandWindow;
}

export interface IcsSubscriptionStore {
  list(): Promise<IcsSubscription[]>;
  add(input: IcsSubscriptionAddInput): Promise<IcsSubscription>;
  update(id: string, patch: IcsSubscriptionUpdateInput): Promise<IcsSubscription | null>;
  remove(id: string): Promise<void>;
  /** id가 null이면 켜져 있는 모든 구독을 갱신한다. */
  refresh(id: string | null): Promise<void>;
  events(): Promise<IcsSubscriptionEvents[]>;
}

/**
 * webcal://은 https://로 바꾸고, http(s) 밖의 프로토콜은 거절한다.
 * 거절 대상을 문자열로 되돌려 주면 그대로 fetch에 들어가므로 반드시 null을 반환한다.
 */
export function normalizeIcsUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (trimmed === '') return null;
  const withProtocol = /^webcal:\/\//i.test(trimmed)
    ? `https://${trimmed.slice('webcal://'.length)}`
    : trimmed;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!parsed.hostname) return null;
  return parsed.toString();
}

function shiftMonths(now: Date, months: number): Date {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + months,
    now.getUTCDate(),
  ));
}

function defaultWindow(now: Date): IcsExpandWindow {
  return {
    from: shiftMonths(now, -ICS_WINDOW_PAST_MONTHS).toISOString().slice(0, 10),
    to: shiftMonths(now, ICS_WINDOW_FUTURE_MONTHS).toISOString().slice(0, 10),
  };
}

function sanitizeSubscription(value: unknown): IcsSubscription | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const url = normalizeIcsUrl(row.url);
  if (typeof row.id !== 'string' || row.id.trim() === '' || !url) return null;
  if (typeof row.name !== 'string' || typeof row.color !== 'string') return null;
  return {
    id: row.id,
    name: row.name,
    url,
    color: row.color,
    enabled: row.enabled !== false,
    lastFetchedAt: typeof row.lastFetchedAt === 'string' ? row.lastFetchedAt : null,
    lastError: typeof row.lastError === 'string' ? row.lastError : null,
  };
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  if (typeof error === 'string' && error.trim() !== '') return error;
  return '외부 캘린더를 불러오지 못했습니다';
}

export function createIcsSubscriptionStore(deps: IcsSubscriptionStoreDeps): IcsSubscriptionStore {
  let subscriptions: IcsSubscription[] | null = null;
  /**
   * 첫 로드가 끝나기 전에 두 호출이 겹치면, 나중에 끝난 읽기가 앞선 호출이 이미 담아 둔
   * 배열을 통째로 갈아치운다(앱 시작 시 주기 갱신과 렌더러 목록 조회가 실제로 겹친다).
   * 진행 중인 읽기를 공유해 목록 배열이 한 번만 만들어지게 한다.
   */
  let loadInFlight: Promise<IcsSubscription[]> | null = null;
  /** 조회 결과는 메모리에만 둔다. 저장 파일에는 구독 설정만 남긴다. */
  const cache = new Map<string, { events: IcsExpandedEvent[]; truncated: boolean }>();

  /** 저장 파일이 깨져 있었다. 첫 덮어쓰기 전에 원본을 한 번 백업한다. */
  let corrupted = false;
  let backupDone = false;

  const readSubscriptions = async (): Promise<{ rows: IcsSubscription[]; degraded: boolean }> => {
    let raw: string | null;
    try {
      raw = await deps.readSubscriptionsFile();
    } catch {
      // 파일이 없는 게 아니라 읽지 못한 것이다. 빈 목록을 확정하면 다음 저장이 파일을 지운다.
      return { rows: [], degraded: true };
    }

    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        // 읽히긴 했는데 내용이 깨졌다. 빈 목록으로 시작하되 원본은 백업해 둔다.
        corrupted = true;
        parsed = null;
      }
    }

    const rows = parsed && typeof parsed === 'object'
      ? (parsed as { subscriptions?: unknown }).subscriptions
      : null;
    return {
      rows: Array.isArray(rows)
        ? rows.map(sanitizeSubscription).filter((row): row is IcsSubscription => row !== null)
        : [],
      degraded: false,
    };
  };

  const loadSubscriptions = async (): Promise<IcsSubscription[]> => {
    if (subscriptions) return subscriptions;
    if (!loadInFlight) {
      loadInFlight = readSubscriptions().then((result) => {
        // 읽기 실패는 캐시하지 않는다 — 다음 호출이 다시 읽는다.
        if (result.degraded) return result.rows;
        // 먼저 끝난 로드만 목록을 만든다. 뒤늦게 끝난 읽기는 그 배열을 그대로 쓴다.
        subscriptions ??= result.rows;
        return subscriptions;
      }).finally(() => { loadInFlight = null; });
    }
    return loadInFlight;
  };

  const persist = async (): Promise<void> => {
    const rows = await loadSubscriptions();
    // 읽기에 실패한 상태(목록 미확정)에서 저장하면 멀쩡한 파일을 빈 목록으로 덮어쓴다.
    // 조용히 넘기면 사용자는 저장된 줄 알게 되므로 사유를 알린다.
    if (subscriptions === null) {
      throw new Error('구독 설정을 읽지 못해 저장할 수 없습니다. 잠시 후 다시 시도해 주세요');
    }
    if (corrupted && !backupDone) {
      backupDone = true;
      try {
        await deps.backupSubscriptionsFile?.();
      } catch {
        // 백업 실패가 저장 자체를 막지는 않는다.
      }
    }
    await deps.writeSubscriptionsFile(JSON.stringify({
      version: ICS_STORE_VERSION,
      subscriptions: rows,
    }, null, 2));
  };

  const announce = (subId: string | null): void => {
    try {
      deps.publishChanged?.({ subId });
    } catch {
      // 알림 실패가 갱신 자체를 되돌리지는 않는다.
    }
  };

  /** 실패해도 직전에 받아 둔 캐시와 마지막 성공 시각은 그대로 둔다. */
  const fetchOne = async (subscription: IcsSubscription): Promise<void> => {
    try {
      const text = await deps.fetchText(subscription.url);
      const now = deps.now();
      const window = deps.resolveWindow?.(now) ?? defaultWindow(now);
      const expanded = expandIcsToEventsStrict(text, window, { today: toKstFields(now).date });
      cache.set(subscription.id, { events: expanded.events, truncated: expanded.truncated });
      subscription.lastFetchedAt = deps.now().toISOString();
      subscription.lastError = null;
    } catch (error) {
      subscription.lastError = readErrorMessage(error);
    }
  };

  return {
    async list() {
      return (await loadSubscriptions()).map((row) => ({ ...row }));
    },

    async add(input) {
      const url = normalizeIcsUrl(input?.url);
      if (!url) throw new Error(ICS_URL_ERROR);
      const rows = await loadSubscriptions();
      const created: IcsSubscription = {
        id: deps.createId(),
        name: typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : url,
        url,
        color: typeof input.color === 'string' && input.color.trim() !== '' ? input.color : '#8B8DA3',
        enabled: true,
        lastFetchedAt: null,
        lastError: null,
      };
      rows.push(created);
      await fetchOne(created);
      await persist();
      announce(created.id);
      return { ...created };
    },

    async update(id, patch) {
      const rows = await loadSubscriptions();
      const target = rows.find((row) => row.id === id);
      if (!target) return null;
      if (typeof patch?.name === 'string' && patch.name.trim() !== '') target.name = patch.name.trim();
      if (typeof patch?.color === 'string' && patch.color.trim() !== '') target.color = patch.color;
      if (typeof patch?.enabled === 'boolean') target.enabled = patch.enabled;
      await persist();
      announce(target.id);
      return { ...target };
    },

    async remove(id) {
      const rows = await loadSubscriptions();
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return;
      rows.splice(index, 1);
      cache.delete(id);
      await persist();
      announce(id);
    },

    async refresh(id) {
      const rows = await loadSubscriptions();
      const targets = rows.filter((row) => row.enabled && (id === null || row.id === id));
      // 갱신할 대상이 없으면 저장·알림도 없다. 읽기 실패로 목록이 비어 보이는 순간에
      // 무조건 저장하면 멀쩡한 파일이 빈 목록으로 덮어써진다.
      if (targets.length === 0) return;
      for (const target of targets) await fetchOne(target);
      await persist();
      announce(id);
    },

    async events() {
      const rows = await loadSubscriptions();
      const result: IcsSubscriptionEvents[] = [];
      for (const row of rows) {
        if (!row.enabled) continue;
        const cached = cache.get(row.id);
        if (!cached) continue;
        result.push({
          subId: row.id,
          events: cached.events.map((event) => ({ ...event })),
          truncated: cached.truncated,
        });
      }
      return result;
    },
  };
}


/* ═══════════════════════════════════════════════════
   본문 받아 오기 (전송)
   ═══════════════════════════════════════════════════ */

/** 리다이렉트 추적 상한. 순환하는 주소에 매달리지 않게 한다. */
export const ICS_MAX_REDIRECTS = 3;
/** 한 번에 받아들일 본문 크기 상한. 넘으면 받다가 끊는다. */
export const ICS_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** node의 http(s).get 응답 중 이 모듈이 실제로 쓰는 부분만 추린 모양. */
export interface IcsHttpResponse {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  setEncoding(encoding: string): void;
  on(eventName: 'data', handler: (chunk: string) => void): void;
  on(eventName: 'end' | 'error', handler: (value?: unknown) => void): void;
  destroy(): void;
}

export interface IcsHttpRequest {
  on(eventName: 'error' | 'timeout', handler: (value?: unknown) => void): IcsHttpRequest;
  destroy(): void;
}

export interface IcsTextFetcherDeps {
  get(url: string, onResponse: (response: IcsHttpResponse) => void): IcsHttpRequest;
  /** 요청 하나의 전체 시한(ms). http 타임아웃은 '유휴' 기준이라 트리클 응답을 못 끊는다. */
  overallTimeoutMs?: number;
}

/** 한 요청이 붙잡고 있을 수 있는 최대 시간. 이 시간을 넘기면 연결을 끊는다. */
const ICS_OVERALL_TIMEOUT_MS = 60_000;

function readLocationHeader(response: IcsHttpResponse): string | null {
  const raw = response.headers?.location;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * 구독 주소의 본문을 문자열로 받아 온다. 리다이렉트는 정해진 횟수까지만 따라가고,
 * 목적지가 http(s)를 벗어나면 거절한다. 본문이 상한을 넘으면 연결을 끊는다.
 */
export function createIcsTextFetcher(deps: IcsTextFetcherDeps): (url: string) => Promise<string> {
  const requestOnce = (url: string, redirectsLeft: number): Promise<string> => (
    new Promise<string>((resolve, reject) => {
      let settled = false;
      const settle = (run: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(overallTimer);
        run();
      };

      // 20s http 타임아웃은 '유휴' 기준이라, 20s 미만 간격으로 찔끔찔끔 보내는 서버는
      // 영원히 끝나지 않는다. 전체 시한을 따로 두어 갱신이 붙잡히지 않게 한다.
      const overallTimer = setTimeout(() => {
        request.destroy();
        settle(() => reject(new Error('외부 캘린더 응답이 너무 늦습니다')));
      }, deps.overallTimeoutMs ?? ICS_OVERALL_TIMEOUT_MS);

      // 응답 콜백은 http 모듈이 동기로 호출한다 — 여기서 던진 예외는 잡아 줄 곳이 없어
      // 메인 프로세스 uncaughtException(=앱 종료)이 된다. 본문 전체를 감싸 실패로 접는다.
      const request = deps.get(url, (response) => {
        try {
          const status = response.statusCode ?? 0;

          if (status >= 300 && status < 400) {
            const location = readLocationHeader(response);
            response.destroy();
            if (!location) {
              settle(() => reject(new Error(`외부 캘린더가 옮겨 간 주소를 알려 주지 않았습니다 (${status})`)));
              return;
            }
            if (redirectsLeft <= 0) {
              settle(() => reject(new Error('주소가 너무 여러 번 옮겨져 불러오지 못했습니다')));
              return;
            }
            // 외부 서버가 파싱 불가능한 Location(예: 'http://')을 줄 수 있다.
            let resolvedLocation: string;
            try {
              resolvedLocation = new URL(location, url).toString();
            } catch {
              settle(() => reject(new Error(ICS_URL_ERROR)));
              return;
            }
            const next = normalizeIcsUrl(resolvedLocation);
            if (!next) {
              settle(() => reject(new Error(ICS_URL_ERROR)));
              return;
            }
            settle(() => { resolve(requestOnce(next, redirectsLeft - 1)); });
            return;
          }

          if (status < 200 || status >= 300) {
            response.destroy();
            settle(() => reject(new Error(`외부 캘린더를 불러오지 못했습니다 (${status})`)));
            return;
          }

          let received = 0;
          const chunks: string[] = [];
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            received += Buffer.byteLength(chunk, 'utf8');
            if (received > ICS_MAX_RESPONSE_BYTES) {
              response.destroy();
              settle(() => reject(new Error('외부 캘린더 파일이 너무 큽니다')));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => { settle(() => resolve(chunks.join(''))); });
          response.on('error', (error) => {
            settle(() => reject(error instanceof Error ? error : new Error(readErrorMessage(error))));
          });
        } catch (error) {
          settle(() => reject(error instanceof Error ? error : new Error(readErrorMessage(error))));
        }
      });

      request.on('error', (error) => {
        settle(() => reject(error instanceof Error ? error : new Error(readErrorMessage(error))));
      });
      request.on('timeout', () => {
        request.destroy();
        settle(() => reject(new Error('외부 캘린더 응답이 너무 늦습니다')));
      });
    })
  );

  return (url: string) => {
    const normalized = normalizeIcsUrl(url);
    if (!normalized) return Promise.reject(new Error(ICS_URL_ERROR));
    return requestOnce(normalized, ICS_MAX_REDIRECTS);
  };
}
