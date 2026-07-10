import { Pin } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { PersonalTodo, PersonalTodoLabel, PersonalTodoPriority, PersonalTodoStatus } from '../types';
import { getPriorityPresentation, summarizeTodoLabels } from '../personalTodoDomain';

export type PersonalTodoSyncState = 'idle' | 'pending' | 'sync-needed';

const statusLabels: Record<PersonalTodoStatus, string> = {
  todo: '대기 중',
  doing: '진행 중',
  done: '완료',
};

const priorityClass: Record<PersonalTodoPriority, string> = {
  high: 'text-red-300',
  medium: 'text-orange-300',
  low: 'text-blue-300',
  none: 'text-text-secondary/50',
};

const priorityColorToken: Record<PersonalTodoPriority, string> = {
  high: '#F87171',
  medium: '#FB923C',
  low: '#60A5FA',
  none: '#8B8DA3',
};

const labelClass: Record<PersonalTodoLabel['colorKey'], string> = {
  violet: 'text-violet-300 bg-violet-400/10',
  blue: 'text-blue-300 bg-blue-400/10',
  green: 'text-green-300 bg-green-400/10',
  yellow: 'text-yellow-200 bg-yellow-400/10',
  orange: 'text-orange-300 bg-orange-400/10',
  red: 'text-red-300 bg-red-400/10',
  pink: 'text-pink-300 bg-pink-400/10',
  gray: 'text-text-secondary/70 bg-bg-border/20',
};

interface TodoMetadataProps {
  todo: PersonalTodo;
  resolvedLabels: PersonalTodoLabel[];
  syncState?: PersonalTodoSyncState;
  onTogglePinned?: (todoId: string, pinned: boolean) => void;
  compact?: boolean;
}

export function TodoMetadata({ todo, resolvedLabels, syncState = 'idle', onTogglePinned, compact = false }: TodoMetadataProps) {
  const priority = getPriorityPresentation(todo.priority);
  // 행/카드 모두 최대 2개를 보여주고 나머지는 +N으로 접는다. compact는 간격만 줄인다.
  const labelSummary = summarizeTodoLabels(todo.labelIds, resolvedLabels, false);
  const labels = labelSummary.visible;
  const hiddenCount = labelSummary.hiddenCount;

  return (
    <div className={cn('flex items-center gap-1.5 min-w-0 text-[10px]', compact && 'gap-1')} aria-label="개인 할일 메타데이터">
      <span className="flex items-center gap-1 shrink-0" title={`우선순위: ${priority.label}`}>
        <span className="w-1 h-3 rounded-full" style={{ backgroundColor: priorityColorToken[todo.priority] }} aria-hidden="true" />
        <span className={priorityClass[todo.priority]}>우선순위 {priority.label}</span>
      </span>
      <span className="text-text-secondary/35" aria-hidden="true">·</span>
      <span className="text-text-secondary/60 shrink-0">{statusLabels[todo.status]}</span>
      {labels.map((label, index) => (
        <span key={label.id} data-personal-todo-label-index={index} className={cn('px-1 py-0.5 rounded truncate max-w-[92px]', labelClass[label.colorKey])} title={label.name}>
          {label.name}
        </span>
      ))}
      {hiddenCount > 0 && <span className="text-text-secondary/60 shrink-0">+{hiddenCount}</span>}
      {onTogglePinned && (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); if (!event.currentTarget.disabled) onTogglePinned(todo.id, !todo.pinned); }}
          disabled={syncState === 'pending' || syncState === 'sync-needed'}
          className={cn('ml-auto p-1 rounded cursor-pointer shrink-0 transition-colors', todo.pinned ? 'text-amber-300 bg-amber-300/10' : 'text-text-secondary/35 hover:text-amber-300 hover:bg-amber-300/10')}
          aria-label={todo.pinned ? '개인 할일 고정 해제' : '개인 할일 고정'}
          aria-pressed={todo.pinned}
          title={todo.pinned ? '고정 해제' : '고정'}
        >
          <Pin size={11} fill={todo.pinned ? 'currentColor' : 'none'} />
        </button>
      )}
      {syncState === 'pending' && <span className="text-text-secondary/45 shrink-0" aria-label="저장 중">저장 중…</span>}
    </div>
  );
}
