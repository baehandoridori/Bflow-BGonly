import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useActivityStore, type InsightsRange } from '@/stores/useActivityStore';
import { MonthDowHeatmapCard } from './cards/MonthDowHeatmapCard';
import { StageBreakdownCard } from './cards/StageBreakdownCard';
import { UserBreakdownCard } from './cards/UserBreakdownCard';
import { TopScenesCard } from './cards/TopScenesCard';
import { WeeklyCompletedCard } from './cards/WeeklyCompletedCard';
import { SceneFlowCard } from './cards/SceneFlowCard';
import { EpisodeProgressCard } from './cards/EpisodeProgressCard';

export function ActivityInsightsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { insights, insightsLoading, insightsRange, loadInsights, setInsightsRange } = useActivityStore();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // v1.23.0 (codex 1차 P2): setInsightsRange 가 이미 loadInsights 를 부른다.
    // 여기서는 모달 첫 진입 시 캐시 없을 때 1회만 (in-flight 동시에 들어가면 중복).
    if (!insights && !insightsLoading) loadInsights(insightsRange);
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [open, insights, insightsLoading, insightsRange, loadInsights]);

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
