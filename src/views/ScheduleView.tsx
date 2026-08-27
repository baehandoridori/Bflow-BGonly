import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore, type ScheduleDateNavigationRequest } from '@/stores/useAppStore';
import {
  getEvents, isGoogleCacheReady, loadBflowEvents, addEvent, updateEvent, deleteEvent,
} from '@/services/calendarService';
import { fetchAllVacationEvents } from '@/services/vacationService';
import { useCalendarDnD } from '@/hooks/useCalendarDnD';
import type { DragMode } from '@/hooks/useCalendarDnD';
import type {
  BflowCalendar, CalendarEvent, CalendarViewMode,
} from '@/types/calendar';
import { mapVacationEvents } from '@/utils/vacationEvents';
import { MiniCalendar } from '@/components/calendar/MiniCalendar';
import { EventSidePanel } from '@/components/calendar/EventSidePanel';
import { EventQuickEdit } from '@/components/calendar/EventQuickEdit';
import { CalendarGrid } from '@/components/calendar/CalendarGrid';
import { EventCreateModal } from '@/components/calendar/EventCreateModal';
import WeekScrollView, { generateYearWeeks, findWeekIndexForDate } from '@/components/calendar/WeekScrollView';
import { WeekTimeGridView } from '@/components/calendar/WeekTimeGridView';
import WeekSidebar from '@/components/calendar/WeekSidebar';
import DayScrollView from '@/components/calendar/DayScrollView';
import DaySidebar from '@/components/calendar/DaySidebar';
import { CalendarRail, GOOGLE_CALENDAR_ID } from '@/components/calendar/CalendarRail';
import { TagBar } from '@/components/calendar/TagBar';
import { TagManagerPopover } from '@/components/calendar/TagManagerPopover';
import { CalendarSettingsModal } from '@/components/calendar/CalendarSettingsModal';
import { ShortcutHelpOverlay } from '@/components/calendar/ShortcutHelpOverlay';
import { useCalendarDragCreate } from '@/hooks/useCalendarDragCreate';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { filterCalendarEvents } from '@/utils/calendarEventFilter';
import {
  calendarEventLinkedTodoId,
  calendarEventIdentityKey,
  hasSameCalendarEventIdentity,
  snapshotCalendarEventIdentity,
  type CalendarEventIdentity,
} from '@/utils/calendarEventIdentity';
import { navigateToSceneView } from '@/utils/sceneNavigationAction';
import { createUuid } from '@/utils/createUuid';
import { fmtDate, parseDate, addDays } from '@/utils/calendarDate';
import { useMotionPref } from '@/hooks/useMotionPref';
import { buildEventSnapshot, diffEventSnapshots, type CalendarEventSnapshot } from '@/utils/calendarEventDiff';

type WeekSubMode = 'card' | 'timegrid';

const CALENDAR_VIEW_STORAGE_KEY = 'bflow_calendar_view_v1';
const CALENDAR_VIEW_MODES: CalendarViewMode[] = ['month', '2week', 'week', 'today'];
const LOCAL_CHANGE_GUARD_MS = 3_000;
const REALTIME_HIGHLIGHT_MS = 2_000;

type LocalChangeGuard = {
  expiresAt: number;
  kind: 'add' | 'update';
  expectedSnapshot: string;
  rollbackSnapshot?: string;
  persistence: 'pending' | 'succeeded' | 'failed';
  sawExpected: boolean;
  sawRollback: boolean;
};

function isOptimisticMetadataCalendarRefresh(event: Event): boolean {
  const detail = (event as CustomEvent<unknown>).detail;
  return typeof detail === 'object'
    && detail !== null
    && (detail as { action?: unknown }).action === 'optimistic-metadata';
}

function expectedCreatedEvent(
  event: CalendarEvent,
  identity: CalendarEventIdentity,
): CalendarEvent {
  return {
    ...event,
    id: identity.id,
    source: identity.source,
    sourceCalendarId: identity.sourceCalendarId,
    allDay: event.allDay ?? true,
    // Google 생성은 서비스가 캐시에 넣는 중립 색으로 즉시 반영된다.
    ...(identity.source === 'google' ? { color: '#8B8DA3' } : {}),
  };
}

function optimisticCreatedEventIdentity(event: CalendarEvent): CalendarEventIdentity {
  if (event.calendarId) {
    return {
      id: event.id,
      source: 'bflow',
      sourceCalendarId: `bflow:${event.calendarId}`,
    };
  }
  return {
    id: event.id,
    source: event.isPrivate ? 'bflow' : 'google',
    sourceCalendarId: event.isPrivate ? 'supabase-private' : 'primary',
  };
}

function readCalendarViewPreference(): { viewMode: CalendarViewMode; weekSubMode: WeekSubMode } {
  const fallback = { viewMode: 'month' as CalendarViewMode, weekSubMode: 'card' as WeekSubMode };
  try {
    if (typeof window === 'undefined') return fallback;
    const raw = window.localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as { viewMode?: unknown; weekSubMode?: unknown };
    if (
      !CALENDAR_VIEW_MODES.includes(value.viewMode as CalendarViewMode)
      || (value.weekSubMode !== 'card' && value.weekSubMode !== 'timegrid')
    ) return fallback;
    return {
      viewMode: value.viewMode as CalendarViewMode,
      weekSubMode: value.weekSubMode,
    };
  } catch {
    return fallback;
  }
}

function normalizeCalendarDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function daysInCalendarYear(year: number): number {
  return new Date(year, 1, 29).getDate() === 29 ? 366 : 365;
}

