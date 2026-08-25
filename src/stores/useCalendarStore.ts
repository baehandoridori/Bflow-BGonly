import { create } from 'zustand';
import type { BflowCalendar, CalendarTag } from '@/types/calendar';
import { useAuthStore } from './useAuthStore.ts';

const VISIBLE_CALENDARS_KEY = 'bflow_calendar_visible_v1';
const ENABLED_TAGS_KEY = 'bflow_calendar_tags_enabled_v1';
const MUTED_CALENDARS_KEY = 'bflow_calendar_muted_v1';
const OPTIMISTIC_CALENDAR_ID_PREFIX = 'optimistic-calendar:';
let loadAllGeneration = 0;
let calendarStoreSessionUserId = useAuthStore.getState().currentUser?.id ?? null;

export interface CalendarMetadataFreshness {
  calendarsFresh: boolean;
  tagsFresh: boolean;
}

type CalendarOptimisticPatch = Partial<Pick<
  BflowCalendar,
  'name' | 'color' | 'visibility' | 'members' | 'canEdit'
>>;

export type CalendarOptimisticOverlay = {
  kind: 'create';
  beforeCalendarIds: string[];
  calendar: BflowCalendar;
} | {
  kind: 'update';
  calendarId: string;
  beforeCalendar: BflowCalendar;
  patch: CalendarOptimisticPatch;
} | {
  kind: 'delete';
  calendarId: string;
  beforeCalendar: BflowCalendar;
};

interface RegisteredCalendarOptimisticOverlay {
  token: number;
  overlay: CalendarOptimisticOverlay;
}

interface CalendarCanonicalSnapshot {
  revision: number;
  calendars: BflowCalendar[];
}

let nextCalendarCanonicalRevision = 0;
const calendarCanonicalByActor = new Map<string, CalendarCanonicalSnapshot>();
const calendarOptimisticByActor = new Map<string, RegisteredCalendarOptimisticOverlay>();

export interface CalendarState {
  calendars: BflowCalendar[];
  tags: CalendarTag[];
  loaded: boolean;
  optimisticDeletedCalendarIds: string[];
  visibleCalendarIds: Record<string, boolean>;
  enabledTagIds: Record<string, boolean>;
  mutedCalendarIds: string[];
  loadAll(): Promise<CalendarMetadataFreshness>;
  toggleCalendarVisible(id: string): void;
  toggleTag(id: string): void;
  resetTagsAllOn(): void;
  toggleMuted(id: string): void;
  upsertCalendarOptimistically(actorId: string, calendar: BflowCalendar): void;
  removeCalendarOptimistically(actorId: string, calendarId: string): void;
  setCalendarOptimisticOverlay(
    actorId: string,
    token: number,
    overlay: CalendarOptimisticOverlay,
  ): void;
  clearCalendarOptimisticOverlay(actorId: string, token: number): void;
}

function cloneCalendar(calendar: BflowCalendar): BflowCalendar {
  return {
    ...calendar,
    members: calendar.members.map((member) => ({ ...member })),
  };
}

function cloneCalendars(calendars: BflowCalendar[]): BflowCalendar[] {
  return calendars.map(cloneCalendar);
}

function calendarMembersMatch(left: BflowCalendar['members'], right: BflowCalendar['members']): boolean {
  if (left.length !== right.length) return false;
  const expected = new Map(right.map((member) => [member.userId, member.canEdit]));
  return left.every((member) => expected.get(member.userId) === member.canEdit);
}

function hasCanonicalCreateMatch(
  actorId: string,
  calendars: BflowCalendar[],
  overlay: Extract<CalendarOptimisticOverlay, { kind: 'create' }>,
): boolean {
  const beforeIds = new Set(overlay.beforeCalendarIds);
  const expected = overlay.calendar;
  return calendars.some((calendar) => (
    !beforeIds.has(calendar.id)
    && calendar.id !== expected.id
    && !calendar.isPersonal
    && calendar.ownerId === actorId
    && calendar.name === expected.name
    && calendar.color === expected.color
    && calendar.visibility === expected.visibility
    && calendarMembersMatch(calendar.members, expected.members)
  ));
}

