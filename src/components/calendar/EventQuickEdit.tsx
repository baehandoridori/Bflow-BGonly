import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { CalendarDays, Copy, Pencil, Tags, Trash2 } from 'lucide-react';
import type { CalendarEvent, CalendarEventType } from '@/types/calendar';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { isOptimisticCalendarTagId, useCalendarStore } from '@/stores/useCalendarStore';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';
import { floatingGlassStyle } from '@/utils/glassStyles';
import { calendarEventIdentityKey } from '@/utils/calendarEventIdentity';
import {
  directUpdateSnapshot,
  eventContentSnapshot,
  isLocalMutationSnapshot,
  type LocalMutationRecovery,
} from '@/utils/calendarLocalMutation';

interface EventQuickEditProps {
  event: CalendarEvent;
  position: { x: number; y: number };
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<CalendarEvent>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onDuplicate: (event: CalendarEvent) => void;
}

type TabKey = 'calendar' | 'edit';

interface PendingSelection<T> {
  eventId: string;
  value: T;
  requestId: number;
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return typeof (value as { then?: unknown } | null)?.then === 'function';
}

const TYPE_OPTIONS: { value: CalendarEventType; label: string }[] = [
  { value: 'custom', label: '커스텀' },
  { value: 'episode', label: '에피소드' },
  { value: 'part', label: '파트' },
  { value: 'scene', label: '씬' },
];

