import { EventTagBadges } from './EventTagBadges';
import { useEventTagTooltip, type EventTagTooltipBind } from './useEventTagTooltip';
import { resolveEventTags } from './eventTagPresentation';
// ─── WeekScrollView: 휠 스크롤 포커스 주간 뷰 (전체 연도 ISO 주차) ──────
import React, { useMemo, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays } from 'lucide-react';
import type { CalendarEvent } from '@/types/calendar';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { visibleWeekDays } from '@/utils/calendarWeekdays';
import { useMotionPref } from '@/hooks/useMotionPref';
import { useStackFlip } from '@/hooks/useStackFlip';
import { WEEKDAYS, fmtDate, addDays, daysBetween, getISOWeekNumber, hexToRgba } from '@/utils/calendarDate';
import { formatEventTimeRange, sortEventsForList } from '@/utils/calendarEventFilter';
import { calendarEventIdentityKey } from '@/utils/calendarEventIdentity';

/* ── 로컬 유틸 ──────────────────────────────────────── */
/** 해당 연도의 일요일 시작 주 배열 생성 (약 53주) */
function generateYearWeeks(year: number): Date[][] {
  // 1월 1일이 속한 주의 일요일부터 시작
  const jan1 = new Date(year, 0, 1, 12, 0, 0, 0);
  const jan1Dow = jan1.getDay();
  const firstSunday = addDays(jan1, -jan1Dow);

  const weeks: Date[][] = [];
  let current = firstSunday;

  // 다음 해 1월 첫 주까지 포함
  const endDate = new Date(year + 1, 0, 7, 12, 0, 0, 0);
  while (current.getTime() < endDate.getTime()) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(addDays(current, d));
    }
    weeks.push(week);
    current = addDays(current, 7);
  }

  return weeks;
}

/** 오늘이 속한 주의 인덱스 찾기 */
function findWeekIndexForDate(weeks: Date[][], dateStr: string): number {
  for (let i = 0; i < weeks.length; i++) {
    const wStart = fmtDate(weeks[i][0]);
    const wEnd = fmtDate(weeks[i][6]);
    if (dateStr >= wStart && dateStr <= wEnd) return i;
  }
  return 0;
}

/* ── 타입 ────────────────────────────────────────────── */
export interface WeekScrollViewProps {
  currentMonth: number; // 0-indexed (호환용, 내부에서 연도 주차로 변환)
  currentYear: number;
  events: CalendarEvent[];
  today: string; // YYYY-MM-DD
  onEventClick: (ev: CalendarEvent) => void;
  onEventContextMenu?: (ev: CalendarEvent, mouse: React.MouseEvent) => void;
  onDateClick?: (date: string) => void; // YYYY-MM-DD — 날짜 클릭 시 이벤트 생성
  activeWeekIndex: number; // 연도 기준 절대 인덱스 (0~52)
  onWeekChange: (index: number) => void;
  pulseDate?: string | null; // '오늘' 이동 안내 펄스
  mode?: 'week' | '2week'; // 'week' = 1주 포커스, '2week' = 2주 활성
  highlightedEventIdentities?: ReadonlySet<string>;
  reduceMotion?: boolean;
  /** 연타 중이면 주 이동 스크롤도 즉시 — 부드러운 스크롤이 다음 입력에 밀린다. */
  instantScroll?: boolean;
  /** 꺼져 있으면 토·일 칸 자체를 그리지 않는다(주 5일 보기). */
  showWeekends?: boolean;
}

/* ── 상수 ────────────────────────────────────────────── */
const DEBOUNCE_MS = 150;
/** 목록이 방금까지 스크롤되고 있었다면, 끝에 닿은 관성 휠로 주가 넘어가지 않게 이만큼 쉰다. */
const LIST_SCROLL_SETTLE_MS = 300;
const VISIBLE_RANGE = 2; // 활성 주 ± 2주 표시
const PRIMARY_TEXT = 'rgb(var(--color-text-primary))';
const SECONDARY_TEXT = 'rgb(var(--color-text-secondary))';
const ACCENT = 'rgb(var(--color-accent))';
const COMPACT_BG = 'rgb(var(--color-bg-card) / 0.62)';
const COMPACT_BORDER = '1px solid rgb(var(--color-bg-border) / 0.3)';

