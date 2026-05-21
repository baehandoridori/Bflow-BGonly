/**
 * 상태 범례 + 필터 — 헤더 아래 한 줄.
 *
 * 6 개 상태 칩 + 그 단계 카드 수 카운트. 클릭 = 그 단계 필터 토글.
 * 호버 = hoveredStatus 셋 (linked highlight, 후속 polish — MVP 는 클릭 필터만).
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (6.4)
 */

import { useMemo } from 'react';
import { cn } from '@/utils/cn';
import type { CompositingState, CompositingStatus } from '@/types';
import { COMPOSITING_STATUS_LABEL, COMPOSITING_STATUS_TOKEN, COMPOSITING_STATUS_ORDER } from '@/utils/compositingLabels';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';

interface StatusLegendProps {
  epStates: Map<string, CompositingState>;
}

export function StatusLegend({ epStates }: StatusLegendProps) {
  const statusFilter = useCompositingDashboardStore((s) => s.statusFilter);
  const setStatusFilter = useCompositingDashboardStore((s) => s.setStatusFilter);

  const counts = useMemo(() => {
    const c: Record<CompositingStatus, number> = {
      batch: 0, combine: 0, aggregated: 0, adjust: 0, error: 0, done: 0,
    };
    for (const row of epStates.values()) {
      c[row.status] = (c[row.status] ?? 0) + 1;
    }
    return c;
  }, [epStates]);

  return (
    <div
      className="flex items-center gap-2 px-6 py-2 border-b border-bg-border/40 overflow-x-auto"
      role="toolbar"
      aria-label="상태별 필터"
    >
      {COMPOSITING_STATUS_ORDER.map((st) => {
        const count = counts[st] ?? 0;
        const active = statusFilter === st;
        const tokenVar = COMPOSITING_STATUS_TOKEN[st];
        return (
          <button
            key={st}
            type="button"
            onClick={() => setStatusFilter(active ? null : st)}
            title={`${COMPOSITING_STATUS_LABEL[st]} ${count}개${active ? ' (필터 해제)' : ''}`}
            className={cn(
              'shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full transition-all duration-200',
              'border tabular-nums',
              active ? 'shadow-[0_0_0_2px_currentColor_inset]' : 'hover:brightness-110',
            )}
            style={{
              background: `color-mix(in srgb, var(${tokenVar}) ${active ? 22 : 12}%, transparent)`,
              color: `var(${tokenVar})`,
              borderColor: `color-mix(in srgb, var(${tokenVar}) ${active ? 60 : 28}%, transparent)`,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: `var(${tokenVar})` }}
            />
            {COMPOSITING_STATUS_LABEL[st]}
            <span className="opacity-70">{count}</span>
          </button>
        );
      })}
      {statusFilter !== null && (
        <button
          type="button"
          onClick={() => setStatusFilter(null)}
          className="ml-2 text-[10px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline transition-colors"
        >
          필터 해제
        </button>
      )}
    </div>
  );
}
