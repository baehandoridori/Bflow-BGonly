import { MessageCircle, MessageSquareWarning } from 'lucide-react';
import { cn } from '@/utils/cn';

interface SheetAlertBadgesProps {
  revisionCount?: number;
  commentCount?: number;
  hasUnreadComments?: boolean;
}

export function SheetAlertBadges({
  revisionCount = 0,
  commentCount = 0,
  hasUnreadComments = false,
}: SheetAlertBadgesProps) {
  if (revisionCount <= 0 && commentCount <= 0) return null;

  return (
    <div className="flex items-center justify-center gap-1">
      {revisionCount > 0 && (
        <span
          className="relative inline-flex h-6 w-6 items-center justify-center rounded-md border border-accent/25 bg-accent/15 text-accent"
          title={`미해결 리비전 ${revisionCount}`}
          aria-label={`미해결 리비전 ${revisionCount}`}
        >
          <MessageSquareWarning size={12} strokeWidth={2.4} />
          <span className="absolute -right-1 -top-1 min-w-3.5 rounded-full bg-accent px-0.5 text-center text-[9px] font-black leading-3.5 text-white">
            {revisionCount}
          </span>
        </span>
      )}
      {commentCount > 0 && (
        <span
          className={cn(
            'relative inline-flex h-6 w-6 items-center justify-center rounded-md border',
            hasUnreadComments
              ? 'comment-unread-badge border-accent/25 bg-accent/20 text-accent'
              : 'border-bg-border/45 bg-text-secondary/10 text-text-secondary/60',
          )}
          title={`${hasUnreadComments ? '새 댓글' : '확인한 댓글'} ${commentCount}`}
          aria-label={`${hasUnreadComments ? '새 댓글' : '확인한 댓글'} ${commentCount}`}
        >
          <MessageCircle size={12} fill="currentColor" />
          <span className={cn(
            'absolute -right-1 -top-1 min-w-3.5 rounded-full px-0.5 text-center text-[9px] font-black leading-3.5',
            hasUnreadComments ? 'bg-accent text-white' : 'bg-bg-border text-text-primary',
          )}>
            {commentCount}
          </span>
        </span>
      )}
    </div>
  );
}
