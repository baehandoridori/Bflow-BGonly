import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Palmtree, CheckSquare } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { CalendarEvent } from '@/types/calendar';
import { EVENT_COLORS } from '@/types/calendar';
import type { DragMode, DragPreview } from '@/hooks/useCalendarDnD';
import { WEEKDAYS, fmtDate, parseDate, addDays, daysBetween } from '@/utils/calendarDate';
import { floatingGlassStyle, tooltipGlassStyle } from '@/utils/glassStyles';

/** 이벤트의 연속 바 레이아웃 계산 */
interface EventBar {
  event: CalendarEvent;
  row: number;
  startCol: number; // 0-indexed in week
  span: number;     // how many columns it spans
  isStart: boolean; // bar starts in this week
  isEnd: boolean;   // bar ends in this week
}

function layoutEventBars(
  events: CalendarEvent[],
  weekStart: Date,
  cols: number,
): EventBar[] {
  const weekEnd = addDays(weekStart, cols - 1);
  const weekStartStr = fmtDate(weekStart);
  const weekEndStr = fmtDate(weekEnd);

  const relevant = events
    .filter((e) => e.endDate >= weekStartStr && e.startDate <= weekEndStr)
    .sort((a, b) => {
      const dSpan = daysBetween(b.startDate, b.endDate) - daysBetween(a.startDate, a.endDate);
      if (dSpan !== 0) return dSpan;
      return a.startDate.localeCompare(b.startDate);
    });

  const rows: string[][] = []; // rows[row][col] = eventId or ''
  const bars: EventBar[] = [];

  for (const ev of relevant) {
    const evStart = parseDate(ev.startDate);
    const evEnd = parseDate(ev.endDate);
    const clampStart = evStart < weekStart ? weekStart : evStart;
    const clampEnd = evEnd > weekEnd ? weekEnd : evEnd;

    const startCol = Math.round((clampStart.getTime() - weekStart.getTime()) / 86400000);
    const endCol = Math.round((clampEnd.getTime() - weekStart.getTime()) / 86400000);
    const span = endCol - startCol + 1;

    // find a row where all cols are free
    let placed = -1;
    for (let r = 0; r < rows.length; r++) {
      let free = true;
      for (let c = startCol; c <= endCol; c++) {
        if (rows[r][c]) { free = false; break; }
      }
      if (free) { placed = r; break; }
    }
    if (placed === -1) {
      placed = rows.length;
      rows.push(new Array(cols).fill(''));
    }
    for (let c = startCol; c <= endCol; c++) {
      rows[placed][c] = ev.id;
    }

    bars.push({
      event: ev,
      row: placed,
      startCol,
      span,
      isStart: evStart >= weekStart,
      isEnd: evEnd <= weekEnd,
    });
  }

  return bars;
}

/* ═══════════════════════════════════════════════════
   이벤트 바 컴포넌트 (리퀴드 글라스)
   ═══════════════════════════════════════════════════ */

