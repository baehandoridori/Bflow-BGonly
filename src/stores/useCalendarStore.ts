import { create } from 'zustand';
import type { BflowCalendar, CalendarTag } from '@/types/calendar';

const VISIBLE_CALENDARS_KEY = 'bflow_calendar_visible_v1';
const ENABLED_TAGS_KEY = 'bflow_calendar_tags_enabled_v1';
const MUTED_CALENDARS_KEY = 'bflow_calendar_muted_v1';

export interface CalendarState {
  calendars: BflowCalendar[];
  tags: CalendarTag[];
  loaded: boolean;
  visibleCalendarIds: Record<string, boolean>;
  enabledTagIds: Record<string, boolean>;
  mutedCalendarIds: string[];
  loadAll(): Promise<void>;
  toggleCalendarVisible(id: string): void;
  toggleTag(id: string): void;
  resetTagsAllOn(): void;
  toggleMuted(id: string): void;
}

function loadExplicitFalseRecords(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key);
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
    try {
      const [calendarRows, tagRows] = await Promise.all([
        window.electronAPI.calendarList(),
        window.electronAPI.calendarTagsList(),
      ]);
      set({
        calendars: calendarRows.map((row) => ({
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
        })),
        tags: tagRows.map((row) => ({
          id: row.id,
          name: row.name,
          color: row.color,
          sortOrder: row.sort_order,
        })),
        loaded: true,
      });
    } catch (err) {
      console.warn('[Calendar] 캘린더 목록·태그 로드 실패:', err);
      set({ calendars: [], tags: [], loaded: true });
    }
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
