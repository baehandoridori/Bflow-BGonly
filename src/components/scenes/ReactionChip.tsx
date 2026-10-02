/**
 * v1.26.0 — 댓글 이모지 리액션 칩.
 *
 * 그룹화된 (이모지 + 카운트) 칩 한 개. 호버 시 누른 사람 툴팁.
 * 본인이 누른 이모지는 accent 강조.
 *
 * 움직임 폴리싱 19번(comments-send-react):
 * - 새로 생긴 칩만 '톡'(pop). 처음 그려질 때 정해져 칩이 있는 동안 바뀌지 않는다(클래스를 넣었다 빼지 않음).
 * - 숫자는 늘면 위로·줄면 아래로 짧게 굴러 바뀐다. 숫자마다 새 칸이 그려지며 한 번만 돈다.
 * - 색 변화만 전환한다(transition-all 은 크기·자리 변화까지 따라 움직였다).
 */

import { useState } from 'react';
import { cn } from '@/utils/cn';
import type { CommentReactionGroup } from '@/types';
import { formatReactionTooltip } from '@/utils/commentReactionUtils';
import { reactionCountRollDirection } from '@/utils/commentSendReact';

interface ReactionChipProps {
  group: CommentReactionGroup;
  currentUserId: string | null;
  onToggle: (emoji: string) => void;
  /** 이 칩이 방금 새로 생겼으면 true — 처음 그려질 때만 본다(패널을 열 때 이미 있던 칩은 false). */
  pop?: boolean;
}

export function ReactionChip({ group, currentUserId, onToggle, pop = false }: ReactionChipProps) {
  const [hover, setHover] = useState(false);
  const [popOnMount] = useState(pop);
  // 숫자 굴림 방향 — 직전에 보여 준 숫자와 비교한다(렌더 중 이전 값 맞추기).
  const [shownCount, setShownCount] = useState(group.count);
  const [roll, setRoll] = useState<'up' | 'down' | null>(null);
  if (group.count !== shownCount) {
    setShownCount(group.count);
    setRoll(reactionCountRollDirection(shownCount, group.count));
  }
  return (
    <button
      type="button"
      className={cn(
        'relative inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs leading-none cursor-pointer transition-colors duration-150 border',
        popOnMount && 'reaction-chip-pop',
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
      <span className="reaction-count-window tabular-nums">
        <span key={group.count} className={cn('reaction-count', roll && `reaction-count--${roll}`)}>
          {group.count}
        </span>
      </span>
      {hover && (
        // 바깥은 가운데 맞춤 자리(-translate-x-1/2), 안쪽만 2px 아래에서 옅게 떠오른다(transform 이 겹치지 않게).
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1 pointer-events-none">
          <div className="reaction-tooltip px-2 py-1 bg-bg-card border border-bg-border rounded text-[11px] text-text-primary whitespace-nowrap shadow-lg">
            {formatReactionTooltip(group, currentUserId)}
          </div>
        </div>
      )}
    </button>
  );
}
