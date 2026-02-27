import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface SettingsSectionProps {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function SettingsSection({ icon, title, children, action, className }: SettingsSectionProps) {
  return (
    <div className={cn('bg-bg-card border border-bg-border rounded-xl p-5', className)}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold text-text-secondary">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
