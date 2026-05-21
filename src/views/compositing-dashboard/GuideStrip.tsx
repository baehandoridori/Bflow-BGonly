/**
 * 첫 진입 안내 띠 — 헤더 바로 아래.
 *
 * 인터랙션 자연어 설명 + 닫기 버튼. 한 번 닫으면 localStorage 플래그로 영구 dismiss.
 * (헤더 우측 ? 버튼으로 다시 펼치는 건 후속 polish — MVP 는 dismiss only.)
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (6.3)
 */

import { Lightbulb, X } from 'lucide-react';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';

export function GuideStrip() {
  const visible = useCompositingDashboardStore((s) => s.guideStripVisible);
  const dismiss = useCompositingDashboardStore((s) => s.dismissGuideStrip);

  if (!visible) return null;

  return (
    <div
      className="flex items-center gap-3 px-6 py-2.5 border-b text-[12px] leading-relaxed"
      style={{
        background: 'rgb(var(--color-accent) / 0.06)',
        borderColor: 'rgb(var(--color-accent) / 0.18)',
        color: 'rgb(var(--color-text-secondary))',
      }}
    >
      <Lightbulb size={14} className="text-accent shrink-0" />
      <div className="flex-1 min-w-0">
        씬을 한 번 클릭하면 위로 떠오르고, 한 번 더 누르면 상세 창이 열립니다.
        호버하면 옆 카드들이 살짝 들썩이고, 상단 단계 칩을 누르면 그 단계만 강조됩니다.
      </div>
      <button
        type="button"
        onClick={dismiss}
        title="이 안내 다시 보지 않기"
        className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-border/40 transition-colors shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}
