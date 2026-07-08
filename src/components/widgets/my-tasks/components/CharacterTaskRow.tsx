import { motion } from 'framer-motion';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/utils/cn';
import { describeDueDate, todayLocalISO, type DueTone } from '@/utils/dueDateBadge';
import type { CharacterTaskItem } from '../types';

const DUE_TONE_CLASS: Record<DueTone, string> = {
  overdue: 'text-[rgb(var(--char-stage-feedback))] bg-[rgb(var(--char-stage-feedback)/0.16)]',
  today: 'text-[rgb(var(--char-stage-feedback))] bg-[rgb(var(--char-stage-feedback)/0.16)]',
  soon: 'text-[rgb(var(--char-stage-progress))] bg-[rgb(var(--char-stage-progress)/0.14)]',
  normal: 'text-text-secondary/70 bg-bg-border/40',
};

/** 마감 배지 — 미완료 태스크에만 표시. (T2-4) */
function DueBadge({ dueDate, className }: { dueDate: string | null; className?: string }) {
  const info = describeDueDate(dueDate, todayLocalISO());
  if (!info) return null;
  return (
    <span
      className={cn('px-1.5 py-0.5 rounded-full font-medium shrink-0', DUE_TONE_CLASS[info.tone], className)}
      title={`마감일 ${dueDate}`}
    >
      {info.label}
    </span>
  );
}

interface CharacterTaskViewProps {
  task: CharacterTaskItem;
  onOpen?: (task: CharacterTaskItem) => void;
  enterDelay?: number;
  reduce?: boolean;
}

function kindLabel(kind: CharacterTaskItem['kind']): string {
  return kind === 'design' ? '디자인' : '리깅';
}

function colorMix(color: string, amount: number): string {
  return `color-mix(in srgb, ${color} ${amount}%, transparent)`;
}

export function CharacterTaskRow({ task, onOpen, enterDelay = 0, reduce = false }: CharacterTaskViewProps) {
  const clickable = !!onOpen;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.25, delay: enterDelay }}
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-lg group transition-[background-color,box-shadow]',
        task.done ? 'bg-green-500/5 opacity-60' : 'hover:bg-bg-border/8 hover:shadow-[0_2px_14px_-4px_rgba(108,92,231,0.45)]',
      )}
    >
      <span className={cn(
        'text-[11px] font-bold shrink-0',
        task.kind === 'design' ? 'text-[rgb(var(--char-stage-progress))]' : 'text-[rgb(var(--char-stage-rigging))]',
      )}>
        :: {kindLabel(task.kind)}
      </span>

      <button
        type="button"
        disabled={!clickable}
        onClick={() => onOpen?.(task)}
        className={cn(
          'flex flex-col min-w-0 flex-1 gap-0.5 text-left rounded px-0.5 -mx-0.5 transition-colors',
          clickable ? 'cursor-pointer hover:bg-bg-border/10' : 'cursor-default',
        )}
        title={clickable ? '캐릭터 현황판에서 열기' : undefined}
      >
        <span className={cn('text-[13px] text-text-primary truncate', task.done && 'line-through text-text-secondary/50')}>
          {task.characterName}
        </span>
        <span className="text-[11px] text-text-secondary/50 truncate">{task.costumeName}</span>
      </button>

      {!task.done && <DueBadge dueDate={task.dueDate} className="text-[10px]" />}

      <span
        className="px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0"
        style={{ color: task.stageColor, background: colorMix(task.stageColor, 12), border: `1px solid ${colorMix(task.stageColor, 35)}` }}
      >
        {task.stageLabel}
      </span>

      {clickable && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen?.(task); }}
          className="p-1 text-text-secondary/20 hover:text-accent cursor-pointer rounded transition-all opacity-0 group-hover:opacity-100"
          title="캐릭터 현황판에서 열기"
        >
          <ExternalLink size={12} />
        </button>
      )}
    </motion.div>
  );
}

export function CharacterTaskCard({ task, onOpen, enterDelay = 0, reduce = false }: CharacterTaskViewProps) {
  const clickable = !!onOpen;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.25, delay: enterDelay }}
      className={cn(
        'group relative flex flex-col gap-1.5 rounded-lg border bg-bg-card p-2 min-h-[92px] transition-[border-color,box-shadow]',
        task.done ? 'opacity-60 border-bg-border/30' : 'border-bg-border/40 hover:border-bg-border/70 hover:shadow-[0_4px_18px_-6px_rgba(108,92,231,0.5)]',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn(
        'text-[10px] font-bold',
          task.kind === 'design' ? 'text-[rgb(var(--char-stage-progress))]' : 'text-[rgb(var(--char-stage-rigging))]',
        )}>
          :: {kindLabel(task.kind)}
        </span>
        {!task.done && <DueBadge dueDate={task.dueDate} className="ml-auto text-[9px]" />}
        <span
          className={cn('px-1.5 py-0.5 rounded-full text-[9px] font-medium shrink-0', task.done && 'ml-auto')}
          style={{ color: task.stageColor, background: colorMix(task.stageColor, 12), border: `1px solid ${colorMix(task.stageColor, 35)}` }}
        >
          {task.stageLabel}
        </span>
      </div>

      <button
        type="button"
        disabled={!clickable}
        onClick={() => onOpen?.(task)}
        className={cn('flex flex-col gap-0.5 text-left flex-1 min-w-0', clickable ? 'cursor-pointer' : 'cursor-default')}
      >
        <span className={cn('text-[12px] text-text-primary line-clamp-2', task.done && 'line-through text-text-secondary/50')}>
          {task.characterName}
        </span>
        <span className="text-[10px] text-text-secondary/50 truncate">{task.costumeName}</span>
      </button>

      {clickable && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen?.(task); }}
          className="absolute bottom-1 right-1 p-1 rounded text-text-secondary/30 hover:text-accent cursor-pointer opacity-0 group-hover:opacity-100 transition-all"
          title="캐릭터 현황판에서 열기"
        >
          <ExternalLink size={11} />
        </button>
      )}
    </motion.div>
  );
}