export function EventQuickEdit({
  event,
  position,
  onClose,
  onUpdate,
  onDelete,
  onDuplicate,
}: EventQuickEditProps) {
  const colorMode = useAppStore((state) => state.colorMode);
  const users = useAuthStore((state) => state.users);
  const calendars = useCalendarStore((state) => state.calendars);
  const tags = useCalendarStore((state) => state.tags);
  const editableCalendars = useMemo(() => calendars.filter((calendar) => calendar.canEdit), [calendars]);
  const sortedTags = useMemo(() => tags
    .filter((tag) => !isOptimisticCalendarTagId(tag.id))
    .sort((left, right) => left.sortOrder - right.sortOrder), [tags]);
  const ref = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState(position);
  const [tab, setTab] = useState<TabKey>('calendar');
  const [title, setTitle] = useState(event.title);
  const [startDate, setStartDate] = useState(event.startDate);
  const [endDate, setEndDate] = useState(event.endDate);
  const [type, setType] = useState<CalendarEventType>(event.type);
  const [memo, setMemo] = useState(event.memo);
  const [pendingCalendar, setPendingCalendar] = useState<PendingSelection<string | undefined> | null>(null);
  const [pendingTag, setPendingTag] = useState<PendingSelection<string | undefined> | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  // 저장/삭제가 진행 중이면 같은 일정의 다음 요청을 막는다. 두 요청이 겹치면
  // 먼저 보낸 오래된 초안이 나중에 커밋돼 방금 저장한 내용을 되돌릴 수 있다.
  const [isMutating, setIsMutating] = useState(false);
  const [allDay, setAllDay] = useState(event.allDay ?? true);
  const [startTime, setStartTime] = useState(event.startTime ?? '');
  const [endTime, setEndTime] = useState(event.endTime ?? '');
  const calendarUpdateRequestRef = useRef(0);
  const tagUpdateRequestRef = useRef(0);
  const eventIdentityKey = calendarEventIdentityKey(event);
  const eventSnapshot = eventContentSnapshot(event);
  const latestEventRef = useRef(event);
  const pendingMutationRef = useRef<LocalMutationRecovery | null>(null);
  const failedMutationRecoveryRef = useRef<LocalMutationRecovery | null>(null);

  const isVacation = event.type === 'vacation';
  const isWriteProtected = event.isReadOnly === true || event.canEdit === false;
  const canWrite = !isVacation && !isWriteProtected;
  const isCanonicalBflow = event.sourceCalendarId?.startsWith('bflow:') === true && Boolean(event.calendarId);
  // 시각 편집 지원 범위는 상세 패널과 동일하게 캐노니컬 B flow + 구글 일정만이다.
  const supportsTimeEditing = isCanonicalBflow || event.source === 'google';
  const hasInvalidTimedInterval = supportsTimeEditing
    && !allDay
    && Boolean(startTime && endTime)
    && `${endDate}T${endTime}` <= `${startDate}T${startTime}`;
  const isTimedSaveBlocked = supportsTimeEditing
    && !allDay
    && (!startTime || !endTime || hasInvalidTimedInterval);
  const displayedCalendarId = pendingCalendar?.eventId === event.id
    ? pendingCalendar.value
    : event.calendarId;
  const displayedTagId = pendingTag?.eventId === event.id
    ? pendingTag.value
    : event.tagId;
  const calendarSelectionPending = pendingCalendar?.eventId === event.id;
  const tagSelectionPending = pendingTag?.eventId === event.id;
  const derivedFieldsDescriptionId = isCanonicalBflow ? `calendar-derived-fields-${event.id}` : undefined;
  const readOnlyDescriptionId = isWriteProtected || isVacation ? `calendar-read-only-${event.id}` : undefined;
  const currentCalendar = calendars.find((calendar) => calendar.id === event.calendarId);
  const currentTag = tags.find((tag) => tag.id === event.tagId);
  const fieldStyle = {
    background: 'rgb(var(--color-bg-primary) / 0.82)',
    border: '1px solid rgb(var(--color-bg-border) / 0.56)',
    color: 'rgb(var(--color-text-primary))',
  } as const;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    let { x, y } = position;
    if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
    if (x < 4) x = 4;
    if (y < 4) y = 4;
    setAdjusted({ x, y });
  }, [position]);

  useEffect(() => {
    const handleClick = (mouseEvent: MouseEvent) => {
      if (ref.current && !ref.current.contains(mouseEvent.target as Node)) onClose();
    };
    const handleKey = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  useEffect(() => {
    latestEventRef.current = event;
    if (pendingMutationRef.current?.identityKey === eventIdentityKey) return;

    const failedRecovery = failedMutationRecoveryRef.current;
    if (failedRecovery?.identityKey === eventIdentityKey) {
      if (isLocalMutationSnapshot(failedRecovery, eventSnapshot)) return;
    }

    failedMutationRecoveryRef.current = null;
    setTitle(event.title);
    setStartDate(event.startDate);
    setEndDate(event.endDate);
    setType(event.type);
    setMemo(event.memo);
    setAllDay(event.allDay ?? true);
    setStartTime(event.startTime ?? '');
    setEndTime(event.endTime ?? '');
    setMutationError(null);
  }, [event, eventIdentityKey, eventSnapshot]);

  const beginMutation = useCallback((mutation: LocalMutationRecovery) => {
    pendingMutationRef.current = mutation;
    failedMutationRecoveryRef.current = null;
    setIsMutating(true);
  }, []);

  const settleMutation = useCallback((mutation: LocalMutationRecovery): boolean => {
    if (pendingMutationRef.current !== mutation) return false;
    pendingMutationRef.current = null;
    setIsMutating(false);
    return true;
  }, []);

  const markMutationFailed = useCallback((mutation: LocalMutationRecovery, message: string) => {
    if (!settleMutation(mutation)) return;
    const latestEvent = latestEventRef.current;
    const latestSnapshot = calendarEventIdentityKey(latestEvent) === mutation.identityKey
      ? eventContentSnapshot(latestEvent)
      : undefined;
    if (latestSnapshot === undefined || !isLocalMutationSnapshot(mutation, latestSnapshot)) {
      failedMutationRecoveryRef.current = null;
      setTitle(latestEvent.title);
      setStartDate(latestEvent.startDate);
      setEndDate(latestEvent.endDate);
      setType(latestEvent.type);
      setMemo(latestEvent.memo);
      setAllDay(latestEvent.allDay ?? true);
      setStartTime(latestEvent.startTime ?? '');
      setEndTime(latestEvent.endTime ?? '');
      setMutationError(null);
      return;
    }
    failedMutationRecoveryRef.current = mutation;
    setMutationError(message);
  }, [settleMutation]);

  const handleSave = useCallback(() => {
    if (!canWrite || pendingMutationRef.current || isTimedSaveBlocked) return;
    const updates: Partial<CalendarEvent> = {};
    if (title !== event.title) updates.title = title;
    if (startDate !== event.startDate || endDate !== event.endDate) {
      updates.startDate = startDate;
      updates.endDate = endDate;
    }
    if (memo !== event.memo) updates.memo = memo;
    if (!isCanonicalBflow && type !== event.type) updates.type = type;
    if (supportsTimeEditing) {
      const allDayChanged = allDay !== (event.allDay ?? true);
      if (allDayChanged) updates.allDay = allDay;
      if (allDay) {
        if (allDayChanged) {
          updates.startTime = undefined;
          updates.endTime = undefined;
        }
      } else {
        if (startTime !== event.startTime) updates.startTime = startTime;
        if (endTime !== event.endTime) updates.endTime = endTime;
      }
    }
    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }
    setMutationError(null);
    const mutation: LocalMutationRecovery = {
      identityKey: eventIdentityKey,
      rollbackSnapshot: eventSnapshot,
      optimisticSnapshot: directUpdateSnapshot(event, updates),
    };
    beginMutation(mutation);
    try {
      const persistence = onUpdate(event.id, updates);
      if (isPromiseLike(persistence)) {
        void persistence.then(
          () => {
            if (settleMutation(mutation)) onClose();
          },
          () => markMutationFailed(mutation, '일정 저장에 실패했어요. 다시 시도해 주세요.'),
        );
        return;
      }
      if (settleMutation(mutation)) onClose();
    } catch {
      markMutationFailed(mutation, '일정 저장에 실패했어요. 다시 시도해 주세요.');
    }
  }, [allDay, beginMutation, canWrite, endDate, endTime, event, eventIdentityKey, eventSnapshot, isCanonicalBflow, isTimedSaveBlocked, markMutationFailed, memo, onClose, onUpdate, settleMutation, startDate, startTime, supportsTimeEditing, title, type]);

  const handleDelete = useCallback(() => {
    if (!canWrite || pendingMutationRef.current) return;
    setMutationError(null);
    const mutation: LocalMutationRecovery = {
      identityKey: eventIdentityKey,
      rollbackSnapshot: eventSnapshot,
    };
    beginMutation(mutation);
    try {
      const persistence = onDelete(event.id);
      if (isPromiseLike(persistence)) {
        void persistence.then(
          () => {
            if (settleMutation(mutation)) onClose();
          },
          () => markMutationFailed(mutation, '일정 삭제에 실패했어요. 다시 시도해 주세요.'),
        );
        return;
      }
      if (settleMutation(mutation)) onClose();
    } catch {
      markMutationFailed(mutation, '일정 삭제에 실패했어요. 다시 시도해 주세요.');
    }
  }, [beginMutation, canWrite, event, eventIdentityKey, eventSnapshot, markMutationFailed, onClose, onDelete, settleMutation]);

  const handleDuplicate = useCallback(() => {
    onDuplicate(event);
    onClose();
  }, [event, onClose, onDuplicate]);

  const handleCalendarChange = useCallback(async (calendarId: string) => {
    if (!canWrite || !isCanonicalBflow || calendarSelectionPending || calendarId === displayedCalendarId) return;
    const requestId = ++calendarUpdateRequestRef.current;
    setPendingCalendar({
      eventId: event.id,
      value: calendarId,
      requestId,
    });
    try {
      await onUpdate(event.id, { calendarId });
    } catch {
      // The canonical event remains the rollback source below.
    }
    setPendingCalendar((current) => current?.requestId === requestId ? null : current);
  }, [calendarSelectionPending, canWrite, displayedCalendarId, event.id, isCanonicalBflow, onUpdate]);

  const handleTagChange = useCallback(async (tagId: string | undefined) => {
    if (!canWrite || !isCanonicalBflow || tagSelectionPending || tagId === displayedTagId) return;
    const requestId = ++tagUpdateRequestRef.current;
    setPendingTag({
      eventId: event.id,
      value: tagId,
      requestId,
    });
    try {
      await onUpdate(event.id, { tagId });
    } catch {
      // The canonical event remains the rollback source below.
    }
    setPendingTag((current) => current?.requestId === requestId ? null : current);
  }, [canWrite, displayedTagId, event.id, isCanonicalBflow, onUpdate, tagSelectionPending]);

  // 자체 AnimatePresence 로 감싸면 부모 presence 의 exit 가 전파되지 않아 닫힘 애니가 죽는다
  // (framer-motion 10.x). presence 는 ScheduleView 쪽 조건부 렌더가 소유한다.
  return createPortal(
      <motion.div
        ref={ref}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        className="fixed z-[1000]"
        style={{
          ...floatingGlassStyle,
          left: adjusted.x,
          top: adjusted.y,
          width: 300,
          background: 'rgb(var(--color-bg-card) / 0.95)',
          borderRadius: 12,
          boxShadow: '0 16px 36px rgb(var(--color-shadow) / calc(var(--shadow-alpha) * 1.28))',
        }}
      >
        {readOnlyDescriptionId && (
          <p id={readOnlyDescriptionId} className="sr-only">보기 전용 일정이라 변경하거나 삭제할 수 없지만 복사는 가능합니다.</p>
        )}
        {derivedFieldsDescriptionId && (
          <p id={derivedFieldsDescriptionId} className="sr-only">유형은 연결 정보에서 자동으로 결정됩니다.</p>
        )}
        {mutationError && (
          <p role="alert" className="mx-3 mt-3 rounded-md bg-red-500/10 px-2.5 py-2 text-xs text-red-300">
            {mutationError}
          </p>
        )}

        <div className="flex border-b" style={{ borderColor: 'rgb(var(--color-bg-border) / 0.45)' }}>
          <button
            onClick={() => setTab('calendar')}
            className="flex-1 py-2.5 text-xs font-medium transition-colors cursor-pointer"
            style={{
              color: tab === 'calendar' ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))',
              borderBottom: tab === 'calendar' ? '2px solid rgb(var(--color-accent))' : '2px solid transparent',
            }}
          >
            <Tags size={12} className="inline mr-1" /> 태그·캘린더
          </button>
          <button
            disabled={!canWrite}
            aria-describedby={readOnlyDescriptionId}
            onClick={() => canWrite && setTab('edit')}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${canWrite ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
            style={{
              color: tab === 'edit' ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))',
              borderBottom: tab === 'edit' ? '2px solid rgb(var(--color-accent))' : '2px solid transparent',
            }}
          >
            <Pencil size={12} className="inline mr-1" /> 일정 편집
          </button>
        </div>

        <div className="p-3">
          {tab === 'calendar' ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: event.color }} />
                <span className="truncate text-xs font-medium text-text-primary">{event.title}</span>
                {(isWriteProtected || isVacation) && (
                  <span className="ml-auto rounded-full border border-bg-border/70 px-1.5 py-0.5 text-[9px] text-text-secondary">보기 전용</span>
                )}
              </div>

              {isCanonicalBflow ? (
                canWrite ? (
                  <>
                    <div>
                      <label className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">캘린더</label>
                      <div className="relative mt-1">
                        <CalendarDays size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
                        <select
                          aria-label="캘린더"
                          value={displayedCalendarId}
                          disabled={calendarSelectionPending}
                          onChange={(changeEvent) => {
                            const calendarId = changeEvent.target.value;
                            return handleCalendarChange(calendarId);
                          }}
                          className="w-full rounded-lg border border-bg-border/60 bg-bg-primary/80 py-1.5 pl-7 pr-2 text-xs text-text-primary outline-none focus:border-accent/60"
                        >
                          {editableCalendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">태그</label>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          aria-pressed={displayedTagId === undefined}
                          disabled={tagSelectionPending}
                          onClick={() => handleTagChange(undefined)}
                          className={`rounded-full px-2 py-1 text-[10px] ${displayedTagId === undefined ? 'bg-accent/20 text-accent' : 'bg-bg-primary/80 text-text-secondary'}`}
                        >
                          없음
                        </button>
                        {sortedTags.map((tag) => {
                          const selected = displayedTagId === tag.id;
                          return (
                            <button
                              type="button"
                              key={tag.id}
                              aria-pressed={selected}
                              disabled={tagSelectionPending}
                              onClick={() => handleTagChange(tag.id)}
                              className="rounded-full border px-2 py-1 text-[10px]"
                              style={{
                                color: selected ? tag.color : 'rgb(var(--color-text-secondary))',
                                borderColor: selected ? tag.color : 'rgb(var(--color-bg-border) / 0.65)',
                                background: selected ? `color-mix(in srgb, ${tag.color} 18%, transparent)` : 'transparent',
                              }}
                            >
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-bg-border/55 bg-bg-primary/45 px-3 py-2 text-[11px] text-text-secondary">
                    {currentCalendar?.name ?? 'B flow 캘린더'}{currentTag ? ` · ${currentTag.name}` : ' · 태그 없음'}
                  </div>
                )
              ) : (
                <div className="rounded-lg border border-bg-border/55 bg-bg-primary/45 px-3 py-2 text-[11px] leading-relaxed text-text-secondary">
                  Google 또는 이전 형식 일정은 현재 저장소를 유지합니다.
                </div>
              )}

              <div className="flex gap-2">
                <button
                  aria-describedby={readOnlyDescriptionId}
                  onClick={handleDuplicate}
                  className="flex-1 cursor-pointer rounded-lg bg-bg-primary/80 py-1.5 text-xs text-text-primary transition-colors hover:bg-bg-border/40"
                >
                  <Copy size={12} className="mr-1.5 inline" /> 복사
                </button>
                <button
                  disabled={!canWrite || isMutating}
                  aria-describedby={readOnlyDescriptionId}
                  onClick={canWrite ? handleDelete : undefined}
                  className="flex-1 cursor-pointer rounded-lg py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-45"
                  style={{ background: 'rgba(255,107,107,0.15)', color: '#FF6B6B' }}
                >
                  <Trash2 size={12} className="mr-1.5 inline" /> 삭제
                </button>
              </div>
            </div>
          ) : (
            <div>
              {!canWrite ? (
                <p className="py-6 text-center text-xs text-text-secondary">보기 전용 일정은 여기서 편집할 수 없습니다</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <input
                    type="text"
                    value={title}
                    disabled={isMutating}
                    onChange={(changeEvent) => setTitle(changeEvent.target.value)}
                    placeholder="일정 제목"
                    className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none placeholder:text-text-secondary/45"
                    style={fieldStyle}
                  />
                  <div className="flex gap-2">
                    <input type="date" value={startDate} disabled={isMutating} onChange={(changeEvent) => setStartDate(changeEvent.target.value)} className="flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none" style={{ ...fieldStyle, colorScheme: colorMode }} />
                    <input type="date" value={endDate} disabled={isMutating} onChange={(changeEvent) => setEndDate(changeEvent.target.value)} className="flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none" style={{ ...fieldStyle, colorScheme: colorMode }} />
                  </div>
                  {supportsTimeEditing && (
                    <label className="flex items-center justify-between gap-3 text-[11px] font-medium text-text-secondary">
                      <span>종일</span>
                      <input
                        aria-label="종일 일정"
                        type="checkbox"
                        checked={allDay}
                        disabled={isMutating}
                        onChange={(changeEvent) => {
                          const checked = changeEvent.target.checked;
                          setAllDay(checked);
                          if (!checked) {
                            if (!startTime) setStartTime('09:00');
                            if (!endTime) setEndTime('10:00');
                          }
                        }}
                        className="h-3.5 w-3.5 rounded accent-accent cursor-pointer"
                      />
                    </label>
                  )}
                  {supportsTimeEditing && !allDay && (
                    <div className="flex gap-2">
                      <input
                        aria-label="시작 시각"
                        type="time"
                        step={600}
                        value={startTime}
                        disabled={isMutating}
                        onChange={(changeEvent) => setStartTime(changeEvent.target.value)}
                        className="flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none"
                        style={{ ...fieldStyle, colorScheme: colorMode }}
                      />
                      <input
                        aria-label="종료 시각"
                        type="time"
                        step={600}
                        value={endTime}
                        disabled={isMutating}
                        onChange={(changeEvent) => setEndTime(changeEvent.target.value)}
                        className="flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none"
                        style={{ ...fieldStyle, colorScheme: colorMode }}
                      />
                    </div>
                  )}
                  {hasInvalidTimedInterval && (
                    <p role="alert" className="text-[11px] font-medium text-red-400">
                      종료 시각은 시작 시각보다 뒤여야 해요.
                    </p>
                  )}
                  <div className="flex gap-1">
                    {TYPE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        disabled={isCanonicalBflow || isMutating}
                        aria-describedby={derivedFieldsDescriptionId}
                        onClick={isCanonicalBflow ? undefined : () => setType(option.value)}
                        className="flex-1 cursor-pointer rounded-lg py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70"
                        style={{
                          background: type === option.value ? 'rgb(var(--color-accent))' : 'rgb(var(--color-bg-primary) / 0.82)',
                          color: type === option.value ? 'rgb(var(--color-on-accent))' : 'rgb(var(--color-text-secondary))',
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <EntityAwareInput
                    multiline
                    value={memo ?? ''}
                    disabled={isMutating}
                    onChange={setMemo}
                    users={users}
                    rows={3}
                    placeholder="메모"
                    dropdownPositionClassName="left-2 right-2"
                    className="w-full resize-none rounded-lg border border-bg-border/[0.56] bg-bg-primary/[0.82] px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-secondary/45"
                  />
                  <button onClick={handleSave} disabled={isMutating || isTimedSaveBlocked} className="w-full cursor-pointer rounded-lg py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45" style={{ background: 'rgb(var(--color-accent))', color: 'rgb(var(--color-on-accent))' }}>저장</button>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>,
    document.body,
  );
}
