/** 개인 할일 상세/편집 모달. 제목·메모는 blur에, 속성은 즉시 저장한다. */
import { useEffect, useRef, useState } from 'react';
import { Calendar, CalendarDays, Pin, Tags, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { cn } from '@/utils/cn';
import type { PersonalTodo, PersonalTodoLabel, PersonalTodoPriority, PersonalTodoStatus } from '../types';
import { ModalPortal } from './ModalPortal';
import { TodoLabelPicker } from './TodoLabelPicker';

const statusOptions: ReadonlyArray<{ value: PersonalTodoStatus; label: string }> = [
  { value: 'todo', label: '할 일' },
  { value: 'doing', label: '진행 중' },
  { value: 'done', label: '완료' },
];

const priorityOptions: ReadonlyArray<{ value: PersonalTodoPriority; label: string }> = [
  { value: 'none', label: '없음' },
  { value: 'low', label: '낮음' },
  { value: 'medium', label: '보통' },
  { value: 'high', label: '높음' },
];

export function TodoDetailModal({
  todo,
  labels = [],
  pendingLabelIds,
  onUpdate,
  onSetStatus,
  onSetPinned,
  onCreateLabel,
  onUpdateLabel,
  onNavigateToCalendar,
  onClose,
}: {
  todo: PersonalTodo;
  labels?: readonly PersonalTodoLabel[];
  pendingLabelIds?: ReadonlySet<string>;
  onUpdate: (id: string, updates: Partial<PersonalTodo>) => void | Promise<void>;
  onSetStatus?: (id: string, status: PersonalTodoStatus) => Promise<boolean>;
  onSetPinned?: (id: string, pinned: boolean) => Promise<void>;
  onCreateLabel?: (input: { todoId: string; name: string; colorKey: PersonalTodoLabel['colorKey'] }) => Promise<void>;
  onUpdateLabel?: (labelId: string, patch: { name?: string; colorKey?: PersonalTodoLabel['colorKey'] }) => Promise<void>;
  /** 캘린더(일정) 뷰로 이동 — 대시보드/팝업 분기는 부모(MyTasksWidget)가 소유한다. */
  onNavigateToCalendar: (todo: PersonalTodo) => void;
  onClose: () => void;
}) {
  const colorMode = useAppStore((s) => s.colorMode);
  const users = useAuthStore((s) => s.users);
  const [editTitle, setEditTitle] = useState(todo.title);
  const [editMemo, setEditMemo] = useState(todo.memo);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const titleFocusedRef = useRef(false);
  const memoFocusedRef = useRef(false);

  useEffect(() => { if (!titleFocusedRef.current) setEditTitle(todo.title); }, [todo.title]);
  useEffect(() => { if (!memoFocusedRef.current) setEditMemo(todo.memo); }, [todo.memo]);
  useEffect(() => { setLabelPickerOpen(false); }, [todo.id]);

  const commitTitle = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== todo.title) void onUpdate(todo.id, { title: trimmed });
    else if (!trimmed) setEditTitle(todo.title);
  };
  const commitMemo = () => { if (editMemo !== todo.memo) void onUpdate(todo.id, { memo: editMemo }); };
  const commitStart = (value: string) => { if (value !== (todo.startDate ?? '')) void onUpdate(todo.id, { startDate: value || undefined }); };
  const commitEnd = (value: string) => { if (value !== (todo.endDate ?? '')) void onUpdate(todo.id, { endDate: value || undefined }); };
  const toggleCalendar = () => { void onUpdate(todo.id, { addToCalendar: !todo.addToCalendar }); };
  const navigateToCalendar = () => { onNavigateToCalendar(todo); onClose(); };

  const selectedLabels = labels.filter((label) => todo.labelIds.includes(label.id));
  const toggleLabel = (labelId: string, selected: boolean) => {
    if (!selected && (pendingLabelIds?.has(labelId) || labelId.startsWith('pending-label-'))) return;
    const labelIds = selected
      ? [...new Set([...todo.labelIds, labelId])]
      : todo.labelIds.filter((id) => id !== labelId);
    void onUpdate(todo.id, { labelIds });
  };
  const changeStatus = (status: PersonalTodoStatus) => {
    if (status === todo.status) return;
    if (onSetStatus) void onSetStatus(todo.id, status);
    else void onUpdate(todo.id, { status });
  };
  const togglePinned = () => {
    if (onSetPinned) void onSetPinned(todo.id, !todo.pinned);
    else void onUpdate(todo.id, { pinned: !todo.pinned });
  };

  return (
    <ModalPortal onClose={onClose} labelledBy="todo-detail-title" maxWidth={480}>
      <div className="flex items-center justify-between border-b border-bg-border/30 px-4 py-3">
        <span id="todo-detail-title" className="text-sm font-semibold text-text-primary">개인 할일</span>
        <button type="button" onClick={onClose} aria-label="개인 할일 모달 닫기" className="rounded-md p-1 text-text-secondary/70 hover:bg-bg-border/20 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><X size={16} /></button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4">
        <div>
          <label htmlFor="todo-detail-name" className="mb-1.5 block text-[11px] text-text-secondary/60">제목</label>
          <input
            id="todo-detail-name"
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            onFocus={() => { titleFocusedRef.current = true; }}
            onBlur={() => { titleFocusedRef.current = false; commitTitle(); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commitTitle(); (event.target as HTMLInputElement).blur(); }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditTitle(todo.title); }
            }}
            placeholder="할 일을 입력하세요"
            className="w-full rounded-lg border border-bg-border bg-bg-primary px-3 py-2 text-xs text-text-primary outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 placeholder:text-text-secondary/30"
          />
        </div>

        {/* 속성 toolbar: 상태/우선순위/상단 고정은 선택 즉시 hook의 낙관적 API를 소비한다. */}
        <div className="relative flex flex-wrap items-center gap-2 rounded-lg border border-bg-border/40 bg-bg-primary/40 p-2" aria-label="개인 할일 속성">
          <label className="flex min-w-[108px] flex-1 flex-col gap-1 text-[10px] text-text-secondary/65">
            상태
            <select value={todo.status} onChange={(event) => changeStatus(event.target.value as PersonalTodoStatus)} aria-label="할 일 상태" className="rounded border border-bg-border bg-bg-card px-2 py-1.5 text-[11px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/40">
              {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex min-w-[108px] flex-1 flex-col gap-1 text-[10px] text-text-secondary/65">
            우선순위
            <select value={todo.priority} onChange={(event) => void onUpdate(todo.id, { priority: event.target.value as PersonalTodoPriority })} aria-label="개인 할 일 우선순위" className="rounded border border-bg-border bg-bg-card px-2 py-1.5 text-[11px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/40">
              {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={togglePinned}
            aria-pressed={todo.pinned}
            aria-label={todo.pinned ? '상단 고정 해제' : '상단 고정'}
            className={cn('mt-4 inline-flex items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60', todo.pinned ? 'border-amber-300/50 bg-amber-300/10 text-amber-200' : 'border-bg-border/60 text-text-secondary hover:border-amber-300/40 hover:text-amber-200')}
          >
            <Pin size={12} fill={todo.pinned ? 'currentColor' : 'none'} /> 상단 고정
          </button>
        </div>

        <div className="relative rounded-lg border border-bg-border/40 bg-bg-primary/30 p-2" aria-label="선택한 레이블">
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[10px] text-text-secondary/65"><Tags size={12} /> 선택한 레이블</span>
            <button type="button" onClick={() => setLabelPickerOpen((open) => !open)} aria-expanded={labelPickerOpen} aria-label="레이블 추가" className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">+ 레이블</button>
          </div>
          <div className="flex min-h-[24px] flex-wrap gap-1">
            {selectedLabels.length > 0 ? selectedLabels.map((label) => <span key={label.id} className="rounded border border-bg-border/50 bg-bg-border/15 px-1.5 py-0.5 text-[10px] text-text-secondary" title={label.name}>{label.name}</span>) : <span className="text-[10px] text-text-secondary/45">선택한 레이블 없음</span>}
          </div>
          {labelPickerOpen && onCreateLabel && onUpdateLabel && <TodoLabelPicker labels={labels} selectedLabelIds={todo.labelIds} pendingLabelIds={pendingLabelIds} onToggleLabel={toggleLabel} onCreateLabel={(input) => onCreateLabel({ todoId: todo.id, ...input })} onUpdateLabel={onUpdateLabel} onClose={() => setLabelPickerOpen(false)} />}
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] text-text-secondary/60">메모</label>
          <EntityAwareInput
            multiline
            aria-label="메모"
            value={editMemo}
            onChange={(value) => { memoFocusedRef.current = true; setEditMemo(value); }}
            onBlur={() => { memoFocusedRef.current = false; commitMemo(); }}
            users={users}
            enableHashtag={false}
            enableHashtags={false}
            autoGrow
            autoGrowMinRows={3}
            autoGrowMaxRows={10}
            autoGrowMaxContainerRatio={0.4}
            placeholder="메모 (선택)"
            rows={3}
            className="w-full resize-none rounded-lg border border-bg-border bg-bg-primary px-3 py-2 text-xs text-text-primary outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 placeholder:text-text-secondary/30"
          />
        </div>

        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="todo-detail-start" className="mb-1 block text-[11px] font-semibold tracking-wider text-text-secondary/60">시작일</label>
            <div className="relative"><input id="todo-detail-start" type="date" value={todo.startDate ?? ''} onChange={(event) => commitStart(event.target.value)} className="date-picker-hidden w-full rounded-lg border-2 border-accent/40 bg-bg-card px-3 py-2 pr-8 text-sm font-medium text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" style={{ colorScheme: colorMode }} /><Calendar size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-accent" /></div>
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="todo-detail-end" className="mb-1 block text-[11px] font-semibold tracking-wider text-text-secondary/60">종료일</label>
            <div className="relative"><input id="todo-detail-end" type="date" value={todo.endDate ?? ''} onChange={(event) => commitEnd(event.target.value)} className="date-picker-hidden w-full rounded-lg border-2 border-accent/40 bg-bg-card px-3 py-2 pr-8 text-sm font-medium text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" style={{ colorScheme: colorMode }} /><Calendar size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-accent" /></div>
          </div>
        </div>

        <button type="button" onClick={toggleCalendar} aria-pressed={todo.addToCalendar} className={cn('flex items-center gap-2.5 rounded-lg border-2 px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60', todo.addToCalendar ? 'border-[#6C5CE7] bg-[#6C5CE7]/15 text-[#6C5CE7]' : 'border-bg-border/60 text-text-secondary/60 hover:border-[#6C5CE7]/30 hover:bg-[#6C5CE7]/5 hover:text-[#6C5CE7]')}>
          <Calendar size={16} /><span className="text-xs font-semibold">캘린더에 추가</span><span className={cn('ml-auto h-[20px] w-9 rounded-full transition-colors', todo.addToCalendar ? 'bg-[#6C5CE7]' : 'bg-bg-border/40')}><motion.span className="relative top-[3px] block h-[14px] w-[14px] rounded-full bg-white shadow-sm" animate={{ left: todo.addToCalendar ? 18 : 3 }} transition={{ duration: 0.2 }} /></span>
        </button>
        {todo.addToCalendar && <button type="button" onClick={navigateToCalendar} className="flex items-center justify-center gap-1.5 rounded-lg border border-bg-border/50 px-3 py-2 text-xs text-text-secondary transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><CalendarDays size={14} /> 캘린더에서 보기</button>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-bg-border/30 px-4 py-3">
        <button type="button" onClick={onClose} className="rounded-lg border border-bg-border/50 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">닫기</button>
      </div>
    </ModalPortal>
  );
}
