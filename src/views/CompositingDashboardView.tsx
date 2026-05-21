/**
 * 컴포지팅 현황 대시보드 — 메인 컨테이너.
 *
 * v1.30.0: 6 단계 워크플로 (배치 → 취합중 → 취합 완료 → 보정 중 → 오류 → 완료) 를
 * EP 별로 실시간 시각화하는 새 뷰. Realtime + Presence + Broadcast 로 협업.
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md
 * plan: docs/superpowers/plans/2026-05-21-compositing-dashboard.md
 *
 * 현재(Task 3.1 시점)는 placeholder — 라우팅과 좌측 사이드바 분리만 동작.
 * 본 컴포넌트의 자식 (DashHeader / GuideStrip / StatusLegend / TimelinePanel / PartCardRow / Modal) 은
 * Task 3.2~3.7 에서 순차 채워진다.
 */

import { Clapperboard } from 'lucide-react';

export function CompositingDashboardView() {
  return (
    <div className="flex flex-col h-full bg-bg-primary text-text-primary overflow-hidden items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-text-secondary">
        <Clapperboard size={48} className="opacity-50" />
        <div className="text-sm font-medium">컴포지팅 현황 대시보드 — 곧 만나요</div>
        <div className="text-xs text-text-secondary/70">
          v1.30.0 에서 이 자리에 새 진행 현황 화면이 들어옵니다.
        </div>
      </div>
    </div>
  );
}

export default CompositingDashboardView;
