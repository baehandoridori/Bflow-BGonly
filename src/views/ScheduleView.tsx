import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus,
  Palmtree,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import {
  getEvents, loadBflowEvents, addEvent, updateEvent, deleteEvent,
} from '@/services/calendarService';
import { fetchAllVacationEvents } from '@/services/vacationService';
import { useCalendarDnD } from '@/hooks/useCalendarDnD';
import type { DragMode } from '@/hooks/useCalendarDnD';
import type {
  CalendarEvent, CalendarViewMode, CalendarFilter,
} from '@/types/calendar';
import { mapVacationEvents } from '@/utils/vacationEvents';
import { MiniCalendar } from '@/components/calendar/MiniCalendar';
import { EventSidePanel } from '@/components/calendar/EventSidePanel';
import { EventQuickEdit } from '@/components/calendar/EventQuickEdit';
import { CalendarGrid } from '@/components/calendar/CalendarGrid';
import { EventCreateModal } from '@/components/calendar/EventCreateModal';
import WeekScrollView, { generateYearWeeks, findWeekIndexForDate } from '@/components/calendar/WeekScrollView';
import WeekSidebar from '@/components/calendar/WeekSidebar';
import DayScrollView from '@/components/calendar/DayScrollView';
import DaySidebar from '@/components/calendar/DaySidebar';
import { useCalendarDragCreate } from '@/hooks/useCalendarDragCreate';
import { navigateToSceneView } from '@/utils/sceneNavigationAction';
import { createUuid } from '@/utils/createUuid';
import { fmtDate, parseDate, addDays } from '@/utils/calendarDate';

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
  } catch (err) {
    console.warn('[ScheduleView] 할일 역동기화 실패:', err);
  }
}

async function unlinkTodoFromCalendar(todoId: string) {
  const supabaseService = await import('@/services/supabaseService');
  try {
    await supabaseService.applyCalendarToTodoPatch(todoId, { addToCalendar: false });
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

  // ─── 새 컴포넌트 상태 ───
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

  const today = fmtDate(new Date());
  const vacationConnected = useAppStore((s) => s.vacationConnected);

  // 이벤트 로드 + 외부 변경 구독 (할일 위젯 등에서 수정 시 즉시 반영)
  useEffect(() => {
    let cancelled = false;
    // cold cache 방어: 캐시가 비어있으면 syncAll 시도
    (async () => {
      const cached = await getEvents();
      const wasColdCache = cached.length === 0;
      await loadBflowEvents();
      if (wasColdCache) {
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
      setVacationEvents(mapVacationEvents(raw, 'vac'));
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
  }, [viewMode, year, month]);

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

  // 이벤트 클릭 → 사이드패널 토글 (같은 이벤트 재클릭 시 닫기)
  const handleEventClick = useCallback((ev: CalendarEvent) => {
    setPanelEvent(prev => prev?.id === ev.id ? null : ev);
  }, []);

  // 이벤트에서 해당 뷰로 이동
  const handleNavigate = useCallback((ev: CalendarEvent) => {
    // 휴가 이벤트 → 휴가 탭으로 이동
    if (ev.type === 'vacation') {
      setView('vacation');
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

  const { handleCellMouseDown, isDateInRange } = useCalendarDragCreate({
    onDragComplete: (startDate, endDate, _anchorEl) => {
      // 드래그/클릭 완료 → 상세 편집 모달 열기 (시작일+종료일 프리필)
      setCreateDate(startDate);
      setCreateEndDate(endDate);
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
            key="create"
            initialDate={createDate}
            initialEndDate={createEndDate}
            episodes={episodes}
            onClose={() => { setShowCreate(false); setCreateDate(undefined); setCreateEndDate(undefined); }}
            onSave={handleAddEvent}
          />
        )}
      </AnimatePresence>

      {/* ═══ 이벤트 사이드패널 ═══ */}
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
