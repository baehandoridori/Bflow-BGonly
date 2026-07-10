import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, X, Filter,
  Trash2, ExternalLink, GripVertical, Clock, MapPin, FileText, Pencil,
  Palmtree, Settings, CheckSquare,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  getEvents, addEvent, updateEvent, deleteEvent, filterEventsByRange,
} from '@/services/calendarService';
import { fetchAllVacationEvents } from '@/services/vacationService';
import { useCalendarDnD } from '@/hooks/useCalendarDnD';
import type { DragMode, DragPreview } from '@/hooks/useCalendarDnD';
import type {
  CalendarEvent, CalendarViewMode, CalendarFilter, CalendarEventType,
} from '@/types/calendar';
import { EVENT_COLORS } from '@/types/calendar';
import { DEPARTMENT_CONFIGS } from '@/types';
import { VACATION_COLOR } from '@/types/vacation';
import { MiniCalendar } from '@/components/calendar/MiniCalendar';
// EventCreateTooltip removed — drag/click now opens full EventCreateModal
import { EventSidePanel } from '@/components/calendar/EventSidePanel';
import { EventQuickEdit } from '@/components/calendar/EventQuickEdit';
import WeekScrollView, { generateYearWeeks, findWeekIndexForDate } from '@/components/calendar/WeekScrollView';
import WeekSidebar from '@/components/calendar/WeekSidebar';
import DayScrollView from '@/components/calendar/DayScrollView';
import DaySidebar from '@/components/calendar/DaySidebar';
import { useCalendarDragCreate } from '@/hooks/useCalendarDragCreate';
import { floatingGlassStyle, tooltipGlassStyle } from '@/utils/glassStyles';
import { navigateToSceneView } from '@/utils/sceneNavigationAction';
import { createUuid } from '@/utils/createUuid';

