import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useActivityStore, type InsightsRange } from '@/stores/useActivityStore';
import { useAppStore } from '@/stores/useAppStore';
import { MonthDowHeatmapCard } from './cards/MonthDowHeatmapCard';
import { StageBreakdownCard } from './cards/StageBreakdownCard';
import { UserBreakdownCard } from './cards/UserBreakdownCard';
import { TopScenesCard } from './cards/TopScenesCard';
import { WeeklyCompletedCard } from './cards/WeeklyCompletedCard';
import { SceneFlowCard } from './cards/SceneFlowCard';
import { EpisodeProgressCard } from './cards/EpisodeProgressCard';

export function ActivityInsightsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { insights, insightsLoading, insightsError, insightsRange, loadInsights, setInsightsRange } = useActivityStore();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // v1.23.0 codex 3차 P1: dept 변경 감지 — 다른 부서 데이터 노출 방지
  const dashboardDeptFilter = useAppStore((s) => s.dashboardDeptFilter);
  const lastDeptRef = useRef(dashboardDeptFilter);

  useEffect(() => {
    if (!open) return;
    // dept 가 바뀌면 강제 reload (store 의 cachedInsightsDept 도 같이 갱신됨)
    const deptChanged = lastDeptRef.current !== dashboardDeptFilter;
    lastDeptRef.current = dashboardDeptFilter;
    // codex 7차 P1: insightsError 가 있으면 무한 재요청 루프 방지를 위해 자동 재시도 X.
    //   사용자가 "다시 시도" 버튼 클릭 또는 range/dept 변경 시에만 재요청.
    // codex 11차 P1: dept 변경은 loading 중이어도 새 요청 보내야 함.
    //   loadInsights 의 requestId 토큰이 stale 응답 자동 차단하므로 안전.
    const shouldFetch = deptChanged
      || (!insights && !insightsLoading && !insightsError);
    if (shouldFetch) {
      loadInsights(insightsRange);
    }
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [open, insights, insightsLoading, insightsError, insightsRange, loadInsights, dashboardDeptFilter]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/55 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-insights-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[1080px] flex flex-col overflow-hidden rounded-2xl border border-bg-border bg-bg-card/95 shadow-2xl shadow-black/40"
        style={{ height: '88vh' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-7 py-5 border-b border-bg-border/60 flex items-start justify-between gap-4 shrink-0">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-secondary">Activity Insights</p>
            <h2 id="activity-insights-title" className="text-xl font-bold tracking-tight mt-1.5">활동 분석</h2>
            <p className="text-sm text-text-secondary mt-1 leading-relaxed">최근 활동 데이터로 본 팀 작업 패턴.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={insightsRange}
              onChange={(e) => setInsightsRange(e.target.value as InsightsRange)}
              className="bg-bg-border/40 border border-bg-border rounded-lg px-3 py-2 text-[12px] text-text-primary cursor-pointer"
            >
              <option value="year">최근 1년</option>
              <option value="half">최근 6개월</option>
              <option value="quarter">최근 3개월</option>
            </select>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-border/50 transition-colors cursor-pointer"
              aria-label="활동 분석 닫기"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-7 overflow-y-auto flex-1">
          {insightsLoading && !insights && (
            <div className="text-center text-text-secondary py-12 text-[13px]">불러오는 중...</div>
          )}
          {insightsError && !insightsLoading && (
            <div className="text-center py-12 space-y-3">
              <p className="text-[13px] text-[#FDCB6E]">분석 데이터를 불러오지 못했습니다.</p>
              <p className="text-[11px] text-text-secondary leading-relaxed max-w-md mx-auto">
                {insightsError}
              </p>
              <button
                type="button"
                onClick={() => loadInsights(insightsRange)}
                className="px-3 py-1.5 rounded-lg border border-accent/35 bg-accent/10 text-accent-sub text-[12px] font-semibold hover:bg-accent/20 transition-colors cursor-pointer"
              >
                다시 시도
              </button>
            </div>
          )}
          {insights && (
            <div className="space-y-5">
              <MonthDowHeatmapCard data={insights.monthDowGrid} />
              <div className="grid grid-cols-2 gap-5">
                <SceneFlowCard />
                <UserBreakdownCard breakdown={insights.userBreakdown} total={insights.userBreakdownTotal} />
                <StageBreakdownCard data={insights.stageBreakdown} />
                <EpisodeProgressCard />
                <TopScenesCard scenes={insights.topScenes} />
              </div>
              <WeeklyCompletedCard data={insights.weeklyCompleted} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
