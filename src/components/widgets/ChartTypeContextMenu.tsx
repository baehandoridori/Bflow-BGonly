import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart3, PieChart, Hash, ArrowRightLeft } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import type { ChartType } from '@/types';
import { cn } from '@/utils/cn';

interface ChartTypeOption {
  type: ChartType;
  label: string;
  icon: React.ReactNode;
}

const ALL_OPTIONS: ChartTypeOption[] = [
  { type: 'horizontal-bar', label: '가로 막대', icon: <BarChart3 size={14} /> },
  { type: 'vertical-bar', label: '세로 막대', icon: <ArrowRightLeft size={14} className="rotate-90" /> },
  { type: 'donut', label: '도넛', icon: <PieChart size={14} /> },
  { type: 'stat-card', label: '숫자 카드', icon: <Hash size={14} /> },
];

interface ChartTypeContextMenuProps {
  widgetId: string;
  supportedTypes: ChartType[];
  x: number;
  y: number;
  onClose: () => void;
}

export function ChartTypeContextMenu({
  widgetId,
  supportedTypes,
  x,
  y,
  onClose,
}: ChartTypeContextMenuProps) {
  const setChartType = useAppStore((s) => s.setChartType);
  const currentType = useAppStore((s) => s.chartTypes[widgetId]);
  const menuRef = useRef<HTMLDivElement>(null);

  const options = ALL_OPTIONS.filter((o) => supportedTypes.includes(o.type));

  const handleSelect = useCallback(async (type: ChartType) => {
    setChartType(widgetId, type);
    onClose();
    // 설정 파일에 차트 타입 저장
    const prefs = await loadPreferences() ?? {};
    const chartTypes = { ...prefs.chartTypes, [widgetId]: type };
    await savePreferences({ ...prefs, chartTypes });
  }, [widgetId, setChartType, onClose]);

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  if (options.length <= 1) return null;

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.12 }}
      className="fixed z-[100] min-w-[160px]"
      style={{ left: x, top: y }}
    >
      <div
        className="rounded-xl overflow-hidden py-1.5"
        style={{
          backgroundColor: 'rgb(var(--color-bg-card) / 0.95)',
          border: '1px solid rgb(var(--color-bg-border) / 0.6)',
          boxShadow: '0 12px 32px rgb(var(--color-shadow) / var(--shadow-alpha)), 0 0 0 1px rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) inset',
          backdropFilter: 'blur(24px)',
        }}
      >
        <div className="px-3 py-1.5 text-[11px] font-medium text-text-secondary/50 uppercase tracking-wider">
          차트 표시 형식
        </div>
        {options.map((opt) => {
          const isActive = currentType === opt.type;
          return (
            <button
              key={opt.type}
              onClick={() => handleSelect(opt.type)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer',
                'transition-colors duration-75',
                isActive
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-primary/80 hover:bg-accent/8 hover:text-text-primary',
              )}
            >
              <span className="shrink-0">{opt.icon}</span>
              <span className="flex-1">{opt.label}</span>
              {isActive && (
                <span className="text-[11px] text-accent/60">현재</span>
              )}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── 위젯별 지원 차트 타입 매핑 ── */
const WIDGET_CHART_TYPES: Record<string, ChartType[]> = {
  // 전체 대시보드 위젯
  'overall-progress': ['donut', 'horizontal-bar', 'stat-card'],
  'stage-bars': ['horizontal-bar', 'vertical-bar'],
  'dept-comparison': ['horizontal-bar', 'vertical-bar', 'donut'],
  // episode-summary: 리스트 형태 위젯이므로 차트 전환 미지원
  // 에피소드 대시보드 위젯
  'ep-overall-progress': ['donut', 'horizontal-bar', 'stat-card'],
  'ep-stage-bars': ['horizontal-bar', 'vertical-bar'],
  'ep-dept-comparison': ['horizontal-bar', 'vertical-bar', 'donut'],
  'ep-part-progress': ['horizontal-bar', 'vertical-bar'],
};

export function getWidgetSupportedCharts(widgetId: string): ChartType[] {
  return WIDGET_CHART_TYPES[widgetId] ?? [];
}

/* ── 우클릭 컨텍스트 메뉴 상태 훅 ── */
export function useChartContextMenu() {
  const [menu, setMenu] = useState<{ widgetId: string; x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, widgetId: string) => {
    const supported = getWidgetSupportedCharts(widgetId);
    if (supported.length <= 1) return; // 전환 옵션이 없으면 기본 메뉴 유지
    e.preventDefault();
    setMenu({ widgetId, x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  return { menu, handleContextMenu, closeMenu };
}
