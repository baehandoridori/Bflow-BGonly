import { Check, MessageSquareWarning } from 'lucide-react';
import { cn } from '@/utils/cn';

interface RevisionCornerFlagProps {
  count: number;
  resolved?: boolean;
  className?: string;
}

export function RevisionCornerFlag({ count, resolved = false, className }: RevisionCornerFlagProps) {
  if (count <= 0) return null;

  const label = `${resolved ? '완료된 리비전' : '미해결 리비전'} ${count}`;

  return (
    <span
      className={cn('revision-corner-flag', resolved && 'revision-corner-flag-resolved', className)}
      title={label}
      aria-label={label}
    >
      <span className="revision-corner-flag-content">
        {resolved ? <Check size={10} strokeWidth={2.6} /> : <MessageSquareWarning size={10} strokeWidth={2.4} />}
        <span className="revision-corner-flag-count">{count}</span>
      </span>
    </span>
  );
}
