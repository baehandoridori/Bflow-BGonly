/** 개인 할일 리스트 행. 본문은 상세 모달을 열고, 드래그는 핸들에서만 시작한다. */
import { X, GripVertical } from 'lucide-react';
import { motion, Reorder, useDragControls, type DragControls } from 'framer-motion';
import { EntityText } from '@/components/common/EntityText';
import { navigateToHashTarget } from '@/utils/hashNavigation';
import { useAuthStore } from '@/stores/useAuthStore';
import { cn } from '@/utils/cn';
import type { PersonalTodo, PersonalTodoLabel } from '../types';
import { TodoMetadata, type PersonalTodoSyncState } from './TodoMetadata';
import { TodoStatusAction } from './TodoStatusAction';

interface TodoRowProps {
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
  showDragHandle?: boolean;
  dragControls?: DragControls;
  isHighlighted?: boolean;
  enterDelay?: number;
  reduce?: boolean;
}

export function TodoRow({
  todo,
  resolvedLabels = [],
  syncState = 'idle',
  onNextStatus,
  onTogglePinned,
  onRetrySync,
  onRemove,
  onDelete,
  onOpenDetail,
  onOpen,
  showDragHandle,
  dragControls,
  isHighlighted,
  enterDelay = 0,
  reduce = false,
}: TodoRowProps) {
  const users = useAuthStore((s) => s.users);
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
        'flex items-center gap-1.5 px-2 py-1.5 rounded-lg group transition-[background-color,box-shadow]',
        todo.completed ? 'bg-green-500/5 opacity-60' : 'hover:bg-bg-border/8 hover:shadow-[0_2px_14px_-4px_rgba(108,92,231,0.45)]',
        isHighlighted && 'ring-1 ring-accent/60 bg-accent/10 animate-pulse',
      )}
    >
      {showDragHandle && (
        <button
          type="button"
          className="text-text-secondary/25 hover:text-text-secondary/65 cursor-grab active:cursor-grabbing shrink-0 p-0.5 rounded"
          aria-label="개인 할일 순서 이동"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (dragControls) dragControls.start(event as unknown as PointerEvent);
          }}
        >
          <GripVertical size={12} />
        </button>
      )}

      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <div
          role="button"
          tabIndex={0}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('button, a')) return;
            openDetail?.(todo);
          }}
          onKeyDown={(event) => {
            if ((event.target as HTMLElement).closest('button, a')) return;
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail?.(todo); }
          }}
          className="flex flex-col min-w-0 text-left cursor-pointer rounded px-0.5 -mx-0.5 hover:bg-bg-border/10 transition-colors"
          title="클릭하여 상세 보기/편집"
        >
          <span className={cn('text-[13px] text-text-primary truncate', todo.completed && 'line-through text-text-secondary/50')}>
            {todo.title}
          </span>
          {todo.memo && (
            <span className="text-[11px] text-text-secondary/50 truncate">
              <EntityText text={todo.memo} userNames={users.map((user) => user.name)} onHashClick={navigateToHashTarget} />
            </span>
          )}
        </div>
        <TodoMetadata todo={todo} resolvedLabels={resolvedLabels} syncState={syncState} onTogglePinned={onTogglePinned} compact />
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

      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); removeTodo?.(todo.id); }}
        className="p-1 text-red-400/60 hover:text-red-400 hover:bg-red-400/10 rounded cursor-pointer opacity-0 group-hover:opacity-100 transition-all shrink-0"
        aria-label="개인 할일 삭제"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}

export function SortableTodoRow(props: Omit<TodoRowProps, 'dragControls'> & { value: PersonalTodo }) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item key={props.value.id} value={props.value} dragListener={false} dragControls={dragControls} className="list-none">
      <TodoRow {...props} todo={props.value} dragControls={dragControls} />
    </Reorder.Item>
  );
}
