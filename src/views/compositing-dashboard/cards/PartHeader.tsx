/**
 * 파트 행 헤더 — [A] 파트 A · 14컷  ▾
 *
 * spec: 2026-05-21-compositing-dashboard-design.md (8.2)
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';
import { PartBadge } from '@/components/compositing-dashboard/common/PartBadge';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';

interface PartHeaderProps {
  partId: string;
  sceneCount: number;
  expanded: boolean;
  onToggle: () => void;
}

export function PartHeader({ partId, sceneCount, expanded, onToggle }: PartHeaderProps) {
  const hoveredPart = useCompositingDashboardStore((s) => s.hoveredPart);
  const setHoveredPart = useCompositingDashboardStore((s) => s.setHoveredPart);
  const focused = hoveredPart === partId;

  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHoveredPart(partId)}
      onMouseLeave={() => setHoveredPart(null)}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-md transition-all duration-200 border text-left',
        'hover:bg-bg-card/70',
        focused
          ? 'border-bg-border shadow-[0_0_0_1px_rgb(var(--color-bg-border))]'
          : 'border-bg-border/40',
      )}
      style={{ background: 'rgb(var(--color-bg-card) / 0.35)' }}
    >
      {expanded
        ? <ChevronDown size={14} className="text-text-secondary shrink-0" />
        : <ChevronRight size={14} className="text-text-secondary shrink-0" />}
      <PartBadge partId={partId as 'A' | 'B' | 'C' | 'D'} size="md" />
      <span className="text-[13px] font-semibold text-text-primary">
        파트 {partId}
      </span>
      <span className="text-[11px] text-text-secondary font-medium">· {sceneCount}컷</span>
    </button>
  );
}
