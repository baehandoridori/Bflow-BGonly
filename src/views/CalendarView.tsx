import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Calendar as CalendarIcon, ChevronRight, ChevronLeft, Layers, BarChart3, CalendarDays } from 'lucide-react';
import { useDataStore } from '@/stores/useDataStore';
import { sceneProgress, isFullyDone } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS, DEPARTMENTS } from '@/types';
import type { Episode, Department } from '@/types';
import { getEvents } from '@/services/calendarService';
import type { CalendarEvent } from '@/types/calendar';
import { EVENT_COLORS } from '@/types/calendar';
import { cn } from '@/utils/cn';

/* ────────────────────────────────────────────────
   프로그레스 색상
   ──────────────────────────────────────────────── */
function pctColor(pct: number): string {
  if (pct >= 100) return '#00B894';
  if (pct >= 75) return '#FDCB6E';
  if (pct >= 50) return '#E17055';
  if (pct >= 25) return '#FF9F43';
  return '#FF6B6B';
}

/* ────────────────────────────────────────────────
   타임라인 바 데이터 (기존 간트)
   ──────────────────────────────────────────────── */
interface TimelineRow {
  id: string;
  label: string;
  subLabel?: string;
  department?: Department;
  pct: number;
  totalScenes: number;
  fullyDone: number;
  depth: number; // 0=에피소드, 1=파트
}

function buildTimelineRows(episodes: Episode[], episodeTitles: Record<number, string> = {}): TimelineRow[] {
  const rows: TimelineRow[] = [];

  for (const ep of episodes) {
    const allScenes = ep.parts.flatMap((p) => p.scenes);
    const totalScenes = allScenes.length;
    const fullyDone = allScenes.filter(isFullyDone).length;
    const epPct = totalScenes > 0
      ? allScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / totalScenes
      : 0;

    rows.push({
      id: `ep-${ep.episodeNumber}`,
      label: episodeTitles[ep.episodeNumber] || ep.title,
      pct: epPct,
      totalScenes,
      fullyDone,
      depth: 0,
    });

    for (const part of ep.parts) {
      const pScenes = part.scenes;
      const pPct = pScenes.length > 0
        ? pScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / pScenes.length
        : 0;

      rows.push({
        id: `part-${part.sheetName}`,
        label: `${part.partId}파트`,
        subLabel: DEPARTMENT_CONFIGS[part.department].shortLabel,
        department: part.department,
        pct: pPct,
        totalScenes: pScenes.length,
        fullyDone: pScenes.filter(isFullyDone).length,
        depth: 1,
      });
    }
  }

  return rows;
}

/* ────────────────────────────────────────────────
   타임라인 차트 (진행률 바)
   ──────────────────────────────────────────────── */
