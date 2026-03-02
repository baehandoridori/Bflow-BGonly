import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, X, Trash2,
  Palmtree, RefreshCw, CircleDashed, Loader2, CalendarDays,
} from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  fetchVacationStatus, fetchVacationLog, fetchAllVacationEvents,
  cancelVacationRequest,
} from '@/services/vacationService';
import { VacationRegisterModal } from '@/components/vacation/VacationRegisterModal';
import { DahyuGrantModal } from '@/components/vacation/DahyuGrantModal';
import { DahyuDeleteModal } from '@/components/vacation/DahyuDeleteModal';
import { VACATION_COLOR } from '@/types/vacation';
import type { VacationStatus, VacationLogEntry, VacationEvent } from '@/types/vacation';
import { cn } from '@/utils/cn';

/* ───────────── date helpers ───────────── */

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

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DAHYU_ADMINS = ['허혜원', '배한솔'] as const;
const TYPE_COLORS = ['#00B894', '#6C5CE7', '#FDCB6E', '#74B9FF', '#FD79A8'];

/* ───────────── event bar layout ───────────── */

interface EventBar {
  event: VacationEvent;
  row: number;
  startCol: number;
  span: number;
  isStart: boolean;
  isEnd: boolean;
}

function layoutEventBars(
  events: VacationEvent[],
  weekStart: Date,
  weekEnd: Date,
  cols: number,
): EventBar[] {
  const weekStartStr = fmtDate(weekStart);
  const weekEndStr = fmtDate(weekEnd);

  const relevant = events
    .filter((e) => e.endDate >= weekStartStr && e.startDate <= weekEndStr)
    .sort((a, b) => {
      const aSpan = Math.round((parseDate(a.endDate).getTime() - parseDate(a.startDate).getTime()) / 86400000) + 1;
      const bSpan = Math.round((parseDate(b.endDate).getTime() - parseDate(b.startDate).getTime()) / 86400000) + 1;
      const dSpan = bSpan - aSpan;
      if (dSpan !== 0) return dSpan;
      return a.startDate.localeCompare(b.startDate);
    });

  const rows: string[][] = [];
  const bars: EventBar[] = [];

  for (const ev of relevant) {
    const evStart = parseDate(ev.startDate);
    const evEnd = parseDate(ev.endDate);
    const clampStart = evStart < weekStart ? weekStart : evStart;
    const clampEnd = evEnd > weekEnd ? weekEnd : evEnd;

    const startCol = Math.round((clampStart.getTime() - weekStart.getTime()) / 86400000);
    const endCol = Math.round((clampEnd.getTime() - weekStart.getTime()) / 86400000);
    const span = endCol - startCol + 1;

    const evKey = `${ev.name}-${ev.startDate}-${ev.endDate}`;

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
      rows[placed][c] = evKey;
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

/* ───────────── sub-components ───────────── */

function StatBlock({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="text-center flex-1">
      <p className={cn('text-xl font-bold', accent || 'text-text-primary')}>{value}</p>
      <p className="text-[10px] text-text-secondary/50 mt-0.5">{label}</p>
    </div>
  );
}

/* ───────────── 부드러운 접기/펼치기 래퍼 ───────────── */

function CollapsibleContent({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] },
            opacity: { duration: 0.2, ease: 'easeInOut' },
          }}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────── 유형별 도넛 차트 ───────────── */

