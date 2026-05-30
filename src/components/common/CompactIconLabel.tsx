import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface CompactIconLabelProps {
  icon: ReactNode;
  label: string;
  className?: string;
  textClassName?: string;
}

export function CompactIconLabel({
  icon,
  label,
  className,
  textClassName,
}: CompactIconLabelProps) {
  return (
    <span
      data-compact-icon-label
      aria-label={label}
      title={label}
      className={cn('inline-flex min-w-0 items-center justify-center gap-1.5', className)}
    >
      <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center">
        {icon}
      </span>
      <span
        data-compact-label-text
        className={cn('min-w-0 whitespace-nowrap', textClassName)}
      >
        {label}
      </span>
    </span>
  );
}