function EventBarChip({
  bar, onClick, onDragStart, isDragging, isGhost,
  hoveredEventId, onHover, onContextMenu,
}: {
  bar: EventBar;
  onClick: (e: CalendarEvent) => void;
  onDragStart?: (eventId: string, mode: DragMode, anchorDate: string) => void;
  isDragging?: boolean;
  isGhost?: boolean;
  hoveredEventId?: string | null;
  onHover?: (id: string | null) => void;
  onContextMenu?: (ev: CalendarEvent, e: React.MouseEvent) => void;
}) {
  const ev = bar.event;
  const hex = ev.color || EVENT_COLORS[0];
  const isHovered = hoveredEventId === ev.id;
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    // 읽기 전용 이벤트: 드래그 불가, 클릭만 처리
    if (ev.isReadOnly || !onDragStart) {
      const onUp = () => {
        document.removeEventListener('mouseup', onUp);
        onClick(ev);
      };
      document.addEventListener('mouseup', onUp);
      return;
    }

    const startX = e.clientX;
    const startY = e.clientY;

    // 리사이즈 핸들 영역 (양쪽 8px)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relRight = rect.width - relX;
    let mode: DragMode;
    if (bar.isStart && relX <= 12) {
      mode = 'resize-start';
    } else if (bar.isEnd && relRight <= 12) {
      mode = 'resize-end';
    } else {
      mode = 'move';
    }

    // 앵커 날짜: 바를 숨기고 아래 셀에서 data-date 추출
    const barEl = e.currentTarget as HTMLElement;
    barEl.style.pointerEvents = 'none';
    const cellEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    barEl.style.pointerEvents = '';
    let anchorDate: string | null = null;
    let cur = cellEl;
    while (cur) {
      anchorDate = cur.getAttribute('data-date');
      if (anchorDate) break;
      cur = cur.parentElement;
    }
    if (!anchorDate) anchorDate = ev.startDate;

    // 클릭 vs 드래그 구분 (5px 임계값)
    const THRESHOLD = 5;
    let dragStarted = false;

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      if (!dragStarted && Math.sqrt(dx * dx + dy * dy) >= THRESHOLD) {
        dragStarted = true;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        onDragStart(ev.id, mode, anchorDate!);
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragStarted) {
        onClick(ev); // 이동 없음 → 클릭으로 처리
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleEnter = (e: React.MouseEvent) => {
    onHover?.(ev.id);
    setTooltipPos({ x: e.clientX, y: e.clientY });
    tooltipTimer.current = setTimeout(() => setShowTooltip(true), 400);
  };
  const handleMove = (e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX, y: e.clientY });
  };
  const handleLeave = () => {
    onHover?.(null);
    clearTimeout(tooltipTimer.current);
    setShowTooltip(false);
  };

  const dateLabel = ev.startDate === ev.endDate
    ? ev.startDate
    : `${ev.startDate} → ${ev.endDate}`;

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={handleEnter}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onContextMenu={onContextMenu ? (e) => onContextMenu(ev, e) : undefined}
      data-event-id={ev.id}
      className={cn(
        'absolute text-left z-10 calendar-event-bar',
        isGhost ? 'pointer-events-none opacity-50' : 'transition-all duration-150',
        !isGhost && isHovered && 'brightness-110 scale-[1.02] z-20',
        isDragging ? 'opacity-40' : '',
        'group/bar',
      )}
      style={{
        left: `calc(${(bar.startCol / 7) * 100}% + 2px)`,
        width: `calc(${(bar.span / 7) * 100}% - 4px)`,
        top: `${bar.row * 28 + 36}px`,
        height: '26px',
        cursor: ev.isReadOnly ? 'pointer' : isDragging ? 'grabbing' : 'grab',
        transition: isGhost ? 'left 0.12s ease-out, width 0.12s ease-out, top 0.12s ease-out' : undefined,
      }}
    >
      <div
        className={cn(
          'h-full flex items-center px-2 text-xs font-medium truncate relative',
          bar.isStart ? 'rounded-l-md' : '',
          bar.isEnd ? 'rounded-r-md' : '',
        )}
        style={{
          background: isGhost
            ? `${hex}30`
            : `linear-gradient(135deg, ${hex}40 0%, ${hex}25 100%)`,
          backdropFilter: isGhost ? undefined : 'blur(8px)',
          WebkitBackdropFilter: isGhost ? undefined : 'blur(8px)',
          borderTop: `1px solid ${hex}50`,
          borderBottom: `1px solid ${hex}20`,
          borderLeft: bar.isStart ? `3px solid ${hex}` : `1px solid ${hex}30`,
          borderRight: bar.isEnd ? `1px solid ${hex}40` : 'none',
          color: hex,
          textShadow: isGhost ? undefined : `0 0 12px ${hex}40`,
          border: isGhost ? `1px dashed ${hex}80` : undefined,
        }}
      >
        {/* 리사이즈 핸들 (왼쪽) */}
        {bar.isStart && !isGhost && !ev.isReadOnly && (
          <div className="absolute left-0 top-0 w-[12px] h-full cursor-col-resize opacity-0 group-hover/bar:opacity-100 transition-opacity"
            style={{ backgroundColor: `${hex}40` }}
          />
        )}
        {!bar.isStart && <span className="text-[9px] mr-0.5 opacity-60">◂</span>}
        {ev.type === 'vacation' && <Palmtree size={10} className="shrink-0 mr-1 opacity-80" />}
        {(ev.linkedTodoId || ev.id.startsWith('cal_')) && <CheckSquare size={9} className="shrink-0 mr-1 opacity-70" />}
        <span className="truncate">{ev.title}</span>
        {!bar.isEnd && <span className="text-[9px] ml-auto pl-0.5 opacity-60 shrink-0">▸</span>}
        {/* 리사이즈 핸들 (오른쪽) */}
        {bar.isEnd && !isGhost && !ev.isReadOnly && (
          <div className="absolute right-0 top-0 w-[12px] h-full cursor-col-resize opacity-0 group-hover/bar:opacity-100 transition-opacity"
            style={{ backgroundColor: `${hex}40` }}
          />
        )}
      </div>

      {/* 글래스모피즘 툴팁 — Portal로 body에 직접 렌더 (부모 transform/overflow 무관) */}
      {showTooltip && !isDragging && !isGhost && createPortal(
        <div
          className="pointer-events-none rounded-2xl px-4 py-3 max-w-[260px]"
          style={{
            ...tooltipGlassStyle,
            position: 'fixed',
            zIndex: 99999,
            left: Math.min(tooltipPos.x, window.innerWidth - 280),
            top: Math.max(tooltipPos.y - 12, 8),
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="text-[13px] font-semibold text-text-primary truncate">{ev.title}</div>
          <div className="text-[12px] text-text-secondary/70 mt-1">{dateLabel}</div>
          {ev.memo && <div className="text-[11px] text-text-secondary/50 mt-1 line-clamp-2">{ev.memo}</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   "+N more" 오버플로우 팝업
   ═══════════════════════════════════════════════════ */

function OverflowPopup({
  events, date, onClose, onEventClick, anchorRect,
}: {
  events: CalendarEvent[];
  date: string;
  onClose: () => void;
  onEventClick: (e: CalendarEvent) => void;
  anchorRect: DOMRect | null;
}) {
  const d = parseDate(date);
  const label = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.15 }}
      className="fixed z-50 rounded-xl p-3 w-64 max-h-72 overflow-y-auto"
      style={{
        ...floatingGlassStyle,
        left: anchorRect ? Math.min(anchorRect.left, window.innerWidth - 280) : 100,
        top: anchorRect ? Math.min(anchorRect.bottom + 4, window.innerHeight - 300) : 100,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-text-primary">{label}</span>
        <button onClick={onClose} className="p-0.5 text-text-secondary hover:text-text-primary cursor-pointer">
          <X size={12} />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {events.map((ev) => {
          const isSingle = ev.startDate === ev.endDate;
          const evS = parseDate(ev.startDate);
          const evE = parseDate(ev.endDate);
          const dateRange = isSingle
            ? `${evS.getMonth() + 1}/${evS.getDate()}`
            : `${evS.getMonth() + 1}/${evS.getDate()} → ${evE.getMonth() + 1}/${evE.getDate()}`;
          return (
            <button
              key={ev.id}
              onClick={() => { onEventClick(ev); onClose(); }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-primary/50 transition-colors text-left cursor-pointer"
            >
              <div className="w-2 h-2 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: ev.color }} />
              <div className="flex-1 min-w-0">
                <span className="text-xs text-text-primary truncate block">{ev.title}</span>
                <span className="text-[11px] text-text-secondary/50 block">{dateRange}</span>
                {ev.memo && <span className="text-[11px] text-text-secondary/40 truncate block">{ev.memo.length > 40 ? ev.memo.slice(0, 40) + '…' : ev.memo}</span>}
              </div>
              <span className="text-[11px] text-text-secondary/50 ml-auto shrink-0">
                {ev.type === 'vacation' ? '휴가' : ev.type !== 'custom' ? ev.type.toUpperCase() : ''}
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════
   메인 캘린더 그리드 (월/2주/1주 공용)
   ═══════════════════════════════════════════════════ */

export function CalendarGrid({
  weeks,
  events,
  today,
  currentMonth,
  maxVisibleBars,
  onEventClick,
  onDragStart,
  dragPreview,
  isDragging,
  onCellMouseDown,
  isDateInDragRange,
  onEventContextMenu,
  onWheel,
  monthKey,
  monthDirection = 0,
  focusedDate,
  pulseDate,
}: {
  weeks: Date[][];
  events: CalendarEvent[];
  today: string;
  currentMonth: number;
  maxVisibleBars: number;
  onEventClick: (ev: CalendarEvent) => void;
  onDragStart?: (eventId: string, mode: DragMode, anchorDate: string) => void;
  dragPreview?: DragPreview | null;
  isDragging?: boolean;
  onCellMouseDown?: (e: React.MouseEvent, date: string) => void;
  isDateInDragRange?: (date: string) => boolean;
  onWheel?: (e: React.WheelEvent) => void;
  onEventContextMenu?: (ev: CalendarEvent, e: React.MouseEvent) => void;
  monthKey?: string;
  monthDirection?: number;
  focusedDate?: string | null;
  pulseDate?: string | null;
}) {
  const [overflow, setOverflow] = useState<{ date: string; rect: DOMRect } | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);

  // 드래그 중이면 프리뷰 날짜로 이벤트를 대체해서 고스트 바 표시
  const displayEvents = useMemo(() => {
    if (!dragPreview) return events;
    return events.map((e) =>
      e.id === dragPreview.eventId
        ? { ...e, startDate: dragPreview.newStartDate, endDate: dragPreview.newEndDate }
        : e,
    );
  }, [events, dragPreview]);

  return (
    <div className="flex flex-col flex-1 h-full min-h-0" onWheel={onWheel}>
      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 mb-0.5 border-b border-bg-border/25">
        {WEEKDAYS.map((day, i) => (
          <div
            key={day}
            className={cn(
              'text-center text-xs font-semibold py-2.5 tracking-wider',
              i === 0 ? 'text-red-400/60' : i === 6 ? 'text-blue-400/60' : 'text-text-secondary/50',
            )}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 주별 행 — flex-1로 화면 꽉 채움, 동적 행 수에 따라 균등 분배 */}
      <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={monthKey || 'default'}
        initial={{ opacity: 0, y: monthDirection > 0 ? 30 : -30 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: monthDirection > 0 ? -30 : 30 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col flex-1 min-h-0 rounded-xl overflow-hidden border border-bg-border/30"
      >
        {weeks.map((week, wi) => {
          const bars = layoutEventBars(displayEvents, week[0], 7);
          const maxRow = bars.length > 0 ? Math.max(...bars.map((b) => b.row)) + 1 : 0;
          // 현재 주 하이라이트
          const isCurrentWeek = week.some((d) => fmtDate(d) === today);
          return (
            <div
              key={wi}
              className={cn("relative grid grid-cols-7 flex-1 min-h-0", isCurrentWeek && 'bg-accent/[0.03]')}
            >
              {/* 날짜 셀 배경 */}
              {week.map((day, di) => {
                const dateStr = fmtDate(day);
                const isToday = dateStr === today;
                const isCurMonth = day.getMonth() === currentMonth;
                const dow = day.getDay();

                // 이 날짜에 해당하는 이벤트 수
                const dayEvents = displayEvents.filter((e) => e.startDate <= dateStr && e.endDate >= dateStr);
                const overflowCount = dayEvents.length - maxVisibleBars;

                // 드래그 중 hover 하이라이트
                const isDropTarget = isDragging && dragPreview && (
                  dragPreview.newStartDate <= dateStr && dragPreview.newEndDate >= dateStr
                );

                const isInDragRange = isDateInDragRange?.(dateStr) ?? false;
                const isFocused = focusedDate === dateStr;

                return (
                  <div
                    key={di}
                    data-date={dateStr}
                    className={cn(
                      'bg-bg-primary/50 transition-colors duration-100 cursor-pointer relative overflow-hidden border-b border-r border-bg-border/20',
                      isCurMonth ? 'hover:bg-bg-border/15' : 'opacity-30',
                      isToday && 'bg-accent/5',
                      isDropTarget && 'bg-accent/10',
                      isInDragRange && 'bg-accent/15 border-accent/30',
                      isFocused && 'ring-2 ring-inset ring-accent/60 bg-accent/8 z-10',
                    )}
                    onMouseDown={onCellMouseDown ? (e) => onCellMouseDown(e, dateStr) : undefined}
                  >
                    {/* 드래그 중 가상 이벤트 바 — 셀 내부 하단에 고정해서 칸을 넘지 않게 */}
                    {isInDragRange && (
                      <div
                        className="absolute left-0.5 right-0.5 rounded-sm pointer-events-none"
                        style={{
                          bottom: '4px',
                          height: '22px',
                          background: 'linear-gradient(135deg, rgba(108,92,231,0.3) 0%, rgba(108,92,231,0.15) 100%)',
                          border: '1px dashed rgba(108,92,231,0.6)',
                          borderLeft: di === 0 || !isDateInDragRange?.(fmtDate(addDays(day, -1))) ? '3px solid #6C5CE7' : '1px dashed rgba(108,92,231,0.6)',
                        }}
                      />
                    )}
                    {/* 날짜 번호 */}
                    <div className="p-2">
                      <span
                        className={cn(
                          'text-sm tabular-nums inline-flex items-center justify-center font-medium',
                          isToday
                            ? 'bg-accent text-white w-7 h-7 rounded-full text-xs font-bold'
                            : dow === 0 ? 'text-red-400'
                            : dow === 6 ? 'text-blue-400'
                            : isCurMonth ? 'text-text-primary/80' : 'text-text-secondary/40',
                        )}
                      >
                        {day.getDate()}
                      </span>
                    </div>
                    {/* 펄스 애니메이션 (navigate-to-date) */}
                    {dateStr === pulseDate && (
                      <motion.div
                        className="absolute inset-0 rounded-lg border-2 border-accent pointer-events-none"
                        style={{ boxShadow: '0 0 12px 4px rgba(108, 92, 231, 0.4), 0 0 24px 8px rgba(108, 92, 231, 0.15)' }}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: [0, 1, 0.6, 1, 0], scale: [0.9, 1.03, 1, 1.02, 1] }}
                        transition={{ duration: 2, ease: 'easeInOut' }}
                      />
                    )}

                    {/* 오버플로우 뱃지 */}
                    {overflowCount > 0 && (
                      <button
                        className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded-full hover:bg-accent/20 cursor-pointer z-30"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = (e.target as HTMLElement).getBoundingClientRect();
                          setOverflow({ date: dateStr, rect });
                        }}
                      >
                        +{overflowCount} 더보기
                      </button>
                    )}
                  </div>
                );
              })}

              {/* 이벤트 바 (오버레이) */}
              {bars.filter((b) => b.row < maxVisibleBars).map((bar) => {
                const barIsDragging = isDragging && dragPreview?.eventId === bar.event.id;
                return (
                  <EventBarChip
                    key={`${bar.event.id}-w${wi}-c${bar.startCol}`}
                    bar={bar}
                    onClick={onEventClick}
                    onDragStart={onDragStart}
                    isDragging={barIsDragging}
                    isGhost={barIsDragging}
                    hoveredEventId={hoveredEventId}
                    onHover={setHoveredEventId}
                    onContextMenu={onEventContextMenu}
                  />
                );
              })}
            </div>
          );
        })}
      </motion.div>
      </AnimatePresence>

      {/* 오버플로우 팝업 */}
      <AnimatePresence>
        {overflow && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOverflow(null)} />
            <OverflowPopup
              events={events.filter(
                (e) => e.startDate <= overflow.date && e.endDate >= overflow.date,
              )}
              date={overflow.date}
              onClose={() => setOverflow(null)}
              onEventClick={onEventClick}
              anchorRect={overflow.rect}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