function calendarDayIndex(date: Date): number {
  const normalized = normalizeCalendarDate(date);
  const jan1 = new Date(normalized.getFullYear(), 0, 1, 12, 0, 0, 0);
  return Math.round((normalized.getTime() - jan1.getTime()) / 86400000);
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

function findUniqueLinkedTodoEvent(events: CalendarEvent[], todoId: string): CalendarEvent | undefined {
  const linkedCandidates = events.filter((event) => event.linkedTodoId === todoId);
  const fallbackCandidates = linkedCandidates.length === 0
    ? events.filter((event) => (
        event.linkedTodoId === undefined
        && calendarEventLinkedTodoId(event) === todoId
      ))
    : [];
  const candidatesByIdentity = new Map(
    [...linkedCandidates, ...fallbackCandidates]
      .map((event) => [calendarEventIdentityKey(event), event]),
  );
  // todo detail에는 source namespace가 없으므로 후보가 둘 이상이면 다른
  // storage 행을 임의로 채택하지 않고 패널을 그대로 둔다.
  return candidatesByIdentity.size === 1
    ? candidatesByIdentity.values().next().value
    : undefined;
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
  const currentView = useAppStore((s) => s.currentView);
  const pendingScheduleDateNavigationRequest = useAppStore((s) => s.pendingScheduleDateNavigationRequest);
  const consumeScheduleDateNavigationRequest = useAppStore((s) => s.consumeScheduleDateNavigationRequest);
  const pendingScheduleTodoPanelNavigationRequest = useAppStore((s) => s.pendingScheduleTodoPanelNavigationRequest);
  const consumeScheduleTodoPanelNavigationRequest = useAppStore((s) => s.consumeScheduleTodoPanelNavigationRequest);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [vacationEvents, setVacationEvents] = useState<CalendarEvent[]>([]);
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => readCalendarViewPreference().viewMode);
  const [weekSubMode, setWeekSubMode] = useState<WeekSubMode>(() => readCalendarViewPreference().weekSubMode);
  const [showCreate, setShowCreate] = useState(false);
  const [createDate, setCreateDate] = useState<string | undefined>();
  const [createEndDate, setCreateEndDate] = useState<string | undefined>();
  const [createStartTime, setCreateStartTime] = useState<string | undefined>();
  const [createEndTime, setCreateEndTime] = useState<string | undefined>();
  const [googleAuthenticated, setGoogleAuthenticated] = useState(false);
  const [calendarSettings, setCalendarSettings] = useState<BflowCalendar | null | undefined>(undefined);
  const [tagManagerAnchor, setTagManagerAnchor] = useState<DOMRect | null>(null);
  const [highlightedEventIdentities, setHighlightedEventIdentities] = useState<ReadonlySet<string>>(() => new Set());
  const canonicalEventSnapshotRef = useRef<CalendarEventSnapshot | null>(null);
  const localChangeGuardsRef = useRef(new Map<string, LocalChangeGuard>());
  const realtimeHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeHighlightRevisionRef = useRef(0);

  // ─── 새 컴포넌트 상태 ───
  const [panelEvent, setPanelEvent] = useState<CalendarEvent | null>(null);

  // 월간 뷰 휠 — 디바운스 타이머
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Quick edit state (right-click)
  const [quickEdit, setQuickEdit] = useState<{
    event: CalendarEvent; position: { x: number; y: number };
  } | null>(null);
  const draggedEventIdentityRef = useRef<CalendarEventIdentity | null>(null);

  const resetCreatePrefill = useCallback(() => {
    setCreateDate(undefined);
    setCreateEndDate(undefined);
    setCreateStartTime(undefined);
    setCreateEndTime(undefined);
  }, []);

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
  const { reduce } = useMotionPref();

  useEffect(() => {
    try {
      window.localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, JSON.stringify({ viewMode, weekSubMode }));
    } catch {
      // 시크릿 모드·저장소 접근 제한에서는 기존 화면 동작을 유지한다.
    }
  }, [viewMode, weekSubMode]);

  const today = fmtDate(new Date());
  const vacationConnected = useAppStore((s) => s.vacationConnected);
  const calendars = useCalendarStore((state) => state.calendars);
  const calendarsLoaded = useCalendarStore((state) => state.loaded);
  const optimisticDeletedCalendarIds = useCalendarStore((state) => state.optimisticDeletedCalendarIds);
  const optimisticDeletedTagIds = useCalendarStore((state) => state.optimisticDeletedTagIds);
  const tags = useCalendarStore((state) => state.tags);
  const visibleCalendarIds = useCalendarStore((state) => state.visibleCalendarIds);
  const enabledTagIds = useCalendarStore((state) => state.enabledTagIds);
  const googleVisible = visibleCalendarIds[GOOGLE_CALENDAR_ID] !== false;
  const personalCalendarId = calendars.find((calendar) => calendar.isPersonal)?.id;
  const knownCalendarIds = useMemo(
    () => (calendarsLoaded ? new Set(calendars.map((calendar) => calendar.id)) : undefined),
    [calendars, calendarsLoaded],
  );
  const deletedTagIds = useMemo(
    () => new Set(optimisticDeletedTagIds),
    [optimisticDeletedTagIds],
  );

  const guardLocalIdentity = useCallback((
    identity: CalendarEventIdentity,
    expectedEvent: CalendarEvent,
    kind: LocalChangeGuard['kind'] = 'update',
    rollbackEvent?: CalendarEvent,
  ) => {
    const identityKey = calendarEventIdentityKey(identity);
    const expectedSnapshot = buildEventSnapshot([expectedEvent]).get(identityKey);
    if (expectedSnapshot === undefined) return;
    const rollbackSnapshot = rollbackEvent
      ? buildEventSnapshot([rollbackEvent]).get(identityKey)
      : undefined;
    const now = Date.now();
    for (const [guardIdentityKey, guard] of localChangeGuardsRef.current) {
      if (guard.expiresAt <= now) localChangeGuardsRef.current.delete(guardIdentityKey);
    }
    localChangeGuardsRef.current.set(identityKey, {
      expiresAt: now + LOCAL_CHANGE_GUARD_MS,
      kind,
      expectedSnapshot,
      rollbackSnapshot,
      persistence: 'pending',
      sawExpected: false,
      sawRollback: false,
    });
  }, []);

  const settleLocalUpdateGuard = useCallback((
    identity: CalendarEventIdentity,
    persistence: Extract<LocalChangeGuard['persistence'], 'succeeded' | 'failed'>,
  ) => {
    const identityKey = calendarEventIdentityKey(identity);
    const guard = localChangeGuardsRef.current.get(identityKey);
    if (!guard || guard.kind !== 'update') return;
    guard.persistence = persistence;
    if ((persistence === 'succeeded' && guard.sawExpected) || (persistence === 'failed' && guard.sawRollback)) {
      localChangeGuardsRef.current.delete(identityKey);
    }
  }, []);

  const guardCreatedEvent = useCallback((event: CalendarEvent): CalendarEventIdentity => {
    const identity = optimisticCreatedEventIdentity(event);
    guardLocalIdentity(identity, expectedCreatedEvent(event, identity), 'add');
    return identity;
  }, [guardLocalIdentity]);

  const guardPersistedCreatedEvent = useCallback((event: CalendarEvent, identity: CalendarEventIdentity) => {
    guardLocalIdentity(identity, expectedCreatedEvent(event, identity), 'add');
  }, [guardLocalIdentity]);

  const applyCanonicalEvents = useCallback((
    canonicalEvents: CalendarEvent[],
    { suppressRealtimeHighlight = false }: { suppressRealtimeHighlight?: boolean } = {},
  ) => {
    const nextSnapshot = buildEventSnapshot(canonicalEvents);
    const previousSnapshot = canonicalEventSnapshotRef.current;
    canonicalEventSnapshotRef.current = nextSnapshot;

    if (previousSnapshot && !suppressRealtimeHighlight) {
      const now = Date.now();
      for (const [identityKey, guard] of localChangeGuardsRef.current) {
        if (guard.expiresAt <= now) localChangeGuardsRef.current.delete(identityKey);
      }
      const diff = diffEventSnapshots(previousSnapshot, nextSnapshot);
      const changedIdentities = [...diff.added, ...diff.changed];
      const addedIdentities = new Set(diff.added);
      const localEchoIdentities = new Set(
        changedIdentities.filter((identityKey) => {
          const guard = localChangeGuardsRef.current.get(identityKey);
          if (!guard) return false;
          const nextEventSnapshot = nextSnapshot.get(identityKey);
          const isMatchingLocalEcho = guard.kind === 'add'
            ? addedIdentities.has(identityKey)
            : guard.expectedSnapshot === nextEventSnapshot || guard.rollbackSnapshot === nextEventSnapshot;
          if (!isMatchingLocalEcho) return false;
          if (guard.kind === 'add') {
            localChangeGuardsRef.current.delete(identityKey);
            return true;
          }
          if (guard.expectedSnapshot === nextEventSnapshot) guard.sawExpected = true;
          if (guard.rollbackSnapshot === nextEventSnapshot) guard.sawRollback = true;
          if ((guard.persistence === 'succeeded' && guard.sawExpected) || (guard.persistence === 'failed' && guard.sawRollback)) {
            localChangeGuardsRef.current.delete(identityKey);
          }
          return true;
        }),
      );
      const targets = changedIdentities.filter((identityKey) => !localEchoIdentities.has(identityKey));
      if (targets.length > 0) {
        const revision = ++realtimeHighlightRevisionRef.current;
        setHighlightedEventIdentities(new Set(targets));
        if (realtimeHighlightTimerRef.current) clearTimeout(realtimeHighlightTimerRef.current);
        realtimeHighlightTimerRef.current = setTimeout(() => {
          if (realtimeHighlightRevisionRef.current !== revision) return;
          setHighlightedEventIdentities(new Set());
          realtimeHighlightTimerRef.current = null;
        }, REALTIME_HIGHLIGHT_MS);
      }
    }

    setEvents(canonicalEvents);
    setPanelEvent((previous) => {
      if (!previous || previous.source === 'vacation') return previous;
      return canonicalEvents.find((event) => hasSameCalendarEventIdentity(event, previous)) ?? null;
    });
    setQuickEdit((previous) => {
      if (!previous) return previous;
      if (previous.event.source === 'vacation') return previous;
      const canonical = canonicalEvents.find((event) => (
        hasSameCalendarEventIdentity(event, previous.event)
      ));
      return canonical ? { ...previous, event: canonical } : null;
    });
  }, []);

  useEffect(() => () => {
    realtimeHighlightRevisionRef.current += 1;
    if (realtimeHighlightTimerRef.current) clearTimeout(realtimeHighlightTimerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshGoogleAuthentication = async () => {
      try {
        const { isAuthenticated } = await import('@/services/googleCalendarService');
        const authenticated = await isAuthenticated();
        if (!cancelled) setGoogleAuthenticated(authenticated);
      } catch {
        if (!cancelled) setGoogleAuthenticated(false);
      }
    };
    const handleAuthenticationChanged = (event: Event) => {
      const authenticated = (event as CustomEvent<{ authed?: boolean }>).detail?.authed;
      if (typeof authenticated === 'boolean') setGoogleAuthenticated(authenticated);
      else void refreshGoogleAuthentication();
    };
    void refreshGoogleAuthentication();
    window.addEventListener('bflow:gcal-auth-changed', handleAuthenticationChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('bflow:gcal-auth-changed', handleAuthenticationChanged);
    };
  }, []);

  // 이벤트 로드 + 외부 변경 구독 (할일 위젯 등에서 수정 시 즉시 반영)
  useEffect(() => {
    let cancelled = false;
    const refresh = async (options?: { suppressRealtimeHighlight?: boolean }) => {
      const canonicalEvents = await getEvents();
      if (!cancelled) applyCanonicalEvents(canonicalEvents, options);
    };
    // B flow와 Google 캐시는 별도로 준비된다. B flow 행이 있어도 Google full sync는 필요할 수 있다.
    (async () => {
      await loadBflowEvents();
      if (!isGoogleCacheReady()) {
        try {
          const { isAuthenticated } = await import('@/services/googleCalendarService');
          if (await isAuthenticated()) {
            const { syncAll } = await import('@/services/calendarService');
            await syncAll({ skipBflowLoad: true });
          }
        } catch { /* GCal 미연결 시 무시 */ }
      }
      await refresh();
    })();
    const handleCalendarChanged = (event: Event) => {
      void refresh({ suppressRealtimeHighlight: isOptimisticMetadataCalendarRefresh(event) });
    };
    window.addEventListener('bflow:calendar-changed', handleCalendarChanged);
    return () => { cancelled = true; window.removeEventListener('bflow:calendar-changed', handleCalendarChanged); };
  }, [applyCanonicalEvents]);

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

  // 통합 이벤트 (B flow + 연결된 휴가)와 캘린더∩태그 필터를 한 경로로 유지한다.
  const allEvents = useMemo(() => [...events, ...vacationEvents], [events, vacationEvents]);
  const filteredEvents = useMemo(
    () => filterCalendarEvents(allEvents, {
      visibleCalendarIds, enabledTagIds, optimisticDeletedTagIds: deletedTagIds,
      googleVisible, knownCalendarIds, personalCalendarId,
    }),
    [allEvents, visibleCalendarIds, enabledTagIds, deletedTagIds, googleVisible, knownCalendarIds, personalCalendarId],
  );

  const visibleCalendarCount = useMemo(
    () => calendars.filter((calendar) => visibleCalendarIds[calendar.id] !== false).length
      + (googleAuthenticated && googleVisible ? 1 : 0),
    [calendars, visibleCalendarIds, googleAuthenticated, googleVisible],
  );
  const totalRailCalendarCount = calendars.length + (googleAuthenticated ? 1 : 0);
  const currentMonthEventCount = useMemo(() => {
    const monthStart = fmtDate(new Date(year, month, 1, 12, 0, 0, 0));
    const monthEnd = fmtDate(new Date(year, month + 1, 0, 12, 0, 0, 0));
    return filteredEvents.filter((event) => event.startDate <= monthEnd && event.endDate >= monthStart).length;
  }, [filteredEvents, month, year]);
  const tagNameById = useMemo<Record<string, string>>(
    () => Object.fromEntries(tags.map((tag) => [tag.id, tag.name])),
    [tags],
  );
  const calendarNameById = useMemo<Record<string, string>>(
    () => Object.fromEntries(calendars.map((calendar) => [calendar.id, calendar.name])),
    [calendars],
  );

  // 권한이 회수되거나 관리 권한이 사라진 캘린더의 설정 모달을 stale 객체로 유지하지 않는다.
  // create mode의 null sentinel은 캘린더 목록과 무관하므로 그대로 보존한다.
  useEffect(() => {
    if (!calendarsLoaded) return;
    setCalendarSettings((previous) => {
      if (previous === undefined || previous === null) return previous;
      const canonical = calendars.find((calendar) => calendar.id === previous.id);
      if (!canonical && optimisticDeletedCalendarIds.includes(previous.id)) return previous;
      return canonical?.canManage ? canonical : undefined;
    });
  }, [calendars, calendarsLoaded, optimisticDeletedCalendarIds]);

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

  const moveToWeekContaining = useCallback((date: Date) => {
    const target = normalizeCalendarDate(date);
    const targetYear = target.getFullYear();
    const targetWeeks = generateYearWeeks(targetYear);
    setYear(targetYear);
    setMonth(target.getMonth());
    setActiveWeekIndex(findWeekIndexForDate(targetWeeks, fmtDate(target)));
  }, []);

  const handleWeekChange = useCallback((requestedIndex: number) => {
    const yearWeeks = generateYearWeeks(year);
    if (yearWeeks.length === 0) return;
    const lastIndex = yearWeeks.length - 1;
    if (requestedIndex < 0) {
      moveToWeekContaining(addDays(yearWeeks[0][3], requestedIndex * 7));
      return;
    }
    if (requestedIndex > lastIndex) {
      moveToWeekContaining(addDays(yearWeeks[lastIndex][3], (requestedIndex - lastIndex) * 7));
      return;
    }
    const requestedWeek = yearWeeks[requestedIndex];
    const dateInDisplayedYear = requestedWeek.find((date) => date.getFullYear() === year)
      ?? new Date(year, 11, 31, 12, 0, 0, 0);
    setMonth(dateInDisplayedYear.getMonth());
    setActiveWeekIndex(requestedIndex);
  }, [moveToWeekContaining, year]);

  const moveWeekBy = useCallback((delta: number) => {
    const yearWeeks = generateYearWeeks(year);
    if (yearWeeks.length === 0) return;
    const safeIndex = Math.max(0, Math.min(yearWeeks.length - 1, activeWeekIndex));
    handleWeekChange(safeIndex + delta);
  }, [activeWeekIndex, handleWeekChange, year]);

  const moveToDay = useCallback((date: Date) => {
    const target = normalizeCalendarDate(date);
    setYear(target.getFullYear());
    setMonth(target.getMonth());
    setActiveDayIndex(calendarDayIndex(target));
  }, []);

  const moveDayBy = useCallback((delta: number) => {
    const safeIndex = Math.max(0, Math.min(daysInCalendarYear(year) - 1, activeDayIndex));
    moveToDay(addDays(new Date(year, 0, safeIndex + 1, 12, 0, 0, 0), delta));
  }, [activeDayIndex, moveToDay, year]);

  const handleDayChange = useCallback((requestedIndex: number) => {
    const lastIndex = daysInCalendarYear(year) - 1;
    if (requestedIndex < 0) {
      moveToDay(new Date(year - 1, 11, 31, 12, 0, 0, 0));
      return;
    }
    if (requestedIndex > lastIndex) {
      moveToDay(new Date(year + 1, 0, 1, 12, 0, 0, 0));
      return;
    }
    moveToDay(new Date(year, 0, requestedIndex + 1, 12, 0, 0, 0));
  }, [moveToDay, year]);

  // 네비게이션
  const goToPrev = () => {
    setFocusedDate(null);
    if (viewMode === 'month') {
      setMonthDir(-1);
      if (month === 0) { setYear(year - 1); setMonth(11); }
      else setMonth(month - 1);
    } else if (viewMode === 'week' || viewMode === '2week') {
      const step = viewMode === '2week' ? 2 : 1;
      moveWeekBy(-step);
    } else {
      moveDayBy(-1);
    }
  };

  const goToNext = () => {
    setFocusedDate(null);
    if (viewMode === 'month') {
      setMonthDir(1);
      if (month === 11) { setYear(year + 1); setMonth(0); }
      else setMonth(month + 1);
    } else if (viewMode === 'week' || viewMode === '2week') {
      const step = viewMode === '2week' ? 2 : 1;
      moveWeekBy(step);
    } else {
      moveDayBy(1);
    }
  };

  const goToToday = () => {
    const now = new Date();
    const todayStr = fmtDate(now);
    moveToWeekContaining(now);
    moveToDay(now);
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
      const optimisticIdentity = guardCreatedEvent(ev);
      await addEvent(ev, {
        onPersistedIdentity: (identity) => {
          if (!hasSameCalendarEventIdentity(identity, optimisticIdentity)) {
            guardPersistedCreatedEvent(ev, identity);
          }
        },
      });
      // bflow:calendar-changed 구독이 자동 refresh하므로 수동 추가 불필요
      setShowCreate(false);
      resetCreatePrefill();
    } finally {
      isAddingRef.current = false;
    }
  }, [guardCreatedEvent, guardPersistedCreatedEvent, resetCreatePrefill]);

  const handleDeleteEvent = useCallback(async (deletingEvent: CalendarEvent) => {
    const mutationIdentity = snapshotCalendarEventIdentity(deletingEvent);
    await deleteEvent(deletingEvent.id, mutationIdentity);
    setEvents((prev) => prev.filter((event) => (
      !hasSameCalendarEventIdentity(event, mutationIdentity)
    )));
    // 할일 연결된 이벤트인 경우 addToCalendar = false 처리 (할일 자체는 유지)
    const todoId = calendarEventLinkedTodoId(deletingEvent);
    if (todoId) unlinkTodoFromCalendar(todoId);
  }, []);

  // 이벤트 클릭 → 사이드패널 토글 (같은 이벤트 재클릭 시 닫기)
  const handleEventClick = useCallback((ev: CalendarEvent) => {
    setPanelEvent((previous) => previous && hasSameCalendarEventIdentity(previous, ev) ? null : ev);
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

  const reconcileEventMutation = useCallback(async (mutationIdentity?: CalendarEventIdentity) => {
    const canonicalEvents = await getEvents();
    const canonical = mutationIdentity
      ? canonicalEvents.find((event) => hasSameCalendarEventIdentity(event, mutationIdentity))
      : undefined;
    applyCanonicalEvents(canonicalEvents);
    const todoId = canonical ? calendarEventLinkedTodoId(canonical) : undefined;
    if (canonical && todoId) void syncCalendarToTodo(todoId, canonical);
  }, [applyCanonicalEvents]);

  // 드래그&드롭
  const handleEventDragDone = useCallback(async (eventId: string, newStart: string, newEnd: string) => {
    const mutationIdentity = draggedEventIdentityRef.current;
    draggedEventIdentityRef.current = null;
    const eventBeforeUpdate = mutationIdentity
      ? events.find((event) => hasSameCalendarEventIdentity(event, mutationIdentity))
      : undefined;
    if (mutationIdentity && eventBeforeUpdate) {
      guardLocalIdentity(mutationIdentity, {
        ...eventBeforeUpdate,
        startDate: newStart,
        endDate: newEnd,
      }, 'update', eventBeforeUpdate);
    }
    try {
      await updateEvent(
        eventId,
        { startDate: newStart, endDate: newEnd },
        mutationIdentity ?? undefined,
      );
      if (mutationIdentity && eventBeforeUpdate) settleLocalUpdateGuard(mutationIdentity, 'succeeded');
    } catch (error) {
      if (mutationIdentity && eventBeforeUpdate) settleLocalUpdateGuard(mutationIdentity, 'failed');
      throw error;
    }
    await reconcileEventMutation(mutationIdentity ?? undefined);
  }, [events, guardLocalIdentity, reconcileEventMutation, settleLocalUpdateGuard]);

  const handleTimeGridEventChange = useCallback(async (
    eventId: string,
    mutationIdentity: CalendarEventIdentity,
    patch: Pick<CalendarEvent, 'startDate' | 'endDate' | 'startTime' | 'endTime'>,
  ) => {
    const eventBeforeUpdate = events.find((event) => hasSameCalendarEventIdentity(event, mutationIdentity));
    if (eventBeforeUpdate) guardLocalIdentity(mutationIdentity, { ...eventBeforeUpdate, ...patch }, 'update', eventBeforeUpdate);
    try {
      await updateEvent(eventId, patch, mutationIdentity);
      if (eventBeforeUpdate) settleLocalUpdateGuard(mutationIdentity, 'succeeded');
    } catch (error) {
      if (eventBeforeUpdate) settleLocalUpdateGuard(mutationIdentity, 'failed');
      throw error;
    }
    await reconcileEventMutation(mutationIdentity);
  }, [events, guardLocalIdentity, reconcileEventMutation, settleLocalUpdateGuard]);

  const { isDragging, preview: dragPreview, startDrag } = useCalendarDnD(handleEventDragDone, handleEventDragDone);

  const handleBarDragStart = useCallback((ev: CalendarEvent, mode: DragMode, anchorDate: string) => {
    if (!ev || ev.isReadOnly) return;
    draggedEventIdentityRef.current = snapshotCalendarEventIdentity(ev);
    startDrag(ev.id, mode, ev.startDate, ev.endDate, 0, anchorDate);
  }, [startDrag]);

  const handleTimeGridCreate = useCallback((date: string, startTime: string, endTime: string) => {
    setCreateDate(date);
    // 시간표의 24:00은 저장 모델의 다음 날 00:00으로 표현한다.
    setCreateEndDate(endTime <= startTime ? fmtDate(addDays(parseDate(date), 1)) : date);
    setCreateStartTime(startTime);
    setCreateEndTime(endTime);
    setShowCreate(true);
  }, []);

  // 드래그 완료 후 모달이 열려 있는 동안 선택 범위를 유지하기 위한 상태
  const [persistedDateRange, setPersistedDateRange] = useState<{ startDate: string; endDate: string } | null>(null);

  // 키보드 네비게이션용 포커스 날짜 (월간 뷰 전용)
  const [focusedDate, setFocusedDate] = useState<string | null>(null);

  // navigate-to-date 펄스 애니메이션용
  const [pulseDate, setPulseDate] = useState<string | null>(null);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  // 오늘 버튼 하이라이트 (persistedDateRange와 분리)
  // todayHighlight 제거됨 — pulseDate로 통합

  const { handleCellMouseDown, isDateInRange } = useCalendarDragCreate({
    onDragComplete: (startDate, endDate, _anchorEl) => {
      // 드래그/클릭 완료 → 상세 편집 모달 열기 (시작일+종료일 프리필)
      setCreateDate(startDate);
      setCreateEndDate(endDate);
      setCreateStartTime(undefined);
      setCreateEndTime(undefined);
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
    if (showCreate || quickEdit || panelEvent || calendarSettings !== undefined || tagManagerAnchor) return;

    const handler = (e: KeyboardEvent) => {
      // 편집 중이거나 OS/앱 조합키를 누른 상태면 캘린더 단축키를 가로채지 않는다.
      const tag = (e.target as HTMLElement)?.tagName;
      const isHelpShortcut = e.key === '?' || (e.key === '/' && e.shiftKey);
      if (
        tag === 'INPUT'
        || tag === 'TEXTAREA'
        || tag === 'SELECT'
        || (e.target as HTMLElement)?.isContentEditable
        || e.ctrlKey
        || e.metaKey
        || e.altKey
        || (e.shiftKey && !isHelpShortcut)
      ) return;

      const key = e.key.toLowerCase();

      if (isHelpShortcut) {
        e.preventDefault();
        e.stopPropagation();
        setShowShortcutHelp((open) => !open);
        return;
      }

      if (showShortcutHelp) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setShowShortcutHelp(false);
        }
        return;
      }

      if (key === 't') {
        e.preventDefault();
        e.stopPropagation();
        goToToday();
        return;
      }

      if (key === 'w') {
        e.preventDefault();
        e.stopPropagation();
        setViewMode('week');
        return;
      }

      if (key === 'm') {
        e.preventDefault();
        e.stopPropagation();
        setViewMode('month');
        return;
      }

      if (key === 'c') {
        e.preventDefault();
        e.stopPropagation();
        const targetDate = focusedDate ?? fmtDate(new Date());
        resetCreatePrefill();
        setCreateDate(targetDate);
        setCreateEndDate(targetDate);
        setShowCreate(true);
        setPersistedDateRange({ startDate: targetDate, endDate: targetDate });
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
          moveWeekBy(-1);
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          moveWeekBy(1);
          return;
        }
        return;
      }

      // 일간 뷰: 방향키로 일 이동
      if (viewMode === 'today') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          moveDayBy(-1);
          return;
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          moveDayBy(1);
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
  }, [
    viewMode, showCreate, quickEdit, panelEvent, calendarSettings, tagManagerAnchor, showShortcutHelp, focusedDate,
    month, year, moveWeekBy, moveDayBy, resetCreatePrefill,
  ]);

  // 뷰 모드 변경 시 포커스 초기화
  useEffect(() => {
    setFocusedDate(null);
  }, [viewMode]);

  // 일정 알림/할일이 store에 남긴 날짜 이동을 적용한다. CustomEvent와 달리 lazy mount
  // 전에도 요청이 보존되며, 정확히 일치하는 요청 ID만 소비해 새 요청을 지우지 않는다.
  const navigateTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const applyScheduleDateNavigation = useCallback((detail: Pick<ScheduleDateNavigationRequest, 'date' | 'todoId'>) => {
    // 이전 타이머 정리
    navigateTimersRef.current.forEach(clearTimeout);
    navigateTimersRef.current = [];

    const dateStr = detail.date;
    const d = parseDate(dateStr);
    moveToWeekContaining(d);
    moveToDay(d);
    setPersistedDateRange({ startDate: dateStr, endDate: dateStr });
    setPulseDate(dateStr);
    // 3초 후 하이라이트 및 펄스 해제
    navigateTimersRef.current.push(
      setTimeout(() => { setPersistedDateRange(null); setPulseDate(null); }, 3000),
    );
  }, [moveToDay, moveToWeekContaining]);

  useEffect(() => {
    if (currentView !== 'schedule' || !pendingScheduleDateNavigationRequest) return;
    const request = consumeScheduleDateNavigationRequest(pendingScheduleDateNavigationRequest.id);
    if (request) applyScheduleDateNavigation(request);
  }, [applyScheduleDateNavigation, consumeScheduleDateNavigationRequest, currentView, pendingScheduleDateNavigationRequest]);

  // 날짜 이동은 즉시 적용하지만, 연결 할일 패널은 이벤트 정본이 늦게 도착할 수 있다.
  // 따라서 시간 대기 대신 events 갱신마다 같은 ID 요청을 재해석하고, 성공한 정확한 ID만 소비한다.
  useEffect(() => {
    if (currentView !== 'schedule' || !pendingScheduleTodoPanelNavigationRequest) return;
    const todoId = pendingScheduleTodoPanelNavigationRequest.todoId;
    if (!todoId) return;
    const linkedEvent = findUniqueLinkedTodoEvent(events, todoId);
    if (!linkedEvent) return;
    const request = consumeScheduleTodoPanelNavigationRequest(pendingScheduleTodoPanelNavigationRequest.id);
    if (request) setPanelEvent(linkedEvent);
  }, [
    consumeScheduleTodoPanelNavigationRequest,
    currentView,
    events,
    pendingScheduleTodoPanelNavigationRequest,
  ]);

  useEffect(() => () => {
    navigateTimersRef.current.forEach(clearTimeout);
  }, []);

  // 드래그 범위 OR 모달 열림 시 persisted 범위를 통합 체크
  const isDateInHighlightRange = useCallback((date: string): boolean => {
    if (isDateInRange(date)) return true;
    if (persistedDateRange && date >= persistedDateRange.startDate && date <= persistedDateRange.endDate) return true;
    // 오늘 버튼 하이라이트 (별도 상태)
    if (date === pulseDate) return true;
    return false;
  }, [isDateInRange, persistedDateRange, pulseDate]);

  // ─── 사이드 패널 / 퀵 에디트 핸들러 ───
  const handleUpdateEventDirect = useCallback(async (
    eventBeforeUpdate: CalendarEvent,
    id: string,
    updates: Partial<CalendarEvent>,
  ) => {
    const mutationIdentity = snapshotCalendarEventIdentity(eventBeforeUpdate);
    const sanitized = { ...updates };
    // 빈 문자열 날짜 방지: 기존 값 유지
    if ('startDate' in sanitized && !sanitized.startDate) delete sanitized.startDate;
    if ('endDate' in sanitized && !sanitized.endDate) delete sanitized.endDate;
    // endDate < startDate 방지: 자동 swap
    if (sanitized.startDate && sanitized.endDate && sanitized.endDate < sanitized.startDate) {
      [sanitized.startDate, sanitized.endDate] = [sanitized.endDate, sanitized.startDate];
    }
    guardLocalIdentity(mutationIdentity, { ...eventBeforeUpdate, ...sanitized }, 'update', eventBeforeUpdate);
    let persistenceFailed = false;
    let persistenceError: unknown;
    try {
      await updateEvent(id, sanitized, mutationIdentity);
      settleLocalUpdateGuard(mutationIdentity, 'succeeded');
    } catch (error) {
      persistenceFailed = true;
      persistenceError = error;
      settleLocalUpdateGuard(mutationIdentity, 'failed');
    }

    try {
      const canonicalEvents = await getEvents();
      const canonical = canonicalEvents.find((event) => (
        hasSameCalendarEventIdentity(event, mutationIdentity)
      ));
      applyCanonicalEvents(canonicalEvents);
      const todoId = canonical ? calendarEventLinkedTodoId(canonical) : undefined;
      if (!persistenceFailed && canonical && todoId) void syncCalendarToTodo(todoId, canonical);
    } catch (refreshError) {
      if (!persistenceFailed) throw refreshError;
      console.warn('[ScheduleView] 일정 저장 실패 후 정본 새로고침 실패:', refreshError);
    }

    if (persistenceFailed) throw persistenceError;
  }, [applyCanonicalEvents, guardLocalIdentity, settleLocalUpdateGuard]);

  const handleDuplicateEvent = useCallback(async (event: CalendarEvent) => {
    const isCanonicalBflow = event.sourceCalendarId?.startsWith('bflow:') === true
      && Boolean(event.calendarId);
    const isWriteProtected = event.isReadOnly === true || event.canEdit === false;
    let duplicateCalendarId = event.calendarId;
    if (isCanonicalBflow && isWriteProtected) {
      const personal = useCalendarStore.getState().calendars.find((calendar) => (
        calendar.isPersonal && calendar.canEdit
      ));
      if (!personal) {
        console.warn('[ScheduleView] 복제할 수 있는 개인 캘린더가 없습니다');
        return;
      }
      duplicateCalendarId = personal.id;
    }
    const newEv: CalendarEvent = {
      ...event,
      id: createUuid(),
      title: `${event.title} (복사)`,
      createdAt: new Date().toISOString(),
      calendarId: duplicateCalendarId,
      sourceCalendarId: undefined,
      source: undefined,
      canEdit: undefined,
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
    const optimisticIdentity = guardCreatedEvent(newEv);
    await addEvent(newEv, {
      onPersistedIdentity: (identity) => {
        if (!hasSameCalendarEventIdentity(identity, optimisticIdentity)) {
          guardPersistedCreatedEvent(newEv, identity);
        }
      },
    });
    // bflow:calendar-changed 구독이 자동 refresh
  }, [guardCreatedEvent, guardPersistedCreatedEvent]);

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
  const handleOpenTagManager = useCallback((anchorRect: DOMRect) => {
    setTagManagerAnchor(anchorRect);
  }, []);

  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'never'}>
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
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {viewMode === 'today' ? (
                <DaySidebar
                  activeDayIndex={activeDayIndex}
                  onDaySelect={handleDayChange}
                  events={filteredEvents}
                  year={year}
                />
              ) : (viewMode === 'week' || viewMode === '2week') ? (
                <WeekSidebar
                  weeks={weeks}
                  events={filteredEvents}
                  today={today}
                  activeWeekIndex={activeWeekIndex}
                  onWeekSelect={handleWeekChange}
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
              <CalendarRail
                isAuthenticated={googleAuthenticated}
                onOpenSettings={(calendar) => setCalendarSettings(calendar)}
                onCreateCalendar={() => setCalendarSettings(null)}
              />
            </div>
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
                aria-label="이전 기간"
                className="p-2 rounded-lg hover:bg-bg-border/30 text-text-secondary/60 hover:text-text-primary transition-colors cursor-pointer"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-lg font-bold text-text-primary min-w-[160px] text-center">
                {headerLabel}
              </span>
              <button
                onClick={goToNext}
                aria-label="다음 기간"
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

          {viewMode === 'week' && (
            <div className="flex rounded-lg border border-accent/35 bg-accent/5 p-0.5" aria-label="주간 보기 방식">
              <button
                type="button"
                aria-label="주간 카드 보기"
                aria-pressed={weekSubMode === 'card'}
                onClick={() => setWeekSubMode('card')}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                  weekSubMode === 'card' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                카드
              </button>
              <button
                type="button"
                aria-label="주간 시간표 보기"
                aria-pressed={weekSubMode === 'timegrid'}
                onClick={() => setWeekSubMode('timegrid')}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                  weekSubMode === 'timegrid' ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                시간표
              </button>
            </div>
          )}

          {/* 이벤트 생성 */}
          <button
            onClick={() => { resetCreatePrefill(); setShowCreate(true); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent hover:bg-accent/80 text-white text-sm font-medium shadow-sm shadow-accent/20 transition-colors cursor-pointer"
          >
            <Plus size={16} />
            일정
          </button>
        </div>
      </div>

      <TagBar
        vacationConnected={vacationConnected}
        onOpenTagManager={handleOpenTagManager}
      />
      {tagManagerAnchor && (
        <TagManagerPopover
          anchorRect={tagManagerAnchor}
          onClose={() => setTagManagerAnchor(null)}
        />
      )}

      {/* ═══ 이벤트 수 통계 ═══ */}
      <div className="flex items-center gap-4 text-sm text-text-secondary/50 px-4">
        <span>이번 달 {currentMonthEventCount}개</span>
        <span className="text-bg-border/50">·</span>
        <span>오늘 {filteredEvents.filter((e) => e.startDate <= today && e.endDate >= today).length}개</span>
        <span className="text-bg-border/50">·</span>
        <span>켜진 캘린더 {visibleCalendarCount}/{totalRailCalendarCount}</span>
      </div>

      {/* ═══ 캘린더 본체 ═══ */}
      <div className="flex-1 flex flex-col overflow-hidden px-3 pb-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${viewMode}:${weekSubMode}`}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={reduce ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {viewMode === 'today' ? (
              <DayScrollView
                events={filteredEvents}
                activeDayIndex={activeDayIndex}
                onActiveDayChange={handleDayChange}
                onEventClick={handleEventClick}
                onDateClick={(dateStr) => {
                  setCreateDate(dateStr);
                  setCreateEndDate(dateStr);
                  setShowCreate(true);
                }}
                year={year}
              />
            ) : viewMode === 'week' && weekSubMode === 'timegrid' ? (
              <WeekTimeGridView
                weekDays={weeks[activeWeekIndex] ?? []}
                events={filteredEvents}
                today={today}
                onEventClick={handleEventClick}
                onSlotClick={handleTimeGridCreate}
                tagNameById={tagNameById}
                calendarNameById={calendarNameById}
                activeWeekIndex={activeWeekIndex}
                weekCount={weeks.length}
                onWeekChange={handleWeekChange}
                onTimeGridCreate={handleTimeGridCreate}
                onTimeGridEventChange={handleTimeGridEventChange}
                highlightedEventIdentities={highlightedEventIdentities}
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
                onWeekChange={handleWeekChange}
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
                draggedEventIdentity={draggedEventIdentityRef.current}
                isDragging={isDragging}
                onCellMouseDown={handleCellMouseDown}
                isDateInDragRange={isDateInHighlightRange}
                onEventContextMenu={handleEventContextMenu}
                monthKey={`${year}-${month}`}
                monthDirection={monthDir}
                focusedDate={focusedDate}
                pulseDate={pulseDate}
                highlightedEventIdentities={highlightedEventIdentities}
                reduceMotion={reduce}
                tagNameById={tagNameById}
                calendarNameById={calendarNameById}
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
            initialStartTime={createStartTime}
            initialEndTime={createEndTime}
            episodes={episodes}
            googleAuthenticated={googleAuthenticated}
            onClose={() => { setShowCreate(false); resetCreatePrefill(); }}
            onSave={handleAddEvent}
          />
        )}
        {calendarSettings !== undefined && (
          <CalendarSettingsModal
            key="calendar-settings"
            calendar={calendarSettings ?? undefined}
            eventCount={calendarSettings
              ? events.filter((event) => event.calendarId === calendarSettings.id).length
              : 0}
            onClose={() => setCalendarSettings(undefined)}
          />
        )}
      </AnimatePresence>

      {/* ═══ 이벤트 사이드패널 ═══ */}
      <AnimatePresence>
        {panelEvent && (
          <EventSidePanel
            key={`panel-${calendarEventIdentityKey(panelEvent)}`}
            event={panelEvent}
            onClose={() => setPanelEvent(null)}
            onDelete={() => { void handleDeleteEvent(panelEvent); setPanelEvent(null); }}
            onUpdate={(id, updates) => handleUpdateEventDirect(panelEvent, id, updates)}
            onNavigate={handleNavigate}
          />
        )}
      </AnimatePresence>

      {/* ═══ EventQuickEdit (right-click popup) ═══ */}
      {quickEdit && (
        <EventQuickEdit
          key={calendarEventIdentityKey(quickEdit.event)}
          event={quickEdit.event}
          position={quickEdit.position}
          onClose={() => setQuickEdit(null)}
          onUpdate={(id, updates) => handleUpdateEventDirect(quickEdit.event, id, updates)}
          onDelete={() => {
            const deletingEvent = quickEdit.event;
            void handleDeleteEvent(deletingEvent);
            setPanelEvent((previous) => previous
              && hasSameCalendarEventIdentity(previous, deletingEvent)
              ? null
              : previous);
          }}
          onDuplicate={handleDuplicateEvent}
        />
      )}
      {showShortcutHelp && (
        <ShortcutHelpOverlay onClose={() => setShowShortcutHelp(false)} />
      )}
      </div>{/* 메인 영역 끝 */}
      </div>
    </MotionConfig>
  );
}
