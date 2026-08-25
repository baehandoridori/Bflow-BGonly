import { create } from 'zustand';
import type { BflowCalendar, CalendarTag } from '@/types/calendar';
import { useAuthStore } from './useAuthStore.ts';

const VISIBLE_CALENDARS_KEY = 'bflow_calendar_visible_v1';
const ENABLED_TAGS_KEY = 'bflow_calendar_tags_enabled_v1';
const MUTED_CALENDARS_KEY = 'bflow_calendar_muted_v1';
let loadAllGeneration = 0;
let calendarStoreSessionUserId = useAuthStore.getState().currentUser?.id ?? null;

export interface CalendarMetadataFreshness {
  calendarsFresh: boolean;
  tagsFresh: boolean;
}

export interface CalendarState {
  calendars: BflowCalendar[];
  tags: CalendarTag[];
  loaded: boolean;
  visibleCalendarIds: Record<string, boolean>;
  enabledTagIds: Record<string, boolean>;
  mutedCalendarIds: string[];
  loadAll(): Promise<CalendarMetadataFreshness>;
  toggleCalendarVisible(id: string): void;
  toggleTag(id: string): void;
  resetTagsAllOn(): void;
  toggleMuted(id: string): void;
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
    const next: Partial<Pick<CalendarState, 'calendars' | 'tags'>> = {};

    if (calendarResult.status === 'fulfilled') {
      next.calendars = calendarResult.value.map((row) => ({
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

  toggleCalendarVisible(id) {
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
  useCalendarStore.setState({ calendars: [], tags: [], loaded: false });
}

// Zustand 구독은 setCurrentUser/setState와 같은 call stack에서 실행된다. 따라서 새 사용자의
// 첫 IPC가 실패하더라도 이전 사용자의 캘린더 메타데이터가 한 프레임도 남지 않는다.
useAuthStore.subscribe((state) => {
  resetCalendarStoreSession(state.currentUser?.id ?? null);
});
