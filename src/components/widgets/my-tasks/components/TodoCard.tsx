import { X } from 'lucide-react';
import { motion } from 'framer-motion';
import { stripEntityTokens } from '@/utils/entityTokens';
import { cn } from '@/utils/cn';
import type { PersonalTodo, PersonalTodoLabel } from '../types';
import { TodoMetadata, type PersonalTodoSyncState } from './TodoMetadata';
import { TodoStatusAction } from './TodoStatusAction';

interface TodoCardProps {
  todo: PersonalTodo;
  resolvedLabels?: PersonalTodoLabel[];
  syncState?: PersonalTodoSyncState;
  onNextStatus?: (id: string, status: PersonalTodo['status']) => void;
  onTogglePinned?: (id: string, pinned: boolean) => void;
  onRetrySync?: () => void;
  onRemove?: (id: string) => void;
  onDelete?: (id: string) => void;
  onOpenDetail?: (todo: PersonalTodo) => void;
  onOpen?: (todo: PersonalTodo) => void;
  isHighlighted?: boolean;
  enterDelay?: number;
  reduce?: boolean;
}

export function TodoCard({ todo, resolvedLabels = [], syncState = 'idle', onNextStatus, onTogglePinned, onRetrySync, onRemove, onDelete, onOpenDetail, onOpen, isHighlighted, enterDelay = 0, reduce = false }: TodoCardProps) {
  const memoText = todo.memo ? stripEntityTokens(todo.memo) : '';
  const nextStatus = todo.status === 'todo' ? 'doing' : todo.status === 'doing' ? 'done' : 'todo';
  const openDetail = onOpen ?? onOpenDetail;
  const removeTodo = onDelete ?? onRemove;

  return (
    <motion.div
      ref={isHighlighted ? (el: HTMLDivElement | null) => { el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.25, delay: enterDelay }}
      className={cn(
        'group relative flex flex-col gap-1.5 rounded-lg border bg-bg-card p-2 min-h-[108px] transition-[border-color,box-shadow]',
        todo.completed ? 'opacity-60 border-bg-border/30' : 'border-bg-border/40 hover:border-bg-border/70 hover:shadow-[0_4px_18px_-6px_rgba(108,92,231,0.5)]',
        isHighlighted && 'ring-1 ring-accent/60 animate-pulse',
      )}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => openDetail?.(todo)}
          className="text-left text-[12px] font-medium text-text-primary truncate flex-1 min-w-0 cursor-pointer"
          title="클릭하여 상세 보기/편집"
        >
          {todo.title}
        </button>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); removeTodo?.(todo.id); }}
          className="ml-auto p-1 text-red-400/60 hover:text-red-400 rounded cursor-pointer opacity-0 group-hover:opacity-100 transition-all shrink-0"
          aria-label="개인 할일 삭제"
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        {memoText && (
          <button
            type="button"
            onClick={() => openDetail?.(todo)}
            data-personal-todo-memo-preview
            className="text-[10px] text-text-secondary/50 truncate text-left cursor-pointer"
            title="클릭하여 상세 보기/편집"
          >
            {memoText}
          </button>
        )}
        <TodoMetadata todo={todo} resolvedLabels={resolvedLabels} syncState={syncState} onTogglePinned={onTogglePinned} />
      </div>
      {onNextStatus && (
        <TodoStatusAction
          status={todo.status}
          disabled={syncState === 'pending' || syncState === 'sync-needed'}
          syncState={syncState}
          onAction={() => onNextStatus(todo.id, nextStatus)}
          onRetry={onRetrySync}
        />
      )}
    </motion.div>
  );
}
