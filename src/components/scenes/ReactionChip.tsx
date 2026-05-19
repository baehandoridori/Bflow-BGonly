/**
 * v1.26.0 — 댓글 이모지 리액션 칩.
 *
 * 그룹화된 (이모지 + 카운트) 칩 한 개. 호버 시 누른 사람 툴팁.
 * 본인이 누른 이모지는 accent 강조.
 */

import { useState } from 'react';
import { cn } from '@/utils/cn';
import type { CommentReactionGroup } from '@/types';
import { formatReactionTooltip } from '@/utils/commentReactionUtils';

interface ReactionChipProps {
  group: CommentReactionGroup;
  currentUserId: string | null;
  onToggle: (emoji: string) => void;
}

export function ReactionChip({ group, currentUserId, onToggle }: ReactionChipProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      className={cn(
        'relative inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs leading-none cursor-pointer transition-all duration-150 border',
        group.mine
          ? 'bg-accent/[0.18] border-accent/70 text-accent-sub font-semibold'
          : 'bg-bg-primary border-bg-border text-text-secondary hover:border-accent/50 hover:bg-accent/[0.08]',
      )}
      onClick={() => onToggle(group.emoji)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={`${group.emoji} ${group.count}명 반응${group.mine ? ' (내가 누름)' : ''}`}
    >
      <span className="text-sm">{group.emoji}</span>
      <span className="tabular-nums">{group.count}</span>
      {hover && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-bg-card border border-bg-border rounded text-[11px] text-text-primary whitespace-nowrap pointer-events-none shadow-lg">
          {formatReactionTooltip(group, currentUserId)}
        </div>
      )}
    </button>
  );
}
