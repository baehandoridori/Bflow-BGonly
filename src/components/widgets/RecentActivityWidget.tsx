import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Clock, Filter, Grid3x3, BarChart3 } from 'lucide-react';
import { Widget } from './Widget';
import { useActivityStore, type GoldenMode } from '@/stores/useActivityStore';
import { useAppStore } from '@/stores/useAppStore';
import { GoldenHeatmap } from './activity/GoldenHeatmap';
import { GoldenBarChart } from './activity/GoldenBarChart';
import { ActivityFilterChips } from './activity/ActivityFilterChips';
import { ActivityFeed } from './activity/ActivityFeed';
import { pickGoldenWindow, pickGoldenHour, pickGoldenDay, dayLabel } from './activity/utils';
import { subscribeToActivityRealtime } from '@/services/supabaseService';

interface TooltipState {
  visible: boolean;
  text: string;
  x: number;
  y: number;
}

export function RecentActivityWidget() {
  const {
    statsGrid,
    goldenMode,
    setGoldenMode,
    activities,
    loadInitial,
    receiveRealtime,
  } = useActivityStore();

  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, text: '', x: 0, y: 0 });

  // 대시보드 부서 필터 변경 시 활동 + statsGrid 자동 재로드 (Codex P2).
  // useActivityStore 의 store action 은 stable reference 라 useEffect 가 재실행되지 않으므로
  // dashboardDeptFilter 를 명시적으로 deps 에 두어 변경을 감지한다.
  const dashboardDeptFilter = useAppStore((s) => s.dashboardDeptFilter);

  // Realtime 구독은 마운트 생명주기에 1번만 (구독 먼저 → race window 최소화)
  useEffect(() => {
    const unsub = subscribeToActivityRealtime(receiveRealtime);
    return () => unsub();
  }, [receiveRealtime]);

  // 활동/통계 로드는 마운트 시 + 부서 필터 변경 시
  useEffect(() => {
    loadInitial();
  }, [dashboardDeptFilter, loadInitial]);

  // 인사이트 자동 산출 (모드별)
  const insightText = useMemo(() => {
    if (activities.length < 5) return '기록을 모으는 중입니다';
    if (goldenMode === 'heatmap') {
      const w = pickGoldenWindow(statsGrid);
      if (!w) return '활동 기록이 부족합니다';
      return `이번 주 가장 활발: ${dayLabel(w.day)}요일 ${w.hour}–${w.hour + 2}시 (${w.count}건)`;
    }
    if (goldenMode === 'hour') {
      const hourTotals = new Array(24).fill(0);
      for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) hourTotals[h] += statsGrid[d][h];
      const r = pickGoldenHour(hourTotals);
      if (!r) return '활동 기록이 부족합니다';
      return `하루 중 정점: ${r.hour}–${r.hour + 2}시 (24시간 기준 ${Math.round(r.ratio * 100)}%)`;
    }
    // day
    const dayTotals = new Array(7).fill(0);
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) dayTotals[d] += statsGrid[d][h];
    const r = pickGoldenDay(dayTotals);
    if (!r) return '활동 기록이 부족합니다';
    return `주중 정점: ${dayLabel(r.day)}요일 (전체의 ${Math.round(r.ratio * 100)}%)`;
  }, [statsGrid, goldenMode, activities.length]);

  return (
    <Widget title="최근 작업" icon={<Activity size={14} />} headerRight={<ModeToggle mode={goldenMode} onChange={setGoldenMode} />}>
      <div className="flex flex-col h-full -m-4">
        {/* 인사이트 배너 */}
        <div className="flex items-center gap-2 px-3.5 pt-3 pb-1">
          <div className="w-full flex items-center gap-2 px-3 py-2 bg-accent/8 border border-accent/20 rounded-[10px] text-[12.5px]">
            <span className="text-accent-sub flex-shrink-0">
              <Clock size={14} />
            </span>
            <span className="text-text-primary">{insightText}</span>
          </div>
        </div>

        {/* 골든타임 시각화 (모드 전환) */}
        <div className="px-3.5 pt-3 pb-1 flex-shrink-0">
          {goldenMode === 'heatmap' && (
            <GoldenHeatmap
              onCellHover={(info) => {
                if (!info) { setTooltip({ visible: false, text: '', x: 0, y: 0 }); return; }
                setTooltip({
                  visible: true,
                  text: `${dayLabel(info.day)} ${info.hour}시 · ${info.count}건`,
                  x: info.x, y: info.y,
                });
              }}
            />
          )}
          {goldenMode === 'hour' && (
            <GoldenBarChart
              mode="hour"
              onBarHover={(info) => {
                if (!info) { setTooltip({ visible: false, text: '', x: 0, y: 0 }); return; }
                setTooltip({ visible: true, text: `${info.label} · ${info.count}건`, x: info.x, y: info.y });
              }}
            />
          )}
          {goldenMode === 'day' && (
            <GoldenBarChart
              mode="day"
              onBarHover={(info) => {
                if (!info) { setTooltip({ visible: false, text: '', x: 0, y: 0 }); return; }
                setTooltip({ visible: true, text: `${info.label} · ${info.count}건`, x: info.x, y: info.y });
              }}
            />
          )}
        </div>

        {/* 필터 칩 */}
        <ActivityFilterChips />

        {/* 피드 라벨 */}
        <div className="px-3.5 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-text-secondary/50">
          최근 활동
        </div>

        {/* 피드 */}
        <ActivityFeed />

        {/* 글로벌 툴팁 — Portal 로 document.body 에 직접 렌더해야
            위젯의 backdrop-filter 가 만든 stacking context 안에 갇히지 않음 */}
        {tooltip.visible && createPortal(
          <div
            className="fixed z-[9999] bg-bg-card/95 border border-bg-border rounded-lg px-2.5 py-1.5 text-[11.5px] text-text-primary pointer-events-none shadow-xl backdrop-blur-md"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: 'translate(-50%, calc(-100% - 8px))',
              whiteSpace: 'nowrap',
            }}
          >
            {tooltip.text}
          </div>,
          document.body,
        )}
      </div>
    </Widget>
  );
}

function ModeToggle({ mode, onChange }: { mode: GoldenMode; onChange: (m: GoldenMode) => void }) {
  return (
    <div className="flex gap-[2px] bg-black/25 p-[2px] rounded-[7px]">
      <ModeButton active={mode === 'heatmap'} onClick={() => onChange('heatmap')} title="히트맵 모드">
        <Grid3x3 size={11} />
        <span className="text-[10.5px]">히트맵</span>
      </ModeButton>
      <ModeButton active={mode === 'hour'} onClick={() => onChange('hour')} title="시간대 막대">
        <BarChart3 size={11} />
        <span className="text-[10.5px]">시간대</span>
      </ModeButton>
      <ModeButton active={mode === 'day'} onClick={() => onChange('day')} title="요일 막대">
        <Activity size={11} />
        <span className="text-[10.5px]">요일</span>
      </ModeButton>
    </div>
  );
}

function ModeButton({ active, onClick, children, title }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 px-2 py-1 rounded-[5px] cursor-pointer transition-all ${
        active
          ? 'bg-accent/20 text-accent-sub'
          : 'text-text-secondary hover:text-text-primary'
      }`}
      style={active ? { boxShadow: 'inset 0 0 0 1px rgba(108, 92, 231, 0.3)' } : {}}
    >
      {children}
    </button>
  );
}
