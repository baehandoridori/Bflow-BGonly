import { useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Calendar as CalendarIcon, ChevronRight, ChevronLeft, Layers, BarChart3 } from 'lucide-react';
import { useDataStore } from '@/stores/useDataStore';
import { sceneProgress, isFullyDone } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS, DEPARTMENTS } from '@/types';
import type { Episode, Department } from '@/types';
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
   간트 바 데이터
   ──────────────────────────────────────────────── */
interface GanttRow {
  id: string;
  label: string;
  subLabel?: string;
  department?: Department;
  pct: number;
  totalScenes: number;
  fullyDone: number;
  depth: number; // 0=에피소드, 1=파트
}

function buildGanttRows(episodes: Episode[]): GanttRow[] {
  const rows: GanttRow[] = [];

  for (const ep of episodes) {
    const allScenes = ep.parts.flatMap((p) => p.scenes);
    const totalScenes = allScenes.length;
    const fullyDone = allScenes.filter(isFullyDone).length;
    const epPct = totalScenes > 0
      ? allScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / totalScenes
      : 0;

    rows.push({
      id: `ep-${ep.episodeNumber}`,
      label: ep.title,
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
   간트 차트 뷰
   ──────────────────────────────────────────────── */
function GanttChart({ episodes }: { episodes: Episode[] }) {
  const rows = useMemo(() => buildGanttRows(episodes), [episodes]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((epId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(epId)) next.delete(epId);
      else next.add(epId);
      return next;
    });
  }, []);

  // 어떤 에피소드에 속하는 파트인지
  const visibleRows = useMemo(() => {
    const result: GanttRow[] = [];
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
              className={cn('shrink-0 flex items-center gap-1.5', isEp ? 'w-28' : 'w-28')}
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

            {/* 간트 바 */}
            <div className="flex-1 h-6 rounded bg-bg-border/20 overflow-hidden relative">
              <motion.div
                className="absolute inset-y-0 left-0 rounded"
                style={{ backgroundColor: pctColor(pct) }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(pct, 100)}%` }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: i * 0.02 }}
              >
                {/* 내부 라벨 */}
                {pct >= 15 && (
                  <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium text-white/80 truncate">
                    {row.fullyDone}/{row.totalScenes} 완료
                  </span>
                )}
              </motion.div>
              {/* 외부 라벨 */}
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
   진행 현황 히트맵 (월간 캘린더 스타일)
   ──────────────────────────────────────────────── */
function ProgressHeatmap({ episodes }: { episodes: Episode[] }) {
  // 에피소드 × 파트 매트릭스를 히트맵 형태로 표시
  const cells = useMemo(() => {
    return episodes.flatMap((ep) =>
      ep.parts.map((part) => {
        const scenes = part.scenes;
        const pct = scenes.length > 0
          ? scenes.reduce((sum, s) => sum + sceneProgress(s), 0) / scenes.length
          : 0;
        return {
          key: `${ep.episodeNumber}-${part.partId}-${part.department}`,
          epTitle: ep.title,
          partId: part.partId,
          department: part.department,
          pct,
          scenes: scenes.length,
          done: scenes.filter(isFullyDone).length,
        };
      }),
    );
  }, [episodes]);

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
   월간 캘린더
   ──────────────────────────────────────────────── */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function MonthlyCalendar({ episodes }: { episodes: Episode[] }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth()); // 0-based

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay(); // 0=일요일
    const totalDays = lastDay.getDate();

    // 이전 달 채우기
    const prevMonthLast = new Date(year, month, 0).getDate();
    const days: { date: number; month: number; year: number; isCurrentMonth: boolean; isToday: boolean; dow: number }[] = [];

    for (let i = startDow - 1; i >= 0; i--) {
      const d = prevMonthLast - i;
      days.push({ date: d, month: month - 1, year, isCurrentMonth: false, isToday: false, dow: days.length % 7 });
    }

    for (let d = 1; d <= totalDays; d++) {
      const isToday = `${year}-${month + 1}-${d}` === todayStr;
      days.push({ date: d, month, year, isCurrentMonth: true, isToday, dow: days.length % 7 });
    }

    // 다음 달 채우기 (6행 채우기)
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      days.push({ date: d, month: month + 1, year, isCurrentMonth: false, isToday: false, dow: days.length % 7 });
    }

    return days;
  }, [year, month, todayStr]);

  // 전체 통계 (간단한 표시용)
  const stats = useMemo(() => {
    const allScenes = episodes.flatMap((ep) => ep.parts.flatMap((p) => p.scenes));
    const total = allScenes.length;
    const done = allScenes.filter(isFullyDone).length;
    const pct = total > 0 ? Math.round(allScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / total) : 0;
    return { total, done, pct, remaining: total - done };
  }, [episodes]);

  const monthLabel = `${year}년 ${month + 1}월`;

  const goToPrevMonth = () => {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
  };
  const goToNextMonth = () => {
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
  };
  const goToToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 캘린더 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevMonth}
            className="p-1.5 rounded-lg hover:bg-bg-border/30 text-text-secondary/60 hover:text-text-primary transition-colors cursor-pointer"
          >
            <ChevronLeft size={16} />
          </button>
          <h2 className="text-base font-semibold text-text-primary min-w-[100px] text-center">
            {monthLabel}
          </h2>
          <button
            onClick={goToNextMonth}
            className="p-1.5 rounded-lg hover:bg-bg-border/30 text-text-secondary/60 hover:text-text-primary transition-colors cursor-pointer"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={goToToday}
            className="ml-2 px-2.5 py-1 text-[10px] rounded-md bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer font-medium"
          >
            오늘
          </button>
        </div>

        {/* 간단 통계 */}
        <div className="flex items-center gap-4 text-xs text-text-secondary/50">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-status-high" />
            <span>완료 {stats.done}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-accent" />
            <span>남은 씬 {stats.remaining}</span>
          </div>
          <span className="tabular-nums font-medium" style={{ color: stats.pct >= 100 ? '#00B894' : undefined }}>
            전체 {stats.pct}%
          </span>
        </div>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-px">
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

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-px bg-bg-border/15 rounded-xl overflow-hidden border border-bg-border/30">
        {calendarDays.map((day, i) => (
          <div
            key={i}
            className={cn(
              'min-h-[72px] p-2 bg-bg-primary/50 transition-colors duration-100',
              day.isCurrentMonth ? 'hover:bg-bg-border/15' : 'opacity-30',
              day.isToday && 'bg-accent/8',
            )}
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  'text-xs tabular-nums',
                  day.isToday
                    ? 'bg-accent text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold'
                    : day.dow === 0 ? 'text-red-400/70'
                    : day.dow === 6 ? 'text-blue-400/70'
                    : day.isCurrentMonth ? 'text-text-primary/60' : 'text-text-secondary/45',
                )}
              >
                {day.date}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   메인 캘린더 뷰
   ──────────────────────────────────────────────── */
type CalViewMode = 'gantt' | 'heatmap' | 'calendar';

export function CalendarView() {
  const episodes = useDataStore((s) => s.episodes);
  const [viewMode, setViewMode] = useState<CalViewMode>('gantt');

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

        {/* 뷰 모드 토글 */}
        <div className="flex bg-bg-card rounded-lg p-0.5 border border-bg-border/50">
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
            <BarChart3 size={13} />
            간트
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
            onClick={() => setViewMode('calendar')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium cursor-pointer',
              'transition-colors duration-150',
              viewMode === 'calendar'
                ? 'bg-accent/20 text-accent'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <CalendarIcon size={13} />
            캘린더
          </button>
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
        {episodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-text-secondary/50">
            <CalendarIcon size={40} className="mb-3 opacity-30" />
            <p className="text-sm">에피소드 데이터가 없습니다</p>
          </div>
        ) : viewMode === 'gantt' ? (
          <div className="bg-bg-card rounded-xl border border-bg-border/40 p-4">
            <GanttChart episodes={episodes} />
          </div>
        ) : viewMode === 'heatmap' ? (
          <ProgressHeatmap episodes={episodes} />
        ) : (
          <div className="bg-bg-card rounded-xl border border-bg-border/40 p-4">
            <MonthlyCalendar episodes={episodes} />
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
