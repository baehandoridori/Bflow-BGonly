/**
 * TodoRow — '내 할일' 리스트 모드 개인 할일 행 (PR 4 재설계, PersonalTodoContent에서 추출).
 *
 * - ★왼쪽 동그라미 체크(정적; ring→check 애니메이션은 PR 5). 클릭=완료 토글.
 * - 드래그 핸들·::개인 라벨·제목/메모(읽기). 본문 클릭 → 상세모달. hover 제거.
 * - ★isHighlighted 승계 필수: 캘린더→할일 점프 시 scrollIntoView + 강조 링(회귀 방지).
 * - ★Reorder.Item 의 '콘텐츠'만 담당한다. Reorder.Group/Item(value/onReorder)은 MyTasksWidget이 소유.
 */
import { Check, X, GripVertical } from 'lucide-react';
import { EntityText } from '@/components/common/EntityText';
import { navigateToHashTarget } from '@/utils/hashNavigation';
import { useAuthStore } from '@/stores/useAuthStore';
import { cn } from '@/utils/cn';
import type { PersonalTodo } from '../types';

interface TodoRowProps {
  todo: PersonalTodo;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenDetail: (todo: PersonalTodo) => void;
  showDragHandle?: boolean;
  isHighlighted?: boolean;
}

export function TodoRow({ todo, onToggle, onRemove, onOpenDetail, showDragHandle, isHighlighted }: TodoRowProps) {
  const users = useAuthStore((s) => s.users);

  return (
    <div
      ref={isHighlighted ? (el: HTMLDivElement | null) => { el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } : undefined}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors group',
        todo.completed ? 'bg-green-500/5 opacity-60' : 'hover:bg-bg-border/8',
        isHighlighted && 'ring-1 ring-accent/60 bg-accent/10 animate-pulse',
      )}
    >
      {/* 드래그 핸들 */}
      {showDragHandle && (
        <div className="text-text-secondary/15 hover:text-text-secondary/40 cursor-grab active:cursor-grabbing shrink-0">
          <GripVertical size={12} />
        </div>
      )}

      {/* 좌측 동그라미 체크 (개인 할일 — 씬과 구분되는 식별 요소) */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(todo.id); }}
        aria-pressed={todo.completed}
        title={todo.completed ? '완료됨 · 누르면 해제' : '완료로 표시'}
        className={cn(
          'w-5 h-5 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all shrink-0',
          todo.completed
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-bg-border/50 hover:border-accent',
        )}
      >
        {todo.completed && <Check size={11} strokeWidth={3} />}
      </button>

      {/* 개인 라벨 */}
      <span className="text-[11px] font-bold text-accent shrink-0">::ᅠ개인</span>

      {/* 제목/메모 — 클릭 시 상세 모달 */}
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, a')) return;
          onOpenDetail(todo);
        }}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest('button, a')) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(todo); }
        }}
        className="flex flex-col min-w-0 flex-1 gap-0.5 text-left cursor-pointer rounded px-0.5 -mx-0.5 hover:bg-bg-border/10 transition-colors"
        title="클릭하여 상세 보기/편집"
      >
        <span className={cn('text-[13px] text-text-primary truncate', todo.completed && 'line-through text-text-secondary/50')}>
          {todo.title}
        </span>
        {todo.memo && (
          <span className="text-[11px] text-text-secondary/50 truncate">
            <EntityText text={todo.memo} userNames={users.map((u) => u.name)} onHashClick={navigateToHashTarget} />
          </span>
        )}
      </div>

      {/* 삭제 */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(todo.id); }}
        className="p-1 text-red-400/60 hover:text-red-400 hover:bg-red-400/10 rounded cursor-pointer opacity-0 group-hover:opacity-100 transition-all shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}
