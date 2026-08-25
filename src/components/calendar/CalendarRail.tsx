import { useEffect, useMemo, useRef, useState } from 'react';
import { BellOff, Check, MoreHorizontal, Plus, Settings } from 'lucide-react';
import type { BflowCalendar } from '@/types/calendar';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { groupCalendarsForRail } from '@/utils/calendarEventFilter';

export const GOOGLE_CALENDAR_ID = 'google';

interface CalendarRailProps {
  isAuthenticated: boolean;
  onOpenSettings: (calendar: BflowCalendar) => void;
  onCreateCalendar: () => void;
}

interface CalendarRowProps {
  calendar: BflowCalendar;
  showSharePermission: boolean;
  visible: boolean;
  muted: boolean;
  open: boolean;
  onToggleVisible: () => void;
  onToggleMenu: () => void;
  onOpenSettings: () => void;
  onToggleMuted: () => void;
  menuRef: React.RefObject<HTMLDivElement>;
  triggerRef: React.RefObject<HTMLButtonElement>;
}

function CalendarRow({
  calendar,
  showSharePermission,
  visible,
  muted,
  open,
  onToggleVisible,
  onToggleMenu,
  onOpenSettings,
  onToggleMuted,
  menuRef,
  triggerRef,
}: CalendarRowProps) {
  return (
    <div className="group relative flex items-center gap-1 rounded-md px-1 py-1 hover:bg-bg-border/25">
      <button
        type="button"
        aria-label={`${calendar.name} 표시`}
        aria-pressed={visible}
        onClick={onToggleVisible}
        className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] cursor-pointer"
        style={{ backgroundColor: calendar.color }}
      >
        {visible && <Check size={10} strokeWidth={3} className="text-white" />}
      </button>
      <span className="min-w-0 flex-1 truncate text-[11px] text-text-primary" title={calendar.name}>
        {calendar.name}
      </span>
      {showSharePermission && (
        <span className="shrink-0 rounded bg-bg-border/50 px-1 py-px text-[9px] text-text-secondary">
          {calendar.canEdit ? '편집' : '보기'}
        </span>
      )}
      {muted && (
        <span aria-label={`${calendar.name} 알림이 꺼짐`} className="shrink-0 text-text-secondary" title="알림 끔">
          <BellOff size={12} />
        </span>
      )}
      <button
        ref={open ? triggerRef : undefined}
        type="button"
        aria-label={`${calendar.name} 메뉴 열기`}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          onToggleMenu();
        }}
        className="shrink-0 rounded p-0.5 text-text-secondary opacity-0 transition-opacity hover:bg-bg-border/50 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-7 z-30 w-36 rounded-md border border-bg-border bg-bg-card p-1 shadow-lg"
        >
          {calendar.canManage && (
            <button
              type="button"
              role="menuitem"
              onClick={onOpenSettings}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] text-text-primary hover:bg-bg-border/50 cursor-pointer"
            >
              <Settings size={12} /> 설정 열기
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={onToggleMuted}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] text-text-primary hover:bg-bg-border/50 cursor-pointer"
          >
            <BellOff size={12} /> {muted ? '알림 켜기' : '이 캘린더 알림 끄기'}
          </button>
        </div>
      )}
    </div>
  );
}

export function CalendarRail({ isAuthenticated, onOpenSettings, onCreateCalendar }: CalendarRailProps) {
  const calendars = useCalendarStore((state) => state.calendars);
  const visibleCalendarIds = useCalendarStore((state) => state.visibleCalendarIds);
  const mutedCalendarIds = useCalendarStore((state) => state.mutedCalendarIds);
  const toggleCalendarVisible = useCalendarStore((state) => state.toggleCalendarVisible);
  const toggleMuted = useCalendarStore((state) => state.toggleMuted);
  const currentUser = useAuthStore((state) => state.currentUser);
  const setView = useAppStore((state) => state.setView);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const groups = useMemo(
    () => groupCalendarsForRail(calendars, currentUser?.id ?? ''),
    [calendars, currentUser?.id],
  );
  const googleVisible = visibleCalendarIds[GOOGLE_CALENDAR_ID] !== false;

  useEffect(() => {
    if (!openMenuId) return;
    const closeWhenOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpenMenuId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpenMenuId(null);
    };
    document.addEventListener('mousedown', closeWhenOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeWhenOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenuId]);

  const renderSection = (title: string, entries: BflowCalendar[], shared = false) => {
    if (entries.length === 0) return null;
    return (
      <section key={title} className="mt-3">
        <h3 className="mb-1 px-1 text-[10px] font-semibold text-text-secondary">{title}</h3>
        {entries.map((calendar) => {
          const open = openMenuId === calendar.id;
          const muted = mutedCalendarIds.includes(calendar.id);
          return (
            <CalendarRow
              key={calendar.id}
              calendar={calendar}
              showSharePermission={shared}
              visible={visibleCalendarIds[calendar.id] !== false}
              muted={muted}
              open={open}
              onToggleVisible={() => toggleCalendarVisible(calendar.id)}
              onToggleMenu={() => setOpenMenuId((current) => current === calendar.id ? null : calendar.id)}
              onOpenSettings={() => {
                onOpenSettings(calendar);
                setOpenMenuId(null);
              }}
              onToggleMuted={() => {
                toggleMuted(calendar.id);
                setOpenMenuId(null);
              }}
              menuRef={menuRef}
              triggerRef={triggerRef}
            />
          );
        })}
      </section>
    );
  };

  return (
    <div className="pb-2">
      {renderSection('내 캘린더', groups.mine)}
      {renderSection('팀 전체', groups.team)}
      {renderSection('나에게 공유됨', groups.shared, true)}
      <section className="mt-3">
        <h3 className="mb-1 px-1 text-[10px] font-semibold text-text-secondary">내 구글</h3>
        {isAuthenticated ? (
          <div className="flex items-center gap-1 rounded-md px-1 py-1">
            <button
              type="button"
              aria-label="내 구글 표시"
              aria-pressed={googleVisible}
              onClick={() => toggleCalendarVisible(GOOGLE_CALENDAR_ID)}
              className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] bg-[#4285F4] cursor-pointer"
            >
              {googleVisible && <Check size={10} strokeWidth={3} className="text-white" />}
            </button>
            <span className="min-w-0 flex-1 truncate text-[11px] text-text-primary">Google Calendar</span>
            <span className="rounded bg-emerald-500/15 px-1 py-px text-[9px] text-emerald-400">연동됨</span>
          </div>
        ) : (
          <div className="flex items-start gap-1.5 px-1 py-1 text-[10px] leading-4 text-text-secondary">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-text-secondary/50" />
            <span>
              구글 캘린더 연동 안 됨 · <button type="button" onClick={() => setView('settings')} className="text-accent hover:underline cursor-pointer">설정에서 연동하기</button>
            </span>
          </div>
        )}
      </section>
      <button
        type="button"
        onClick={onCreateCalendar}
        className="mt-3 flex w-full items-center gap-1 rounded-md px-1 py-1 text-[11px] text-accent hover:bg-accent/10 cursor-pointer"
      >
        <Plus size={13} /> 새 캘린더
      </button>
    </div>
  );
}
