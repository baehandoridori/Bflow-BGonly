import { RotateCcw } from 'lucide-react';
import type { PersonalTodoStatus } from '../types';
import { getTodoNextAction } from '../personalTodoDomain';
import type { PersonalTodoSyncState } from './TodoMetadata';

interface TodoStatusActionProps {
  status: PersonalTodoStatus;
  disabled?: boolean;
  syncState?: PersonalTodoSyncState;
  onAction: () => void;
  onRetry?: () => void;
}
export function TodoStatusAction({ status, disabled = false, syncState = 'idle', onAction, onRetry }: TodoStatusActionProps) {
  const next = getTodoNextAction(status);
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onAction(); }}
        disabled={disabled}
        className="px-1.5 py-1 rounded border border-accent/30 text-accent/85 hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-[10px] font-medium whitespace-nowrap"
        aria-label={`다음 상태: ${next.label}`}
      >
        {next.label}
      </button>
      {syncState === 'sync-needed' && onRetry && (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onRetry(); }}
          className="flex items-center gap-0.5 px-1 py-1 rounded text-amber-300 hover:bg-amber-300/10 cursor-pointer text-[10px]"
          aria-label="개인 할일 저장 다시 시도"
          title="저장 다시 시도"
        >
          <RotateCcw size={10} /> 다시 시도
        </button>
      )}
    </div>
  );
}
