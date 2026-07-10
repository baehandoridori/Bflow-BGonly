import { Pin } from 'lucide-react';
import { Reorder, useDragControls } from 'framer-motion';
import type { PersonalTodo, PersonalTodoLabel } from '../types';
import type { PersonalTodoSyncState } from './TodoMetadata';
import { TodoRow } from './TodoRow';
import { TodoCard } from './TodoCard';

type TodoViewMode = 'list' | 'card';

interface PinnedTodoSectionProps {
  todos: PersonalTodo[];
  labels: PersonalTodoLabel[];
  syncState: PersonalTodoSyncState;
  onReorder: (todos: PersonalTodo[]) => void;
  onNextStatus: (id: string, status: PersonalTodo['status']) => void;
  onTogglePinned: (id: string, pinned: boolean) => void;
  onRemove?: (id: string) => void;
  onDelete?: (id: string) => void;
  onOpenDetail?: (todo: PersonalTodo) => void;
  onOpen?: (todo: PersonalTodo) => void;
  onRetrySync: () => void;
  highlightedId?: string | null;
  staggerDelay?: (index: number) => number;
  reduce?: boolean;
  viewMode: TodoViewMode;
  reorderDisabled?: boolean;
}

function SortablePinnedTodo({ todo, index, labels, viewMode: _viewMode, reorderDisabled: _reorderDisabled, ...props }: Omit<PinnedTodoSectionProps, 'todos' | 'onReorder'> & { todo: PersonalTodo; index: number }) {
  const dragControls = useDragControls();
  return <Reorder.Item key={todo.id} value={todo} dragListener={false} dragControls={dragControls} className="list-none">
    <TodoRow {...props} todo={todo} resolvedLabels={labels.filter((label) => todo.labelIds.includes(label.id))} dragControls={dragControls} showDragHandle={!_reorderDisabled} isHighlighted={props.highlightedId === todo.id} enterDelay={props.staggerDelay?.(index) ?? 0} reduce={props.reduce} />
  </Reorder.Item>;
}

export function PinnedTodoSection({ todos, labels, syncState, onReorder, viewMode, reorderDisabled = false, ...props }: PinnedTodoSectionProps) {
  if (todos.length === 0) return null;
  return (
    <section aria-label={`나의 고정 ${todos.length}`} className={`mb-2 rounded-lg border border-accent/25 bg-accent/5 p-1.5${reorderDisabled ? ' opacity-70' : ''}`}>
      <div className="flex items-center gap-1 px-1 py-1 text-[11px] text-accent/90">
        <Pin size={11} fill="currentColor" aria-hidden="true" />
        <span className="font-medium">나의 고정</span>
        <span className="text-[9px] text-accent/60">{todos.length}</span>
      </div>
      {viewMode === 'card' ? (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}>
          {todos.map((todo, index) => (
            <TodoCard
              key={todo.id}
              todo={todo}
              resolvedLabels={labels.filter((label) => todo.labelIds.includes(label.id))}
              syncState={syncState}
              onNextStatus={props.onNextStatus}
              onTogglePinned={props.onTogglePinned}
              onRetrySync={props.onRetrySync}
              onDelete={props.onDelete ?? props.onRemove}
              onOpen={props.onOpen ?? props.onOpenDetail}
              isHighlighted={props.highlightedId === todo.id}
              enterDelay={props.staggerDelay?.(index) ?? 0}
              reduce={props.reduce}
            />
          ))}
        </div>
      ) : (
        <Reorder.Group axis="y" values={todos} onReorder={(next) => { if (!reorderDisabled) onReorder(next); }} className="list-none p-0 m-0">
          {todos.map((todo, index) => <SortablePinnedTodo key={todo.id} todo={todo} index={index} {...props} labels={labels} syncState={syncState} viewMode={viewMode} />)}
        </Reorder.Group>
      )}
    </section>
  );
}
