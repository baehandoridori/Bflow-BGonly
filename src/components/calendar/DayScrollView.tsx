import { EventTagBadges } from './EventTagBadges';
import { useEventTagTooltip, type EventTagTooltipBind } from './useEventTagTooltip';
import { resolveEventTags } from './eventTagPresentation';
// ─── DayScrollView: 휠 스크롤 포커스 일간 뷰 (5일 표시) ──────
import React, { useMemo, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays } from 'lucide-react';
import type { CalendarEvent } from '@/types/calendar';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { fmtDate, daysBetween, hexToRgba } from '@/utils/calendarDate';
import { formatEventTimeRange, sortEventsForList } from '@/utils/calendarEventFilter';
import { calendarEventIdentityKey } from '@/utils/calendarEventIdentity';

/* ── 로컬 유틸 ──────────────────────────────────────── */
const WEEKDAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

/** 연도의 dayIndex(0-based) → Date */
function dayIndexToDate(year: number, dayIndex: number): Date {
  const jan1 = new Date(year, 0, 1, 12, 0, 0, 0);
  const d = new Date(jan1);
  d.setDate(d.getDate() + dayIndex);
  return d;
}

/** 해당 연도의 총 일수 */
function daysInYear(year: number): number {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
}

/* ── 타입 ────────────────────────────────────────────── */
export interface DayScrollViewProps {
  events: CalendarEvent[];
  activeDayIndex: number; // day of year (0-based, 0~365)
  onActiveDayChange: (index: number) => void;
  onEventClick?: (event: CalendarEvent) => void;
  onEventContextMenu?: (event: CalendarEvent, mouse: React.MouseEvent) => void;
  pulseDate?: string | null; // '오늘' 이동 안내 펄스
  onDateClick?: (date: string) => void; // YYYY-MM-DD — 날짜 클릭 시 이벤트 생성
  year: number;
  highlightedEventIdentities?: ReadonlySet<string>;
  reduceMotion?: boolean;
  /** 연타 중(←→를 누르고 있을 때)이면 칸 너비를 기다리지 않고 바로 바꾼다 — 트랜지션이 계속 다시 겨눠지며 덜컹이지 않게. */
  instantTransition?: boolean;
}

/* ── 상수 ────────────────────────────────────────────── */
const DEBOUNCE_MS = 150;
/** 목록이 방금까지 스크롤되고 있었다면, 끝에 닿은 관성 휠로 날짜가 넘어가지 않게 이만큼 쉰다. */
const LIST_SCROLL_SETTLE_MS = 300;
/**
 * 포커스 ±2일을 보여 주고, 그 바깥 ±3일은 너비 0인 대기 칸으로 둔다.
 * 하루씩 넘길 때 모든 칸이 그대로 남아(날짜 키) 너비만 CSS 트랜지션으로 바뀐다 —
 * 새 칸은 0에서 자라고 나가는 칸은 0으로 줄어들어, 칸이 갑자기 생기거나 빠지며 튀지 않는다.
 */
const RENDER_RANGE = 3;
/** 포커스와의 거리(0~3)별 칸 모양. 너비 합은 100% — 넘기는 동안에도 합이 유지된다. */
const COLUMN_SHAPES = [
  { width: '60%', minWidth: 0, opacity: 1, scale: 1 },
  { width: '15%', minWidth: 60, opacity: 0.3, scale: 0.97 },
  { width: '5%', minWidth: 36, opacity: 0.12, scale: 0.94 },
  { width: '0%', minWidth: 0, opacity: 0, scale: 0.94 },
] as const;
/**
 * 포커스 카드 내용의 고정 너비 = 포커스 칸 최종 너비(60cqw) − 칸 안쪽 여백(px-1 양쪽 8px) − 카드 테두리(2px).
 * 칸 너비가 바뀌는 동안 내용이 다시 줄바꿈되지 않고, 늘어나는 카드 틀 안에서 드러나기만 한다.
 */