/* ═══════════════════════════════════════════════════
   유틸리티
   ═══════════════════════════════════════════════════ */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

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
  bar, compact, onClick, onDragStart, isDragging, isGhost,
  hoveredEventId, onHover, onContextMenu,
}: {
  bar: EventBar;
  compact?: boolean;
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
        top: `${bar.row * (compact ? 23 : 28) + (compact ? 28 : 36)}px`,
        height: compact ? '22px' : '26px',
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
   이벤트 상세 모달
   ═══════════════════════════════════════════════════ */

function EventDetailModal({
  event, onClose, onDelete, onNavigate, onEdit,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onDelete: (id: string) => void;
  onNavigate: (ev: CalendarEvent) => void;
  onEdit: (ev: CalendarEvent) => void;
}) {
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const start = parseDate(event.startDate);
  const end = parseDate(event.endDate);
  const isSingle = event.startDate === event.endDate;
  const dateLabel = isSingle
    ? `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}일`
    : `${start.getMonth() + 1}/${start.getDate()} → ${end.getMonth() + 1}/${end.getDate()}`;

  const typeLabels: Record<CalendarEventType, string> = {
    custom: '일반 이벤트',
    episode: '에피소드',
    part: '파트',
    scene: '씬',
    vacation: '휴가',
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.93, y: 12 }}
        transition={{ duration: 0.2 }}
        className="bg-bg-card rounded-2xl shadow-2xl border border-bg-border w-96 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 컬러 헤더 */}
        <div
          className="h-2 w-full"
          style={{ background: `linear-gradient(90deg, ${event.color}, ${event.color}80)` }}
        />
        <div className="p-5 flex flex-col gap-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-text-primary truncate">{event.title}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="text-[11px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: `${event.color}20`, color: event.color }}
                >
                  {typeLabels[event.type]}
                </span>
                {event.linkedEpisode != null && (
                  <span className="text-[11px] text-text-secondary">
                    {episodeTitles[event.linkedEpisode] || `EP.${String(event.linkedEpisode).padStart(2, '0')}`}
                    {event.linkedPart && ` ${event.linkedPart}파트`}
                    {event.linkedSceneId && ` #${event.linkedSceneId}`}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-1 text-text-secondary hover:text-text-primary cursor-pointer">
              <X size={16} />
            </button>
          </div>

          {/* 정보 */}
          <div className="flex flex-col gap-2.5 text-xs">
            <div className="flex items-center gap-2 text-text-secondary">
              <Clock size={13} />
              <span>{dateLabel}</span>
            </div>
            {event.memo && (
              <div className="flex items-start gap-2 text-text-secondary">
                <FileText size={13} className="shrink-0 mt-0.5" />
                <span className="leading-relaxed">{event.memo}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-text-secondary/60">
              <MapPin size={13} />
              <span>작성: {event.createdBy}</span>
            </div>
          </div>

          {/* 액션 */}
          {event.isReadOnly ? (
            /* 휴가 이벤트 — 프로필에서 관리 안내 */
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-[11px] text-text-secondary/50 text-center">
                휴가 이벤트는 프로필 설정에서 관리됩니다
              </p>
              <button
                onClick={() => { onNavigate(event); onClose(); }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors cursor-pointer"
              >
                <Settings size={13} />
                프로필 설정으로 이동
              </button>
            </div>
          ) : (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { onEdit(event); onClose(); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium bg-bg-border/20 text-text-primary hover:bg-bg-border/30 transition-colors cursor-pointer"
              >
                <Pencil size={13} />
                편집
              </button>
              {event.type !== 'custom' && (
                <button
                  onClick={() => onNavigate(event)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors cursor-pointer"
                >
                  <ExternalLink size={13} />
                  이동
                </button>
              )}
              <button
                onClick={() => { onDelete(event.id); onClose(); }}
                className="flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
              >
                <Trash2 size={13} />
                삭제
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════
   이벤트 생성/편집 모달
   ═══════════════════════════════════════════════════ */

function EventCreateModal({
  initialDate,
  initialEndDate,
  editEvent,
  episodes,
  onClose,
  onSave,
}: {
  initialDate?: string;
  initialEndDate?: string;
  editEvent?: CalendarEvent;
  episodes: { episodeNumber: number; title: string; parts: { partId: string; sheetName: string; department: string; scenes: { sceneId: string; no: number }[] }[] }[];
  onClose: () => void;
  onSave: (ev: Omit<CalendarEvent, 'id' | 'createdAt'>) => void;
}) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const colorMode = useAppStore((s) => s.colorMode);
  const today = fmtDate(new Date());
  const isEditMode = !!editEvent;

  const [title, setTitle] = useState(editEvent?.title ?? '');
  const [memo, setMemo] = useState(editEvent?.memo ?? '');
  const [startDate, setStartDate] = useState(editEvent?.startDate ?? initialDate ?? today);
  const [endDate, setEndDate] = useState(editEvent?.endDate ?? initialEndDate ?? initialDate ?? today);
  const [color, setColor] = useState<string>(editEvent?.color ?? EVENT_COLORS[0]);
  const [evType, setEvType] = useState<CalendarEventType>(editEvent?.type ?? 'custom');
  const [isPrivate, setIsPrivate] = useState<boolean>(!!editEvent?.isPrivate);

  // 연결 항목
  const [linkedEp, setLinkedEp] = useState<number | ''>(editEvent?.linkedEpisode ?? '');
  const [linkedPart, setLinkedPart] = useState(editEvent?.linkedSheetName ?? '');
  const [linkedScene, setLinkedScene] = useState(editEvent?.linkedSceneId ?? '');

  const selectedEpParts = useMemo(() => {
    if (linkedEp === '') return [];
    return episodes.find((e) => e.episodeNumber === linkedEp)?.parts ?? [];
  }, [linkedEp, episodes]);

  const selectedPartScenes = useMemo(() => {
    if (!linkedPart) return [];
    return selectedEpParts.find((p) => p.sheetName === linkedPart)?.scenes ?? [];
  }, [linkedPart, selectedEpParts]);

  // 에피소드/파트/씬 선택 시 제목 자동 입력
  useEffect(() => {
    if (isEditMode) return; // 편집 모드에서는 자동입력 안 함
    if (evType === 'custom') return;
    const ep = episodes.find((e) => e.episodeNumber === linkedEp);
    if (!ep) {
      // 에피소드 미선택 시 안내 제목
      if (evType === 'episode') setTitle('에피소드 선택...');
      else if (evType === 'part') setTitle('파트 선택...');
      else if (evType === 'scene') setTitle('씬 선택...');
      return;
    }
    const epLabel = episodeTitles[ep.episodeNumber] || ep.title;
    if (evType === 'episode') {
      setTitle(epLabel);
    } else if (evType === 'part' || evType === 'scene') {
      const part = selectedEpParts.find((p) => p.sheetName === linkedPart);
      if (!part) {
        // 파트 미선택 — 에피소드까지만 표시
        setTitle(`${epLabel} — 파트 선택...`);
      } else {
        const deptLabel = DEPARTMENT_CONFIGS[part.department as 'bg' | 'acting']?.shortLabel ?? '';
        if (evType === 'part') {
          setTitle(`${epLabel} ${part.partId}파트 (${deptLabel})`);
        } else if (evType === 'scene') {
          // 씬 선택 시 제목, 씬 미선택이면 파트까지만 표시
          setTitle(linkedScene
            ? `${epLabel} ${part.partId}파트 #${linkedScene}`
            : `${epLabel} ${part.partId}파트 (${deptLabel}) — 씬 선택...`);
        }
      }
    }
  }, [evType, linkedEp, linkedPart, linkedScene, episodes, selectedEpParts, isEditMode]);

  const handleSubmit = () => {
    if (!title.trim()) return;
    const partData = selectedEpParts.find((p) => p.sheetName === linkedPart);
    onSave({
      title: title.trim(),
      memo: memo.trim(),
      color,
      type: evType,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      createdBy: currentUser?.name ?? '알 수 없음',
      linkedEpisode: linkedEp !== '' ? linkedEp : undefined,
      linkedPart: partData?.partId,
      linkedSheetName: linkedPart || undefined,
      linkedSceneId: linkedScene || undefined,
      linkedDepartment: partData?.department as 'bg' | 'acting' | undefined,
      isPrivate,
    });
  };

  return (
    <>
      {/* 배경 클릭으로 닫기 (반투명 오버레이 없음) */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.01 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="absolute right-0 top-0 bottom-0 z-50 w-[24rem] max-h-full overflow-y-auto"
        style={{
          ...floatingGlassStyle,
          background: 'rgb(var(--color-bg-card) / 0.96)',
          borderLeft: '1px solid rgb(var(--color-bg-border) / 0.42)',
          boxShadow: '-14px 0 36px rgb(var(--color-shadow) / calc(var(--shadow-alpha) * 1.22))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border">
          <h3 className="text-sm font-bold text-text-primary">{isEditMode ? '이벤트 편집' : '새 이벤트'}</h3>
          <button onClick={onClose} className="p-1 text-text-secondary hover:text-text-primary cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* 제목 */}
          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">제목</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="이벤트 이름"
              className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 outline-none focus:border-accent"
              autoFocus
            />
          </div>

          {/* 날짜 */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">시작일</label>
              <div className="relative mt-1">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-bg-card border border-accent/40 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 date-picker-hidden"
                  style={{ colorScheme: colorMode }}
                />
                <CalendarDays size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
              </div>
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">마감일</label>
              <div className="relative mt-1">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-bg-card border border-accent/40 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 date-picker-hidden"
                  style={{ colorScheme: colorMode }}
                />
                <CalendarDays size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
              </div>
            </div>
          </div>

          {/* 이벤트 유형 */}
          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">유형</label>
            <div className="flex gap-1.5 mt-1">
              {([['custom', '일반'], ['episode', '에피소드'], ['part', '파트'], ['scene', '씬']] as const).map(([t, l]) => (
                <button
                  key={t}
                  onClick={() => {
                    setEvType(t);
                    // 더 구체적인 타입으로 갈 때 기존 선택 유지, 덜 구체적으로 갈 때만 초기화
                    if (t === 'custom') { setLinkedEp(''); setLinkedPart(''); setLinkedScene(''); }
                    else if (t === 'episode') { setLinkedPart(''); setLinkedScene(''); }
                    else if (t === 'part') { setLinkedScene(''); }
                    // 'scene' → 모든 기존 선택 유지
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer',
                    evType === t
                      ? 'bg-accent/20 text-accent'
                      : 'bg-bg-primary text-text-secondary hover:text-text-primary',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* 연결 항목 (에피소드/파트/씬 선택) */}
          {evType !== 'custom' && (
            <div className="flex flex-col gap-2 bg-bg-primary/50 rounded-xl p-3 border border-bg-border/50">
              <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">연결 대상</label>
              <select
                value={linkedEp}
                onChange={(e) => { setLinkedEp(e.target.value ? Number(e.target.value) : ''); setLinkedPart(''); setLinkedScene(''); }}
                className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
              >
                <option value="">에피소드 선택</option>
                {episodes.map((ep) => (
                  <option key={ep.episodeNumber} value={ep.episodeNumber}>{episodeTitles[ep.episodeNumber] || ep.title}</option>
                ))}
              </select>
              {(evType === 'part' || evType === 'scene') && linkedEp !== '' && (
                <select
                  value={linkedPart}
                  onChange={(e) => { setLinkedPart(e.target.value); setLinkedScene(''); }}
                  className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                >
                  <option value="">파트 선택</option>
                  {selectedEpParts.map((p) => (
                    <option key={p.sheetName} value={p.sheetName}>
                      {p.partId}파트 ({DEPARTMENT_CONFIGS[p.department as 'bg' | 'acting']?.shortLabel ?? p.department})
                    </option>
                  ))}
                </select>
              )}
              {evType === 'scene' && linkedPart && (
                <select
                  value={linkedScene}
                  onChange={(e) => setLinkedScene(e.target.value)}
                  className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                >
                  <option value="">씬 선택</option>
                  {selectedPartScenes.map((s) => (
                    <option key={s.sceneId || s.no} value={s.sceneId || String(s.no)}>
                      #{s.no} {s.sceneId}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* 색상 */}
          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">색상</label>
            <div className="flex gap-1.5 mt-1.5">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'w-6 h-6 rounded-full transition-all cursor-pointer',
                    color === c ? 'scale-110' : 'hover:scale-110',
                  )}
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px rgb(var(--color-bg-card)), 0 0 0 4px ${c}` : undefined }}
                />
              ))}
            </div>
          </div>

          {/* 메모 */}
          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">메모</label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모 (선택사항)"
              rows={2}
              className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary/40 resize-none outline-none focus:border-accent"
            />
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-bg-border/65 bg-bg-primary/60 px-3.5 py-3 cursor-pointer transition-colors hover:border-accent/30">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded accent-accent cursor-pointer"
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-text-primary">나만 보기</div>
              <p className="mt-1 text-[11px] leading-relaxed text-text-secondary/80">
                Google Calendar에는 올리지 않고 B flow에만 저장합니다. 같은 계정으로 로그인한 본인 기기에서만 계속 보입니다.
              </p>
            </div>
          </label>

          {/* 저장 */}
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="w-full py-2.5 rounded-xl text-sm font-medium bg-accent hover:bg-accent/80 text-white disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {isEditMode ? '이벤트 저장' : '이벤트 추가'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ═══════════════════════════════════════════════════
   메인 캘린더 그리드 (월/2주/1주 공용)
   ═══════════════════════════════════════════════════ */

function CalendarGrid({
  weeks,
  events,
  today,
  currentMonth,
  maxVisibleBars,
  onDateClick,
  onEventClick,
  onDragStart,
  dragPreview,
  isDragging,
  onCellMouseDown,
  isDateInDragRange,
  onEventContextMenu,
  focusWeekIndex,
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
  onDateClick: (date: string) => void;
  onEventClick: (ev: CalendarEvent) => void;
  onDragStart?: (eventId: string, mode: DragMode, anchorDate: string) => void;
  dragPreview?: DragPreview | null;
  isDragging?: boolean;
  onCellMouseDown?: (e: React.MouseEvent, date: string) => void;
  isDateInDragRange?: (date: string) => boolean;
  focusWeekIndex?: number;
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
                    onClick={() => { if (!isDragging) onDateClick(dateStr); }}
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

/* ═══════════════════════════════════════════════════
   오늘 뷰 (타임라인 스타일)
   ═══════════════════════════════════════════════════ */

function TodayView({
  events, today, onEventClick,
}: {
  events: CalendarEvent[];
  today: string;
  onEventClick: (ev: CalendarEvent) => void;
}) {
  const todayEvents = events
    .filter((e) => e.startDate <= today && e.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const d = parseDate(today);
  const label = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center py-4">
        <div className="text-2xl font-bold text-text-primary">{d.getDate()}</div>
        <div className="text-sm text-text-secondary mt-1">{label}</div>
      </div>

      {todayEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-secondary/50">
          <CalendarDays size={40} className="mb-3 opacity-30" />
          <p className="text-sm">오늘 일정이 없습니다</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {todayEvents.map((ev) => {
            const isSingle = ev.startDate === ev.endDate;
            const s = parseDate(ev.startDate);
            const e = parseDate(ev.endDate);
            const dateRange = isSingle
              ? '오늘'
              : `${s.getMonth() + 1}/${s.getDate()} → ${e.getMonth() + 1}/${e.getDate()}`;

            return (
              <button
                key={ev.id}
                onClick={() => onEventClick(ev)}
                className="flex items-center gap-3 p-3 rounded-xl transition-all hover:scale-[1.01] cursor-pointer"
                style={{
                  background: `linear-gradient(135deg, ${ev.color}12 0%, ${ev.color}08 100%)`,
                  border: `1px solid ${ev.color}25`,
                  backdropFilter: 'blur(8px)',
                }}
              >
                <div className="w-1 h-10 rounded-full shrink-0" style={{ backgroundColor: ev.color }} />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-text-primary truncate">{ev.title}</p>
                  <p className="text-[11px] text-text-secondary/60 mt-0.5">{dateRange} · {ev.createdBy}</p>
                </div>
                <span
                  className="text-[11px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                  style={{ backgroundColor: `${ev.color}20`, color: ev.color }}
                >
                  {ev.type === 'custom' ? '일반' : ev.type === 'vacation' ? '휴가' : ev.type.toUpperCase()}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   캘린더 → 할일 역동기화 헬퍼
   ═══════════════════════════════════════════════════ */

async function syncCalendarToTodo(todoId: string, calEvent: CalendarEvent) {
  const supabaseService = await import('@/services/supabaseService');
  try {
    await supabaseService.applyCalendarToTodoPatch(todoId, {
      title: calEvent.title,
      memo: calEvent.memo,
      startDate: calEvent.startDate || null,
      endDate: calEvent.endDate || null,
      addToCalendar: true,
    });
    window.dispatchEvent(new Event('bflow:todos-changed'));
  } catch (err) {
    console.warn('[ScheduleView] 할일 역동기화 실패:', err);
  }
}

async function unlinkTodoFromCalendar(todoId: string) {
  const supabaseService = await import('@/services/supabaseService');
  try {
    await supabaseService.applyCalendarToTodoPatch(todoId, { addToCalendar: false });
    window.dispatchEvent(new Event('bflow:todos-changed'));
  } catch (err) {
    console.warn('[ScheduleView] 할일 링크 해제 실패:', err);
  }
}

/* ═══════════════════════════════════════════════════
   메인 ScheduleView
   ═══════════════════════════════════════════════════ */

export function ScheduleView() {
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const {
    setView,
  } = useAppStore();

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [vacationEvents, setVacationEvents] = useState<CalendarEvent[]>([]);
  const [showVacation, setShowVacation] = useState(true);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [filter, setFilter] = useState<CalendarFilter>('all');
  const [deptFilter, setDeptFilter] = useState<'all' | 'bg' | 'acting'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [createDate, setCreateDate] = useState<string | undefined>();
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);

  // ─── 새 컴포넌트 상태 ───
  // Side panel state (replaces detailEvent modal)
  const [panelEvent, setPanelEvent] = useState<CalendarEvent | null>(null);

  // 월간 뷰 휠 — 디바운스 타이머
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Quick edit state (right-click)
  const [quickEdit, setQuickEdit] = useState<{
    event: CalendarEvent; position: { x: number; y: number };
  } | null>(null);

  // Week scroll view state — 연도 기준 절대 인덱스
  const [activeWeekIndex, setActiveWeekIndex] = useState(() => {
    const now = new Date();
    const yearWeeks = generateYearWeeks(now.getFullYear());
    return findWeekIndexForDate(yearWeeks, fmtDate(now));
  });

  // Day scroll view state — 연도 내 일 인덱스 (0-based)
  const [activeDayIndex, setActiveDayIndex] = useState(() => {
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1, 12, 0, 0, 0);
    return Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).getTime() - jan1.getTime()) / 86400000);
  });

  // 날짜 상태
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [monthDir, setMonthDir] = useState(0); // 월 슬라이드 방향
  const [weekOffset, setWeekOffset] = useState(0); // 주/2주 뷰 오프셋

  const today = fmtDate(new Date());
  const vacationConnected = useAppStore((s) => s.vacationConnected);

  // 이벤트 로드 + 외부 변경 구독 (할일 위젯 등에서 수정 시 즉시 반영)
  useEffect(() => {
    let cancelled = false;
    // cold cache 방어: 캐시가 비어있으면 syncAll 시도
    (async () => {
      const cached = await getEvents();
      if (cached.length === 0) {
        try {
          const { isAuthenticated } = await import('@/services/googleCalendarService');
          if (await isAuthenticated()) {
            const { syncAll } = await import('@/services/calendarService');
            await syncAll();
          }
        } catch { /* GCal 미연결 시 무시 */ }
      }
      if (!cancelled) getEvents().then(setEvents);
    })();
    const refresh = () => getEvents().then(setEvents);
    window.addEventListener('bflow:calendar-changed', refresh);
    return () => { cancelled = true; window.removeEventListener('bflow:calendar-changed', refresh); };
  }, []);

  // 휴가 이벤트 로드
  const loadVacationEvents = useCallback(async () => {
    if (!vacationConnected) { setVacationEvents([]); return; }
    try {
      const raw = await fetchAllVacationEvents();
      const mapped: CalendarEvent[] = raw.map((v, i) => ({
        id: `vac-${v.name}-${v.startDate}-${i}`,
        title: `${v.name} ${v.type}`,
        memo: '',
        color: VACATION_COLOR,
        type: 'vacation' as const,
        startDate: v.startDate,
        endDate: v.endDate,
        createdBy: v.name,
        createdAt: new Date().toISOString(),
        vacationType: v.type,
        vacationUserName: v.name,
        isReadOnly: true,
      }));
      setVacationEvents(mapped);
    } catch {
      // 비차단 — 실패해도 캘린더는 정상 동작
      setVacationEvents([]);
    }
  }, [vacationConnected]);

  useEffect(() => { loadVacationEvents(); }, [loadVacationEvents]);

  // 통합 이벤트 (로컬 + 휴가)
  const allEvents = useMemo(() => {
    if (!showVacation) return events;
    return [...events, ...vacationEvents];
  }, [events, vacationEvents, showVacation]);

  // 필터링
  const filteredEvents = useMemo(() => {
    let result = allEvents;
    if (filter !== 'all') result = result.filter((e) => e.type === filter);
    if (deptFilter !== 'all') result = result.filter((e) => e.linkedDepartment === deptFilter || e.type === 'custom' || e.type === 'vacation');
    return result;
  }, [allEvents, filter, deptFilter]);

  // 주 데이터 계산 (모든 날짜를 정오로 생성 — parseDate와 일관성 유지)
  const weeks = useMemo(() => {
    if (viewMode === 'today') return [];

    if (viewMode === 'month') {
      const firstDay = new Date(year, month, 1, 12, 0, 0, 0);
      const lastDay = new Date(year, month + 1, 0);
      const startDow = firstDay.getDay();

      const days: Date[] = [];
      // 이전 달
      for (let i = startDow - 1; i >= 0; i--) {
        days.push(addDays(firstDay, -(i + 1)));
      }
      // 이번 달
      for (let d = 1; d <= lastDay.getDate(); d++) {
        days.push(new Date(year, month, d, 12, 0, 0, 0));
      }
      // 다음 달 (현재 주 완성까지만 — 동적 행)
      while (days.length % 7 !== 0) {
        days.push(addDays(days[days.length - 1], 1));
      }

      const result: Date[][] = [];
      for (let i = 0; i < days.length; i += 7) {
        result.push(days.slice(i, i + 7));
      }
      return result;
    }

    if (viewMode === 'week') {
      // 주간 뷰: 전체 연도 주 배열 (사이드바용)
      return generateYearWeeks(year);
    }

    if (viewMode === '2week') {
      // 2주 뷰도 전체 연도 주 배열 사용 (사이드바 + activeWeekIndex 통일)
      return generateYearWeeks(year);
    }

    return [];
  }, [viewMode, year, month, weekOffset]);

  // 네비게이션
  const goToPrev = () => {
    if (viewMode === 'month') {
      setMonthDir(-1);
      if (month === 0) { setYear(year - 1); setMonth(11); }
      else setMonth(month - 1);
    } else if (viewMode === 'week' || viewMode === '2week') {
      const step = viewMode === '2week' ? 2 : 1;
      setActiveWeekIndex((idx: number) => Math.max(0, idx - step));
    } else {
      setActiveDayIndex((idx: number) => Math.max(0, idx - 1));
    }
  };

  const goToNext = () => {
    if (viewMode === 'month') {
      setMonthDir(1);
      if (month === 11) { setYear(year + 1); setMonth(0); }
      else setMonth(month + 1);
    } else if (viewMode === 'week' || viewMode === '2week') {
      const step = viewMode === '2week' ? 2 : 1;
      setActiveWeekIndex((idx: number) => Math.min(generateYearWeeks(year).length - 1, idx + step));
    } else {
      setActiveDayIndex((idx: number) => Math.min((new Date(year, 1, 29).getDate() === 29 ? 365 : 364), idx + 1));
    }
  };

  const goToToday = () => {
    const now = new Date();
    const todayStr = fmtDate(now);
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    setWeekOffset(0);
    // 주간 뷰: 오늘이 속한 주로 이동
    const yearWeeks = generateYearWeeks(now.getFullYear());
    setActiveWeekIndex(findWeekIndexForDate(yearWeeks, todayStr));
    // 일간 뷰: 오늘로 초기화 (양쪽 모두 정오로 정규화)
    const jan1 = new Date(now.getFullYear(), 0, 1, 12, 0, 0, 0);
    const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
    setActiveDayIndex(Math.floor((todayNoon.getTime() - jan1.getTime()) / 86400000));
    // 월간 뷰: 오늘 날짜에 펄스 애니메이션 (모달 트리거 방지)
    if (viewMode === 'month') {
      setPulseDate(todayStr);
      setFocusedDate(todayStr);
      setTimeout(() => { setPulseDate(null); }, 2500);
    }
    // 주간/2주: showCreate 트리거하지 않음
  };

  // 이벤트 CRUD
  const isAddingRef = useRef(false);
  const handleAddEvent = useCallback(async (data: Omit<CalendarEvent, 'id' | 'createdAt'>) => {
    if (isAddingRef.current) return;
    isAddingRef.current = true;
    try {
      const ev: CalendarEvent = {
        ...data,
        id: createUuid(),
        createdAt: new Date().toISOString(),
      };
      await addEvent(ev);
      // bflow:calendar-changed 구독이 자동 refresh하므로 수동 추가 불필요
      setShowCreate(false);
      setCreateDate(undefined);
    } finally {
      isAddingRef.current = false;
    }
  }, []);

  const handleUpdateEvent = useCallback(async (data: Omit<CalendarEvent, 'id' | 'createdAt'>) => {
    if (!editEvent) return;
    const updates = { ...data };
    await updateEvent(editEvent.id, updates);
    const updatedEvent = { ...editEvent, ...updates };
    setEvents((prev) => prev.map((e) => (e.id === editEvent.id ? { ...e, ...updates } : e)));
    // 캘린더 → 할일 역동기화
    if (updatedEvent.linkedTodoId || updatedEvent.id.startsWith('cal_')) {
      const todoId = updatedEvent.linkedTodoId || updatedEvent.id.replace(/^cal_/, '');
      syncCalendarToTodo(todoId, updatedEvent);
    }
    setEditEvent(null);
    setShowCreate(false);
  }, [editEvent]);

  const handleDeleteEvent = useCallback(async (id: string) => {
    // 삭제 전에 이벤트 정보 저장 (할일 연결 해제용)
    const deletingEvent = events.find(e => e.id === id);
    await deleteEvent(id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
    // 할일 연결된 이벤트인 경우 addToCalendar = false 처리 (할일 자체는 유지)
    if (deletingEvent) {
      if (deletingEvent.linkedTodoId || deletingEvent.id.startsWith('cal_')) {
        const todoId = deletingEvent.linkedTodoId || deletingEvent.id.replace(/^cal_/, '');
        unlinkTodoFromCalendar(todoId);
      }
    }
  }, [events]);

  // 날짜 클릭 → 툴팁으로 이벤트 생성 (드래그 훅이 처리하므로 기존 모달은 열지 않음)
  const handleDateClick = useCallback((_date: string) => {
    // 드래그 훅의 onDragComplete가 상세 편집 모달을 직접 열므로
    // 여기서는 아무것도 하지 않음 (이중 모달 방지)
  }, []);

  // 이벤트 클릭 → 사이드패널 토글 (같은 이벤트 재클릭 시 닫기)
  const handleEventClick = useCallback((ev: CalendarEvent) => {
    setPanelEvent(prev => prev?.id === ev.id ? null : ev);
  }, []);

  // 이벤트에서 해당 뷰로 이동
  const handleNavigate = useCallback((ev: CalendarEvent) => {
    // 휴가 이벤트 → 휴가 탭으로 이동
    if (ev.type === 'vacation') {
      setView('vacation');
      setDetailEvent(null);
      setPanelEvent(null);
      return;
    }
    let linkedPart: string | null | undefined = undefined;
    if (ev.linkedSheetName) {
      // 파트 ID 추출 (sheetName 형식: EP01_A_BG)
      const match = ev.linkedSheetName.match(/_([A-Z])_/);
      if (match) linkedPart = match[1];
    }
    navigateToSceneView({
      episodeNumber: ev.linkedEpisode,
      partId: linkedPart,
      department: ev.linkedDepartment,
      highlightSceneId: ev.linkedSceneId,
      toastMessage: `${ev.title} → 씬 뷰로 이동합니다`,
    });
    setDetailEvent(null);
  }, [setView]);

  // 드래그&드롭
  const handleEventDragDone = useCallback(async (eventId: string, newStart: string, newEnd: string) => {
    await updateEvent(eventId, { startDate: newStart, endDate: newEnd });
    setEvents((prev) => {
      const updated = prev.map((e) => (e.id === eventId ? { ...e, startDate: newStart, endDate: newEnd } : e));
      // sync to todo if linked
      const ev = updated.find((e) => e.id === eventId);
      if (ev && (ev.linkedTodoId || ev.id.startsWith('cal_'))) {
        const todoId = ev.linkedTodoId || ev.id.replace(/^cal_/, '');
        syncCalendarToTodo(todoId, ev);
      }
      return updated;
    });
  }, []);

  const { isDragging, preview: dragPreview, startDrag } = useCalendarDnD(handleEventDragDone, handleEventDragDone);

  const handleBarDragStart = useCallback((eventId: string, mode: DragMode, anchorDate: string) => {
    const ev = allEvents.find((ev) => ev.id === eventId);
    if (!ev || ev.isReadOnly) return;
    startDrag(eventId, mode, ev.startDate, ev.endDate, 0, anchorDate);
  }, [allEvents, startDrag]);

  // ─── 드래그-투-크리에이트: 시작/종료 날짜 상태 ───
  const [createEndDate, setCreateEndDate] = useState<string | undefined>();

  // 드래그 완료 후 모달이 열려 있는 동안 선택 범위를 유지하기 위한 상태
  const [persistedDateRange, setPersistedDateRange] = useState<{ startDate: string; endDate: string } | null>(null);

  // 키보드 네비게이션용 포커스 날짜 (월간 뷰 전용)
  const [focusedDate, setFocusedDate] = useState<string | null>(null);

  // navigate-to-date 펄스 애니메이션용
  const [pulseDate, setPulseDate] = useState<string | null>(null);

  // 오늘 버튼 하이라이트 (persistedDateRange와 분리)
  // todayHighlight 제거됨 — pulseDate로 통합

  const { dragState, handleCellMouseDown, isDateInRange } = useCalendarDragCreate({
    onDragComplete: (startDate, endDate, _anchorEl) => {
      // 드래그/클릭 완료 → 상세 편집 모달 열기 (시작일+종료일 프리필)
      setCreateDate(startDate);
      setCreateEndDate(endDate);
      setEditEvent(null);
      setShowCreate(true);
      // 모달이 열려 있는 동안 하이라이트 유지
      setPersistedDateRange({ startDate, endDate });
    },
  });

  // showCreate가 닫히면 persisted range 초기화
  useEffect(() => {
    if (!showCreate) setPersistedDateRange(null);
  }, [showCreate]);

  // 캘린더 키보드 네비게이션 (모든 뷰)
  useEffect(() => {
    if (showCreate || quickEdit) return;

    const handler = (e: KeyboardEvent) => {
      // input/textarea에 포커스 있으면 무시
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // 패널이 열려 있을 때 Escape만 처리
      if (panelEvent && e.key === 'Escape') {
        setPanelEvent(null);
        return;
      }

      if (e.key === 'Escape') {
        setFocusedDate(null);
        return;
      }

      // 주간/2주 뷰: 방향키로 주 이동 (휠과 동일하게 activeWeekIndex 변경)
      if (viewMode === 'week' || viewMode === '2week') {
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          setActiveWeekIndex((idx: number) => Math.max(0, idx - 1));
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          setActiveWeekIndex((idx: number) => Math.min(generateYearWeeks(year).length - 1, idx + 1));
          return;
        }
        return;
      }

      // 일간 뷰: 방향키로 일 이동
      if (viewMode === 'today') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          setActiveDayIndex((o: number) => Math.max(0, o - 1));
          return;
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          setActiveDayIndex((o: number) => Math.min((new Date(year, 1, 29).getDate() === 29 ? 365 : 364), o + 1));
          return;
        }
        return;
      }

      // 월간 뷰: 방향키로 날짜 이동
      const arrows: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      const delta = arrows[e.key];

      if (delta !== undefined) {
        e.preventDefault();
        e.stopPropagation();
        setFocusedDate((prev) => {
          // 포커스 없으면 현재 보이는 달의 1일부터 시작 (오늘로 점프 방지)
          const base = prev ? parseDate(prev) : new Date(year, month, 1, 12, 0, 0, 0);
          const next = addDays(base, delta);
          const nextStr = fmtDate(next);
          // 월이 변경되면 자동으로 이동
          if (next.getMonth() !== month || next.getFullYear() !== year) {
            setYear(next.getFullYear());
            setMonth(next.getMonth());
            setMonthDir(delta > 0 ? 1 : -1);
          }
          return nextStr;
        });
        return;
      }

      if (e.key === 'Enter' && focusedDate) {
        e.preventDefault();
        e.stopPropagation();
        setCreateDate(focusedDate);
        setCreateEndDate(focusedDate);
        setEditEvent(null);
        setShowCreate(true);
        setPersistedDateRange({ startDate: focusedDate, endDate: focusedDate });
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [viewMode, showCreate, quickEdit, panelEvent, focusedDate, month, year]);

  // 뷰 모드 변경 시 포커스 초기화
  useEffect(() => {
    setFocusedDate(null);
  }, [viewMode]);

  // 외부에서 날짜 이동 요청 수신 (MyTasksWidget 등)
  const navigateTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.date) {
        // 이전 타이머 정리
        navigateTimersRef.current.forEach(clearTimeout);
        navigateTimersRef.current = [];

        const dateStr = detail.date as string;
        const d = parseDate(dateStr);
        setYear(d.getFullYear());
        setMonth(d.getMonth());
        setPersistedDateRange({ startDate: dateStr, endDate: dateStr });
        // 주간/일간 뷰에서도 해당 날짜로 이동
        const yearWeeks = generateYearWeeks(d.getFullYear());
        const weekIdx = findWeekIndexForDate(yearWeeks, dateStr);
        if (weekIdx >= 0) setActiveWeekIndex(weekIdx);
        // 일간 뷰: 연초 기준 일수 계산
        const yearStart = new Date(d.getFullYear(), 0, 1);
        const dayIdx = Math.floor((d.getTime() - yearStart.getTime()) / 86400000);
        setActiveDayIndex(dayIdx);
        setPulseDate(dateStr);
        // 3초 후 하이라이트 및 펄스 해제
        navigateTimersRef.current.push(
          setTimeout(() => { setPersistedDateRange(null); setPulseDate(null); }, 3000)
        );
        // 해당 날짜의 연동된 이벤트를 사이드패널에 표시
        if (detail.todoId) {
          navigateTimersRef.current.push(
            setTimeout(() => {
              const linkedEvent = events.find(ev =>
                ev.linkedTodoId === detail.todoId || ev.id === `cal_${detail.todoId}`
              );
              if (linkedEvent) setPanelEvent(linkedEvent);
            }, 100)
          );
        }
      }
    };
    window.addEventListener('bflow:navigate-to-date', handler);
    return () => {
      window.removeEventListener('bflow:navigate-to-date', handler);
      navigateTimersRef.current.forEach(clearTimeout);
    };
  }, [events]);

  // 드래그 범위 OR 모달 열림 시 persisted 범위를 통합 체크
  const isDateInHighlightRange = useCallback((date: string): boolean => {
    if (isDateInRange(date)) return true;
    if (persistedDateRange && date >= persistedDateRange.startDate && date <= persistedDateRange.endDate) return true;
    // 오늘 버튼 하이라이트 (별도 상태)
    if (date === pulseDate) return true;
    return false;
  }, [isDateInRange, persistedDateRange, pulseDate]);

  // ─── 사이드 패널 / 퀵 에디트 핸들러 ───
  const handleUpdateEventDirect = useCallback(async (id: string, updates: Partial<CalendarEvent>) => {
    // 빈 문자열 날짜 방지: 기존 값 유지
    if ('startDate' in updates && !updates.startDate) delete updates.startDate;
    if ('endDate' in updates && !updates.endDate) delete updates.endDate;
    // endDate < startDate 방지: 자동 swap
    if (updates.startDate && updates.endDate && updates.endDate < updates.startDate) {
      [updates.startDate, updates.endDate] = [updates.endDate, updates.startDate];
    }
    await updateEvent(id, updates);
    setEvents(prev => {
      const updated = prev.map(e => e.id === id ? { ...e, ...updates } : e);
      // 캘린더 → 할일 역동기화 (최신 상태에서 참조)
      const ev = prev.find(e => e.id === id);
      if (ev) {
        const updatedEvent = { ...ev, ...updates };
        if (updatedEvent.linkedTodoId || updatedEvent.id.startsWith('cal_')) {
          const todoId = updatedEvent.linkedTodoId || updatedEvent.id.replace(/^cal_/, '');
          syncCalendarToTodo(todoId, updatedEvent);
        }
      }
      return updated;
    });
    // 사이드패널에 표시 중인 이벤트도 갱신
    setPanelEvent(prev => prev && prev.id === id ? { ...prev, ...updates } : prev);
  }, []);

  const handleDuplicateEvent = useCallback(async (event: CalendarEvent) => {
    const newEv: CalendarEvent = {
      ...event,
      id: createUuid(),
      title: `${event.title} (복사)`,
      createdAt: new Date().toISOString(),
      // 연결 정보 모두 제거: 완전 독립 이벤트로 복제
      linkedTodoId: undefined,
      isReadOnly: false,
      type: 'custom',
      linkedEpisode: undefined,
      linkedSheetName: undefined,
      linkedSceneId: undefined,
      linkedDepartment: undefined,
      linkedPart: undefined,
    };
    await addEvent(newEv);
    // bflow:calendar-changed 구독이 자동 refresh
  }, []);

  // 이벤트 우클릭 → QuickEdit
  const handleEventContextMenu = useCallback((ev: CalendarEvent, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setQuickEdit({ event: ev, position: { x: e.clientX, y: e.clientY } });
  }, []);

  // 헤더 라벨
  const headerLabel = useMemo(() => {
    if (viewMode === 'month') return `${year}년 ${month + 1}월`;
    if (viewMode === 'today') {
      const d = new Date();
      return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
    }
    // 주간/2주간: activeWeekIndex 기준으로 현재 보이는 범위 표시
    if (weeks.length > 0 && activeWeekIndex < weeks.length) {
      if (viewMode === '2week') {
        const startWeek = weeks[activeWeekIndex];
        const endIdx = Math.min(activeWeekIndex + 1, weeks.length - 1);
        const endWeek = weeks[endIdx];
        const first = startWeek[0];
        const last = endWeek[6];
        return `${first.getMonth() + 1}/${first.getDate()} — ${last.getMonth() + 1}/${last.getDate()}`;
      }
      const activeWeek = weeks[activeWeekIndex];
      const first = activeWeek[0];
      const last = activeWeek[6];
      return `${first.getMonth() + 1}/${first.getDate()} — ${last.getMonth() + 1}/${last.getDate()}`;
    }
    return '';
  }, [viewMode, year, month, weeks, activeWeekIndex]);

  // 최대 바 행 수
  const maxBars = viewMode === 'month' ? 3 : viewMode === '2week' ? 5 : 8;

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-full">
      {/* ═══ 좌측 사이드바 ═══ */}
      <div
        className="flex-shrink-0 border-r border-bg-border/30 transition-all duration-250 overflow-hidden"
        style={{
          width: sidebarOpen ? 180 : 40,
          transition: 'width 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {sidebarOpen ? (
          <div className="w-[180px] h-full flex flex-col p-2">
            <button
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-accent hover:bg-accent/10 rounded-md cursor-pointer mb-2 self-end"
            >
              <ChevronLeft size={12} />
              접기
            </button>
            {viewMode === 'today' ? (
              <DaySidebar
                activeDayIndex={activeDayIndex}
                onDaySelect={setActiveDayIndex}
                events={filteredEvents}
                year={year}
              />
            ) : (viewMode === 'week' || viewMode === '2week') ? (
              <WeekSidebar
                weeks={weeks}
                events={filteredEvents}
                today={today}
                activeWeekIndex={activeWeekIndex}
                onWeekSelect={setActiveWeekIndex}
                currentMonth={month}
                currentYear={year}
              />
            ) : (
              <MiniCalendar
                currentMonth={new Date(year, month, 1)}
                onMonthChange={(d) => { setYear(d.getFullYear()); setMonth(d.getMonth()); }}
                onDateSelect={(dateStr) => {
                  setCreateDate(dateStr);
                  setShowCreate(true);
                }}
                events={filteredEvents}
                selectedDate={createDate}
              />
            )}
          </div>
        ) : (
          <div className="w-[40px] h-full flex flex-col items-center pt-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 text-accent hover:bg-accent/10 rounded-md cursor-pointer"
              title="사이드바 펼치기"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* ═══ 메인 영역 ═══ */}
      <div className="flex-1 flex flex-col gap-3 min-w-0 relative overflow-hidden">
      {/* ═══ 헤더 ═══ */}
      <div className="flex items-center justify-between flex-wrap gap-2 px-3 pt-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <CalendarDays size={20} className="text-accent" />
            캘린더
          </h1>

          {/* 네비게이션 */}
          {viewMode !== 'today' && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={goToPrev}
                className="p-2 rounded-lg hover:bg-bg-border/30 text-text-secondary/60 hover:text-text-primary transition-colors cursor-pointer"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-lg font-bold text-text-primary min-w-[160px] text-center">
                {headerLabel}
              </span>
              <button
                onClick={goToNext}
                className="p-2 rounded-lg hover:bg-bg-border/30 text-text-secondary/60 hover:text-text-primary transition-colors cursor-pointer"
              >
                <ChevronRight size={20} />
              </button>
              <button
                onClick={goToToday}
                className="ml-2 px-3 py-1.5 text-xs rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer font-medium"
              >
                오늘
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 필터 */}
          <div className="flex items-center bg-bg-card rounded-lg p-0.5 border border-bg-border/50">
            {([['all', '전체'], ['custom', '일반'], ['episode', 'EP'], ['part', '파트'], ['scene', '씬'], ['vacation', '휴가']] as const).map(([f, l]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md font-medium cursor-pointer transition-colors',
                  filter === f
                    ? f === 'vacation' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-accent/20 text-accent'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {/* 휴가 표시 토글 */}
          {vacationConnected && (
            <button
              onClick={() => setShowVacation((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer border',
                showVacation
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-bg-card text-text-secondary/50 border-bg-border/50',
              )}
              title={showVacation ? '휴가 이벤트 숨기기' : '휴가 이벤트 표시'}
            >
              <Palmtree size={13} />
              휴가
            </button>
          )}

          {/* 부서 필터 */}
          <div className="flex items-center bg-bg-card rounded-lg p-0.5 border border-bg-border/50">
            {([['all', '전체'], ['bg', 'BG'], ['acting', 'ACT']] as const).map(([f, l]) => (
              <button
                key={f}
                onClick={() => setDeptFilter(f)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md font-medium cursor-pointer transition-colors',
                  deptFilter === f
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {/* 뷰 모드 */}
          <div className="flex bg-bg-card rounded-lg p-0.5 border border-bg-border/50">
            {([['month', '월'], ['2week', '2주'], ['week', '주'], ['today', '오늘']] as const).map(([m, l]) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md font-medium cursor-pointer transition-colors',
                  viewMode === m
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {/* 이벤트 생성 */}
          <button
            onClick={() => { setCreateDate(undefined); setShowCreate(true); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent hover:bg-accent/80 text-white text-sm font-medium shadow-sm shadow-accent/20 transition-colors cursor-pointer"
          >
            <Plus size={16} />
            이벤트
          </button>
        </div>
      </div>

      {/* ═══ 이벤트 수 통계 ═══ */}
      <div className="flex items-center gap-4 text-sm text-text-secondary/50 px-4">
        <span>전체 {allEvents.length}개</span>
        <span className="text-bg-border/50">·</span>
        <span>이번 달 {allEvents.filter((e) => {
          const s = parseDate(e.startDate);
          return s.getFullYear() === year && s.getMonth() === month;
        }).length}개</span>
        <span className="text-bg-border/50">·</span>
        <span>오늘 {allEvents.filter((e) => e.startDate <= today && e.endDate >= today).length}개</span>
        {vacationEvents.length > 0 && (
          <>
            <span className="text-bg-border/50">·</span>
            <span className="text-emerald-400/70">휴가 {vacationEvents.length}건</span>
          </>
        )}
      </div>

      {/* ═══ 캘린더 본체 ═══ */}
      <div className="flex-1 flex flex-col overflow-hidden px-3 pb-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={viewMode}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {viewMode === 'today' ? (
              <DayScrollView
                events={filteredEvents}
                activeDayIndex={activeDayIndex}
                onActiveDayChange={setActiveDayIndex}
                onEventClick={handleEventClick}
                onDateClick={(dateStr) => {
                  setCreateDate(dateStr);
                  setCreateEndDate(dateStr);
                  setEditEvent(null);
                  setShowCreate(true);
                }}
                year={year}
              />
            ) : viewMode === 'week' || viewMode === '2week' ? (
              <WeekScrollView
                currentMonth={month}
                currentYear={year}
                events={filteredEvents}
                today={today}
                onEventClick={handleEventClick}
                onDateClick={(dateStr) => {
                  setCreateDate(dateStr);
                  setCreateEndDate(dateStr);
                  setEditEvent(null);
                  setShowCreate(true);
                }}
                activeWeekIndex={activeWeekIndex}
                onWeekChange={setActiveWeekIndex}
                mode={viewMode === '2week' ? '2week' : 'week'}
              />
            ) : (
              <CalendarGrid
                weeks={weeks}
                events={filteredEvents}
                today={today}
                currentMonth={month}
                maxVisibleBars={maxBars}
                onDateClick={handleDateClick}
                onEventClick={handleEventClick}
                onDragStart={handleBarDragStart}
                dragPreview={dragPreview}
                isDragging={isDragging}
                onCellMouseDown={handleCellMouseDown}
                isDateInDragRange={isDateInHighlightRange}
                onEventContextMenu={handleEventContextMenu}
                monthKey={`${year}-${month}`}
                monthDirection={monthDir}
                focusedDate={focusedDate}
                pulseDate={pulseDate}
                onWheel={(e) => {
                  if (viewMode !== 'month') return;
                  // 디바운스된 월 이동 (휠 아래=다음달, 위=이전달)
                  clearTimeout(wheelTimerRef.current);
                  const dir = e.deltaY > 0 ? 1 : -1;
                  setMonthDir(dir);
                  wheelTimerRef.current = setTimeout(() => {
                    if (dir > 0) goToNext();
                    else goToPrev();
                  }, 150);
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ═══ 모달들 ═══ */}
      <AnimatePresence>
        {showCreate && (
          <EventCreateModal
            key={editEvent ? `edit-${editEvent.id}` : 'create'}
            initialDate={createDate}
            initialEndDate={createEndDate}
            editEvent={editEvent ?? undefined}
            episodes={episodes}
            onClose={() => { setShowCreate(false); setCreateDate(undefined); setCreateEndDate(undefined); setEditEvent(null); }}
            onSave={editEvent ? handleUpdateEvent : handleAddEvent}
          />
        )}
      </AnimatePresence>

      {/* ═══ EventSidePanel (replaces EventDetailModal) ═══ */}
      <AnimatePresence>
        {panelEvent && (
          <EventSidePanel
            key={`panel-${panelEvent.id}`}
            event={panelEvent}
            onClose={() => setPanelEvent(null)}
            onDelete={(id) => { handleDeleteEvent(id); setPanelEvent(null); }}
            onUpdate={handleUpdateEventDirect}
            onNavigate={handleNavigate}
          />
        )}
      </AnimatePresence>

      {/* ═══ EventQuickEdit (right-click popup) ═══ */}
      {quickEdit && (
        <EventQuickEdit
          key={quickEdit.event.id}
          event={quickEdit.event}
          position={quickEdit.position}
          onClose={() => setQuickEdit(null)}
          onUpdateColor={(id, color) => {
            handleUpdateEventDirect(id, { color });
            // 패널 이벤트도 업데이트
            setPanelEvent(prev => prev && prev.id === id ? { ...prev, color } : prev);
          }}
          onUpdate={(id, updates) => {
            handleUpdateEventDirect(id, updates);
            setPanelEvent(prev => prev && prev.id === id ? { ...prev, ...updates } : prev);
          }}
          onDelete={(id) => { handleDeleteEvent(id); setPanelEvent(prev => prev?.id === id ? null : prev); }}
          onDuplicate={handleDuplicateEvent}
        />
      )}
      </div>{/* 메인 영역 끝 */}
    </div>
  );
}
