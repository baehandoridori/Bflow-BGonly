import { GripVertical } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/utils/cn';

interface WidgetProps {
  title: string;
  icon?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Widget({ title, icon, headerRight, children, className }: WidgetProps) {
  const isEditMode = useAppStore((s) => s.isEditMode);

  return (
    <div
      className={cn(
        'border border-bg-border/60 rounded-xl flex flex-col h-full overflow-hidden',
        'shadow-sm shadow-black/10',
        'hover:shadow-md hover:shadow-black/20 hover:border-bg-border/80',
        'transition-shadow transition-border duration-200 ease-out',
        isEditMode && 'ring-1 ring-accent/30',
        className
      )}
      style={{
        background: 'rgba(20, 22, 32, 0.45)',
        backdropFilter: 'blur(20px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.6)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06) inset, 0 1px 0 rgba(255,255,255,0.08) inset',
      }}
    >
      {/* 헤더 */}
      <div
        className={cn(
          'widget-drag-handle flex items-center gap-2 px-4 py-3',
          'border-b border-bg-border/60 select-none',
          isEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        )}
      >
        {isEditMode && (
          <GripVertical size={14} className="text-text-secondary/60 flex-shrink-0" />
        )}
        {icon && <span className="text-accent flex-shrink-0">{icon}</span>}
        <span className="text-sm font-medium truncate text-text-primary/90">{title}</span>
        {headerRight && <div className="ml-auto flex items-center">{headerRight}</div>}
      </div>

      {/* 내용 */}
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}