/* ── 컴포넌트 ────────────────────────────────────────── */
export default function WeekScrollView({
  currentYear,
  events,
  today,
  onEventClick,
  onEventContextMenu,
  onDateClick,
  activeWeekIndex,
  onWeekChange,
  pulseDate,
  mode = 'week',
  highlightedEventIdentities,
  reduceMotion,
  instantScroll,
  showWeekends = true,
}: WeekScrollViewProps) {
  const is2Week = mode === '2week';
  const tags = useCalendarStore((state) => state.tags);
  const { reduce } = useMotionPref();
  const tagNameById = useMemo(
    () => Object.fromEntries(tags.map((tag) => [tag.id, tag.name])) as Record<string, string>,
    [tags],
  );
  /* 전체 연도 주 데이터 */
  const allWeeks = useMemo(() => generateYearWeeks(currentYear), [currentYear]);

  /* 표시할 주 범위 */
  const visibleWeeks = useMemo(() => {
    const result: { week: Date[]; absIdx: number; weekKey: string }[] = [];
    const range = is2Week ? 1 : VISIBLE_RANGE;
    const start = Math.max(0, activeWeekIndex - range);
    // 2주 모드: active + next가 활성이므로 +1 더 보여줌
    const endExtra = is2Week ? range + 1 : range;
    const end = Math.min(allWeeks.length - 1, activeWeekIndex + endExtra);
    for (let i = start; i <= end; i++) {
      result.push({ week: allWeeks[i], absIdx: i, weekKey: fmtDate(allWeeks[i][0]) });
    }
    return result;
  }, [allWeeks, activeWeekIndex, is2Week]);

  /* 주에 해당하는 이벤트 — 보이는 주만, 일정·범위가 바뀔 때만 다시 거른다 */
  const eventsByWeek = useMemo(() => {
    const byWeek = new Map<string, CalendarEvent[]>();
    for (const { week, weekKey } of visibleWeeks) {
      const wEnd = fmtDate(week[6]);
      byWeek.set(weekKey, events.filter((ev) => ev.endDate >= weekKey && ev.startDate <= wEnd));
    }
    return byWeek;
  }, [events, visibleWeeks]);

  /* 주 넘김 — 줄 묶음 전체를 한 번에 미끄러뜨린다(합성 스레드). 연타·동작 줄이기에서는 바로 바꾼다. */
  const stackRef = useRef<HTMLDivElement>(null);
  const activeWeekKey = allWeeks[activeWeekIndex] ? fmtDate(allWeeks[activeWeekIndex][0]) : `${currentYear}:${activeWeekIndex}`;
  const motionOff = reduceMotion ?? reduce;
  const instant = motionOff || instantScroll === true;
  useStackFlip(stackRef, `${mode}:${showWeekends ? 7 : 5}:${activeWeekKey}`, {
    axis: 'y',
    disabled: instant,
    order: activeWeekKey,
  });

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
      // 스크롤 가능한 이벤트 리스트 내부에서는 주 이동 차단
      const target = e.target as HTMLElement;
      const scrollable = target.closest('[data-scroll-events]') as HTMLElement | null;
      if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) {
        const { scrollTop, scrollHeight, clientHeight } = scrollable;
        const atTop = scrollTop <= 0 && e.deltaY < 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;
        if (!atTop && !atBottom) return;
        // 목록 끝에 막 닿은 관성 스크롤(트랙패드)이 그대로 주를 넘기지 않게 한 번 쉰다.
        if (Date.now() - lastListScrollAtRef.current < LIST_SCROLL_SETTLE_MS) return;
      }
      const dir = e.deltaY > 0 ? 1 : -1;
      // 부모가 연도 경계를 소유한다. -1/length는 이전/다음 해로 넘길 sentinel이다.
      onWeekChange(activeWeekIndex + dir);
      wheelTimer.current = setTimeout(() => {
        wheelTimer.current = null;
      }, DEBOUNCE_MS);
    },
    [activeWeekIndex, allWeeks.length, onWeekChange],
  );

  return (
    <div
      className="flex flex-col w-full select-none overflow-hidden flex-1 h-full justify-center"
      onWheel={handleWheel}
      onScrollCapture={handleScrollCapture}
    >
      {/* 줄 묶음. 포커스 주 카드는 남은 높이 안에 들어가고(일정 목록은 카드 안에서 스크롤),
          위아래 주는 줄어들지 않는다 — 일정이 많아도 이웃 주와 목록 끝이 화면 밖으로 밀려나지 않는다. */}
      <div
        ref={stackRef}
        className={`flex flex-col w-full min-h-0 max-h-full${instant ? ' calendar-scroll-rows--instant' : ''}`}
      >
        {visibleWeeks.map(({ week, absIdx, weekKey }) => {
          const diff = absIdx - activeWeekIndex;
          const absDiff = Math.abs(diff);
          const isoWeek = getISOWeekNumber(week[3]); // 목요일 기준

          // 2주 모드: active + next(+1) 둘 다 활성
          const isActive = is2Week
            ? (diff === 0 || diff === 1)
            : diff === 0;
          const isNear = !isActive && absDiff <= (is2Week ? 1 : 1);

          const opacity = isActive ? 1 : isNear ? 0.3 : 0.12;
          const scale = isActive ? 1 : isNear ? 0.97 : 0.94;
          const weekEvents = eventsByWeek.get(weekKey) ?? [];

          return (
            <div
              key={weekKey}
              data-flip-id={weekKey}
              data-flip-anchor={isActive ? undefined : 'true'}
              data-flip-active={isActive ? 'true' : undefined}
              className={isActive ? 'w-full flex flex-col' : 'w-full min-h-0 overflow-hidden'}
              style={{
                cursor: !isActive ? 'pointer' : undefined,
                // 높이가 모자라면 포커스 카드가 먼저 줄어든다(바닥 50vh·2주 30vh). 줄어들 몫 비중을 크게 둬
                // 이웃 주는 카드가 바닥에 닿은 뒤(창이 아주 낮을 때)에야 줄어든다 — 카드 아래가 잘리지 않게.
                minHeight: isActive ? (is2Week ? '30vh' : '50vh') : undefined,
                flex: isActive ? '0 1000 auto' : '0 1 auto',
              }}
              onClick={() => !isActive && onWeekChange(absIdx)}
            >
              {/* 강조(투명도·크기)는 CSS 트랜지션 — 합성 스레드에서 돈다 */}
              <div
                className={`calendar-scroll-row${isActive ? ' flex-1 min-h-0 flex flex-col' : ''}`}
                style={{ opacity, transform: scale === 1 ? undefined : `scale(${scale})` }}
              >
                {isActive ? (
                  <ActiveWeek
                    week={week}
                    events={weekEvents}
                    today={today}
                    isoWeek={isoWeek}
                    onEventClick={onEventClick}
                    onEventContextMenu={onEventContextMenu}
                    onDateClick={onDateClick}
                    pulseDate={pulseDate}
                    reduce={reduce}
                    tagNameById={tagNameById}
                    highlightedEventIdentities={highlightedEventIdentities}
                    reduceMotion={motionOff}
                    instantScroll={instantScroll === true}
                    showWeekends={showWeekends}
                  />
                ) : isNear ? (
                  <CompactWeek
                    week={week}
                    events={weekEvents}
                    today={today}
                    isoWeek={isoWeek}
                    showBars
                    showWeekends={showWeekends}
                  />
                ) : (
                  <CompactWeek
                    week={week}
                    events={[]}
                    today={today}
                    isoWeek={isoWeek}
                    showBars={false}
                    showWeekends={showWeekends}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* export for ScheduleView to find initial week index */
export { generateYearWeeks, findWeekIndexForDate };

/* ── ActiveWeek: 포커스된 주 ──────────────────────────── */
function ActiveWeek({
  week,
  events,
  today,
  isoWeek,
  onEventClick,
  onEventContextMenu,
  onDateClick,
  pulseDate,
  reduce,
  tagNameById,
  highlightedEventIdentities,
  reduceMotion,
  instantScroll,
  showWeekends,
}: {
  week: Date[];
  events: CalendarEvent[];
  today: string;
  isoWeek: number;
  onEventClick: (ev: CalendarEvent) => void;
  onEventContextMenu?: (ev: CalendarEvent, mouse: React.MouseEvent) => void;
  onDateClick?: (date: string) => void;
  pulseDate?: string | null;
  reduce: boolean;
  tagNameById: Record<string, string>;
  highlightedEventIdentities?: ReadonlySet<string>;
  reduceMotion: boolean;
  instantScroll?: boolean;
  showWeekends: boolean;
}) {
  const sortedEvents = useMemo(() => sortEventsForList(events), [events]);
  // 주말을 숨기면 토·일 칸을 아예 그리지 않는다. 주 배열 자체는 7일 그대로 둔다.
  const visibleDays = useMemo(() => visibleWeekDays(week, showWeekends), [showWeekends, week]);
  const dayStrings = useMemo(() => visibleDays.map(fmtDate), [visibleDays]);
  const dayColumns = `repeat(${visibleDays.length}, minmax(0, 1fr))`;
  // 태그 툴팁은 카드마다 훅을 두지 않고 한 번만 건다(카드 수만큼 문서 리스너가 붙었다 떨어지지 않게).
  const hover = useEventTagTooltip();
  const eventListRef = useRef<HTMLDivElement>(null);
  const eventListId = `week-event-list-${fmtDate(week[0])}`;
  const hiddenBarCount = Math.max(0, events.length - 5);
  const revealEventList = useCallback(() => {
    const list = eventListRef.current;
    if (!list) return;
    list.scrollIntoView({ behavior: reduce || instantScroll ? 'auto' : 'smooth', block: 'nearest' });
    list.focus({ preventScroll: true });
  }, [instantScroll, reduce]);

  return (
    <div
      className="rounded-xl p-5 mb-2 flex flex-col flex-1 min-h-0"
      style={{
        background: 'rgba(108,92,231,0.06)',
        border: '1px solid rgba(108,92,231,0.35)',
        boxShadow: '0 0 18px rgba(108,92,231,0.12)',
        // 높이 바닥(50vh·2주 30vh)은 바깥 줄이 정한다. 카드는 그 줄을 채우고 일정 목록이 안에서 스크롤된다.
      }}
    >
      {/* 주차 라벨 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold" style={{ color: ACCENT }}>
          {isoWeek}주차
        </span>
        <span className="text-[10px]" style={{ color: SECONDARY_TEXT }}>
          {week[0].getMonth() + 1}.{week[0].getDate()} ~ {week[6].getMonth() + 1}.{week[6].getDate()}
        </span>
      </div>

      {/* 날짜 그리드 + 이벤트 점 (주말 숨김이면 5칸) */}
      <div className="grid gap-1 mb-3" style={{ gridTemplateColumns: dayColumns }}>
        {visibleDays.map((day, i) => {
          const ds = fmtDate(day);
          const isToday = ds === today;
          const dow = day.getDay();
          const color =
            dow === 0 ? 'rgb(var(--color-calendar-sunday))' : dow === 6 ? 'rgb(var(--color-calendar-saturday))' : PRIMARY_TEXT;

          // 이 날짜에 해당하는 이벤트 수집
          const dayEvents = events.filter(
            (ev) => ev.startDate <= ds && ev.endDate >= ds,
          );

          return (
            <div
              key={ds}
              data-week-day={ds}
              className="relative flex flex-col items-center gap-0.5 cursor-pointer rounded-lg hover:bg-bg-border/20 transition-colors py-0.5"
              onClick={() => onDateClick?.(ds)}
            >
              {ds === pulseDate && (
                <motion.div
                  data-navigate-pulse="true"
                  className="absolute inset-0 rounded-lg border-2 border-accent pointer-events-none"
                  style={{ boxShadow: '0 0 12px 4px rgba(108, 92, 231, 0.4), 0 0 24px 8px rgba(108, 92, 231, 0.15)' }}
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
                  animate={reduceMotion
                    ? { opacity: 1, scale: 1 }
                    : { opacity: [0, 1, 0.6, 1, 0], scale: [0.9, 1.03, 1, 1.02, 1] }}
                  transition={reduceMotion ? { duration: 0 } : { duration: 2, ease: 'easeInOut' }}
                />
              )}
              <span
                className="text-[10px] font-medium"
                style={{ color }}
              >
                {WEEKDAYS[i]}
              </span>
              <span
                className="text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full"
                style={{
                  color: isToday ? '#fff' : color,
                  background: isToday ? '#6C5CE7' : 'transparent',
                }}
              >
                {day.getDate()}
              </span>
              {/* 이벤트 도트 (최대 3개) */}
              <div className="flex gap-px" style={{ minHeight: 6 }}>
                {dayEvents.slice(0, 3).map((ev) => (
                  <div
                    key={calendarEventIdentityKey(ev)}
                    className="rounded-full"
                    style={{
                      width: 5,
                      height: 5,
                      background: ev.color,
                    }}
                  />
                ))}
                {dayEvents.length > 3 && (
                  <span style={{ fontSize: 7, color: SECONDARY_TEXT, lineHeight: '5px' }}>
                    +{dayEvents.length - 3}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Multi-day event bars spanning the date grid */}
      {events.length > 0 && (
        <div className="flex flex-col gap-0.5 mb-2">
          {events.slice(0, 5).map((ev) => {
            const identityKey = calendarEventIdentityKey(ev);
            const isRealtimeHighlighted = highlightedEventIdentities?.has(identityKey) === true;
            // 보이는 날짜 목록 안에서의 위치. 주말을 숨기면 금·월 칸이 맞붙어 막대 하나가 된다.
            const startCol = dayStrings.findIndex((dateStr) => dateStr >= ev.startDate);
            let endCol = -1;
            for (let index = dayStrings.length - 1; index >= 0; index--) {
              if (dayStrings[index] <= ev.endDate) { endCol = index; break; }
            }
            // 숨긴 날에만 걸친 일정은 그릴 칸이 없다.
            if (startCol === -1 || endCol === -1 || endCol < startCol) return null;
            const spanCols = endCol - startCol + 1;

            return (
              <div
                key={calendarEventIdentityKey(ev)}
                className="grid gap-1"
                style={{ gridTemplateColumns: dayColumns }}
              >
                <div
                  data-event-identity={identityKey}
                  data-realtime-highlight={isRealtimeHighlighted ? 'true' : undefined}
                  className={`rounded-full truncate flex items-center px-1.5 ${isRealtimeHighlighted ? reduceMotion ? 'calendar-realtime-highlight-static' : 'calendar-realtime-highlight' : ''}`}
                  style={{
                    gridColumnStart: startCol + 1,
                    gridColumnEnd: startCol + 1 + spanCols,
                    background: hexToRgba(ev.color, 0.2),
                    height: 14,
                    fontSize: 8,
                    color: ev.color,
                    fontWeight: 600,
                  }}
                >
                  {ev.title}
                </div>
              </div>
            );
          })}
          {hiddenBarCount > 0 && (
            <button
              type="button"
              aria-label={`숨은 일정 ${hiddenBarCount}개 보기`}
              aria-controls={eventListId}
              onClick={(event) => {
                event.stopPropagation();
                revealEventList();
              }}
              className="self-start px-1 text-[9px] font-semibold text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              +{hiddenBarCount}개
            </button>
          )}
        </div>
      )}

      {/* Event cards */}
      {events.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center flex-1 gap-2 cursor-pointer rounded-lg hover:bg-bg-border/20 transition-colors"
          onClick={() => onDateClick?.(fmtDate(week[3]))}
        >
          <CalendarDays size={36} color={SECONDARY_TEXT} />
          <span className="text-sm" style={{ color: SECONDARY_TEXT }}>
            이번 주 일정이 없습니다
          </span>
        </div>
      ) : (
        <div
          ref={eventListRef}
          id={eventListId}
          data-scroll-events
          tabIndex={-1}
          className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto mt-2 focus:outline-none"
        >
          {sortedEvents.map((ev) => (
            <EventCard
              key={calendarEventIdentityKey(ev)}
              event={ev}
              today={today}
              tagNameById={tagNameById}
              isRealtimeHighlighted={highlightedEventIdentities?.has(calendarEventIdentityKey(ev)) === true}
              reduceMotion={reduceMotion}
              bindHover={hover.bind}
              onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
              onContextMenu={onEventContextMenu ? (e) => onEventContextMenu(ev, e) : undefined}
            />
          ))}
        </div>
      )}
      {hover.tooltip}
    </div>
  );
}

/* ── EventCard ────────────────────────────────────────── */
function EventCard({
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
  /** 상위(ActiveWeek)가 한 번만 건 태그 툴팁 훅의 바인딩. */
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
    // 호버 확대는 CSS 로 — 카드마다 framer 컴포넌트를 만들면 주를 넘길 때마다 그만큼 무겁게 마운트된다.
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
        padding: '8px 10px',
      }}
    >
      <div className="flex flex-col flex-1 min-w-0">
        <span
          className="font-bold truncate"
          style={{ fontSize: 11, color: PRIMARY_TEXT }}
        >
          {event.title}
        </span>
        <div className="mt-1"><EventTagBadges event={event} /></div>
        {subtitle && (
          <span style={{ fontSize: 9, color: SECONDARY_TEXT }}>
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

/* ── CompactWeek: 비활성 주 ───────────────────────────── */
function CompactWeek({
  week,
  events,
  today,
  isoWeek,
  showBars,
  showWeekends,
}: {
  week: Date[];
  events: CalendarEvent[];
  today: string;
  isoWeek: number;
  showBars: boolean;
  showWeekends: boolean;
}) {
  const visibleDays = visibleWeekDays(week, showWeekends);
  return (
    <div className="rounded-lg px-3 py-2 mb-1" style={{ background: COMPACT_BG, border: COMPACT_BORDER }}>
      {/* 주차 라벨 */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[9px] font-bold" style={{ color: SECONDARY_TEXT }}>
          {isoWeek}주차
        </span>
        <span className="text-[8px]" style={{ color: 'rgb(var(--color-text-secondary) / 0.5)' }}>
          {week[0].getMonth() + 1}.{week[0].getDate()}~{week[6].getMonth() + 1}.{week[6].getDate()}
        </span>
        {showBars && events.length > 0 && (
          <span className="text-[8px]" style={{ color: SECONDARY_TEXT }}>
            · {events.length}건
          </span>
        )}
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${visibleDays.length}, minmax(0, 1fr))` }}>
        {visibleDays.map((day) => {
          const ds = fmtDate(day);
          const isToday = ds === today;
          const dow = day.getDay();
          const color =
            dow === 0 ? 'rgb(var(--color-calendar-sunday))' : dow === 6 ? 'rgb(var(--color-calendar-saturday))' : PRIMARY_TEXT;

          return (
            <div
              key={ds}
              className="flex flex-col items-center"
            >
              <span
                className="text-[10px] font-medium w-5 h-5 flex items-center justify-center rounded-full"
                style={{
                  color: isToday ? '#fff' : color,
                  background: isToday ? '#6C5CE7' : 'transparent',
                }}
              >
                {day.getDate()}
              </span>
              {/* event bar summaries */}
              {showBars && (
                <div className="flex gap-px mt-0.5">
                  {events
                    .filter((ev) => ev.startDate <= ds && ev.endDate >= ds)
                    .slice(0, 2)
                    .map((ev) => (
                      <div
                        key={calendarEventIdentityKey(ev)}
                        className="rounded-full"
                        style={{
                          width: 4,
                          height: 2,
                          background: ev.color,
                        }}
                      />
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
