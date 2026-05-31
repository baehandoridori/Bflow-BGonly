import { MessageSquare } from 'lucide-react';
import type { CompRevision } from '@/types';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';

export function summarizeRevisionComments(
  revisions: CompRevision[],
  commentCountByRev?: Map<string, number>,
  commentSeenByRev?: Map<string, boolean>,
): { count: number; seen: boolean } {
  let count = 0;
  let hasUnread = false;

  for (const revision of revisions) {
    const revisionCommentCount = commentCountByRev?.get(revision.id) ?? 0;
    if (revisionCommentCount <= 0) continue;

    count += revisionCommentCount;
    if (!commentSeenByRev?.get(revision.id)) {
      hasUnread = true;
    }
  }

  return {
    count,
    seen: count > 0 && !hasUnread,
  };
}

export function RevisionCommentMarker({
  count,
  seen = false,
  size = 'normal',
  className = '',
}: {
  count: number;
  seen?: boolean;
  size?: 'normal' | 'compact';
  className?: string;
}) {
  if (count <= 0) return null;

  const label = seen ? `확인한 댓글 ${count}개` : `새 댓글 ${count}개`;
  const sizeClass = size === 'compact'
    ? 'gap-0.5 px-1.5 py-0.5 text-[10px]'
    : 'gap-1 px-2 py-0.5 text-[11px]';

  return (
    <span
      data-comment-marker={seen ? 'seen' : 'unseen'}
      title={label}
      aria-label={label}
      className={`compact-label-container inline-flex min-w-0 shrink items-center rounded-full border font-bold leading-none transition-colors ${
        seen
          ? 'border-bg-border/35 bg-bg-primary/35 text-text-secondary/55'
          : 'border-accent/30 bg-accent/10 text-accent-sub'
      } ${sizeClass} ${className}`}
      style={seen ? undefined : { boxShadow: '0 0 12px rgba(108, 92, 231, 0.16)' }}
    >
      <CompactIconLabel
        icon={<MessageSquare size={size === 'compact' ? 10 : 11} className="shrink-0" />}
        label={`${count}`}
      />
    </span>
  );
}