function applyCalendarOptimisticOverlay(
  actorId: string,
  calendars: BflowCalendar[],
  overlay: CalendarOptimisticOverlay,
  hasCanonicalSnapshot: boolean,
): BflowCalendar[] {
  const base = cloneCalendars(calendars);
  if (overlay.kind === 'create') {
    if (hasCanonicalCreateMatch(actorId, base, overlay)) return base;
    const optimistic = cloneCalendar(overlay.calendar);
    const existingIndex = base.findIndex((calendar) => calendar.id === optimistic.id);
    if (existingIndex < 0) return [...base, optimistic];
    return base.map((calendar, index) => index === existingIndex ? optimistic : calendar);
  }
  if (overlay.kind === 'delete') {
    return base.filter((calendar) => calendar.id !== overlay.calendarId);
  }

  const existingIndex = base.findIndex((calendar) => calendar.id === overlay.calendarId);
  // A fresh canonical omission can mean access was revoked. Only the pre-load actor-return
  // presentation may use the captured before row; fresh metadata never resurrects it.
  if (existingIndex < 0 && hasCanonicalSnapshot) return base;
  const current = existingIndex >= 0 ? base[existingIndex] : cloneCalendar(overlay.beforeCalendar);
  const patched: BflowCalendar = {
    ...current,
    ...overlay.patch,
    members: overlay.patch.members?.map((member) => ({ ...member })) ?? current.members,
  };
  if (existingIndex < 0) return [...base, patched];
  return base.map((calendar, index) => index === existingIndex ? patched : calendar);
}

function rollbackCalendarOptimisticOverlay(
  calendars: BflowCalendar[],
  overlay: CalendarOptimisticOverlay,
): BflowCalendar[] {
  const base = cloneCalendars(calendars);
  if (overlay.kind === 'create') {
    return base.filter((calendar) => calendar.id !== overlay.calendar.id);
  }
  const before = cloneCalendar(overlay.beforeCalendar);
  const existingIndex = base.findIndex((calendar) => calendar.id === overlay.calendarId);
  if (existingIndex < 0) return [...base, before];
  return base.map((calendar, index) => index === existingIndex ? before : calendar);
}

function optimisticDeletedCalendarIds(
  registered: RegisteredCalendarOptimisticOverlay | undefined,
): string[] {
  return registered?.overlay.kind === 'delete' ? [registered.overlay.calendarId] : [];
}

export function getCalendarCanonicalSnapshot(
  actorId: string | undefined,
): CalendarCanonicalSnapshot | null {
  if (!actorId || useAuthStore.getState().currentUser?.id !== actorId) return null;
  const snapshot = calendarCanonicalByActor.get(actorId);
  return snapshot ? { revision: snapshot.revision, calendars: cloneCalendars(snapshot.calendars) } : null;
}

function loadExplicitFalseRecords(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      localStorage.setItem(key, '{}');
      return {};
    }
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value === false),
    );
  } catch {
    return {};
  }
}

function saveExplicitFalseRecords(key: string, records: Record<string, boolean>): void {
  try {
    const explicitFalseOnly = Object.fromEntries(
      Object.entries(records).filter(([, value]) => value === false),
    );
    localStorage.setItem(key, JSON.stringify(explicitFalseOnly));
  } catch { /* ignore */ }
}

