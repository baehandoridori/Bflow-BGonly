import {
  useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import { motion } from 'framer-motion';
import { Check, Crown, Search, Settings, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { loadBflowEvents } from '@/services/calendarService';
import type { CalendarCreateInput, CalendarUpdateInput } from '@/shared/calendarApiContract';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { EVENT_COLORS, type BflowCalendar, type CalendarMember } from '@/types/calendar';
import { avatarColor } from '@/utils/avatarColor';
import { cn } from '@/utils/cn';
import { floatingGlassStyle } from '@/utils/glassStyles';

interface CalendarSettingsModalProps {
  calendar?: BflowCalendar;
  eventCount: number;
  onClose: () => void;
}

type CalendarVisibility = BflowCalendar['visibility'];

type CalendarRefreshMode = 'metadata' | 'events';
type CalendarVerification = 'committed' | 'not-committed' | 'ambiguous';

interface CalendarIntentBase {
  actorId: string;
}

interface CalendarCreateIntent extends CalendarIntentBase {
  kind: 'create';
  input: CalendarCreateInput;
  beforeCalendarIds: string[];
}

interface CalendarUpdateIntent extends CalendarIntentBase {
  kind: 'update';
  calendarId: string;
  updates: CalendarUpdateInput;
  beforeCalendar: BflowCalendar;
}

interface CalendarDeleteIntent extends CalendarIntentBase {
  kind: 'delete';
  calendarId: string;
  beforeCalendar: BflowCalendar;
}

type CalendarMutationIntent = CalendarCreateIntent | CalendarUpdateIntent | CalendarDeleteIntent;

interface InFlightCalendarMutation {
  token: number;
  intent: CalendarMutationIntent;
  refreshMode: CalendarRefreshMode;
}

interface PendingCalendarReconciliation {
  intent: CalendarMutationIntent;
  refreshMode: CalendarRefreshMode;
  persistenceSucceeded: boolean;
  successMessage: string;
}

interface ActorCalendarMutationState {
  inFlight: InFlightCalendarMutation | null;
  reconciliation: PendingCalendarReconciliation | null;
}

let nextCalendarMutationToken = 0;
let calendarMutationRevision = { revision: 0 };
const calendarMutationByActor = new Map<string, ActorCalendarMutationState>();
const emptyActorCalendarMutation: ActorCalendarMutationState = {
  inFlight: null,
  reconciliation: null,
};
const calendarMutationListeners = new Set<() => void>();
let nextCalendarModalInstanceToken = 0;

interface ActiveCalendarModal {
  token: number;
  actorId?: string;
  calendarId: string | null;
  mounted: { current: boolean };
  onClose: () => void;
}

let activeCalendarModal: ActiveCalendarModal | null = null;

function publishCalendarMutationSnapshot(
  actorId: string,
  updates: Partial<ActorCalendarMutationState>,
): void {
  const next = {
    ...(calendarMutationByActor.get(actorId) ?? emptyActorCalendarMutation),
    ...updates,
  };
  if (!next.inFlight && !next.reconciliation) calendarMutationByActor.delete(actorId);
  else calendarMutationByActor.set(actorId, next);
  calendarMutationRevision = { revision: calendarMutationRevision.revision + 1 };
  for (const listener of calendarMutationListeners) listener();
}

function subscribeCalendarMutationSnapshot(listener: () => void): () => void {
  calendarMutationListeners.add(listener);
  return () => calendarMutationListeners.delete(listener);
}

function getCalendarMutationRevision(): { revision: number } {
  return calendarMutationRevision;
}

function getActorCalendarMutation(actorId: string | undefined): ActorCalendarMutationState {
  return actorId
    ? calendarMutationByActor.get(actorId) ?? emptyActorCalendarMutation
    : emptyActorCalendarMutation;
}

function isCurrentCalendarActor(actorId: string): boolean {
  return useAuthStore.getState().currentUser?.id === actorId;
}

function cloneCalendar(calendar: BflowCalendar): BflowCalendar {
  return {
    ...calendar,
    members: calendar.members.map((member) => ({ ...member })),
  };
}

function normalizedMemberKeys(members: CalendarMember[]): string[] {
  return members
    .map((member) => `${member.userId}\u0000${member.canEdit ? '1' : '0'}`)
    .sort();
}

function normalizedInputMemberKeys(members: NonNullable<CalendarCreateInput['members']>): string[] {
  return members
    .map((member) => `${member.user_id}\u0000${member.can_edit ? '1' : '0'}`)
    .sort();
}

function membersMatchInput(
  calendarMembers: CalendarMember[],
  inputMembers: NonNullable<CalendarCreateInput['members']>,
): boolean {
  const canonical = normalizedMemberKeys(calendarMembers);
  const intended = normalizedInputMemberKeys(inputMembers);
  return canonical.length === intended.length
    && canonical.every((value, index) => value === intended[index]);
}

function calendarMatchesUpdates(calendar: BflowCalendar, updates: CalendarUpdateInput): boolean {
  if (updates.name !== undefined && calendar.name !== updates.name) return false;
  if (updates.color !== undefined && calendar.color !== updates.color) return false;
  if (updates.visibility !== undefined && calendar.visibility !== updates.visibility) return false;
  if (updates.members !== undefined && !membersMatchInput(calendar.members, updates.members)) return false;
  return true;
}

function verifyCalendarIntent(
  intent: CalendarMutationIntent,
  calendars: BflowCalendar[],
): CalendarVerification {
  if (intent.kind === 'create') {
    const beforeIds = new Set(intent.beforeCalendarIds);
    const newCalendars = calendars.filter((calendar) => !beforeIds.has(calendar.id));
    const expectedMembers = intent.input.visibility === 'private'
      ? []
      : intent.input.members ?? [];
    const exactMatches = newCalendars.filter((calendar) => (
      !calendar.isPersonal
      && calendar.ownerId === intent.actorId
      && calendar.name === intent.input.name
      && calendar.color === intent.input.color
      && calendar.visibility === intent.input.visibility
      && membersMatchInput(calendar.members, expectedMembers)
    ));
    if (exactMatches.length === 1) return 'committed';
    if (exactMatches.length === 0 && newCalendars.length === 0) return 'not-committed';
    return 'ambiguous';
  }

  const target = calendars.find((calendar) => calendar.id === intent.calendarId);
  if (intent.kind === 'delete') return target ? 'not-committed' : 'committed';
  if (!target) return 'ambiguous';
  if (calendarMatchesUpdates(target, intent.updates)) return 'committed';
  if (calendarMatchesUpdates(target, {
    ...(intent.updates.name !== undefined ? { name: intent.beforeCalendar.name } : {}),
    ...(intent.updates.color !== undefined ? { color: intent.beforeCalendar.color } : {}),
    ...(intent.updates.visibility !== undefined ? { visibility: intent.beforeCalendar.visibility } : {}),
    ...(intent.updates.members !== undefined ? {
      members: intent.beforeCalendar.members.map((member) => ({
        user_id: member.userId,
        can_edit: member.canEdit,
      })),
    } : {}),
  })) return 'not-committed';
  return 'ambiguous';
}

function intentMatchesModal(
  intent: CalendarMutationIntent | undefined,
  calendar: BflowCalendar | undefined,
  actorId: string | undefined,
): boolean {
  if (!intent || !actorId || intent.actorId !== actorId) return false;
  if (intent.kind === 'create') return calendar === undefined;
  return calendar?.id === intent.calendarId;
}

function closeActiveModalForIntent(intent: CalendarMutationIntent): void {
  const active = activeCalendarModal;
  if (!active?.mounted.current || active.actorId !== intent.actorId) return;
  if (intent.kind === 'create') {
    if (active.calendarId !== null) return;
  } else if (active.calendarId !== intent.calendarId) return;
  active.onClose();
}

function uniqueMembers(members: CalendarMember[], ownerId: string): CalendarMember[] {
  const seen = new Set<string>();
  return members.filter((member) => {
    if (!member.userId || member.userId === ownerId || seen.has(member.userId)) return false;
    seen.add(member.userId);
    return true;
  });
}

export function CalendarSettingsModal({ calendar, eventCount, onClose }: CalendarSettingsModalProps) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const users = useAuthStore((state) => state.users);
  useSyncExternalStore(
    subscribeCalendarMutationSnapshot,
    getCalendarMutationRevision,
    getCalendarMutationRevision,
  );
  const sharedMutation = getActorCalendarMutation(currentUser?.id);
  const isCreate = calendar === undefined;
  const isPersonal = calendar?.isPersonal ?? false;
  const ownerId = calendar?.ownerId ?? currentUser?.id ?? '';
  const modalInstanceTokenRef = useRef(0);
  if (modalInstanceTokenRef.current === 0) {
    modalInstanceTokenRef.current = ++nextCalendarModalInstanceToken;
  }
  const mountedRef = useRef(true);
  activeCalendarModal = {
    token: modalInstanceTokenRef.current,
    actorId: currentUser?.id,
    calendarId: calendar?.id ?? null,
    mounted: mountedRef,
    onClose,
  };
  const sharedIntent = sharedMutation.inFlight?.intent ?? sharedMutation.reconciliation?.intent;
  const modalIntent = intentMatchesModal(sharedIntent, calendar, currentUser?.id)
    ? sharedIntent
    : undefined;
  const initialUpdates = modalIntent?.kind === 'update' ? modalIntent.updates : undefined;
  const initialMemberInput = modalIntent?.kind === 'create'
    ? modalIntent.input.members
    : initialUpdates?.members;
  const [name, setName] = useState(() => (
    modalIntent?.kind === 'create'
      ? modalIntent.input.name
      : initialUpdates?.name ?? calendar?.name ?? ''
  ));
  const [color, setColor] = useState(() => (
    modalIntent?.kind === 'create'
      ? modalIntent.input.color
      : initialUpdates?.color ?? calendar?.color ?? EVENT_COLORS[0]
  ));
  const [visibility, setVisibility] = useState<CalendarVisibility>(() => (
    modalIntent?.kind === 'create'
      ? modalIntent.input.visibility
      : initialUpdates?.visibility ?? calendar?.visibility ?? 'members'
  ));
  const [members, setMembers] = useState<CalendarMember[]>(() => uniqueMembers(
    initialMemberInput?.map((member) => ({
      userId: member.user_id,
      canEdit: member.can_edit,
    })) ?? calendar?.members ?? [],
    ownerId,
  ));
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [localSaving, setSaving] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const mutationInFlight = sharedMutation.inFlight !== null;
  const reconciliationRequired = sharedMutation.reconciliation !== null;
  const mutationsLocked = mutationInFlight || reconciliationRequired;
  const saving = localSaving || mutationInFlight;
  const canChooseTeam = currentUser?.role === 'admin';
  const owner = users.find((user) => user.id === ownerId)
    ?? (currentUser?.id === ownerId ? currentUser : undefined);
  const ownerName = (owner?.name ?? ownerId) || '알 수 없음';

  const availableUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
    const memberIds = new Set(members.map((member) => member.userId));
    return users.filter((user) => (
      user.id !== ownerId
      && !memberIds.has(user.id)
      && (!normalizedQuery || user.name.toLocaleLowerCase('ko-KR').includes(normalizedQuery))
    ));
  }, [members, ownerId, query, users]);

  const editCount = members.filter((member) => member.canEdit).length;
  const viewCount = members.length - editCount;
  const showMembers = !isPersonal && visibility !== 'private';
  const createdDate = calendar?.createdAt?.slice(0, 10) || '-';
  const canSubmit = Boolean(name.trim() && currentUser && !saving && !reconciliationRequired);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (activeCalendarModal?.token === modalInstanceTokenRef.current) {
        activeCalendarModal = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (searchRef.current?.contains(event.target as Node)) return;
      setSearchOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [searchOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (searchOpen) setSearchOpen(false);
      else onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, searchOpen]);

  const addMember = (userId: string) => {
    if (userId === ownerId || members.some((member) => member.userId === userId)) return;
    setMembers((current) => [...current, { userId, canEdit: visibility === 'team' }]);
    setQuery('');
    setSearchOpen(false);
  };

  const setMemberPermission = (userId: string, canEdit: boolean) => {
    setMembers((current) => current.map((member) => (
      member.userId === userId ? { ...member, canEdit } : member
    )));
  };

  const removeMember = (userId: string) => {
    setMembers((current) => current.filter((member) => member.userId !== userId));
  };

  const refreshCanonicalCalendars = async (mode: CalendarRefreshMode): Promise<boolean> => {
    if (mode === 'events') return loadBflowEvents();
    const metadataFreshness = await useCalendarStore.getState().loadAll();
    return metadataFreshness.calendarsFresh;
  };

  const settleCalendarMutation = (
    token: number,
    actorId: string,
    reconciliation: PendingCalendarReconciliation | null,
  ): boolean => {
    if (getActorCalendarMutation(actorId).inFlight?.token !== token) return false;
    publishCalendarMutationSnapshot(actorId, {
      inFlight: null,
      reconciliation,
    });
    return true;
  };

  const finishVerifiedMutation = (
    token: number,
    intent: CalendarMutationIntent,
    successMessage: string,
  ): void => {
    if (!settleCalendarMutation(token, intent.actorId, null)) return;
    toast.success(successMessage);
    closeActiveModalForIntent(intent);
  };

  const reconcileFromCanonical = async () => {
    const actorId = currentUser?.id;
    if (!actorId) return;
    const actorMutation = getActorCalendarMutation(actorId);
    const pending = actorMutation.reconciliation;
    if (!pending || actorMutation.inFlight) return;
    const token = ++nextCalendarMutationToken;
    publishCalendarMutationSnapshot(actorId, {
      inFlight: {
        token,
        intent: pending.intent,
        refreshMode: pending.refreshMode,
      },
    });
    setSaving(true);
    let refreshed = false;
    try {
      refreshed = await refreshCanonicalCalendars(pending.refreshMode);
    } catch {
      refreshed = false;
    }
    if (!isCurrentCalendarActor(actorId)) {
      settleCalendarMutation(token, actorId, pending);
      if (mountedRef.current) setSaving(false);
      return;
    }
    if (!refreshed) {
      settleCalendarMutation(token, actorId, pending);
      setSaving(false);
      toast.error('최신 캘린더 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }

    if (pending.persistenceSucceeded) {
      setSaving(false);
      finishVerifiedMutation(token, pending.intent, pending.successMessage);
      return;
    }

    const verification = verifyCalendarIntent(
      pending.intent,
      useCalendarStore.getState().calendars,
    );
    if (verification === 'committed') {
      setSaving(false);
      finishVerifiedMutation(
        token,
        pending.intent,
        '응답은 받지 못했지만 최신 목록에서 변경 내용을 확인했어요.',
      );
      return;
    }
    if (verification === 'not-committed') {
      settleCalendarMutation(token, actorId, null);
      setSaving(false);
      toast.error('변경 내용이 저장되지 않은 것을 확인했어요. 내용을 확인하고 다시 시도해 주세요.');
      return;
    }
    settleCalendarMutation(token, actorId, pending);
    setSaving(false);
    toast.error('최신 목록에서도 저장 결과를 확정하지 못했어요. 잠시 후 다시 확인해 주세요.');
  };

  const runMutation = async (
    intent: CalendarMutationIntent,
    mutation: () => Promise<unknown>,
    successMessage: string,
    failureMessage: string,
    refreshEvents = false,
  ) => {
    const actorId = intent.actorId;
    const actorMutation = getActorCalendarMutation(actorId);
    if (actorMutation.inFlight || actorMutation.reconciliation) return;
    const refreshMode: CalendarRefreshMode = refreshEvents ? 'events' : 'metadata';
    const token = ++nextCalendarMutationToken;
    publishCalendarMutationSnapshot(actorId, {
      inFlight: { token, intent, refreshMode },
      reconciliation: null,
    });
    setSaving(true);
    let persistenceSucceeded = false;
    try {
      await mutation();
      persistenceSucceeded = true;
    } catch {
      persistenceSucceeded = false;
    }
    const reconciliation: PendingCalendarReconciliation = {
      intent,
      refreshMode,
      persistenceSucceeded,
      successMessage,
    };
    if (!isCurrentCalendarActor(actorId)) {
      settleCalendarMutation(token, actorId, reconciliation);
      if (mountedRef.current) setSaving(false);
      return;
    }
    let refreshed = false;
    try {
      refreshed = await refreshCanonicalCalendars(refreshMode);
    } catch {
      refreshed = false;
    }
    if (!isCurrentCalendarActor(actorId)) {
      settleCalendarMutation(token, actorId, reconciliation);
      if (mountedRef.current) setSaving(false);
      return;
    }

    if (persistenceSucceeded && refreshed) {
      setSaving(false);
      finishVerifiedMutation(token, intent, successMessage);
      return;
    }

    if (!persistenceSucceeded && refreshed) {
      const verification = verifyCalendarIntent(
        intent,
        useCalendarStore.getState().calendars,
      );
      if (verification === 'committed') {
        setSaving(false);
        finishVerifiedMutation(
          token,
          intent,
          '응답은 받지 못했지만 최신 목록에서 변경 내용을 확인했어요.',
        );
        return;
      }
    }

    settleCalendarMutation(token, actorId, reconciliation);
    setSaving(false);
    if (persistenceSucceeded) {
      toast.error('캘린더 변경은 저장됐지만 최신 목록을 불러오지 못했어요. 목록 확인만 다시 시도해 주세요.');
    } else if (refreshed) {
      toast.error('저장 응답을 받지 못해 최신 목록만으로 결과를 확정하지 못했어요. 목록을 다시 확인해 주세요.');
    } else {
      toast.error(`${failureMessage} 저장 결과도 확인할 수 없어 최신 목록을 다시 불러와 주세요.`);
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (
      !trimmedName
      || !currentUser
      || saving
      || mutationsLocked
      || getActorCalendarMutation(currentUser?.id).inFlight
      || getActorCalendarMutation(currentUser?.id).reconciliation
    ) return;
    const normalizedMembers = uniqueMembers(members, ownerId);
    const memberInput = normalizedMembers.map((member) => ({
      user_id: member.userId,
      can_edit: member.canEdit,
    }));

    if (isCreate) {
      const input: CalendarCreateInput = {
        name: trimmedName,
        color,
        visibility,
        members: visibility === 'private' ? [] : memberInput,
      };
      await runMutation(
        {
          kind: 'create',
          actorId: currentUser.id,
          input,
          beforeCalendarIds: useCalendarStore.getState().calendars.map((item) => item.id),
        },
        () => window.electronAPI.calendarCreate(input),
        '캘린더를 만들었어요',
        '캘린더를 만들지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
      return;
    }

    const nextVisibility: CalendarVisibility = isPersonal ? 'private' : visibility;
    const visibilityChanged = !isPersonal && nextVisibility !== calendar.visibility;
    const originalMembers = uniqueMembers(calendar.members, ownerId);
    const membersChanged = !isPersonal && (
      normalizedMembers.length !== originalMembers.length
      || normalizedMembers.some((member) => !originalMembers.some((original) => (
        original.userId === member.userId && original.canEdit === member.canEdit
      )))
    );
    const updates: CalendarUpdateInput = {};
    if (trimmedName !== calendar.name) updates.name = trimmedName;
    if (color !== calendar.color) updates.color = color;
    if (visibilityChanged) updates.visibility = nextVisibility;
    if (!isPersonal && (visibilityChanged || membersChanged)) {
      updates.members = nextVisibility === 'private' ? [] : memberInput;
    }
    await runMutation(
      {
        kind: 'update',
        actorId: currentUser.id,
        calendarId: calendar.id,
        updates,
        beforeCalendar: cloneCalendar(calendar),
      },
      () => window.electronAPI.calendarUpdate(calendar.id, updates),
      '캘린더 설정을 저장했어요',
      '캘린더 설정을 저장하지 못했어요. 다시 시도해 주세요.',
      updates.color !== undefined || visibilityChanged || membersChanged,
    );
  };

  const handleDelete = async () => {
    if (
      !calendar
      || !currentUser
      || calendar.isPersonal
      || !calendar.canManage
      || saving
      || mutationsLocked
      || getActorCalendarMutation(currentUser?.id).inFlight
      || getActorCalendarMutation(currentUser?.id).reconciliation
    ) return;
    const confirmed = await ConfirmDialog.show({
      message: `${calendar.name} 캘린더를 삭제할까요?\n일정 ${eventCount}개가 함께 삭제돼요.`,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (!confirmed) return;
    await runMutation(
      {
        kind: 'delete',
        actorId: currentUser.id,
        calendarId: calendar.id,
        beforeCalendar: cloneCalendar(calendar),
      },
      () => window.electronAPI.calendarDelete(calendar.id),
      '캘린더를 삭제했어요',
      '캘린더를 삭제하지 못했어요. 다시 시도해 주세요.',
      true,
    );
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.16 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black"
        onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={isCreate ? '새 캘린더' : '캘린더 설정'}
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="absolute bottom-0 right-0 top-0 z-50 flex w-[29rem] max-w-full flex-col overflow-hidden"
        style={{
          ...floatingGlassStyle,
          background: 'rgb(var(--color-bg-card) / 0.97)',
          borderLeft: '1px solid rgb(var(--color-bg-border) / 0.52)',
          boxShadow: '-14px 0 36px rgb(var(--color-shadow) / calc(var(--shadow-alpha) * 1.22))',
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-bg-border/70 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-bold text-text-primary">
              <Settings size={18} className="text-accent" />
              {isCreate ? '새 캘린더' : '캘린더 설정'}
            </h3>
            <button type="button" aria-label="닫기" onClick={onClose} className="rounded p-1 text-text-secondary hover:bg-bg-border/40 hover:text-text-primary cursor-pointer">
              <X size={17} />
            </button>
          </div>
          {!isCreate && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-text-secondary">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-bg-border/70 bg-bg-primary/70 px-2 py-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                소유자 {ownerName}
              </span>
              <span className="rounded-full border border-bg-border/70 bg-bg-primary/70 px-2 py-1">만든 날 {createdDate}</span>
              <span className="rounded-full border border-bg-border/70 bg-bg-primary/70 px-2 py-1">일정 {eventCount}개</span>
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">이름</label>
            <input
              aria-label="캘린더 이름"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="캘린더 이름"
              autoFocus
              className="mt-1.5 w-full rounded-lg border border-bg-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary/40 focus:border-accent"
            />
          </section>

          <section>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">색</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {EVENT_COLORS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  aria-label={`색상 ${candidate}`}
                  aria-pressed={color === candidate}
                  onClick={() => setColor(candidate)}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border-2 transition-transform cursor-pointer hover:scale-110',
                    color === candidate ? 'border-text-primary' : 'border-transparent',
                  )}
                  style={{ backgroundColor: candidate }}
                >
                  {color === candidate && <Check size={13} strokeWidth={3} className="text-white" />}
                </button>
              ))}
            </div>
          </section>

          {!isPersonal && (
            <section>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">공개 범위</span>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                {([
                  ['private', '나만'],
                  ['members', '특정 팀원'],
                  ['team', '팀 전체'],
                ] as const).map(([value, label]) => {
                  const disabled = value === 'team' && !canChooseTeam;
                  return (
                    <label key={value} className={cn('inline-flex items-center gap-1.5', disabled ? 'text-text-secondary/45' : 'text-text-primary cursor-pointer')}>
                      <input
                        aria-label={label}
                        type="radio"
                        name="calendar-visibility"
                        value={value}
                        checked={visibility === value}
                        disabled={disabled}
                        onChange={() => setVisibility(value)}
                        className="accent-accent"
                      />
                      {label}
                      {value === 'team' && !canChooseTeam && (
                        <span className="rounded border border-bg-border bg-bg-primary px-1.5 py-0.5 text-[9px] text-text-secondary">관리자만</span>
                      )}
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] text-text-secondary/75">
                {visibility === 'private' && '나만 이 캘린더를 볼 수 있어요.'}
                {visibility === 'members' && '아래에서 고른 팀원만 이 캘린더를 볼 수 있어요.'}
                {visibility === 'team' && '팀 전원이 볼 수 있고, 추가 편집자를 지정할 수 있어요.'}
              </p>
            </section>
          )}

          {showMembers && (
            <section>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                  {visibility === 'team' ? '추가 편집자' : '멤버'}
                </span>
                <span className="text-[10px] text-text-secondary">
                  {members.length + 1}명 · 편집 {editCount} · 보기 {viewCount}
                </span>
              </div>

              <div ref={searchRef} className="relative mt-2">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  aria-label="멤버 검색"
                  value={query}
                  onFocus={() => setSearchOpen(true)}
                  onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }}
                  placeholder="이름으로 추가…"
                  className="w-full rounded-lg border border-bg-border bg-bg-primary py-2 pl-9 pr-3 text-xs text-text-primary outline-none placeholder:text-text-secondary/55 focus:border-accent"
                />
                {searchOpen && (
                  <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-40 overflow-y-auto rounded-lg border border-bg-border bg-bg-card p-1.5 shadow-xl">
                    {availableUsers.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        aria-label={`${user.name} 추가`}
                        onClick={() => addMember(user.id)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-primary hover:bg-bg-primary cursor-pointer"
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: avatarColor(user.id) }}>
                          {user.name.charAt(0)}
                        </span>
                        <span>{user.name}</span>
                      </button>
                    ))}
                    {availableUsers.length === 0 && (
                      <p className="px-2 py-1.5 text-[11px] text-text-secondary">추가할 팀원이 없어요</p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3 space-y-1.5">
                <div className="flex items-center gap-2 rounded-lg border border-bg-border/60 bg-bg-primary/45 px-2.5 py-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: avatarColor(ownerId) }}>
                    {ownerName.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
                    {ownerName}{ownerId === currentUser?.id && <span className="ml-1 text-[10px] font-normal text-text-secondary">나</span>}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold text-amber-300">
                    <Crown size={10} /> 소유자
                  </span>
                  <span className="w-[52px] text-right text-[9px] text-text-secondary/60">변경 불가</span>
                </div>

                {members.map((member) => {
                  const user = users.find((candidate) => candidate.id === member.userId);
                  const memberName = user?.name ?? member.userId;
                  const isMe = member.userId === currentUser?.id;
                  return (
                    <div key={member.userId} className="flex items-center gap-2 rounded-lg border border-bg-border/60 bg-bg-primary/45 px-2.5 py-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: avatarColor(member.userId) }}>
                        {memberName.charAt(0)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
                        {memberName}{isMe && <span className="ml-1 text-[10px] font-normal text-text-secondary">나{currentUser?.role === 'admin' ? ' · 관리자' : ''}</span>}
                      </span>
                      <div className="flex rounded-md bg-bg-card p-0.5 text-[10px]">
                        <button
                          type="button"
                          aria-label={`${memberName} 보기 권한`}
                          aria-pressed={!member.canEdit}
                          onClick={() => setMemberPermission(member.userId, false)}
                          className={cn('rounded px-2 py-1 cursor-pointer', !member.canEdit ? 'bg-accent/20 text-accent' : 'text-text-secondary')}
                        >
                          보기
                        </button>
                        <button
                          type="button"
                          aria-label={`${memberName} 편집 권한`}
                          aria-pressed={member.canEdit}
                          onClick={() => setMemberPermission(member.userId, true)}
                          className={cn('rounded px-2 py-1 cursor-pointer', member.canEdit ? 'bg-accent/20 text-accent' : 'text-text-secondary')}
                        >
                          편집
                        </button>
                      </div>
                      <button
                        type="button"
                        aria-label={`${memberName} 제거`}
                        onClick={() => removeMember(member.userId)}
                        className="flex h-7 w-7 items-center justify-center rounded text-text-secondary/60 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <p className="mt-2 text-[10px] leading-4 text-text-secondary/70">
                {visibility === 'team'
                  ? '추가 편집자는 일정을 추가·수정·삭제할 수 있어요.'
                  : '편집 멤버는 일정을 추가·수정·삭제할 수 있고, 보기 멤버는 볼 수만 있어요.'}
              </p>
            </section>
          )}
        </div>

        {reconciliationRequired && (
          <div className="mx-5 mb-4 rounded-lg border border-amber-400/35 bg-amber-400/10 p-3">
            <p className="text-[11px] leading-4 text-text-secondary">
              {sharedMutation.reconciliation?.persistenceSucceeded
                ? '캘린더 변경은 저장됐어요. 최신 목록 반영만 다시 확인해 주세요.'
                : '저장 결과를 아직 확정할 수 없어 캘린더 변경을 잠시 멈췄어요.'}
            </p>
            <button
              type="button"
              aria-label="최신 캘린더 목록 다시 불러오기"
              onClick={reconcileFromCanonical}
              disabled={saving}
              className="mt-2 w-full rounded-md border border-bg-border px-2 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-bg-border/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              최신 목록 다시 불러오기
            </button>
          </div>
        )}

        <footer className="flex items-center justify-between gap-3 border-t border-bg-border/70 bg-bg-card/95 px-5 py-4">
          <div>
            {!isCreate && !isPersonal && calendar.canManage && (
              <button type="button" onClick={handleDelete} disabled={saving || reconciliationRequired} className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-40 cursor-pointer">
                <Trash2 size={14} /> 캘린더 삭제
              </button>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-2 text-xs text-text-secondary hover:bg-bg-primary hover:text-text-primary disabled:opacity-40 cursor-pointer">취소</button>
            <button type="button" onClick={handleSave} disabled={!canSubmit} className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer">
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </footer>
      </motion.div>
    </>
  );
}
