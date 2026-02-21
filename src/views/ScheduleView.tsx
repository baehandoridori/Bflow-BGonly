import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, X, Filter,
  Trash2, ExternalLink, GripVertical, Clock, MapPin, FileText,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  getEvents, addEvent, updateEvent, deleteEvent, filterEventsByRange,
} from '@/services/calendarService';
import type {
  CalendarEvent, CalendarViewMode, CalendarFilter, CalendarEventType,
} from '@/types/calendar';
import { EVENT_COLORS } from '@/types/calendar';
import { DEPARTMENT_CONFIGS } from '@/types';

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
  bar, compact, onClick,
}: {
  bar: EventBar; compact?: boolean; onClick: (e: CalendarEvent) => void;
}) {
  const ev = bar.event;
  const hex = ev.color || EVENT_COLORS[0];

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(ev); }}
      className={cn(
        'absolute text-left transition-all duration-150 cursor-pointer z-10',
        'hover:brightness-110 hover:scale-[1.02] hover:z-20',
        'group/bar',
      )}
      style={{
        left: `calc(${(bar.startCol / 7) * 100}% + 2px)`,
        width: `calc(${(bar.span / 7) * 100}% - 4px)`,
        top: `${bar.row * (compact ? 20 : 24) + (compact ? 24 : 30)}px`,
        height: compact ? '18px' : '22px',
      }}
      title={`${ev.title}${ev.memo ? ` — ${ev.memo}` : ''}`}
    >
      <div
        className={cn(
          'h-full flex items-center px-1.5 text-[10px] font-medium truncate',
          bar.isStart ? 'rounded-l-md' : '',
          bar.isEnd ? 'rounded-r-md' : '',
          !bar.isStart && !bar.isEnd ? '' : '',
        )}
        style={{
          background: `linear-gradient(135deg, ${hex}40 0%, ${hex}25 100%)`,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderTop: `1px solid ${hex}50`,
          borderBottom: `1px solid ${hex}20`,
          borderLeft: bar.isStart ? `3px solid ${hex}` : `1px solid ${hex}30`,
          borderRight: bar.isEnd ? `1px solid ${hex}40` : 'none',
          color: hex,
          textShadow: `0 0 12px ${hex}40`,
        }}
      >
        {bar.isStart && <span className="truncate">{ev.title}</span>}
      </div>
    </button>
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
      className="fixed z-50 bg-bg-card rounded-xl shadow-2xl border border-bg-border p-3 w-64 max-h-72 overflow-y-auto"
      style={{
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
        {events.map((ev) => (
          <button
            key={ev.id}
            onClick={() => { onEventClick(ev); onClose(); }}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-primary/50 transition-colors text-left cursor-pointer"
          >
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ev.color }} />
            <span className="text-xs text-text-primary truncate">{ev.title}</span>
            <span className="text-[10px] text-text-secondary/50 ml-auto shrink-0">
              {ev.type !== 'custom' ? ev.type.toUpperCase() : ''}
            </span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════
   이벤트 상세 모달
   ═══════════════════════════════════════════════════ */

function EventDetailModal({
  event, onClose, onDelete, onNavigate,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onDelete: (id: string) => void;
  onNavigate: (ev: CalendarEvent) => void;
}) {
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
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
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
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: `${event.color}20`, color: event.color }}
                >
                  {typeLabels[event.type]}
                </span>
                {event.linkedEpisode != null && (
                  <span className="text-[10px] text-text-secondary">EP.{String(event.linkedEpisode).padStart(2, '0')}</span>
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
          <div className="flex gap-2 pt-1">
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
  episodes,
  onClose,
  onSave,
}: {
  initialDate?: string;
  episodes: { episodeNumber: number; title: string; parts: { partId: string; sheetName: string; department: string; scenes: { sceneId: string; no: number }[] }[] }[];
  onClose: () => void;
  onSave: (ev: Omit<CalendarEvent, 'id' | 'createdAt'>) => void;
}) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const today = fmtDate(new Date());

  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [startDate, setStartDate] = useState(initialDate ?? today);
  const [endDate, setEndDate] = useState(initialDate ?? today);
  const [color, setColor] = useState<string>(EVENT_COLORS[0]);
  const [evType, setEvType] = useState<CalendarEventType>('custom');

  // 연결 항목
  const [linkedEp, setLinkedEp] = useState<number | ''>('');
  const [linkedPart, setLinkedPart] = useState('');
  const [linkedScene, setLinkedScene] = useState('');

  const selectedEpParts = useMemo(() => {
    if (linkedEp === '') return [];
    return episodes.find((e) => e.episodeNumber === linkedEp)?.parts ?? [];
  }, [linkedEp, episodes]);

  const selectedPartScenes = useMemo(() => {
    if (!linkedPart) return [];
    return selectedEpParts.find((p) => p.sheetName === linkedPart)?.scenes ?? [];
  }, [linkedPart, selectedEpParts]);

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
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.93, y: 12 }}
        transition={{ duration: 0.2 }}
        className="bg-bg-card rounded-2xl shadow-2xl border border-bg-border w-[28rem] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border">
          <h3 className="text-sm font-bold text-text-primary">새 이벤트</h3>
          <button onClick={onClose} className="p-1 text-text-secondary hover:text-text-primary cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* 제목 */}
          <div>
            <label className="text-[10px] font-semibold text-text-secondary/60 uppercase tracking-wider">제목</label>
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
              <label className="text-[10px] font-semibold text-text-secondary/60 uppercase tracking-wider">시작일</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary outline-none focus:border-accent"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] font-semibold text-text-secondary/60 uppercase tracking-wider">마감일</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* 이벤트 유형 */}
          <div>
            <label className="text-[10px] font-semibold text-text-secondary/60 uppercase tracking-wider">유형</label>
            <div className="flex gap-1.5 mt-1">
              {([['custom', '일반'], ['episode', '에피소드'], ['part', '파트'], ['scene', '씬']] as const).map(([t, l]) => (
                <button
                  key={t}
                  onClick={() => { setEvType(t); setLinkedEp(''); setLinkedPart(''); setLinkedScene(''); }}
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
              <label className="text-[10px] font-semibold text-text-secondary/60 uppercase tracking-wider">연결 대상</label>
              <select
                value={linkedEp}
                onChange={(e) => { setLinkedEp(e.target.value ? Number(e.target.value) : ''); setLinkedPart(''); setLinkedScene(''); }}
                className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
              >
                <option value="">에피소드 선택</option>
                {episodes.map((ep) => (
                  <option key={ep.episodeNumber} value={ep.episodeNumber}>{ep.title}</option>
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
            <label className="text-[10px] font-semibold text-text-secondary/60 uppercase tracking-wider">색상</label>
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
            <label className="text-[10px] font-semibold text-text-secondary/60 uppercase tracking-wider">메모</label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모 (선택사항)"
              rows={2}
              className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary/40 resize-none outline-none focus:border-accent"
            />
          </div>

          {/* 저장 */}
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="w-full py-2.5 rounded-xl text-sm font-medium bg-accent hover:bg-accent/80 text-white disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            이벤트 추가
          </button>
        </div>
      </motion.div>
    </motion.div>
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
}: {
  weeks: Date[][];
  events: CalendarEvent[];
  today: string;
  currentMonth: number;
  maxVisibleBars: number;
  onDateClick: (date: string) => void;
  onEventClick: (ev: CalendarEvent) => void;
}) {
  const [overflow, setOverflow] = useState<{ date: string; rect: DOMRect } | null>(null);

  return (
    <>
      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-px mb-px">
        {WEEKDAYS.map((day, i) => (
          <div
            key={day}
            className={cn(
              'text-center text-[11px] font-medium py-2',
              i === 0 ? 'text-red-400/60' : i === 6 ? 'text-blue-400/60' : 'text-text-secondary/50',
            )}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 주별 행 */}
      <div className="flex flex-col gap-px bg-bg-border/15 rounded-xl overflow-hidden border border-bg-border/30">
        {weeks.map((week, wi) => {
          const bars = layoutEventBars(events, week[0], 7);
          const maxRow = bars.length > 0 ? Math.max(...bars.map((b) => b.row)) + 1 : 0;
          const visibleRows = Math.min(maxRow, maxVisibleBars);
          const rowHeight = Math.max(30 + visibleRows * 24 + 4, 72);

          return (
            <div key={wi} className="relative grid grid-cols-7 gap-px" style={{ minHeight: rowHeight }}>
              {/* 날짜 셀 배경 */}
              {week.map((day, di) => {
                const dateStr = fmtDate(day);
                const isToday = dateStr === today;
                const isCurMonth = day.getMonth() === currentMonth;
                const dow = day.getDay();

                // 이 날짜에 해당하는 이벤트 수
                const dayEvents = events.filter((e) => e.startDate <= dateStr && e.endDate >= dateStr);
                const overflowCount = dayEvents.length - maxVisibleBars;

                return (
                  <div
                    key={di}
                    className={cn(
                      'bg-bg-primary/50 transition-colors duration-100 cursor-pointer relative',
                      isCurMonth ? 'hover:bg-bg-border/15' : 'opacity-30',
                      isToday && 'bg-accent/5',
                    )}
                    style={{ minHeight: rowHeight }}
                    onClick={() => onDateClick(dateStr)}
                  >
                    {/* 날짜 번호 */}
                    <div className="p-1.5">
                      <span
                        className={cn(
                          'text-xs tabular-nums inline-flex items-center justify-center',
                          isToday
                            ? 'bg-accent text-white w-5 h-5 rounded-full text-[10px] font-bold'
                            : dow === 0 ? 'text-red-400/70'
                            : dow === 6 ? 'text-blue-400/70'
                            : isCurMonth ? 'text-text-primary/60' : 'text-text-secondary/30',
                        )}
                      >
                        {day.getDate()}
                      </span>
                    </div>

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
              {bars.filter((b) => b.row < maxVisibleBars).map((bar) => (
                <EventBarChip
                  key={`${bar.event.id}-${wi}`}
                  bar={bar}
                  onClick={onEventClick}
                />
              ))}
            </div>
          );
        })}
      </div>

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
    </>
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
                  <p className="text-[10px] text-text-secondary/60 mt-0.5">{dateRange} · {ev.createdBy}</p>
                </div>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                  style={{ backgroundColor: `${ev.color}20`, color: ev.color }}
                >
                  {ev.type === 'custom' ? '일반' : ev.type.toUpperCase()}
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
   메인 ScheduleView
   ═══════════════════════════════════════════════════ */

export function ScheduleView() {
  const episodes = useDataStore((s) => s.episodes);
  const { setView, setSelectedEpisode, setSelectedPart, setSelectedDepartment } = useAppStore();

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [filter, setFilter] = useState<CalendarFilter>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [createDate, setCreateDate] = useState<string | undefined>();
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);

  // 날짜 상태
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [weekOffset, setWeekOffset] = useState(0); // 주/2주 뷰 오프셋

  const today = fmtDate(new Date());

  // 이벤트 로드
  useEffect(() => {
    getEvents().then(setEvents);
  }, []);

  // 필터링
  const filteredEvents = useMemo(() => {
    if (filter === 'all') return events;
    return events.filter((e) => e.type === filter);
  }, [events, filter]);

  // 주 데이터 계산
  const weeks = useMemo(() => {
    if (viewMode === 'today') return [];

    if (viewMode === 'month') {
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startDow = firstDay.getDay();

      const days: Date[] = [];
      // 이전 달
      for (let i = startDow - 1; i >= 0; i--) {
        days.push(addDays(firstDay, -(i + 1)));
      }
      // 이번 달
      for (let d = 1; d <= lastDay.getDate(); d++) {
        days.push(new Date(year, month, d));
      }
      // 다음 달 (6행 채우기)
      while (days.length < 42) {
        days.push(addDays(days[days.length - 1], 1));
      }

      const result: Date[][] = [];
      for (let i = 0; i < days.length; i += 7) {
        result.push(days.slice(i, i + 7));
      }
      return result;
    }

    if (viewMode === 'week' || viewMode === '2week') {
      const todayDate = new Date();
      const todayDow = todayDate.getDay();
      const weekStart = addDays(todayDate, -todayDow + weekOffset * 7);
      const numWeeks = viewMode === '2week' ? 2 : 1;

      const result: Date[][] = [];
      for (let w = 0; w < numWeeks; w++) {
        const week: Date[] = [];
        for (let d = 0; d < 7; d++) {
          week.push(addDays(weekStart, w * 7 + d));
        }
        result.push(week);
      }
      return result;
    }

    return [];
  }, [viewMode, year, month, weekOffset]);

  // 네비게이션
  const goToPrev = () => {
    if (viewMode === 'month') {
      if (month === 0) { setYear(year - 1); setMonth(11); }
      else setMonth(month - 1);
    } else {
      setWeekOffset(weekOffset - (viewMode === '2week' ? 2 : 1));
    }
  };

  const goToNext = () => {
    if (viewMode === 'month') {
      if (month === 11) { setYear(year + 1); setMonth(0); }
      else setMonth(month + 1);
    } else {
      setWeekOffset(weekOffset + (viewMode === '2week' ? 2 : 1));
    }
  };

  const goToToday = () => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    setWeekOffset(0);
  };

  // 이벤트 CRUD
  const handleAddEvent = useCallback(async (data: Omit<CalendarEvent, 'id' | 'createdAt'>) => {
    const ev: CalendarEvent = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await addEvent(ev);
    setEvents((prev) => [...prev, ev]);
    setShowCreate(false);
    setCreateDate(undefined);
  }, []);

  const handleDeleteEvent = useCallback(async (id: string) => {
    await deleteEvent(id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // 날짜 클릭 → 이벤트 생성
  const handleDateClick = useCallback((date: string) => {
    setCreateDate(date);
    setShowCreate(true);
  }, []);

  // 이벤트에서 해당 뷰로 이동
  const handleNavigate = useCallback((ev: CalendarEvent) => {
    if (ev.linkedEpisode != null) {
      setSelectedEpisode(ev.linkedEpisode);
    }
    if (ev.linkedSheetName) {
      // 파트 ID 추출 (sheetName 형식: EP01_A_BG)
      const match = ev.linkedSheetName.match(/_([A-Z])_/);
      if (match) setSelectedPart(match[1]);
    }
    if (ev.linkedDepartment) {
      setSelectedDepartment(ev.linkedDepartment);
    }
    // 씬 뷰로 이동
    setView('scenes');
    setDetailEvent(null);
  }, [setView, setSelectedEpisode, setSelectedPart, setSelectedDepartment]);

  // 헤더 라벨
  const headerLabel = useMemo(() => {
    if (viewMode === 'month') return `${year}년 ${month + 1}월`;
    if (viewMode === 'today') {
      const d = new Date();
      return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
    }
    if (weeks.length > 0) {
      const first = weeks[0][0];
      const last = weeks[weeks.length - 1][6];
      return `${first.getMonth() + 1}/${first.getDate()} — ${last.getMonth() + 1}/${last.getDate()}`;
    }
    return '';
  }, [viewMode, year, month, weeks]);

  // 최대 바 행 수
  const maxBars = viewMode === 'month' ? 3 : viewMode === '2week' ? 5 : 8;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* ═══ 헤더 ═══ */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <CalendarDays size={20} className="text-accent" />
            캘린더
          </h1>

          {/* 네비게이션 */}
          {viewMode !== 'today' && (
            <div className="flex items-center gap-1">
              <button
                onClick={goToPrev}
                className="p-1.5 rounded-lg hover:bg-bg-border/30 text-text-secondary/60 hover:text-text-primary transition-colors cursor-pointer"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold text-text-primary min-w-[120px] text-center">
                {headerLabel}
              </span>
              <button
                onClick={goToNext}
                className="p-1.5 rounded-lg hover:bg-bg-border/30 text-text-secondary/60 hover:text-text-primary transition-colors cursor-pointer"
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={goToToday}
                className="ml-1 px-2.5 py-1 text-[10px] rounded-md bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer font-medium"
              >
                오늘
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 필터 */}
          <div className="flex items-center bg-bg-card rounded-lg p-0.5 border border-bg-border/50">
            {([['all', '전체'], ['custom', '일반'], ['episode', 'EP'], ['part', '파트'], ['scene', '씬']] as const).map(([f, l]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-2.5 py-1 text-[10px] rounded-md font-medium cursor-pointer transition-colors',
                  filter === f
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
                  'px-3 py-1 text-[11px] rounded-md font-medium cursor-pointer transition-colors',
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent/80 text-white text-xs font-medium transition-colors cursor-pointer"
          >
            <Plus size={14} />
            이벤트
          </button>
        </div>
      </div>

      {/* ═══ 이벤트 수 통계 ═══ */}
      <div className="flex items-center gap-4 text-xs text-text-secondary/50 px-1">
        <span>전체 {events.length}개</span>
        <span className="text-bg-border/50">·</span>
        <span>이번 달 {events.filter((e) => {
          const s = parseDate(e.startDate);
          return s.getFullYear() === year && s.getMonth() === month;
        }).length}개</span>
        <span className="text-bg-border/50">·</span>
        <span>오늘 {events.filter((e) => e.startDate <= today && e.endDate >= today).length}개</span>
      </div>

      {/* ═══ 캘린더 본체 ═══ */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'today' ? (
          <div className="bg-bg-card rounded-xl border border-bg-border/40 p-4">
            <TodayView events={filteredEvents} today={today} onEventClick={setDetailEvent} />
          </div>
        ) : (
          <CalendarGrid
            weeks={weeks}
            events={filteredEvents}
            today={today}
            currentMonth={month}
            maxVisibleBars={maxBars}
            onDateClick={handleDateClick}
            onEventClick={setDetailEvent}
          />
        )}
      </div>

      {/* ═══ 모달들 ═══ */}
      <AnimatePresence>
        {showCreate && (
          <EventCreateModal
            key="create"
            initialDate={createDate}
            episodes={episodes}
            onClose={() => { setShowCreate(false); setCreateDate(undefined); }}
            onSave={handleAddEvent}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detailEvent && (
          <EventDetailModal
            key="detail"
            event={detailEvent}
            onClose={() => setDetailEvent(null)}
            onDelete={handleDeleteEvent}
            onNavigate={handleNavigate}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