function loadMutedCalendarIds(): string[] {
  try {
    const raw = localStorage.getItem(MUTED_CALENDARS_KEY);
    if (raw === null) {
      localStorage.setItem(MUTED_CALENDARS_KEY, '[]');
      return [];
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return [];
  }
}

function saveMutedCalendarIds(ids: string[]): void {
  try { localStorage.setItem(MUTED_CALENDARS_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

function isPersistableCalendarPreferenceId(id: string): boolean {
  return !id.startsWith(OPTIMISTIC_CALENDAR_ID_PREFIX);
}

export function isCalendarVisible(state: CalendarState, id: string): boolean {
  return state.visibleCalendarIds[id] !== false;
}

export function isTagEnabled(state: CalendarState, id: string): boolean {
  return state.enabledTagIds[id] !== false;
}

export function getPersonalCalendar(state: CalendarState, myUserId: string): BflowCalendar | undefined {
  return state.calendars.find((calendar) => calendar.isPersonal && calendar.ownerId === myUserId);
}

export const useCalendarStore = create<CalendarState>((set) => ({
  calendars: [],
  tags: [],
  loaded: false,
  optimisticDeletedCalendarIds: [],
  visibleCalendarIds: loadExplicitFalseRecords(VISIBLE_CALENDARS_KEY),
  enabledTagIds: loadExplicitFalseRecords(ENABLED_TAGS_KEY),
  mutedCalendarIds: loadMutedCalendarIds(),

  async loadAll() {
    const requestUserId = useAuthStore.getState().currentUser?.id ?? null;
    resetCalendarStoreSession(requestUserId);
    const requestGeneration = ++loadAllGeneration;
    const [calendarResult, tagResult] = await Promise.allSettled([
      window.electronAPI.calendarList(),
      window.electronAPI.calendarTagsList(),
    ]);
    const next: Partial<Pick<CalendarState, 'calendars' | 'tags' | 'optimisticDeletedCalendarIds'>> = {};
    let canonicalCalendars: BflowCalendar[] | undefined;

    if (calendarResult.status === 'fulfilled') {
      canonicalCalendars = calendarResult.value.map((row) => ({
          id: row.id,
          name: row.name,
          color: row.color,
          visibility: row.visibility,
          ownerId: row.owner_id,
          isPersonal: row.is_personal,
          members: row.members.map((member) => ({
            userId: member.user_id,
            canEdit: member.can_edit,
          })),
          canEdit: row.can_edit,
          canManage: row.can_manage,
          createdAt: row.created_at,
        }));
    } else {
      console.warn('[Calendar] 캘린더 목록 로드 실패:', calendarResult.reason);
    }

    if (tagResult.status === 'fulfilled') {
      next.tags = tagResult.value.map((row) => ({
          id: row.id,
          name: row.name,
          color: row.color,
          sortOrder: row.sort_order,
        }));
    } else {
      console.warn('[Calendar] 캘린더 태그 로드 실패:', tagResult.reason);
    }

    // 독립 요청의 실패는 마지막으로 성공한 다른 메타데이터를 지우지 않는다.
    if (
      requestGeneration !== loadAllGeneration
      || requestUserId !== calendarStoreSessionUserId
      || requestUserId !== (useAuthStore.getState().currentUser?.id ?? null)
    ) return { calendarsFresh: false, tagsFresh: false };
    if (canonicalCalendars) {
      const canonical = cloneCalendars(canonicalCalendars);
      if (requestUserId) {
        calendarCanonicalByActor.set(requestUserId, {
          revision: ++nextCalendarCanonicalRevision,
          calendars: cloneCalendars(canonical),
        });
      }
      const registered = requestUserId ? calendarOptimisticByActor.get(requestUserId) : undefined;
      next.calendars = registered && requestUserId
        ? applyCalendarOptimisticOverlay(requestUserId, canonical, registered.overlay, true)
        : canonical;
      next.optimisticDeletedCalendarIds = optimisticDeletedCalendarIds(registered);
    }
    set((state) => ({
      ...next,
      // loaded는 개인 캘린더 저장 경로를 결정하는 준비 상태다. 태그만 성공한
      // 최초 요청에서는 true로 올리지 않아 다음 쓰기가 캘린더 목록을 재시도한다.
      loaded: state.loaded || calendarResult.status === 'fulfilled',
    }));
    return {
      calendarsFresh: calendarResult.status === 'fulfilled',
      tagsFresh: tagResult.status === 'fulfilled',
    };
  },

  upsertCalendarOptimistically(actorId, calendar) {
    if (useAuthStore.getState().currentUser?.id !== actorId) return;
    const optimistic = {
      ...calendar,
      members: calendar.members.map((member) => ({ ...member })),
    };
    set((state) => {
      if (useAuthStore.getState().currentUser?.id !== actorId) return state;
      const existing = state.calendars.some((item) => item.id === optimistic.id);
      return {
        calendars: existing
          ? state.calendars.map((item) => item.id === optimistic.id ? optimistic : item)
          : [...state.calendars, optimistic],
      };
    });
  },

  removeCalendarOptimistically(actorId, calendarId) {
    if (useAuthStore.getState().currentUser?.id !== actorId) return;
    set((state) => {
      if (useAuthStore.getState().currentUser?.id !== actorId) return state;
      return { calendars: state.calendars.filter((calendar) => calendar.id !== calendarId) };
    });
  },

  setCalendarOptimisticOverlay(actorId, token, overlay) {
    if (useAuthStore.getState().currentUser?.id !== actorId) return;
    const previous = calendarOptimisticByActor.get(actorId);
    calendarOptimisticByActor.set(actorId, { token, overlay });
    set((state) => {
      if (useAuthStore.getState().currentUser?.id !== actorId) return state;
      const canonical = calendarCanonicalByActor.get(actorId);
      const base = canonical
        ? canonical.calendars
        : previous
          ? rollbackCalendarOptimisticOverlay(state.calendars, previous.overlay)
          : state.calendars;
      return {
        calendars: applyCalendarOptimisticOverlay(actorId, base, overlay, Boolean(canonical)),
        optimisticDeletedCalendarIds: optimisticDeletedCalendarIds({ token, overlay }),
      };
    });
  },

  clearCalendarOptimisticOverlay(actorId, token) {
    const registered = calendarOptimisticByActor.get(actorId);
    if (!registered || registered.token !== token) return;
    calendarOptimisticByActor.delete(actorId);
    if (useAuthStore.getState().currentUser?.id !== actorId) return;
    set((state) => ({
      calendars: cloneCalendars(
        calendarCanonicalByActor.get(actorId)?.calendars
          ?? rollbackCalendarOptimisticOverlay(state.calendars, registered.overlay),
      ),
      optimisticDeletedCalendarIds: [],
    }));
  },

  toggleCalendarVisible(id) {
    if (!isPersistableCalendarPreferenceId(id)) return;
    set((state) => {
      const next = { ...state.visibleCalendarIds };
      if (isCalendarVisible(state, id)) next[id] = false;
      else delete next[id];
      saveExplicitFalseRecords(VISIBLE_CALENDARS_KEY, next);
      return { visibleCalendarIds: next };
    });
  },

  toggleTag(id) {
    set((state) => {
      const next = { ...state.enabledTagIds };
      if (isTagEnabled(state, id)) next[id] = false;
      else delete next[id];
      saveExplicitFalseRecords(ENABLED_TAGS_KEY, next);
      return { enabledTagIds: next };
    });
  },

  resetTagsAllOn() {
    saveExplicitFalseRecords(ENABLED_TAGS_KEY, {});
    set({ enabledTagIds: {} });
  },

  toggleMuted(id) {
    if (!isPersistableCalendarPreferenceId(id)) return;
    set((state) => {
      const next = state.mutedCalendarIds.includes(id)
        ? state.mutedCalendarIds.filter((calendarId) => calendarId !== id)
        : [...state.mutedCalendarIds, id];
      saveMutedCalendarIds(next);
      return { mutedCalendarIds: next };
    });
  },
}));

function resetCalendarStoreSession(userId: string | null): void {
  if (userId === calendarStoreSessionUserId) return;
  calendarStoreSessionUserId = userId;
  loadAllGeneration += 1;
  const registered = userId ? calendarOptimisticByActor.get(userId) : undefined;
  const canonical = userId ? calendarCanonicalByActor.get(userId) : undefined;
  useCalendarStore.setState({
    calendars: registered && userId
      ? applyCalendarOptimisticOverlay(userId, canonical?.calendars ?? [], registered.overlay, Boolean(canonical))
      : [],
    tags: [],
    loaded: false,
    optimisticDeletedCalendarIds: optimisticDeletedCalendarIds(registered),
  });
}

// Zustand 구독은 setCurrentUser/setState와 같은 call stack에서 실행된다. 따라서 새 사용자의
// 첫 IPC가 실패하더라도 이전 사용자의 캘린더 메타데이터가 한 프레임도 남지 않는다.
useAuthStore.subscribe((state) => {
  resetCalendarStoreSession(state.currentUser?.id ?? null);
});