function TimelineChart({ episodes, deptFilter, episodeTitles }: { episodes: Episode[]; deptFilter: 'all' | 'bg' | 'acting'; episodeTitles?: Record<number, string> }) {
  const rows = useMemo(() => {
    const all = buildTimelineRows(episodes, episodeTitles);
    if (deptFilter === 'all') return all;
    // 에피소드 행은 유지, 파트 행은 부서 필터
    return all.filter((r) => r.depth === 0 || r.department === deptFilter);
  }, [episodes, deptFilter, episodeTitles]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((epId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(epId)) next.delete(epId);
      else next.add(epId);
      return next;
    });
  }, []);

  const visibleRows = useMemo(() => {
    const result: TimelineRow[] = [];
    let currentEpId = '';
    for (const row of rows) {
      if (row.depth === 0) {
        currentEpId = row.id;
        result.push(row);
      } else if (!collapsed.has(currentEpId)) {
        result.push(row);
      }
    }
    return result;
  }, [rows, collapsed]);

  return (
    <div className="flex flex-col gap-1">
      {visibleRows.map((row, i) => {
        const pct = Math.round(row.pct);
        const isEp = row.depth === 0;
        const deptColor = row.department ? DEPARTMENT_CONFIGS[row.department].color : undefined;

        return (
          <motion.div
            key={row.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: i * 0.02 }}
            className={cn(
              'flex items-center gap-3 rounded-lg py-2 px-3',
              'transition-colors duration-100',
              isEp ? 'hover:bg-bg-border/15' : 'hover:bg-bg-border/8',
            )}
          >
            {/* 라벨 */}
            <div
              className="shrink-0 flex items-center gap-1.5 w-28"
              style={{ paddingLeft: row.depth * 16 }}
            >
              {isEp && (
                <button
                  onClick={() => toggleCollapse(row.id)}
                  className="w-4 h-4 flex items-center justify-center text-text-secondary/50 hover:text-text-secondary cursor-pointer"
                >
                  <ChevronRight
                    size={12}
                    className={cn('transition-transform duration-150', !collapsed.has(row.id) && 'rotate-90')}
                  />
                </button>
              )}
              <span
                className={cn(
                  'text-xs truncate',
                  isEp ? 'font-semibold text-text-primary' : 'text-text-secondary/70',
                )}
              >
                {row.label}
              </span>
              {row.subLabel && (
                <span
                  className="text-[10px] px-1 py-px rounded font-medium"
                  style={{ color: deptColor, backgroundColor: deptColor ? `${deptColor}15` : undefined }}
                >
                  {row.subLabel}
                </span>
              )}
            </div>

            {/* 바 */}
            <div className="flex-1 h-6 rounded bg-bg-border/20 overflow-hidden relative">
              <motion.div
                className="absolute inset-y-0 left-0 rounded"
                style={{ backgroundColor: pctColor(pct) }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(pct, 100)}%` }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: i * 0.02 }}
              >
                {pct >= 15 && (
                  <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium text-white/80 truncate">
                    {row.fullyDone}/{row.totalScenes} 완료
                  </span>
                )}
              </motion.div>
              {pct < 15 && row.totalScenes > 0 && (
                <span className="absolute inset-0 flex items-center px-2 text-[10px] text-text-secondary/50">
                  {row.fullyDone}/{row.totalScenes}
                </span>
              )}
            </div>

            {/* 퍼센트 */}
            <span
              className={cn(
                'shrink-0 w-10 text-right text-xs font-medium tabular-nums',
                pct >= 100 ? 'text-status-high' : 'text-text-secondary/60',
              )}
            >
              {pct}%
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────
   진행 현황 히트맵
   ──────────────────────────────────────────────── */
function ProgressHeatmap({ episodes, deptFilter, episodeTitles }: { episodes: Episode[]; deptFilter: 'all' | 'bg' | 'acting'; episodeTitles?: Record<number, string> }) {
  const cells = useMemo(() => {
    return episodes.flatMap((ep) =>
      ep.parts.filter((part) => deptFilter === 'all' || part.department === deptFilter).map((part) => {
        const scenes = part.scenes;
        const pct = scenes.length > 0
          ? scenes.reduce((sum, s) => sum + sceneProgress(s), 0) / scenes.length
          : 0;
        return {
          key: `${ep.episodeNumber}-${part.partId}-${part.department}`,
          epTitle: episodeTitles?.[ep.episodeNumber] || ep.title,
          partId: part.partId,
          department: part.department,
          pct,
          scenes: scenes.length,
          done: scenes.filter(isFullyDone).length,
        };
      }),
    );
  }, [episodes, deptFilter]);

  if (cells.length === 0) return null;

  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
      {cells.map((cell, i) => {
        const pct = Math.round(cell.pct);
        const opacity = Math.max(0.08, cell.pct / 100);
        const color = pctColor(cell.pct);
        const deptCfg = DEPARTMENT_CONFIGS[cell.department];

        return (
          <motion.div
            key={cell.key}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: i * 0.015 }}
            className={cn(
              'rounded-lg p-3 border border-bg-border/20 cursor-default group',
              'transition-border transition-shadow duration-200 ease-out',
              'hover:border-bg-border/50 hover:shadow-md hover:shadow-black/15',
            )}
            style={{ backgroundColor: `${color}${Math.round(opacity * 25).toString(16).padStart(2, '0')}` }}
            title={`${cell.epTitle} ${cell.partId}파트 (${deptCfg.shortLabel}) — ${pct}%`}
          >
            <div className="text-[10px] font-medium text-text-primary/70 truncate">{cell.epTitle}</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[10px] text-text-secondary/50">{cell.partId}</span>
              <span className="text-[10px]" style={{ color: deptCfg.color }}>{deptCfg.shortLabel}</span>
            </div>
            <div className="mt-2 text-lg font-bold tabular-nums" style={{ color }}>
              {pct}%
            </div>
            <div className="text-[10px] text-text-secondary/50 mt-0.5">
              {cell.done}/{cell.scenes} 씬
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────
   이벤트 기반 간트 차트
   ──────────────────────────────────────────────── */

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function EventGanttChart() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    getEvents().then(setEvents);
  }, []);

  const DAY_WIDTH = 32; // 날짜 하나의 픽셀 폭

  // 날짜 범위 계산: 지난달 ~ 다다음달
  const { dateRange, dayLabels, totalDays } = useMemo(() => {
    const now = new Date();
    const rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 3, 0);

    const startStr = fmtDate(rangeStart);
    const endStr = fmtDate(rangeEnd);

    const days: { date: string; label: string; isToday: boolean; isWeekend: boolean; isFirstOfMonth: boolean; isMonday: boolean; monthLabel?: string }[] = [];
    const cur = new Date(rangeStart);
    const todayStr = fmtDate(now);
    while (fmtDate(cur) <= endStr) {
      const dateStr = fmtDate(cur);
      const isFirst = cur.getDate() === 1;
      days.push({
        date: dateStr,
        label: String(cur.getDate()),
        isToday: dateStr === todayStr,
        isWeekend: cur.getDay() === 0 || cur.getDay() === 6,
        isFirstOfMonth: isFirst,
        isMonday: cur.getDay() === 1,
        monthLabel: isFirst ? `${cur.getFullYear()}.${cur.getMonth() + 1}월` : undefined,
      });
      cur.setDate(cur.getDate() + 1);
    }

    return { dateRange: { start: startStr, end: endStr }, dayLabels: days, totalDays: days.length };
  }, []);

  // 범위 내 이벤트만 필터
  const visibleEvents = useMemo(() => {
    return events
      .filter((e) => e.endDate >= dateRange.start && e.startDate <= dateRange.end)
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
  }, [events, dateRange]);

  // 이벤트별 오프셋 & 폭 계산
  const rangeStartDate = parseDate(dateRange.start);
  const totalWidth = totalDays * DAY_WIDTH;
  const LABEL_WIDTH = 160; // 왼쪽 라벨 영역

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 월별 그룹 계산
  const months = useMemo(() => {
    const result: { label: string; span: number }[] = [];
    let curMonth = '';
    for (const d of dayLabels) {
      const pd = parseDate(d.date);
      const ml = `${pd.getFullYear()}.${pd.getMonth() + 1}월`;
      if (ml !== curMonth) {
        result.push({ label: ml, span: 1 });
        curMonth = ml;
      } else {
        result[result.length - 1].span++;
      }
    }
    return result;
  }, [dayLabels]);

  // 오늘 위치로 자동 스크롤
  useEffect(() => {
    const todayIdx = dayLabels.findIndex((d) => d.isToday);
    if (todayIdx >= 0 && scrollRef.current) {
      const scrollTo = todayIdx * DAY_WIDTH - scrollRef.current.clientWidth / 2;
      scrollRef.current.scrollLeft = Math.max(0, scrollTo);
    }
  }, [dayLabels]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-text-secondary/50">
        <CalendarDays size={36} className="mb-2 opacity-30" />
        <p className="text-sm">이벤트가 없습니다</p>
        <p className="text-[10px] mt-1">캘린더에서 이벤트를 추가해 보세요</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
      <div style={{ width: LABEL_WIDTH + totalWidth, minWidth: '100%' }}>
        {/* 월 라벨 헤더 */}
        <div className="flex">
          <div
            className="shrink-0 bg-bg-card border-r border-bg-border/20 z-20"
            style={{ width: LABEL_WIDTH, position: 'sticky', left: 0 }}
          />
          {months.map((m) => (
            <div
              key={m.label}
              className="shrink-0 text-center text-[10px] font-bold text-accent border-r-2 border-accent/30 py-1"
              style={{ width: m.span * DAY_WIDTH }}
            >
              {m.label}
            </div>
          ))}
        </div>

        {/* 날짜 헤더 */}
        <div className="flex border-b border-bg-border/30">
          <div
            className="shrink-0 bg-bg-card border-r border-bg-border/20 px-3 py-1 text-[10px] font-semibold text-text-secondary/60 z-20"
            style={{ width: LABEL_WIDTH, position: 'sticky', left: 0 }}
          >
            이벤트
          </div>
          {dayLabels.map((d) => (
            <div
              key={d.date}
              className={cn(
                'shrink-0 text-center text-[9px] py-1',
                d.isToday ? 'bg-accent/15 text-accent font-bold' : d.isWeekend ? 'bg-bg-border/8 text-text-secondary/40' : 'text-text-secondary/50',
                d.isFirstOfMonth && 'border-l-2 border-l-accent/40',
                d.isMonday && !d.isFirstOfMonth && 'border-l border-l-bg-border/30',
              )}
              style={{ width: DAY_WIDTH }}
              title={d.date}
            >
              {d.label}
            </div>
          ))}
        </div>

        {/* 이벤트 행 */}
        {visibleEvents.map((ev, i) => {
          const evStart = parseDate(ev.startDate < dateRange.start ? dateRange.start : ev.startDate);
          const evEnd = parseDate(ev.endDate > dateRange.end ? dateRange.end : ev.endDate);
          const offsetDays = Math.round((evStart.getTime() - rangeStartDate.getTime()) / 86400000);
          const spanDays = Math.round((evEnd.getTime() - evStart.getTime()) / 86400000) + 1;
          const hex = ev.color || EVENT_COLORS[0];

          return (
            <motion.div
              key={ev.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: i * 0.02 }}
              className="flex border-b border-bg-border/10 hover:bg-bg-border/5 transition-colors"
              style={{ height: 32 }}
            >
              {/* 왼쪽 라벨 (sticky) */}
              <div
                className="shrink-0 flex items-center gap-1.5 px-3 border-r border-bg-border/20 bg-bg-card cursor-pointer hover:bg-bg-border/10 z-20"
                style={{ width: LABEL_WIDTH, position: 'sticky', left: 0 }}
                onClick={() => setSelectedEvent(selectedEvent?.id === ev.id ? null : ev)}
              >
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: hex }} />
                <span className="text-[11px] text-text-primary truncate">{ev.title}</span>
              </div>
              {/* 바 영역 */}
              <div className="relative flex-1" style={{ width: totalWidth }}>
                <div
                  className="absolute top-1 h-5 rounded-md flex items-center px-1.5 text-[9px] font-medium truncate cursor-pointer hover:brightness-110"
                  style={{
                    left: offsetDays * DAY_WIDTH,
                    width: Math.max(spanDays * DAY_WIDTH - 2, 4),
                    background: `linear-gradient(135deg, ${hex}50 0%, ${hex}30 100%)`,
                    border: `1px solid ${hex}60`,
                    color: hex,
                  }}
                  onClick={() => setSelectedEvent(selectedEvent?.id === ev.id ? null : ev)}
                  title={`${ev.title}: ${ev.startDate} → ${ev.endDate}`}
                >
                  <span className="truncate">{ev.title}</span>
                </div>
                {/* 행 안의 세로선 */}
                {i === 0 && dayLabels.map((d, idx) => {
                  const isToday = d.isToday;
                  const isMonth = d.isFirstOfMonth;
                  const isWeek = d.isMonday && !d.isFirstOfMonth;
                  if (!isToday && !isMonth && !isWeek) return null;
                  return (
                    <div
                      key={`vl-${d.date}`}
                      className="absolute pointer-events-none"
                      style={{
                        left: idx * DAY_WIDTH,
                        top: 0,
                        height: visibleEvents.length * 32,
                        width: isToday ? 2 : isMonth ? 2 : 1,
                        backgroundColor: isToday
                          ? 'rgb(var(--color-accent))'
                          : isMonth
                            ? 'rgba(var(--color-accent), 0.35)'
                            : 'rgba(var(--color-bg-border), 0.25)',
                        zIndex: isToday ? 5 : isMonth ? 3 : 1,
                      }}
                    />
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </div>
      {/* 선택된 이벤트 상세 */}
      {selectedEvent && (
        <div className="border-t border-bg-border/30 px-4 py-3 bg-bg-primary/30">
          <div className="flex items-start gap-3">
            <div className="w-3 h-3 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: selectedEvent.color }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-primary">{selectedEvent.title}</div>
              <div className="text-[11px] text-text-secondary/60 mt-0.5">
                {selectedEvent.startDate} → {selectedEvent.endDate}
                {selectedEvent.linkedEpisode != null && ` · EP${String(selectedEvent.linkedEpisode).padStart(2, '0')}`}
                {selectedEvent.linkedPart && ` ${selectedEvent.linkedPart}파트`}
              </div>
              {selectedEvent.memo && (
                <div className="text-[11px] text-text-secondary/50 mt-1">{selectedEvent.memo}</div>
              )}
            </div>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
              style={{ backgroundColor: `${selectedEvent.color}20`, color: selectedEvent.color }}
            >
              {selectedEvent.type === 'custom' ? '일반' : selectedEvent.type.toUpperCase()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────
   메인 캘린더 뷰
   ──────────────────────────────────────────────── */
type CalViewMode = 'timeline' | 'heatmap' | 'gantt';

export function CalendarView() {
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const [viewMode, setViewMode] = useState<CalViewMode>('timeline');
  const [deptFilter, setDeptFilter] = useState<'all' | 'bg' | 'acting'>('all');

  const summary = useMemo(() => {
    const allScenes = episodes.flatMap((ep) => ep.parts.flatMap((p) => p.scenes));
    const total = allScenes.length;
    const done = allScenes.filter(isFullyDone).length;
    const pct = total > 0
      ? allScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / total
      : 0;
    return { total, done, pct, epCount: episodes.length };
  }, [episodes]);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-text-primary">프로젝트 타임라인</h1>
          <div className="flex items-center gap-2 text-xs text-text-secondary/50">
            <span>{summary.epCount}개 에피소드</span>
            <span className="text-bg-border/50">·</span>
            <span>{summary.done}/{summary.total} 완료</span>
            <span className="text-bg-border/50">·</span>
            <span className="tabular-nums font-medium" style={{ color: summary.pct >= 100 ? '#00B894' : undefined }}>
              {Math.round(summary.pct)}%
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 부서 필터 */}
          <div className="flex bg-bg-card rounded-lg p-0.5 border border-bg-border/50">
            {([['all', '전체'], ['bg', 'BG'], ['acting', 'ACT']] as const).map(([f, l]) => (
              <button
                key={f}
                onClick={() => setDeptFilter(f)}
                className={cn(
                  'px-3 py-1 text-xs rounded-md font-medium cursor-pointer transition-colors duration-150',
                  deptFilter === f
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {/* 뷰 모드 토글 */}
          <div className="flex bg-bg-card rounded-lg p-0.5 border border-bg-border/50">
            <button
              onClick={() => setViewMode('timeline')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium cursor-pointer',
                'transition-colors duration-150',
                viewMode === 'timeline'
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <BarChart3 size={13} />
              타임라인
            </button>
            <button
              onClick={() => setViewMode('heatmap')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium cursor-pointer',
                'transition-colors duration-150',
                viewMode === 'heatmap'
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <Layers size={13} />
              히트맵
            </button>
            <button
              onClick={() => setViewMode('gantt')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium cursor-pointer',
                'transition-colors duration-150',
                viewMode === 'gantt'
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <CalendarDays size={13} />
              간트
            </button>
          </div>
        </div>
      </div>

      {/* 전체 프로그레스 */}
      <div className="bg-bg-card rounded-xl border border-bg-border/40 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-secondary/50">전체 프로젝트 진행률</span>
          <span className="text-sm font-bold tabular-nums" style={{ color: pctColor(summary.pct) }}>
            {Math.round(summary.pct)}%
          </span>
        </div>
        <div className="h-3 rounded-full bg-bg-border/30 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{
              background: summary.pct >= 100
                ? 'linear-gradient(90deg, rgba(0,184,148,1) 0%, rgba(46,213,174,1) 40%, rgba(85,239,196,1) 100%)'
                : `linear-gradient(90deg, ${pctColor(summary.pct)} 0%, ${pctColor(Math.min(summary.pct + 30, 100))} 100%)`,
            }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(summary.pct, 100)}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'timeline' ? (
          episodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-text-secondary/50">
              <CalendarIcon size={40} className="mb-3 opacity-30" />
              <p className="text-sm">에피소드 데이터가 없습니다</p>
            </div>
          ) : (
            <div className="bg-bg-card rounded-xl border border-bg-border/40 p-4">
              <TimelineChart episodes={episodes} deptFilter={deptFilter} episodeTitles={episodeTitles} />
            </div>
          )
        ) : viewMode === 'heatmap' ? (
          episodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-text-secondary/50">
              <CalendarIcon size={40} className="mb-3 opacity-30" />
              <p className="text-sm">에피소드 데이터가 없습니다</p>
            </div>
          ) : (
            <ProgressHeatmap episodes={episodes} deptFilter={deptFilter} episodeTitles={episodeTitles} />
          )
        ) : (
          <div className="bg-bg-card rounded-xl border border-bg-border/40 overflow-hidden">
            <EventGanttChart />
          </div>
        )}
      </div>

      {/* 범례 */}
      <div className="flex items-center justify-center gap-4 py-2 text-[10px] text-text-secondary/50">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#FF6B6B' }} />
          <span>0~25%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#E17055' }} />
          <span>25~50%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#FDCB6E' }} />
          <span>50~75%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#00B894' }} />
          <span>75~100%</span>
        </div>
        {DEPARTMENTS.map((dept) => (
          <div key={dept} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: DEPARTMENT_CONFIGS[dept].color }} />
            <span>{DEPARTMENT_CONFIGS[dept].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
