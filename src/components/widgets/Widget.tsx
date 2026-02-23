import { createContext, useContext } from 'react';
import { GripVertical, ExternalLink } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/utils/cn';

/** Dashboard에서 각 위젯을 래핑하여 widgetId를 전달하는 Context */
export const WidgetIdContext = createContext<string | null>(null);
/** 팝업 모드 감지 (팝업 안에서는 팝아웃 버튼 숨김, 스타일 변경) */
export const IsPopupContext = createContext(false);

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
  const isPopup = useContext(IsPopupContext);
  const widgetId = propId ?? ctxId;

  const handlePopout = () => {
    if (!widgetId) return;
    window.electronAPI?.widgetOpenPopup?.(widgetId, title);
  };

  // 팝업 모드: 헤더/외곽 없이 콘텐츠만 표시
  if (isPopup) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <div className="flex-1 overflow-auto p-4">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'border border-bg-border/30 rounded-2xl flex flex-col h-full overflow-hidden',
        'shadow-sm',
        'hover:shadow-lg hover:border-bg-border/50',
        'transition-all duration-200 ease-out',
        isEditMode && 'ring-1 ring-accent/30',
        className
      )}
      style={{
        background: 'rgb(var(--color-glass-tint) / var(--glass-tint-alpha))',
        backdropFilter: 'blur(24px) saturate(1.8)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
        boxShadow: '0 8px 32px rgb(var(--color-shadow) / var(--shadow-alpha)), 0 0 0 1px rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) inset, 0 1px 0 rgb(var(--color-glass-highlight) / 0.12) inset',
      }}
    >
      {/* 헤더 */}
      <div
        className={cn(
          'widget-drag-handle flex items-center gap-2 px-4 py-3',
          'border-b border-bg-border/20 select-none',
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
