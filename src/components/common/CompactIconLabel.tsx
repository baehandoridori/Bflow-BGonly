import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface CompactIconLabelProps {
  icon: ReactNode;
  label: string;
  className?: string;
  textClassName?: string;
  iconClassName?: string;
  iconPosition?: 'before' | 'after';
  displayMode?: 'both' | 'text' | 'icon';
}

export function CompactIconLabel({
  icon,
  label,
  className,
  textClassName,
  iconClassName,
  iconPosition = 'before',
  displayMode = 'both',
}: CompactIconLabelProps) {
  const showIcon = displayMode !== 'text';
  const showText = displayMode !== 'icon';
  const iconNode = (
    <span
      data-compact-label-icon
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center', iconClassName)}
    >
      {icon}
    </span>
  );
  const textNode = (
    <span
      data-compact-label-text
      className={cn('min-w-0 whitespace-nowrap', textClassName)}
    >
      {label}
    </span>
  );

  return (
    <span
      data-compact-icon-label
      data-icon-position={iconPosition}
      data-display-mode={displayMode}
      aria-label={label}
      title={label}
      className={cn('inline-flex min-w-0 items-center justify-center gap-1.5', className)}
    >
      {iconPosition === 'before' && showIcon ? iconNode : null}
      {showText ? textNode : null}
      {iconPosition === 'after' && showIcon ? iconNode : null}
    </span>
  );
}