const ACTIVE_CONTENT_WIDTH = 'calc(60cqw - 10px)';
const PRIMARY_TEXT = 'rgb(var(--color-text-primary))';
const SECONDARY_TEXT = 'rgb(var(--color-text-secondary))';
const ACCENT = 'rgb(var(--color-accent))';
const CARD_BG_SOFT = 'rgb(var(--color-bg-card) / 0.58)';
const CARD_BG_SOFTEST = 'rgb(var(--color-bg-card) / 0.46)';
const CARD_BORDER = '1px solid rgb(var(--color-bg-border) / 0.28)';

/* ── 컴포넌트 ────────────────────────────────────────── */
export default function DayScrollView({
  events,
  activeDayIndex,
  onActiveDayChange,
  onEventClick,
  onEventContextMenu,
  onDateClick,
  pulseDate,
  year,
  highlightedEventIdentities,
  reduceMotion = false,
  instantTransition = false,
}: DayScrollViewProps) {
  const maxDay = daysInYear(year) - 1;
  const tags = useCalendarStore((state) => state.tags);
  const tagNameById = useMemo(
    () => Object.fromEntries(tags.map((tag) => [tag.id, tag.name])) as Record<string, string>,
    [tags],
  );

  /* 그릴 날짜 범위: active ± 3 (±3은 너비 0 대기 칸) */
  const visibleDays = useMemo(() => {
    const result: { date: Date; dateStr: string; absIdx: number }[] = [];
    const start = Math.max(0, activeDayIndex - RENDER_RANGE);
    const end = Math.min(maxDay, activeDayIndex + RENDER_RANGE);
    for (let i = start; i <= end; i++) {
      const d = dayIndexToDate(year, i);
      result.push({ date: d, dateStr: fmtDate(d), absIdx: i });
    }
    return result;
  }, [year, activeDayIndex, maxDay]);

  /* 휠 디바운스 */
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastListScrollAtRef = useRef(0);
  // 카드 안 일정 목록이 움직인 시각. scroll 은 버블링되지 않아 캡처로 받는다.
  const handleScrollCapture = useCallback((e: React.UIEvent) => {
    if ((e.target as HTMLElement).closest?.('[data-scroll-events]')) lastListScrollAtRef.current = Date.now();
  }, []);
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (wheelTimer.current) return;
      // 스크롤 가능한 이벤트 리스트 내부에서는 날짜 이동 차단
      const target = e.target as HTMLElement;
      const scrollable = target.closest('[data-scroll-events]') as HTMLElement | null;
      if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) {
        const { scrollTop, scrollHeight, clientHeight } = scrollable;
        const atTop = scrollTop <= 0 && e.deltaY < 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;
        if (!atTop && !atBottom) return; // 리스트 내 스크롤 우선
        // 목록 끝에 막 닿은 관성 스크롤(트랙패드)이 그대로 날짜를 넘기지 않게 한 번 쉰다.
        if (Date.now() - lastListScrollAtRef.current < LIST_SCROLL_SETTLE_MS) return;
      }
      const dir = e.deltaY > 0 ? 1 : -1;
      onActiveDayChange(activeDayIndex + dir);
      wheelTimer.current = setTimeout(() => {
        wheelTimer.current = null;
      }, DEBOUNCE_MS);
    },
    [activeDayIndex, onActiveDayChange],
  );

  /* 날짜별 일정 — 보이는 칸만, 일정·범위가 바뀔 때만 다시 거른다 */
  const eventsByDate = useMemo(() => {
    const byDate = new Map<string, CalendarEvent[]>();
    for (const { dateStr } of visibleDays) {
      byDate.set(dateStr, events.filter((ev) => ev.startDate <= dateStr && ev.endDate >= dateStr));
    }
    return byDate;
  }, [events, visibleDays]);

  const today = fmtDate(new Date());

  return (
    <div
      className={`flex items-stretch w-full select-none overflow-hidden flex-1 h-full${reduceMotion || instantTransition ? ' calendar-scroll-rows--instant' : ''}`}
      // 포커스 카드 내용 너비(60cqw)의 기준 상자
      style={{ containerType: 'inline-size' }}
      onWheel={handleWheel}
      onScrollCapture={handleScrollCapture}
    >
      {visibleDays.map(({ date, dateStr, absIdx }) => {
        const absDiff = Math.abs(absIdx - activeDayIndex);
        const shape = COLUMN_SHAPES[Math.min(absDiff, RENDER_RANGE)];
        const isActive = absDiff === 0;
        const isNear = absDiff === 1;
        const isStandby = absDiff >= RENDER_RANGE;
        const dayEvents = eventsByDate.get(dateStr) ?? [];

        return (
          <div
            key={dateStr}
            // 포커스 칸은 자르지 않는다(이동 안내 펄스의 바깥 빛). 나머지는 좁아지거나 0이 되므로 자른다.
            className={`calendar-day-col flex-shrink-0${isActive ? '' : ' overflow-hidden'}`}
            aria-hidden={isStandby || undefined}
            style={{
              cursor: !isActive && !isStandby ? 'pointer' : undefined,
              width: shape.width,
              minWidth: shape.minWidth,
            }}
            onClick={() => !isActive && !isStandby && onActiveDayChange(absIdx)}
          >
            {/* 강조(투명도·크기)는 CSS 트랜지션 — 합성 스레드에서 돈다 */}
            <div
              className="calendar-scroll-row h-full px-1"
              style={{ opacity: shape.opacity, transform: shape.scale === 1 ? undefined : `scale(${shape.scale})` }}
            >
              {isActive ? (
                <ActiveDay
                  date={date}
                  dateStr={dateStr}
                  events={dayEvents}
                  today={today}
                  onEventClick={onEventClick}
                  onEventContextMenu={onEventContextMenu}
                  onDateClick={onDateClick}
                  pulseDate={pulseDate}
                  tagNameById={tagNameById}
                  highlightedEventIdentities={highlightedEventIdentities}
                  reduceMotion={reduceMotion}
                />
              ) : isNear ? (
                <NearDay
                  date={date}
                  dateStr={dateStr}
                  events={dayEvents}
                  today={today}
                />
              ) : (
                <FarDay
                  date={date}
                  dateStr={dateStr}
                  today={today}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── ActiveDay: 포커스된 날 ──────────────────────────── */
function ActiveDay({
  date,
  dateStr,
  events,
  today,
  onEventClick,
  onEventContextMenu,
  onDateClick,
  pulseDate,
  tagNameById,
  highlightedEventIdentities,
  reduceMotion,
}: {
  date: Date;
  dateStr: string;
  events: CalendarEvent[];
  today: string;
  onEventClick?: (ev: CalendarEvent) => void;
  onEventContextMenu?: (ev: CalendarEvent, mouse: React.MouseEvent) => void;
  onDateClick?: (date: string) => void;
  pulseDate?: string | null;
  tagNameById: Record<string, string>;
  highlightedEventIdentities?: ReadonlySet<string>;
  reduceMotion: boolean;
}) {
  const dow = date.getDay();
  const isToday = dateStr === today;
  const dayColor = dow === 0 ? 'rgb(var(--color-calendar-sunday))' : dow === 6 ? 'rgb(var(--color-calendar-saturday))' : PRIMARY_TEXT;
  const label = `${date.getMonth() + 1}/${date.getDate()} ${WEEKDAY_KR[dow]}`;
  const sortedEvents = useMemo(() => sortEventsForList(events), [events]);
  // 태그 툴팁은 카드마다가 아니라 한 번만 건다(카드 수만큼 문서 리스너가 붙었다 떨어지지 않게).
  const hover = useEventTagTooltip();

  return (
    <div className="relative h-full">
      {/* 카드 틀 — 칸 너비를 따라 늘고 줄며 안쪽을 잘라 낸다. */}
      <div
        className="relative rounded-xl h-full overflow-hidden"
        style={{
          background: 'rgba(108,92,231,0.06)',
          border: '1px solid rgba(108,92,231,0.35)',
          boxShadow: '0 0 18px rgba(108,92,231,0.12)',
        }}
      >
      {/* 내용은 최종 너비로 고정 — 칸이 넓어지는 동안 다시 줄바꿈되지 않고 드러나기만 한다. */}
      <div className="flex flex-col h-full p-5" style={{ width: ACTIVE_CONTENT_WIDTH }}>
      {/* 날짜 헤더 */}
      <div className="flex items-center gap-3 mb-4">
        <span
          className="text-3xl font-bold w-12 h-12 flex items-center justify-center rounded-full"
          style={{
            color: isToday ? '#fff' : dayColor,
            background: isToday ? '#6C5CE7' : 'transparent',
          }}
        >
          {date.getDate()}
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-bold" style={{ color: ACCENT }}>
            {label}
          </span>
          <span className="text-[10px]" style={{ color: SECONDARY_TEXT }}>
            {date.getFullYear()}년 {date.getMonth() + 1}월
          </span>
        </div>
        {isToday && (
          <span
            className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'rgb(var(--color-accent) / 0.2)', color: ACCENT }}
          >
            오늘
          </span>
        )}
      </div>

      {/* 이벤트 카드 */}
      {events.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center flex-1 gap-2 cursor-pointer rounded-lg hover:bg-bg-border/20 transition-colors"
          onClick={() => onDateClick?.(dateStr)}
        >
          <CalendarDays size={36} color={SECONDARY_TEXT} />
          <span className="text-sm" style={{ color: SECONDARY_TEXT }}>
            일정이 없습니다
          </span>
        </div>
      ) : (
        <div data-scroll-events className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto">
          {sortedEvents.map((ev) => (
            <DayEventCard
              key={calendarEventIdentityKey(ev)}
              event={ev}
              today={today}
              tagNameById={tagNameById}
              isRealtimeHighlighted={highlightedEventIdentities?.has(calendarEventIdentityKey(ev)) === true}
              reduceMotion={reduceMotion}
              bindHover={hover.bind}
              onClick={(e) => { e.stopPropagation(); onEventClick?.(ev); }}
              onContextMenu={onEventContextMenu ? (e) => onEventContextMenu(ev, e) : undefined}
            />
          ))}
          {/* 빈 공간 클릭으로 이벤트 생성 */}
          <div
            className="flex-1 min-h-[40px] cursor-pointer rounded-lg hover:bg-bg-border/20 transition-colors"
            onClick={() => onDateClick?.(dateStr)}
          />
        </div>
      )}
      </div>
      </div>
      {/* 이동 안내 펄스는 카드 틀 밖에 겹친다 — 틀이 안쪽을 잘라도 바깥 빛 번짐은 남는다. */}
      {dateStr === pulseDate && (
        <motion.div
          data-navigate-pulse="true"
          className="absolute inset-0 rounded-xl border-2 border-accent pointer-events-none"
          style={{ boxShadow: '0 0 12px 4px rgba(108, 92, 231, 0.4), 0 0 24px 8px rgba(108, 92, 231, 0.15)' }}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
          animate={reduceMotion
            ? { opacity: 1, scale: 1 }
            : { opacity: [0, 1, 0.6, 1, 0], scale: [0.98, 1.01, 1, 1.005, 1] }}
          transition={reduceMotion ? { duration: 0 } : { duration: 2, ease: 'easeInOut' }}
        />
      )}
      {hover.tooltip}
    </div>
  );
}

/* ── DayEventCard ────────────────────────────────────── */
function DayEventCard({
  event,
  today,
  tagNameById,
  isRealtimeHighlighted,
  reduceMotion,
  bindHover,
  onClick,
  onContextMenu,
}: {
  event: CalendarEvent;
  today: string;
  tagNameById: Record<string, string>;
  isRealtimeHighlighted: boolean;
  reduceMotion: boolean;
  /** 상위(ActiveDay)가 한 번만 건 태그 툴팁 훅의 바인딩. */
  bindHover?: EventTagTooltipBind;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const tags = useCalendarStore((state) => state.tags);
  const accent = resolveEventTags(event, tags)[0]?.color ?? event.color;
  const dDay = daysBetween(today, event.endDate);
  const dDayLabel =
    dDay === 0 ? 'D-Day' : dDay > 0 ? `D-${dDay}` : `D+${Math.abs(dDay)}`;
  const subtitle = event.allDay === false
    ? formatEventTimeRange(event, tagNameById)
    : null;

  return (
    // 호버 확대는 CSS 로 — 카드마다 framer 컴포넌트를 만들면 날을 넘길 때마다 그만큼 무겁게 마운트된다.
    <div
      {...bindHover?.(event)}
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-event-identity={calendarEventIdentityKey(event)}
      data-realtime-highlight={isRealtimeHighlighted ? 'true' : undefined}
      className={`calendar-event-card flex items-center gap-2 cursor-pointer ${isRealtimeHighlighted ? reduceMotion ? 'calendar-realtime-highlight-static' : 'calendar-realtime-highlight' : ''}`}
      style={{
        background: hexToRgba(accent, 0.08),
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        padding: '10px 12px',
      }}
    >
      <div className="flex flex-col flex-1 min-w-0">
        <span
          className="font-bold truncate"
          style={{ fontSize: 12, color: PRIMARY_TEXT }}
        >
          {event.title}
        </span>
        <div className="mt-1"><EventTagBadges event={event} /></div>
        {subtitle && (
          <span style={{ fontSize: 10, color: SECONDARY_TEXT }}>
            {subtitle}
          </span>
        )}
      </div>
      <span
        className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
        style={{
          background: hexToRgba(accent, 0.18),
          color: PRIMARY_TEXT,
        }}
      >
        {dDayLabel}
      </span>
    </div>
  );
}

/* ── NearDay: ±1일 (반투명, 축소) ────────────────────── */
function NearDay({
  date,
  dateStr,
  events,
  today,
}: {
  date: Date;
  dateStr: string;
  events: CalendarEvent[];
  today: string;
}) {
  const dow = date.getDay();
  const isToday = dateStr === today;
  const dayColor = dow === 0 ? 'rgb(var(--color-calendar-sunday))' : dow === 6 ? 'rgb(var(--color-calendar-saturday))' : PRIMARY_TEXT;

  return (
    <div
      className="rounded-lg px-2 py-3 h-full flex flex-col items-center"
      style={{ background: CARD_BG_SOFT, border: CARD_BORDER }}
    >
      <span
        className="text-[10px] font-medium mb-1"
        style={{ color: dayColor }}
      >
        {WEEKDAY_KR[dow]}
      </span>
      <span
        className="text-lg font-bold w-8 h-8 flex items-center justify-center rounded-full mb-2"
        style={{
          color: isToday ? '#fff' : dayColor,
          background: isToday ? '#6C5CE7' : 'transparent',
        }}
      >
        {date.getDate()}
      </span>
      {/* 이벤트 도트 */}
      <div className="flex flex-col gap-1 items-center">
        {events.slice(0, 5).map((ev) => (
          <div
            key={calendarEventIdentityKey(ev)}
            className="rounded-full"
            style={{ width: 6, height: 6, background: ev.color }}
          />
        ))}
        {events.length > 5 && (
          <span style={{ fontSize: 7, color: SECONDARY_TEXT }}>
            +{events.length - 5}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── FarDay: ±2일 (매우 투명, 날짜만) ─────────────────── */
function FarDay({
  date,
  dateStr,
  today,
}: {
  date: Date;
  dateStr: string;
  today: string;
}) {
  const dow = date.getDay();
  const isToday = dateStr === today;
  const dayColor = dow === 0 ? 'rgb(var(--color-calendar-sunday))' : dow === 6 ? 'rgb(var(--color-calendar-saturday))' : PRIMARY_TEXT;

  return (
    <div
      className="rounded-lg px-1 py-3 h-full flex flex-col items-center justify-center"
      style={{ background: CARD_BG_SOFTEST, border: CARD_BORDER }}
    >
      <span
        className="text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full"
        style={{
          color: isToday ? '#fff' : dayColor,
          background: isToday ? '#6C5CE7' : 'transparent',
        }}
      >
        {date.getDate()}
      </span>
    </div>
  );
}
