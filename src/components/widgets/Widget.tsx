import { GripVertical } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/utils/cn';

interface WidgetProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Widget({ title, icon, children, className }: WidgetProps) {
  const isEditMode = useAppStore((s) => s.isEditMode);

  return (
    <div
      className={cn(
        'bg-bg-card border border-bg-border rounded-xl flex flex-col h-full overflow-hidden',
        isEditMode && 'ring-1 ring-accent/30',
        className
      )}
    >
      {/* 헤더 (드래그 핸들) */}
      <div className="widget-drag-handle flex items-center gap-2 px-4 py-3 border-b border-bg-border cursor-grab select-none">
        {isEditMode && (
          <GripVertical size={14} className="text-text-secondary flex-shrink-0" />
        )}
        {icon && <span className="text-accent flex-shrink-0">{icon}</span>}
        <span className="text-sm font-medium truncate">{title}</span>
      </div>

      {/* 내용 */}
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}
