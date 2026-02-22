import { createContext, useContext } from 'react';
import { GripVertical, ExternalLink } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/utils/cn';

/** Dashboard에서 각 위젯을 래핑하여 widgetId를 전달하는 Context */
export const WidgetIdContext = createContext<string | null>(null);

interface WidgetProps {
  title: string;
  widgetId?: string;
  icon?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Widget({ title, widgetId: propId, icon, headerRight, children, className }: WidgetProps) {
  const isEditMode = useAppStore((s) => s.isEditMode);
  const ctxId = useContext(WidgetIdContext);
  const widgetId = propId ?? ctxId;

  const handlePopout = () => {
    if (!widgetId) return;
    window.electronAPI?.widgetOpenPopup?.(widgetId, title);
  };

  return (
    <div
      className={cn(
        'border border-white/[0.08] rounded-xl flex flex-col h-full overflow-hidden',
        'shadow-sm shadow-black/10',
        'hover:shadow-lg hover:shadow-black/25 hover:border-white/[0.12]',
        'transition-all duration-200 ease-out',
        isEditMode && 'ring-1 ring-accent/30',
        className
      )}
      style={{
        background: 'rgba(16, 18, 28, 0.32)',
        backdropFilter: 'blur(24px) saturate(1.8)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08) inset, 0 1px 0 rgba(255,255,255,0.12) inset',
      }}
    >
      {/* 헤더 */}
      <div
        className={cn(
          'widget-drag-handle flex items-center gap-2 px-4 py-3',
          'border-b border-white/[0.06] select-none',
          isEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        )}
      >
        {isEditMode && (
          <GripVertical size={14} className="text-text-secondary/60 flex-shrink-0" />
        )}
        {icon && <span className="text-accent flex-shrink-0">{icon}</span>}
        <span className="text-sm font-medium truncate text-text-primary/90">{title}</span>
        <div className="ml-auto flex items-center gap-1">
          {headerRight}
          {widgetId && !isEditMode && (
            <button
              onClick={handlePopout}
              className="p-1 rounded-md text-text-secondary/40 hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
              title="위젯 팝업으로 띄우기"
            >
              <ExternalLink size={13} />
            </button>
          )}
        </div>
      </div>

      {/* 내용 */}
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}
