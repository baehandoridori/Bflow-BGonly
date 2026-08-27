import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Pencil,
  Trash2,
  ExternalLink,
  Clock,
  FileText,
  MapPin,
  Palmtree,
  Save,
  XCircle,
  CheckSquare,
} from 'lucide-react';
import type { CalendarEvent, CalendarEventType } from '@/types/calendar';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  getTagCanonicalSnapshot,
  isOptimisticCalendarTagId,
  useCalendarStore,
} from '@/stores/useCalendarStore';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';
import { EntityText } from '@/components/common/EntityText';
import { DEPARTMENT_CONFIGS } from '@/types';
import { floatingGlassStyle } from '@/utils/glassStyles';
import { parseDate } from '@/utils/calendarDate';
import { calendarEventIdentityKey, calendarEventLinkedTodoId } from '@/utils/calendarEventIdentity';

// ─── 유틸 ──────────────────────────────────────────

function formatDate(d: Date): string {
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday})`;
}

function formatDateRange(start: string, end: string): string {
  const s = parseDate(start);
  const e = parseDate(end);
  if (start === end) return formatDate(s);
  return `${formatDate(s)} → ${formatDate(e)}`;
}

function calcDDay(endDate: string): string {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const end = parseDate(endDate);
  const diff = Math.round((end.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'D-DAY';
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

function toInputDate(s: string): string {
  return s; // already YYYY-MM-DD
}

function fromInputDate(s: string): string {
  return s; // already YYYY-MM-DD
}

// ─── 타입 라벨 ─────────────────────────────────────

const TYPE_LABELS: Record<CalendarEventType, string> = {
  custom: '일반 이벤트',
  episode: '에피소드',
  part: '파트',
  scene: '씬',
  vacation: '휴가',
};

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return typeof (value as { then?: unknown } | null)?.then === 'function';
}

// ─── 인터페이스 ────────────────────────────────────

interface EventSidePanelProps {
  event: CalendarEvent;
  onClose: () => void;
  onDelete: (id: string) => void | Promise<void>;
  onUpdate: (id: string, updates: Partial<CalendarEvent>) => void | Promise<void>;
  onNavigate: (ev: CalendarEvent) => void;
}

// ─── 슬라이드 트랜지션 ────────────────────────────

const panelVariants = {
  initial: { x: 300, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: 300, opacity: 0 },
};

const panelTransition = {
  duration: 0.25,
  ease: [0.16, 1, 0.3, 1],
};

// ─── 컴포넌트 ──────────────────────────────────────

export function EventSidePanel({
  event,
  onClose,
  onDelete,
  onUpdate,
  onNavigate,
}: EventSidePanelProps) {
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const setView = useAppStore((s) => s.setView);
  const colorMode = useAppStore((s) => s.colorMode);
  const [editing, setEditing] = useState(false);

  // 편집 드래프트
  const [draftTitle, setDraftTitle] = useState(event.title);
  const [draftStart, setDraftStart] = useState(event.startDate);
  const [draftEnd, setDraftEnd] = useState(event.endDate);
  const [draftMemo, setDraftMemo] = useState(event.memo);
  const [draftCalendarId, setDraftCalendarId] = useState(event.calendarId ?? '');
  const [draftTagId, setDraftTagId] = useState<string | undefined>(event.tagId);
  const [draftAllDay, setDraftAllDay] = useState(event.allDay ?? true);
  const [draftStartTime, setDraftStartTime] = useState(event.startTime ?? '');
  const [draftEndTime, setDraftEndTime] = useState(event.endTime ?? '');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const users = useAuthStore((s) => s.users);
  const userNames = useMemo(() => users.map((u) => u.name), [users]);
  const currentUser = useAuthStore((state) => state.currentUser);
  const calendars = useCalendarStore((state) => state.calendars);
  const tags = useCalendarStore((state) => state.tags);
  const optimisticDeletedTagIds = useCalendarStore((state) => state.optimisticDeletedTagIds);
  const editableCalendars = useMemo(() => calendars.filter((calendar) => calendar.canEdit), [calendars]);
  const sortedTags = useMemo(() => tags
    .filter((tag) => !isOptimisticCalendarTagId(tag.id))
    .sort((left, right) => left.sortOrder - right.sortOrder), [tags]);
  const selectableTagIds = useMemo(() => new Set(sortedTags.map((tag) => tag.id)), [sortedTags]);
  const deletedTagIds = new Set(optimisticDeletedTagIds);
  const canonicalTagSnapshot = getTagCanonicalSnapshot(currentUser?.id);
  const canonicalTagIds = canonicalTagSnapshot
    ? new Set(canonicalTagSnapshot.tags.map((tag) => tag.id))
    : null;
  const eventIdentityKey = calendarEventIdentityKey(event);

  // 다른 일정으로 전환할 때만 드래프트와 실패 상태를 리셋한다.
  // 같은 일정의 낙관적 저장 롤백은 새 객체로 들어와도 재시도 상태를 유지한다.
  useEffect(() => {
    setDraftTitle(event.title);
    setDraftStart(event.startDate);
    setDraftEnd(event.endDate);
    setDraftMemo(event.memo);
    setDraftCalendarId(event.calendarId ?? '');
    setDraftTagId(event.tagId);
    setDraftAllDay(event.allDay ?? true);
    setDraftStartTime(event.startTime ?? '');
    setDraftEndTime(event.endTime ?? '');
    setMutationError(null);
    setEditing(false);
  }, [eventIdentityKey]);

  const selectedTagUnavailable = Boolean(draftTagId && (
    isOptimisticCalendarTagId(draftTagId)
    || deletedTagIds.has(draftTagId)
    || (!selectableTagIds.has(draftTagId) && canonicalTagIds !== null && !canonicalTagIds.has(draftTagId))
  ));

  useEffect(() => {
    if (selectedTagUnavailable) setDraftTagId(undefined);
  }, [draftTagId, selectedTagUnavailable]);

  // ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editing) {
          setEditing(false);
          setDraftTitle(event.title);
          setDraftStart(event.startDate);
          setDraftEnd(event.endDate);
          setDraftMemo(event.memo);
          setDraftCalendarId(event.calendarId ?? '');
          setDraftTagId(event.tagId);
          setDraftAllDay(event.allDay ?? true);
          setDraftStartTime(event.startTime ?? '');
          setDraftEndTime(event.endTime ?? '');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose, event]);

  const isVacation = event.type === 'vacation';
  const isViewOnly = event.isReadOnly === true || event.canEdit === false;
  const isEditing = editing && !isVacation && !isViewOnly;
  const isCanonicalBflow = event.sourceCalendarId?.startsWith('bflow:') === true && Boolean(event.calendarId);
  const supportsTimeEditing = isCanonicalBflow || event.source === 'google';
  const currentCalendar = calendars.find((calendar) => calendar.id === event.calendarId);
  const currentTag = tags.find((tag) => tag.id === event.tagId);
  const hasLinkedScene = event.type !== 'custom' && event.type !== 'vacation';
  const linkedTodoId = calendarEventLinkedTodoId(event);
  const hasLinkedTodo = Boolean(linkedTodoId);
  const dday = calcDDay(event.endDate);
  const fieldClassName = 'w-full bg-bg-primary/85 border border-bg-border/70 focus:border-accent/50 rounded-md px-2 py-1 text-sm font-semibold text-text-primary outline-none transition-colors';
  const dateFieldClassName = 'w-full bg-bg-primary/85 border border-bg-border/70 focus:border-accent/50 rounded-md px-2 py-1 text-xs text-text-primary outline-none transition-colors';
  const labelClassName = 'text-[10px] text-text-secondary/70 font-medium uppercase tracking-wide';
  const hasInvalidTimedInterval = supportsTimeEditing
    && !draftAllDay
    && Boolean(draftStartTime && draftEndTime)
    && `${draftEnd}T${draftEndTime}` <= `${draftStart}T${draftStartTime}`;
  const isTimedSaveBlocked = supportsTimeEditing
    && !draftAllDay
    && (!draftStartTime || !draftEndTime || hasInvalidTimedInterval);

  // 연결 정보 텍스트
  const linkedLabel = (() => {
    if (event.linkedEpisode == null) return null;
    const parts: string[] = [];
    parts.push(
      episodeTitles[event.linkedEpisode] ||
        `EP.${String(event.linkedEpisode).padStart(2, '0')}`,
    );
    if (event.linkedPart) parts.push(`${event.linkedPart}파트`);
    if (event.linkedSceneId) parts.push(`#${event.linkedSceneId}`);
    return parts.join(' ');
  })();

  // 편집 저장
  const handleSave = () => {
    if (isVacation || isViewOnly) {
      setEditing(false);
      return;
    }
    if (isTimedSaveBlocked) return;
    const updates: Partial<CalendarEvent> = {};
    const nextStartDate = fromInputDate(draftStart);
    const nextEndDate = fromInputDate(draftEnd);
    if (draftTitle !== event.title) updates.title = draftTitle;
    if (nextStartDate !== event.startDate || nextEndDate !== event.endDate) {
      updates.startDate = nextStartDate;
      updates.endDate = nextEndDate;
    }
    if (draftMemo !== event.memo) updates.memo = draftMemo;
    if (supportsTimeEditing) {
      const allDayChanged = draftAllDay !== (event.allDay ?? true);
      if (allDayChanged) updates.allDay = draftAllDay;
      if (draftAllDay) {
        if (allDayChanged) {
          updates.startTime = undefined;
          updates.endTime = undefined;
        }
      } else {
        if (draftStartTime !== event.startTime) updates.startTime = draftStartTime;
        if (draftEndTime !== event.endTime) updates.endTime = draftEndTime;
      }
    }
    if (isCanonicalBflow) {
      const persistedTagId = draftTagId && !selectedTagUnavailable
        ? draftTagId
        : undefined;
      if (draftCalendarId !== event.calendarId) updates.calendarId = draftCalendarId;
      if (persistedTagId !== event.tagId) updates.tagId = persistedTagId;
    }
    if (Object.keys(updates).length === 0) {
      setEditing(false);
      return;
    }
    setMutationError(null);
    try {
      const persistence = onUpdate(event.id, updates);
      if (isPromiseLike(persistence)) {
        void persistence.then(
          () => setEditing(false),
          () => setMutationError('일정 저장에 실패했어요. 다시 시도해 주세요.'),
        );
        return;
      }
      setEditing(false);
    } catch {
      setMutationError('일정 저장에 실패했어요. 다시 시도해 주세요.');
    }
  };

  // 편집 취소
  const handleCancel = () => {
    setDraftTitle(event.title);
    setDraftStart(event.startDate);
    setDraftEnd(event.endDate);
    setDraftMemo(event.memo);
    setDraftCalendarId(event.calendarId ?? '');
    setDraftTagId(event.tagId);
    setDraftAllDay(event.allDay ?? true);
    setDraftStartTime(event.startTime ?? '');
    setDraftEndTime(event.endTime ?? '');
    setMutationError(null);
    setEditing(false);
  };

  const handleDelete = () => {
    if (isVacation || isViewOnly) return;
    setMutationError(null);
    try {
      const persistence = onDelete(event.id);
      if (isPromiseLike(persistence)) {
        void persistence.then(
          () => onClose(),
          () => setMutationError('일정 삭제에 실패했어요. 다시 시도해 주세요.'),
        );
        return;
      }
      onClose();
    } catch {
      setMutationError('일정 삭제에 실패했어요. 다시 시도해 주세요.');
    }
  };

  const linkedNavigationButtons = (
    <>
      {hasLinkedScene && (
        <button
          onClick={() => onNavigate(event)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-[#6C5CE7]/15 text-[#6C5CE7] hover:bg-[#6C5CE7]/25 transition-colors cursor-pointer"
        >
          <ExternalLink size={12} />
          이동
        </button>
      )}
      {hasLinkedTodo && (
        <button
          onClick={() => {
            setView('dashboard');
            // 대시보드 마운트 대기 후 네비게이션 이벤트 디스패치
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('bflow:navigate-to-todo', { detail: { todoId: linkedTodoId } }));
            }, 300);
            onClose();
          }}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-[#A29BFE]/15 text-[#A29BFE] hover:bg-[#A29BFE]/25 transition-colors cursor-pointer"
        >
          <CheckSquare size={12} />
          할일로 이동
        </button>
      )}
    </>
  );

  return (
    <motion.div
      key={event.id}
      variants={panelVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={panelTransition}
      className="absolute right-0 top-0 bottom-0 w-[280px] z-40 flex flex-col"
      style={{
        ...floatingGlassStyle,
        background: 'rgb(var(--color-bg-card) / 0.95)',
        borderLeft: '1px solid rgb(var(--color-bg-border) / 0.4)',
        boxShadow: '-12px 0 32px rgb(var(--color-shadow) / calc(var(--shadow-alpha) * 1.2))',
      }}
    >
      {/* ── 컬러 스트라이프 ── */}
      <div
        className="h-1 w-full shrink-0"
        style={{ background: `linear-gradient(90deg, ${event.color}, ${event.color}80)` }}
      />

      {/* ── 헤더 ── */}
      <div className="flex items-start gap-2 px-4 pt-3 pb-2 shrink-0">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5"
          style={{ backgroundColor: event.color }}
        />
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className={fieldClassName}
              autoFocus
            />
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug text-text-primary">
                {event.title}
              </h3>
              {isViewOnly && (
                <span className="shrink-0 rounded-full border border-bg-border/70 bg-bg-primary/60 px-1.5 py-0.5 text-[9px] font-medium text-text-secondary">
                  보기 전용
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 text-text-secondary hover:text-text-primary rounded transition-colors cursor-pointer shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── 스크롤 바디 ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
        {/* 정보 카드 */}
        <div className="bg-bg-primary/55 rounded-lg border border-bg-border/55 p-3 flex flex-col gap-2.5">
          {/* 날짜 */}
          {isEditing ? (
            <div className="flex flex-col gap-1.5">
              {supportsTimeEditing && (
                <label className="flex items-center justify-between gap-3 text-[11px] font-medium text-text-secondary">
                  <span>종일</span>
                  <input
                    aria-label="종일 일정"
                    type="checkbox"
                    checked={draftAllDay}
                    onChange={(changeEvent) => {
                      const checked = changeEvent.target.checked;
                      setDraftAllDay(checked);
                      if (!checked) {
                        if (!draftStartTime) setDraftStartTime('09:00');
                        if (!draftEndTime) setDraftEndTime('10:00');
                      }
                    }}
                    className="h-3.5 w-3.5 rounded accent-accent cursor-pointer"
                  />
                </label>
              )}
              <label className={labelClassName}>
                시작일
              </label>
              <input
                type="date"
                value={toInputDate(draftStart)}
                onChange={(e) => setDraftStart(fromInputDate(e.target.value))}
                className={dateFieldClassName}
                style={{ colorScheme: colorMode }}
              />
              {supportsTimeEditing && !draftAllDay && (
                <input
                  aria-label="시작 시각"
                  type="time"
                  step={600}
                  value={draftStartTime}
                  onChange={(changeEvent) => setDraftStartTime(changeEvent.target.value)}
                  className={dateFieldClassName}
                  style={{ colorScheme: colorMode }}
                />
              )}
              <label className={`${labelClassName} mt-1`}>
                종료일
              </label>
              <input
                type="date"
                value={toInputDate(draftEnd)}
                onChange={(e) => setDraftEnd(fromInputDate(e.target.value))}
                className={dateFieldClassName}
                style={{ colorScheme: colorMode }}
              />
              {supportsTimeEditing && !draftAllDay && (
                <input
                  aria-label="종료 시각"
                  type="time"
                  step={600}
                  value={draftEndTime}
                  onChange={(changeEvent) => setDraftEndTime(changeEvent.target.value)}
                  className={dateFieldClassName}
                  style={{ colorScheme: colorMode }}
                />
              )}
              {hasInvalidTimedInterval && (
                <p role="alert" className="text-[11px] font-medium text-red-400">
                  종료 시각은 시작 시각보다 뒤여야 해요.
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-text-secondary">
              <Clock size={12} className="shrink-0" />
              <span className="text-xs">
                {formatDateRange(event.startDate, event.endDate)}
                {supportsTimeEditing && event.allDay === false && event.startTime && event.endTime
                  ? ` ${event.startTime} – ${event.endTime}`
                  : ''}
              </span>
              <span
                className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: `${event.color}20`,
                  color: event.color,
                }}
              >
                {dday}
              </span>
            </div>
          )}

          {/* 캘린더 + 태그 */}
          {isEditing && isCanonicalBflow ? (
            <div className="flex flex-col gap-2 border-t border-bg-border/45 pt-2">
              <div>
                <label className={labelClassName}>캘린더</label>
                <select
                  aria-label="캘린더"
                  value={draftCalendarId}
                  onChange={(changeEvent) => setDraftCalendarId(changeEvent.target.value)}
                  className={`${dateFieldClassName} mt-1`}
                >
                  {editableCalendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>{calendar.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClassName}>태그</label>
                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    aria-pressed={draftTagId === undefined}
                    onClick={() => setDraftTagId(undefined)}
                    className={`rounded-full px-2 py-1 text-[10px] ${draftTagId === undefined ? 'bg-accent/20 text-accent' : 'bg-bg-primary/70 text-text-secondary'}`}
                  >
                    없음
                  </button>
                  {sortedTags.map((tag) => {
                    const selected = draftTagId === tag.id;
                    return (
                      <button
                        type="button"
                        key={tag.id}
                        aria-pressed={selected}
                        onClick={() => setDraftTagId(tag.id)}
                        className="rounded-full border px-2 py-1 text-[10px]"
                        style={{
                          color: selected ? tag.color : 'rgb(var(--color-text-secondary))',
                          borderColor: selected ? tag.color : 'rgb(var(--color-bg-border) / 0.7)',
                          background: selected ? `color-mix(in srgb, ${tag.color} 18%, transparent)` : 'transparent',
                        }}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-bg-border/45 pt-2 text-[10px] text-text-secondary">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-bg-primary/65 px-2 py-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: event.color }} />
                {currentCalendar?.name ?? (event.source === 'google' ? '내 구글 캘린더' : isVacation ? '휴가' : '이전 일정')}
              </span>
              {currentTag && (
                <span
                  className="rounded-full border px-2 py-1 font-medium"
                  style={{ color: currentTag.color, borderColor: currentTag.color, background: `color-mix(in srgb, ${currentTag.color} 16%, transparent)` }}
                >
                  {currentTag.name}
                </span>
              )}
            </div>
          )}

          {/* 타입 배지 + 연결 정보 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: `${event.color}20`,
                color: event.color,
              }}
            >
              {TYPE_LABELS[event.type]}
            </span>
            {hasLinkedTodo && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium inline-flex items-center gap-0.5"
                style={{ backgroundColor: 'rgb(var(--color-accent) / 0.14)', color: 'rgb(var(--color-accent-sub))' }}
              >
                <CheckSquare size={9} />
                할일 연동
              </span>
            )}
            {linkedLabel && (
              <span className="text-[10px] text-text-secondary">{linkedLabel}</span>
            )}
            {event.linkedDepartment && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: `${DEPARTMENT_CONFIGS[event.linkedDepartment].color}20`,
                  color: DEPARTMENT_CONFIGS[event.linkedDepartment].color,
                }}
              >
                {DEPARTMENT_CONFIGS[event.linkedDepartment].label}
              </span>
            )}
          </div>

          {/* 휴가 타입 */}
          {isVacation && event.vacationType && (
            <div className="flex items-center gap-2 text-text-secondary">
              <Palmtree size={12} className="shrink-0 text-emerald-400" />
              <span className="text-xs">{event.vacationType}</span>
              {event.vacationUserName && (
                <span className="text-xs text-text-secondary/60">({event.vacationUserName})</span>
              )}
            </div>
          )}
        </div>

        {/* 메모 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-text-secondary">
            <FileText size={11} />
            <span className="text-[10px] font-medium uppercase tracking-wide">메모</span>
          </div>
          {isEditing ? (
            <EntityAwareInput
              multiline
              value={draftMemo ?? ''}
              onChange={setDraftMemo}
              users={users}
              /* #태그 끔: 이 메모는 ScheduleView 카드/툴팁/상세·CalendarView 선택 패널에서 평문({event.memo})으로
                 표시돼 직렬화 토큰('[#a001](...)')이 노출된다(EntityAwareInput enableHashtag 주석 참조). */
              rows={4}
              className="w-full bg-bg-primary/85 border border-bg-border/70 focus:border-accent/50 rounded-md px-2.5 py-2 text-xs text-text-primary outline-none resize-none leading-relaxed transition-colors"
              placeholder="메모 입력..."
            />
          ) : (
            <div className="bg-bg-primary/40 rounded-md px-2.5 py-2 min-h-[48px]">
              <p className="text-xs text-text-primary/80 leading-relaxed whitespace-pre-wrap">
                {event.memo
                  ? <EntityText text={event.memo} userNames={userNames} />
                  : <span className="text-text-secondary/40">메모 없음</span>}
              </p>
            </div>
          )}
        </div>

        {/* 작성자 */}
        <div className="flex items-center gap-2 text-text-secondary/60">
          <MapPin size={11} />
          <span className="text-[10px]">작성: {event.createdBy}</span>
        </div>

        {/* 스페이서 */}
        <div className="flex-1" />

        {mutationError && (
          <p role="alert" className="rounded-md bg-red-500/10 px-2.5 py-2 text-center text-[11px] text-red-300">
            {mutationError}
          </p>
        )}

        {/* ── 액션 영역 ── */}
        {isVacation ? (
          /* 휴가 이벤트: 편집 불가 안내 */
          <div className="flex flex-col gap-2 pt-1">
            <p className="text-[10px] text-text-secondary/50 text-center leading-relaxed">
              휴가 관리는 휴가 탭에서 관리합니다
            </p>
            <button
              onClick={() => {
                onNavigate(event);
                onClose();
              }}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors cursor-pointer"
            >
              <Palmtree size={13} />
              휴가 탭으로 이동
            </button>
          </div>
        ) : isViewOnly ? (
          <div className="flex flex-col gap-2 pt-1">
            <div className="rounded-lg border border-bg-border/55 bg-bg-primary/45 px-3 py-2.5 text-center">
              <p className="text-[10px] leading-relaxed text-text-secondary/70">
                보기 전용 일정이라 편집하거나 삭제할 수 없습니다
              </p>
            </div>
            {(hasLinkedScene || hasLinkedTodo) && (
              <div className="flex gap-2">
                {linkedNavigationButtons}
              </div>
            )}
          </div>
        ) : isEditing ? (
          /* 편집 모드: 저장/취소 */
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCancel}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-bg-primary/75 text-text-secondary hover:bg-bg-border/50 hover:text-text-primary transition-colors cursor-pointer"
            >
              <XCircle size={13} />
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={isTimedSaveBlocked}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-[#6C5CE7]/20 text-[#6C5CE7] hover:bg-[#6C5CE7]/30 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Save size={13} />
              저장
            </button>
          </div>
        ) : (
          /* 읽기 모드: 편집/이동/삭제 */
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setMutationError(null);
                  setEditing(true);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-bg-primary/70 text-text-primary hover:bg-bg-border/45 transition-colors cursor-pointer"
              >
                <Pencil size={12} />
                편집
              </button>
              {linkedNavigationButtons}
            </div>
            <button
              onClick={handleDelete}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
            >
              <Trash2 size={12} />
              삭제
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
