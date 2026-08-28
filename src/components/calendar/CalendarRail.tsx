import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BellOff, Check, Info, MoreHorizontal, Plus, RefreshCw, Settings, Trash2 } from 'lucide-react';
import type { BflowCalendar } from '@/types/calendar';
import type { IcsSubscription } from '@/shared/icsApiContract';
import { icsCalendarId } from '@/shared/icsApiContract';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { groupCalendarsForRail } from '@/utils/calendarEventFilter';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { IcsSubscribeForm } from '@/components/calendar/IcsSubscribeForm';

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

function formatLastFetched(value: string | null): string {
  if (!value) return '아직 받아 온 적 없음';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '아직 받아 온 적 없음';
  return `마지막 확인 ${parsed.getMonth() + 1}/${parsed.getDate()} ${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
}

interface IcsSubscriptionRowProps {
  subscription: IcsSubscription;
  visible: boolean;
  open: boolean;
  onToggleVisible: () => void;
  onToggleMenu: () => void;
  onRefresh: () => void;
  onRename: () => void;
  onRemove: () => void;
  menuRef: React.RefObject<HTMLDivElement>;
  triggerRef: React.RefObject<HTMLButtonElement>;
}

function IcsSubscriptionRow({
  subscription,
  visible,
  open,
  onToggleVisible,
  onToggleMenu,
  onRefresh,
  onRename,
  onRemove,
  menuRef,
  triggerRef,
}: IcsSubscriptionRowProps) {
  return (
    <div className="group relative flex items-center gap-1 rounded-md px-1 py-1 hover:bg-bg-border/25">
      <button
        type="button"
        aria-label={`${subscription.name} 표시`}
        aria-pressed={visible}
        onClick={onToggleVisible}
        className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] cursor-pointer"
        style={{ backgroundColor: subscription.color }}
      >
        {visible && <Check size={10} strokeWidth={3} className="text-white" />}
      </button>
      <span className="min-w-0 flex-1 truncate text-[11px] text-text-primary" title={subscription.url}>
        {subscription.name}
      </span>
      {subscription.lastError && (
        <span
          aria-label={`${subscription.name} 불러오기 실패`}
          title={`${subscription.lastError} · ${formatLastFetched(subscription.lastFetchedAt)}`}
          className="shrink-0 text-amber-400"
        >
          <AlertTriangle size={12} />
        </span>
      )}
      {subscription.lastFetchTruncated && (
        <span
          aria-label={`${subscription.name} 일부만 표시`}
          title="일정이 많아 가까운 500개까지만 보여요"
          className="shrink-0 text-amber-400/80"
        >
          <Info size={12} />
        </span>
      )}
      <button
        ref={open ? triggerRef : undefined}
        type="button"
        aria-label={`${subscription.name} 메뉴 열기`}
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
          className="absolute right-0 top-7 z-30 w-40 rounded-md border border-bg-border bg-bg-card p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onRename}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] text-text-primary hover:bg-bg-border/50 cursor-pointer"
          >
            <Settings size={12} /> 이름·색 바꾸기
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onRefresh}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] text-text-primary hover:bg-bg-border/50 cursor-pointer"
          >
            <RefreshCw size={12} /> 지금 새로고침
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onRemove}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] text-red-400 hover:bg-red-500/10 cursor-pointer"
          >
            <Trash2 size={12} /> 구독 해제
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
  const [icsSubscriptions, setIcsSubscriptions] = useState<IcsSubscription[]>([]);
  const [showSubscribeForm, setShowSubscribeForm] = useState(false);
  const [renamingSubscription, setRenamingSubscription] = useState<IcsSubscription | null>(null);

  const reloadIcsSubscriptions = useCallback(async () => {
    try {
      const rows = await window.electronAPI?.icsList?.();
      if (rows) setIcsSubscriptions(rows);
    } catch (error) {
      console.warn('[Calendar] 외부 구독 목록을 불러오지 못했습니다:', error);
    }
  }, []);

  useEffect(() => {
    void reloadIcsSubscriptions();
    // 주기 갱신이 끝나면 마지막 확인 시각·실패 표시가 바뀌므로 목록도 다시 읽는다.
    const cleanup = window.electronAPI?.onIcsChanged?.(() => { void reloadIcsSubscriptions(); });
    return () => { cleanup?.(); };
  }, [reloadIcsSubscriptions]);


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
      <section className="mt-3">
        <h3 className="mb-1 px-1 text-[10px] font-semibold text-text-secondary">구독</h3>
        {icsSubscriptions.length === 0 && !showSubscribeForm && (
          <p className="px-1 py-1 text-[10px] leading-4 text-text-secondary/70">
            다른 캘린더의 공유 주소를 붙여넣으면 그 일정이 여기 함께 보여요.
          </p>
        )}
        {icsSubscriptions.map((subscription) => {
          const visibilityKey = icsCalendarId(subscription.id);
          return (
            <Fragment key={subscription.id}>
            <IcsSubscriptionRow
              subscription={subscription}
              visible={visibleCalendarIds[visibilityKey] !== false}
              open={openMenuId === visibilityKey}
              onToggleVisible={() => toggleCalendarVisible(visibilityKey)}
              onToggleMenu={() => setOpenMenuId((current) => (current === visibilityKey ? null : visibilityKey))}
              onRefresh={() => {
                setOpenMenuId(null);
                void (async () => {
                  // 일정 재조회는 메인이 보내는 ics:changed 한 경로로 수렴한다.
                  await window.electronAPI?.icsRefresh?.(subscription.id);
                  await reloadIcsSubscriptions();
                })();
              }}
              onRename={() => {
                setOpenMenuId(null);
                setRenamingSubscription(subscription);
              }}
              onRemove={() => {
                setOpenMenuId(null);
                void (async () => {
                  const confirmed = await ConfirmDialog.show({
                    message: `${subscription.name} 구독을 해제할까요?\n이 주소에서 받아 온 일정이 캘린더에서 사라져요.`,
                    confirmLabel: '해제',
                    tone: 'danger',
                  });
                  if (!confirmed) return;
                  await window.electronAPI?.icsRemove?.(subscription.id);
                  await reloadIcsSubscriptions();
                })();
              }}
              menuRef={menuRef}
              triggerRef={triggerRef}
            />
            {renamingSubscription?.id === subscription.id && (
              <IcsSubscribeForm
                initial={{
                  name: subscription.name,
                  url: subscription.url,
                  color: subscription.color,
                }}
                onCancel={() => setRenamingSubscription(null)}
                onSubmit={async (input) => {
                  await window.electronAPI?.icsUpdate?.(subscription.id, {
                    name: input.name,
                    color: input.color,
                  });
                  await reloadIcsSubscriptions();
                }}
              />
            )}
            </Fragment>
          );
        })}
        {showSubscribeForm ? (
          <IcsSubscribeForm
            onCancel={() => setShowSubscribeForm(false)}
            onSubmit={async (input) => {
              await window.electronAPI?.icsAdd?.(input);
              await reloadIcsSubscriptions();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowSubscribeForm(true)}
            className="mt-1 flex w-full items-center gap-1 rounded-md px-1 py-1 text-[11px] text-accent hover:bg-accent/10 cursor-pointer"
          >
            <Plus size={13} /> 주소로 구독
          </button>
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