function TypeDonutCard({ entries, total, expanded, onToggle }: {
  entries: [string, number][]; total: number; expanded: boolean; onToggle: () => void;
}) {
  return (
    <div
      className="bg-bg-card/60 rounded-xl border border-bg-border/30 p-4 backdrop-blur-sm min-w-0"
      style={{ flexGrow: expanded ? 1 : 0, flexShrink: 0, flexBasis: 'auto', transition: 'flex-grow 0.3s cubic-bezier(0.25,0.1,0.25,1)' }}
    >
      <button onClick={onToggle} className="flex items-center gap-2 w-full cursor-pointer">
        <p className="text-[12px] font-semibold text-text-primary whitespace-nowrap">유형별 사용 현황</p>
        <ChevronDown size={12} className={cn('ml-auto text-text-secondary/40 transition-transform duration-200', expanded && 'rotate-180')} />
      </button>
      <CollapsibleContent expanded={expanded}>
        <div className="flex items-center gap-4 mt-3">
          <svg viewBox="0 0 36 36" className="w-16 h-16 shrink-0 -rotate-90">
            {(() => {
              let offset = 0;
              return entries.map(([type, days], i) => {
                const pct = (days / total) * 100;
                const dash = `${pct} ${100 - pct}`;
                const el = (
                  <circle
                    key={type}
                    cx="18" cy="18" r="15.9"
                    fill="none"
                    stroke={TYPE_COLORS[i % TYPE_COLORS.length]}
                    strokeWidth="3.5"
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                    strokeLinecap="round"
                    className="transition-all duration-500"
                  />
                );
                offset += pct;
                return el;
              });
            })()}
            <text x="18" y="19" textAnchor="middle" dominantBaseline="central"
              className="fill-text-primary" fontSize="7" fontWeight="700"
              transform="rotate(90 18 18)"
            >
              {total}
            </text>
          </svg>
          <div className="flex-1 space-y-1">
            {entries.map(([type, days], i) => (
              <div key={type} className="flex items-center gap-2 text-[11px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} />
                <span className="text-text-primary/80 flex-1">{type}</span>
                <span className="text-text-secondary/60">{days}일</span>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </div>
  );
}

/* ───────────── 월 요약 카드 ───────────── */

function MonthSummaryCard({ month, summary, expanded, onToggle }: {
  month: number; summary: { count: number; days: number; topType: string | null }; expanded: boolean; onToggle: () => void;
}) {
  return (
    <div
      className="bg-bg-card/60 rounded-xl border border-bg-border/30 p-4 backdrop-blur-sm min-w-0"
      style={{ flexGrow: expanded ? 1 : 0, flexShrink: 0, flexBasis: 'auto', transition: 'flex-grow 0.3s cubic-bezier(0.25,0.1,0.25,1)' }}
    >
      <button onClick={onToggle} className="flex items-center gap-2 w-full cursor-pointer">
        <p className="text-[12px] font-semibold text-text-primary whitespace-nowrap">{month + 1}월 요약</p>
        <ChevronDown size={12} className={cn('ml-auto text-text-secondary/40 transition-transform duration-200', expanded && 'rotate-180')} />
      </button>
      <CollapsibleContent expanded={expanded}>
        <div className="space-y-1 text-[12px] mt-3">
          <div className="flex items-center gap-2">
            <span className="text-text-primary font-bold text-lg">{summary.count}</span>
            <span className="text-text-secondary/60">건 등록</span>
          </div>
          <p className="text-text-secondary/70">{summary.days}일 사용</p>
          {summary.topType && (
            <p className="text-text-secondary/50 text-[11px]">주로 <span className="text-text-primary/80">{summary.topType}</span></p>
          )}
        </div>
      </CollapsibleContent>
    </div>
  );
}

/* ───────────── 휴가 삭제 모달 ───────────── */

function VacationDeleteListModal({
  open, onClose, vacLog, onDelete, cancellingRow,
}: {
  open: boolean;
  onClose: () => void;
  vacLog: VacationLogEntry[];
  onDelete: (rowIndex: number) => void;
  cancellingRow: number | null;
}) {
  const deletable = vacLog.filter((e) => e.state === '등록완료');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        className="bg-bg-card border border-bg-border rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border/50">
          <div className="flex items-center gap-2">
            <Trash2 size={16} className="text-red-400" />
            <h3 className="text-sm font-semibold text-text-primary">휴가 삭제</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-bg-border/50 cursor-pointer transition-colors">
            <X size={16} className="text-text-secondary" />
          </button>
        </div>

        <div className="px-5 py-4 max-h-[400px] overflow-y-auto">
          {deletable.length === 0 ? (
            <p className="text-xs text-text-secondary/50 text-center py-6">삭제할 수 있는 휴가가 없습니다</p>
          ) : (
            <div className="space-y-2">
              {deletable.map((entry) => {
                const dateRange = entry.startDate === entry.endDate
                  ? entry.startDate
                  : `${entry.startDate} ~ ${entry.endDate}`;
                const isCancelling = cancellingRow === entry.rowIndex;
                return (
                  <div
                    key={entry.rowIndex}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-bg-primary/40 border border-bg-border/20"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: VACATION_COLOR }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className="text-text-primary font-medium">{entry.type}</span>
                        <span className="text-text-secondary/50">{dateRange}</span>
                      </div>
                      {entry.reason && (
                        <p className="text-[10px] text-text-secondary/40 truncate mt-0.5">{entry.reason}</p>
                      )}
                    </div>
                    <button
                      onClick={() => onDelete(entry.rowIndex)}
                      disabled={isCancelling}
                      className={cn(
                        'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0 transition-colors cursor-pointer border',
                        isCancelling
                          ? 'bg-red-500/10 border-red-500/20 text-red-400/60 cursor-not-allowed'
                          : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20 hover:border-red-500/40',
                      )}
                    >
                      {isCancelling ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      삭제
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/* ───────────── main component ───────────── */

export function VacationView() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const vacationConnected = useAppStore((s) => s.vacationConnected);
  const setToast = useAppStore((s) => s.setToast);
  const setVacationCache = useAppStore((s) => s.setVacationCache);
  const invalidateVacationCache = useAppStore((s) => s.invalidateVacationCache);

  // 변경(등록/삭제) 후 캐시 유예 — 30초간 캐시 저장 안 함
  const mutationTimeRef = useRef(0);

  // ── 월 탐색 ──
  const todayStr = fmtDate(new Date());
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr);
  const [direction, setDirection] = useState(0);

  const goToday = () => {
    const now = new Date();
    setDirection(0);
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    setSelectedDate(fmtDate(now));
  };

  const goPrev = () => {
    setDirection(-1);
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };

  const goNext = () => {
    setDirection(1);
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };

  const handleDateClick = (dateStr: string) => {
    setSelectedDate((prev) => prev === dateStr ? null : dateStr);
  };

  // ── 캘린더 그리드 ──
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const days: { date: number; dateStr: string; isCurrentMonth: boolean; isToday: boolean; dow: number }[] = [];

    const prevMonthLast = new Date(year, month, 0).getDate();
    for (let i = startDow - 1; i >= 0; i--) {
      const d = prevMonthLast - i;
      const ds = fmtDate(new Date(year, month - 1, d));
      days.push({ date: d, dateStr: ds, isCurrentMonth: false, isToday: ds === todayStr, dow: days.length % 7 });
    }

    for (let d = 1; d <= totalDays; d++) {
      const ds = fmtDate(new Date(year, month, d));
      days.push({ date: d, dateStr: ds, isCurrentMonth: true, isToday: ds === todayStr, dow: days.length % 7 });
    }

    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const ds = fmtDate(new Date(year, month + 1, d));
      days.push({ date: d, dateStr: ds, isCurrentMonth: false, isToday: false, dow: days.length % 7 });
    }

    return days;
  }, [year, month, todayStr]);

  // ── 휴가 데이터 ──
  const [vacStatus, setVacStatus] = useState<VacationStatus | null>(null);
  const [vacLog, setVacLog] = useState<VacationLogEntry[]>([]);
  const [allEvents, setAllEvents] = useState<VacationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadMyData = useCallback(async (force = false) => {
    if (!currentUser || !vacationConnected) return;
    if (!force) {
      const cache = useAppStore.getState().vacationCache;
      if (cache && cache.userName === currentUser.name && Date.now() - cache.lastFetch < 300_000) {
        // mutation guard 기간에는 캐시도 적용하지 않음 (낙관적 값 유지)
        if (Date.now() - mutationTimeRef.current > 30_000) {
          setVacStatus(cache.status);
          setVacLog(cache.log);
        }
        return;
      }
    }
    setLoading(true);
    try {
      const [status, log] = await Promise.all([
        fetchVacationStatus(currentUser.name),
        fetchVacationLog(currentUser.name, new Date().getFullYear(), 20),
      ]);
      // 변경(등록/삭제) 직후 30초간은 낙관적 상태 유지 (서버 데이터가 아직 stale일 수 있음)
      if (Date.now() - mutationTimeRef.current > 30_000) {
        setVacStatus(status);
        setVacLog(log);
        setVacationCache({ userName: currentUser.name, status, log, lastFetch: Date.now() });
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [currentUser, vacationConnected, setVacationCache]);

  const loadEvents = useCallback(async () => {
    if (!vacationConnected) return;
    setEventsLoading(true);
    try {
      const events = await fetchAllVacationEvents(year);
      setAllEvents(events);
    } catch {
      // silently fail
    } finally {
      setEventsLoading(false);
    }
  }, [vacationConnected, year]);

  useEffect(() => { loadMyData(); }, [loadMyData]);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  // ── 이벤트 바 레이아웃 (주별) ──
  const weeklyBars = useMemo(() => {
    const result: Map<number, EventBar[]> = new Map();
    for (let weekIdx = 0; weekIdx < 6; weekIdx++) {
      const weekStart = parseDate(calendarDays[weekIdx * 7].dateStr);
      const weekEnd = parseDate(calendarDays[weekIdx * 7 + 6].dateStr);
      const bars = layoutEventBars(allEvents, weekStart, weekEnd, 7);
      result.set(weekIdx, bars);
    }
    return result;
  }, [calendarDays, allEvents]);

  // 선택된 날짜의 이벤트
  const selectedDateEvents = useMemo(() => {
    if (!selectedDate) return [];
    return allEvents.filter((e) => e.startDate <= selectedDate && e.endDate >= selectedDate);
  }, [allEvents, selectedDate]);

  // ── 휴가 유형별 사용 통계 ──
  const typeStats = useMemo(() => {
    const active = vacLog.filter((e) => e.state === '등록완료');
    const map = new Map<string, number>();
    for (const e of active) {
      const days = typeof e.days === 'number' ? e.days : parseFloat(e.days) || 1;
      map.set(e.type, (map.get(e.type) ?? 0) + days);
    }
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    return { entries, total };
  }, [vacLog]);

  // ── 다음 휴가 카운트다운 ──
  const nextVacation = useMemo(() => {
    const upcoming = vacLog
      .filter((e) => e.state === '등록완료' && e.startDate > todayStr)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (upcoming.length === 0) return null;
    const next = upcoming[0];
    const diff = Math.ceil((parseDate(next.startDate).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
    return { ...next, dday: diff };
  }, [vacLog, todayStr]);

  // ── 이번 달 요약 ──
  const monthSummary = useMemo(() => {
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const thisMonth = vacLog.filter((e) =>
      e.state === '등록완료' && e.startDate.startsWith(monthPrefix),
    );
    const totalDays = thisMonth.reduce((s, e) => {
      const d = typeof e.days === 'number' ? e.days : parseFloat(e.days) || 1;
      return s + d;
    }, 0);
    const typeCount = new Map<string, number>();
    for (const e of thisMonth) typeCount.set(e.type, (typeCount.get(e.type) ?? 0) + 1);
    const topType = [...typeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { count: thisMonth.length, days: totalDays, topType };
  }, [vacLog, year, month]);

  // ── 모달 상태 ──
  const [showVacModal, setShowVacModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDahyuModal, setShowDahyuModal] = useState(false);
  const [showDahyuDeleteModal, setShowDahyuDeleteModal] = useState(false);
  const [dahyuDropdownOpen, setDahyuDropdownOpen] = useState(false);
  const dahyuDropdownRef = useRef<HTMLDivElement>(null);
  const [cancellingRow, setCancellingRow] = useState<number | null>(null);
  const [logFilter, setLogFilter] = useState<'all' | '등록완료' | '처리중' | '취소'>('all');

  // ── 카드 접기/펼치기 ──
  const [expandTypeStats, setExpandTypeStats] = useState(true);
  const [expandMonthSummary, setExpandMonthSummary] = useState(true);
  const [expandCountdown, setExpandCountdown] = useState(true);

  const isDahyuAdmin = (DAHYU_ADMINS as readonly string[]).includes(currentUser?.name ?? '');

  useEffect(() => {
    if (!dahyuDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dahyuDropdownRef.current && !dahyuDropdownRef.current.contains(e.target as Node)) {
        setDahyuDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dahyuDropdownOpen]);

  /** 낙관적 일수 계산 */
  const calcDays = (type: string, start: string, end: string): number => {
    if (type === '오전반차' || type === '오후반차') return 0.5;
    const s = new Date(start), e = new Date(end);
    return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
  };

  const handleCancelVacation = async (rowIndex: number) => {
    if (!currentUser) return;
    setCancellingRow(rowIndex);

    // 낙관적 로그 업데이트
    const prevLog = [...vacLog];
    const prevStatus = vacStatus ? { ...vacStatus } : null;
    const prevEvents = [...allEvents];
    setVacLog((prev) => prev.map((e) =>
      e.rowIndex === rowIndex ? { ...e, state: '취소' } : e,
    ));

    // 낙관적 상태 업데이트 (일수 복원)
    const entry = vacLog.find(e => e.rowIndex === rowIndex);
    if (entry && vacStatus) {
      const days = typeof entry.days === 'number' ? entry.days : parseFloat(String(entry.days)) || 1;
      const isAnnual = entry.type === '연차' || entry.type === '오전반차' || entry.type === '오후반차';
      const isDahyu = entry.type === '대체휴가';
      setVacStatus(prev => prev ? {
        ...prev,
        usedDays: isAnnual ? prev.usedDays - days : prev.usedDays,
        remainingDays: isAnnual ? prev.remainingDays + days : prev.remainingDays,
        altVacationUsed: isDahyu ? prev.altVacationUsed - days : prev.altVacationUsed,
        altVacationNet: isDahyu ? prev.altVacationNet + days : prev.altVacationNet,
        validUseCount: (prev.validUseCount ?? 1) - 1,
      } : prev);

      // 캘린더에서 해당 이벤트 제거
      setAllEvents(prev => prev.filter(ev =>
        !(ev.name === currentUser.name && ev.startDate === entry.startDate && ev.endDate === entry.endDate && ev.type === entry.type),
      ));
    }

    // 스피너 즉시 해제, 백그라운드 API 호출
    mutationTimeRef.current = Date.now();
    setCancellingRow(null);
    setSyncing(false);

    try {
      const result = await cancelVacationRequest(currentUser.name, rowIndex);
      if (result.ok && result.success) {
        setToast({ message: '휴가가 취소되었습니다', type: 'success' });
        invalidateVacationCache();
        // 8초 후 실제 데이터 갱신 (GAS 전파 대기)
        setTimeout(async () => {
          try { await Promise.all([loadMyData(true), loadEvents()]); } catch { /* silent */ }
        }, 8000);
      } else {
        // 롤백
        setVacLog(prevLog);
        setVacStatus(prevStatus);
        setAllEvents(prevEvents);
        setToast({ message: '취소 실패: ' + (result.error || '알 수 없는 오류'), type: 'critical' });
      }
    } catch (err) {
      // 롤백
      setVacLog(prevLog);
      setVacStatus(prevStatus);
      setAllEvents(prevEvents);
      setToast({ message: '취소 실패: ' + (err instanceof Error ? err.message : '알 수 없는 오류'), type: 'critical' });
    }
  };

  const handleVacSubmitStart = (data: { type: string; startDate: string; endDate: string }) => {
    mutationTimeRef.current = Date.now();

    // 낙관적 상태 업데이트
    if (vacStatus) {
      const days = calcDays(data.type, data.startDate, data.endDate);
      const isAnnual = data.type === '연차' || data.type === '오전반차' || data.type === '오후반차';
      const isDahyu = data.type === '대체휴가';
      setVacStatus(prev => prev ? {
        ...prev,
        usedDays: isAnnual ? prev.usedDays + days : prev.usedDays,
        remainingDays: isAnnual ? prev.remainingDays - days : prev.remainingDays,
        overuse: isAnnual ? (prev.remainingDays - days) < 0 : prev.overuse,
        altVacationUsed: isDahyu ? prev.altVacationUsed + days : prev.altVacationUsed,
        altVacationNet: isDahyu ? prev.altVacationNet - days : prev.altVacationNet,
        specialVacationUsed: data.type === '특별휴가' ? prev.specialVacationUsed + 1 : prev.specialVacationUsed,
        totalUseCount: prev.totalUseCount + 1,
        validUseCount: (prev.validUseCount ?? 0) + 1,
      } : prev);
    }

    // 캘린더에 낙관적 이벤트 추가
    if (currentUser) {
      setAllEvents(prev => [...prev, { name: currentUser.name, type: data.type, startDate: data.startDate, endDate: data.endDate }]);
    }
  };

  const handleVacSuccess = async () => {
    invalidateVacationCache();
    // 30초 guard 해제 → 서버 데이터로 상태 갱신
    mutationTimeRef.current = 0;
    try {
      await Promise.all([loadMyData(true), loadEvents()]);
    } catch { /* silent */ }
  };

  const remainingColor = vacStatus
    ? vacStatus.remainingDays >= 5 ? 'text-emerald-400'
    : vacStatus.remainingDays >= 3 ? 'text-amber-400'
    : 'text-red-400'
    : 'text-text-secondary';

  // ── 초과 사용 경고 ──
  const overuseAlerted = useRef(false);
  useEffect(() => {
    if (!vacStatus) return;
    const isOveruse = vacStatus.overuse || vacStatus.altVacationNet < 0;
    if (!isOveruse) { overuseAlerted.current = false; return; }
    if (overuseAlerted.current) return;
    overuseAlerted.current = true;
    if (vacStatus.overuse) {
      setToast({ message: `연차가 초과 사용되었습니다. 잔여: ${vacStatus.remainingDays}일`, type: 'warning' });
    } else if (vacStatus.altVacationNet < 0) {
      setToast({ message: '대체휴가가 초과 사용되었습니다.', type: 'warning' });
    }
  }, [vacStatus, setToast]);

  // ── 미연동 상태 ──
  if (!vacationConnected) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-center h-full"
      >
        <div className="text-center">
          <Palmtree size={48} className="text-text-secondary/20 mx-auto mb-4" />
          <p className="text-text-secondary/60 text-sm">휴가 연동이 필요합니다</p>
          <p className="text-text-secondary/40 text-xs mt-1">설정 → 연동에서 휴가 API URL을 등록하세요</p>
        </div>
      </motion.div>
    );
  }

  const monthKey = `${year}-${month}`;
  const hasTypeStats = vacStatus?.found && typeStats.total > 0;
  const hasMonthSummary = monthSummary.count > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="h-full flex flex-col overflow-hidden"
    >
      {/* ════════ 동기화 로딩 바 ════════ */}
      {syncing && (
        <div className="shrink-0 h-0.5 w-full bg-bg-border/30 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: VACATION_COLOR }}
            initial={{ x: '-100%', width: '40%' }}
            animate={{ x: '250%' }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
      )}

      {/* ════════ 헤더 바 ════════ */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-bg-border/50">
        <div className="flex items-center gap-3">
          <button onClick={goPrev} className="p-1.5 rounded-lg hover:bg-bg-border/50 transition-colors cursor-pointer">
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-base font-bold text-text-primary min-w-[120px] text-center">
            {year}년 {month + 1}월
          </h2>
          <button onClick={goNext} className="p-1.5 rounded-lg hover:bg-bg-border/50 transition-colors cursor-pointer">
            <ChevronRight size={18} />
          </button>
          <button
            onClick={goToday}
            className="ml-1 px-3 py-1 rounded-lg text-xs font-medium bg-bg-border/30 hover:bg-bg-border/60 text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            오늘
          </button>
          {eventsLoading && <CircleDashed size={14} className="text-accent animate-spin ml-2" />}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowVacModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-white transition-colors cursor-pointer hover:brightness-110"
            style={{ background: VACATION_COLOR }}
          >
            <Plus size={14} />
            휴가 신청
          </button>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors cursor-pointer"
          >
            <Trash2 size={14} />
            휴가 삭제
          </button>
          {isDahyuAdmin && (
            <div ref={dahyuDropdownRef} className="relative">
              <button
                onClick={() => setDahyuDropdownOpen(!dahyuDropdownOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/20 rounded-lg text-xs text-amber-400 font-medium transition-colors cursor-pointer"
              >
                관리
                <ChevronDown size={10} className={cn('transition-transform', dahyuDropdownOpen && 'rotate-180')} />
              </button>
              {dahyuDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-40 bg-bg-card border border-bg-border rounded-xl shadow-2xl overflow-hidden z-[50]">
                  <button
                    onClick={() => { setShowDahyuModal(true); setDahyuDropdownOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-border/50 transition-colors cursor-pointer"
                  >
                    <Plus size={12} className="text-emerald-400" />
                    대체휴가 지급
                  </button>
                  <button
                    onClick={() => { setShowDahyuDeleteModal(true); setDahyuDropdownOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-bg-border/50 transition-colors cursor-pointer"
                  >
                    <X size={12} />
                    대체휴가 삭제
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ════════ 메인 2컬럼 ════════ */}
      <div className="flex-1 flex overflow-hidden">

        {/* ──── 좌측: 풀사이즈 캘린더 (65%) ──── */}
        <div className="flex-[65] flex flex-col min-w-0 border-r border-bg-border/30">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 shrink-0 border-b border-bg-border/30">
            {WEEKDAYS.map((d, i) => (
              <div
                key={d}
                className={cn(
                  'text-center py-2 text-xs font-medium',
                  i === 0 ? 'text-red-400/70' : i === 6 ? 'text-blue-400/70' : 'text-text-secondary/50',
                )}
              >
                {d}
              </div>
            ))}
          </div>

          {/* 캘린더 그리드 */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={monthKey}
              initial={{ opacity: 0, x: direction * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -40 }}
              transition={{ duration: 0.2 }}
              className="flex-1 grid grid-rows-6"
            >
              {Array.from({ length: 6 }).map((_, weekIdx) => {
                const weekDays = calendarDays.slice(weekIdx * 7, weekIdx * 7 + 7);
                const bars = weeklyBars.get(weekIdx) ?? [];

                return (
                  <div key={weekIdx} className="grid grid-cols-7 border-b border-bg-border/20 relative min-h-0">
                    {weekDays.map((day) => {
                      const isSelected = selectedDate !== null && day.dateStr === selectedDate;
                      const hasEvent = allEvents.some((e) => e.startDate <= day.dateStr && e.endDate >= day.dateStr);

                      return (
                        <button
                          key={day.dateStr}
                          onClick={() => handleDateClick(day.dateStr)}
                          className={cn(
                            'relative flex flex-col items-start p-1 cursor-pointer transition-colors duration-150',
                            'hover:bg-bg-border/20',
                            !day.isCurrentMonth && 'opacity-30',
                            isSelected && 'bg-accent/8',
                          )}
                        >
                          <span className={cn(
                            'text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full',
                            day.isToday && 'bg-accent text-white',
                            isSelected && !day.isToday && 'ring-1 ring-accent/50',
                            day.dow === 0 && !day.isToday ? 'text-red-400/80' :
                            day.dow === 6 && !day.isToday ? 'text-blue-400/80' :
                            !day.isToday ? 'text-text-primary/80' : '',
                          )}>
                            {day.date}
                          </span>
                          {hasEvent && !day.isToday && (
                            <span
                              className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                              style={{ background: VACATION_COLOR }}
                            />
                          )}
                        </button>
                      );
                    })}

                    {/* 이벤트 바 오버레이 */}
                    {bars.map((bar, bi) => {
                      const left = `${(bar.startCol / 7) * 100}%`;
                      const width = `${(bar.span / 7) * 100}%`;
                      const top = `${28 + bar.row * 22}px`;
                      const label = bar.event.type === '연차'
                        ? bar.event.name
                        : `${bar.event.name} ${bar.event.type}`;

                      return (
                        <div
                          key={`${bar.event.name}-${bar.event.startDate}-${bi}`}
                          className="absolute overflow-hidden pointer-events-none z-10"
                          style={{ left, width, top, height: '18px', padding: '0 1px' }}
                        >
                          <div
                            className={cn(
                              'h-full flex items-center px-1.5 text-[10px] font-medium text-white/90 truncate',
                              bar.isStart && 'rounded-l-md',
                              bar.isEnd && 'rounded-r-md',
                            )}
                            style={{ background: `${VACATION_COLOR}cc` }}
                          >
                            {bar.isStart && label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ──── 우측: 사이드 패널 (35%) ──── */}
        <div className="flex-[35] flex flex-col min-w-0 overflow-y-auto p-4 gap-4">

          {/* ── 나의 휴가 현황 ── */}
          <div className="bg-bg-card/60 rounded-xl border border-bg-border/30 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-3">
              <Palmtree size={15} className="text-emerald-400" />
              <span className="text-[13px] font-semibold text-text-primary">나의 휴가 현황</span>
              {!loading && (
                <button onClick={() => loadMyData(true)} className="ml-auto p-1 text-text-secondary/30 hover:text-text-primary cursor-pointer transition-colors">
                  <RefreshCw size={12} />
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex items-center gap-2 py-4 justify-center">
                <CircleDashed size={14} className="text-accent animate-spin" />
                <p className="text-xs text-text-secondary/50">조회 중...</p>
              </div>
            ) : vacStatus?.found ? (
              <>
                <div className="flex items-center divide-x divide-bg-border/20 mb-2">
                  <StatBlock label="총 연차" value={`${vacStatus.totalDays}일`} />
                  <StatBlock
                    label="사용"
                    value={vacStatus.validUseCount != null ? `${vacStatus.usedDays}일 (${vacStatus.validUseCount}회)` : `${vacStatus.usedDays}일`}
                    accent="text-text-secondary/70"
                  />
                  <StatBlock label="잔여" value={`${vacStatus.remainingDays}일`} accent={remainingColor} />
                </div>

                {(vacStatus.altVacationHeld > 0 || vacStatus.altVacationUsed > 0 || vacStatus.specialVacationUsed > 0) && (
                  <div className="flex items-center gap-4 text-[11px] text-text-secondary/60 mt-1">
                    {(vacStatus.altVacationHeld > 0 || vacStatus.altVacationUsed > 0) && (
                      <span>
                        대체휴가{' '}
                        <span className={vacStatus.altVacationHeld === 0 ? 'text-amber-400' : 'text-text-primary/80'}>{vacStatus.altVacationHeld}일</span>
                        {' · 사용 '}{vacStatus.altVacationUsed}일
                        {' · '}
                        <span className={vacStatus.altVacationNet <= 0 ? 'text-amber-400' : 'text-emerald-400'}>
                          잔여 {vacStatus.altVacationNet}일
                        </span>
                      </span>
                    )}
                    {vacStatus.specialVacationUsed > 0 && <span>특별휴가 {vacStatus.specialVacationUsed}회</span>}
                  </div>
                )}

                {vacStatus.altVacationNet < 0 && (
                  <div className="px-3 py-1.5 mt-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[11px] text-amber-400">
                    대체휴가가 초과 사용되었습니다
                  </div>
                )}
                {vacStatus.overuse && (
                  <div className="px-3 py-1.5 mt-2 bg-red-500/10 border border-red-500/30 rounded-lg text-[11px] text-red-400">
                    연차가 초과 사용되었습니다
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 py-2">
                <CircleDashed size={14} className="text-text-secondary/40" />
                <p className="text-xs text-text-secondary/50">직원 정보를 찾을 수 없습니다</p>
              </div>
            )}
          </div>

          {/* ── 유형별 통계 + 월 요약 (항상 가로 배치) ── */}
          {(hasTypeStats || hasMonthSummary) && (
            <div className="flex gap-4">
              {hasTypeStats && (
                <TypeDonutCard entries={typeStats.entries} total={typeStats.total} expanded={expandTypeStats} onToggle={() => setExpandTypeStats((v) => !v)} />
              )}
              {hasMonthSummary && (
                <MonthSummaryCard month={month} summary={monthSummary} expanded={expandMonthSummary} onToggle={() => setExpandMonthSummary((v) => !v)} />
              )}
            </div>
          )}

          {/* ── 다음 휴가 카운트다운 ── */}
          {nextVacation && (
            <div className="bg-bg-card/60 rounded-xl border border-bg-border/30 p-4 backdrop-blur-sm">
              <button onClick={() => setExpandCountdown((v) => !v)} className="flex items-center gap-2 w-full cursor-pointer">
                <p className="text-[12px] font-semibold text-text-primary">다음 휴가까지</p>
                <span className="text-[11px] font-bold ml-1" style={{ color: VACATION_COLOR }}>D-{nextVacation.dday}</span>
                <ChevronDown size={12} className={cn('ml-auto text-text-secondary/40 transition-transform duration-200', expandCountdown && 'rotate-180')} />
              </button>
              <CollapsibleContent expanded={expandCountdown}>
                <div className="flex items-center gap-3 mt-3">
                  <div
                    className="w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0"
                    style={{ background: `${VACATION_COLOR}20`, border: `1px solid ${VACATION_COLOR}40` }}
                  >
                    <span className="text-lg font-bold" style={{ color: VACATION_COLOR }}>
                      {nextVacation.dday}
                    </span>
                    <span className="text-[8px] font-medium text-text-secondary/60 -mt-0.5">D-day</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-text-secondary/60 truncate">
                      {nextVacation.type} · {nextVacation.startDate === nextVacation.endDate
                        ? nextVacation.startDate
                        : `${nextVacation.startDate} ~ ${nextVacation.endDate}`}
                    </p>
                    {nextVacation.reason && (
                      <p className="text-[10px] text-text-secondary/40 truncate mt-0.5">{nextVacation.reason}</p>
                    )}
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          )}

          {/* ── 선택 날짜 상세 (날짜 선택 시에만 표시) ── */}
          <AnimatePresence mode="wait">
            {selectedDate && (
              <motion.div
                key={selectedDate}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="bg-bg-card/60 rounded-xl border border-bg-border/30 p-4 backdrop-blur-sm"
              >
                <div className="flex items-center gap-2 mb-3">
                  <CalendarDays size={15} className="text-accent" />
                  <span className="text-[13px] font-semibold text-text-primary">
                    {(() => {
                      const d = parseDate(selectedDate);
                      return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
                    })()}
                    {selectedDate === todayStr && (
                      <span className="ml-1.5 text-[10px] text-accent font-normal">오늘</span>
                    )}
                  </span>
                  <button
                    onClick={() => setSelectedDate(null)}
                    className="ml-auto p-0.5 rounded hover:bg-bg-border/50 cursor-pointer transition-colors"
                  >
                    <X size={12} className="text-text-secondary/40" />
                  </button>
                </div>

                {selectedDateEvents.length === 0 ? (
                  <p className="text-xs text-text-secondary/40 py-2">이 날짜에 휴가가 없습니다</p>
                ) : (
                  <div className="space-y-1.5">
                    {selectedDateEvents.map((ev, i) => (
                      <div
                        key={`${ev.name}-${ev.startDate}-${i}`}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-border/20 transition-colors duration-200"
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: VACATION_COLOR }}
                        />
                        <span className="text-sm font-medium text-text-primary">{ev.name}</span>
                        <span className="text-xs text-text-secondary/60">{ev.type}</span>
                        {ev.startDate !== ev.endDate && (
                          <span className="text-[10px] text-text-secondary/40 ml-auto">
                            {ev.startDate} ~ {ev.endDate}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── 내 휴가 내역 ── */}
          <div className="bg-bg-card/60 rounded-xl border border-bg-border/30 p-4 backdrop-blur-sm flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-2 mb-2 shrink-0">
              <Palmtree size={15} className="text-emerald-400" />
              <span className="text-[13px] font-semibold text-text-primary">내 휴가 내역</span>
              <span className="text-[10px] text-text-secondary/40 ml-auto">{new Date().getFullYear()}년</span>
            </div>

            {/* 필터 칩 */}
            <div className="flex gap-1 mb-2 shrink-0">
              {([
                { key: 'all', label: '전체' },
                { key: '등록완료', label: '등록완료' },
                { key: '처리중', label: '처리중' },
                { key: '취소', label: '취소' },
              ] as const).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setLogFilter(f.key)}
                  className={cn(
                    'px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors cursor-pointer border',
                    logFilter === f.key
                      ? f.key === '등록완료' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : f.key === '취소' ? 'bg-red-500/15 text-red-400 border-red-500/30'
                      : f.key === '처리중' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      : 'bg-accent/15 text-accent border-accent/30'
                      : 'bg-bg-border/20 text-text-secondary/50 border-bg-border/30 hover:text-text-primary hover:bg-bg-border/40',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto space-y-1">
              {vacLog.length === 0 ? (
                <p className="text-[11px] text-text-secondary/40 py-2 text-center">올해 휴가 내역이 없습니다</p>
              ) : (() => {
                const filtered = logFilter === 'all'
                  ? vacLog
                  : vacLog.filter((e) => (e.state || '처리중') === logFilter);
                return filtered.length === 0 ? (
                  <p className="text-[11px] text-text-secondary/40 py-2 text-center">해당 상태의 내역이 없습니다</p>
                ) : filtered.map((entry) => {
                  const isCancelled = entry.state === '취소';
                  const isActive = entry.state === '등록완료';
                  const dateRange = entry.startDate === entry.endDate
                    ? entry.startDate
                    : `${entry.startDate} ~ ${entry.endDate}`;
                  return (
                    <div
                      key={entry.rowIndex}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px]',
                        isCancelled && 'opacity-50',
                      )}
                    >
                      <span className={cn(
                        'px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0',
                        isActive ? 'bg-emerald-500/15 text-emerald-400' :
                        isCancelled ? 'bg-red-500/15 text-red-400' :
                        'bg-amber-500/15 text-amber-400',
                      )}>
                        {entry.state || '처리중'}
                      </span>
                      <span className="text-text-primary/80 font-medium shrink-0">{entry.type}</span>
                      <span className="text-text-secondary/50 truncate flex-1">{dateRange}</span>
                      {entry.reason && (
                        <span className="text-text-secondary/30 truncate max-w-[80px]">{entry.reason}</span>
                      )}
                      {isActive && (
                        <button
                          onClick={() => handleCancelVacation(entry.rowIndex)}
                          disabled={cancellingRow === entry.rowIndex}
                          className={cn(
                            'ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium shrink-0 transition-colors cursor-pointer border',
                            cancellingRow === entry.rowIndex
                              ? 'bg-red-500/10 border-red-500/20 text-red-400/60 cursor-not-allowed'
                              : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20 hover:border-red-500/40',
                          )}
                        >
                          {cancellingRow === entry.rowIndex
                            ? <Loader2 size={10} className="animate-spin" />
                            : <X size={10} />
                          }
                          취소
                        </button>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* ════════ 모달 ════════ */}
      {currentUser && (
        <VacationRegisterModal
          open={showVacModal}
          onClose={() => setShowVacModal(false)}
          userName={currentUser.name}
          initialDate={selectedDate ?? undefined}
          onSubmitStart={handleVacSubmitStart}
          onSubmitEnd={() => {
            // 실패 → guard 해제 → 서버 데이터로 낙관적 상태 복원
            mutationTimeRef.current = 0;
            loadMyData(true);
            loadEvents();
          }}
          onSuccess={handleVacSuccess}
        />
      )}

      <VacationDeleteListModal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        vacLog={vacLog}
        onDelete={handleCancelVacation}
        cancellingRow={cancellingRow}
      />

      {isDahyuAdmin && (
        <>
          <DahyuGrantModal
            open={showDahyuModal}
            onClose={() => setShowDahyuModal(false)}
            onSuccess={handleVacSuccess}
          />
          <DahyuDeleteModal
            open={showDahyuDeleteModal}
            onClose={() => setShowDahyuDeleteModal(false)}
            onSuccess={handleVacSuccess}
          />
        </>
      )}
    </motion.div>
  );
}
