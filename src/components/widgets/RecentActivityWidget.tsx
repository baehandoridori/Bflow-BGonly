import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, BarChart3, ChevronLeft, ChevronRight, Clock, Disc, X } from 'lucide-react';
import { Widget } from './Widget';
import { useActivityStore } from '@/stores/useActivityStore';
import { useAppStore } from '@/stores/useAppStore';
import { GoldenHeatmap } from './activity/GoldenHeatmap';
import { ActivityFilterChips } from './activity/ActivityFilterChips';
import { ActivityFeed } from './activity/ActivityFeed';
import { ActivityInsightsModal } from './activity/ActivityInsightsModal';
import { getRangeBoundary, todayLabelFor } from './activity/timeRange';
import { pickGoldenWindow, dayLabel, EMPTY_GROUPED_COUNT, type GroupedCount } from './activity/utils';
import { GROUP_LABEL, GROUP_DOT_COLOR } from './activity/constants';
import { subscribeToActivityRealtime } from '@/services/supabaseService';
import type { ActionGroup, CellFilter, TimeUnit } from '@/types';

interface TooltipState {
  visible: boolean;
  title: string;
  cell: GroupedCount;
  x: number;
  y: number;
}

const TOOLTIP_GROUP_ORDER: ActionGroup[] = ['progress', 'memo', 'scene', 'etc'];

export function RecentActivityWidget() {
  const {
    statsGrid,
    timeUnit,
    rangeIdx,
    cellFilter,
    activities,
    loadInitial,
    receiveRealtime,
    applyCellFilter,
    clearCellFilter,
  } = useActivityStore();

  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    title: '',
    cell: { ...EMPTY_GROUPED_COUNT },
    x: 0,
    y: 0,
  });
  const [insightsOpen, setInsightsOpen] = useState(false);

  const hideTooltip = () =>
    setTooltip({ visible: false, title: '', cell: { ...EMPTY_GROUPED_COUNT }, x: 0, y: 0 });

  const dashboardDeptFilter = useAppStore((s) => s.dashboardDeptFilter);

  useEffect(() => {
    const unsub = subscribeToActivityRealtime(receiveRealtime);
    return () => unsub();
  }, [receiveRealtime]);

  useEffect(() => {
    loadInitial();
  }, [dashboardDeptFilter, loadInitial]);

  // 인사이트 자동 산출 (단위/기간 별)
  const insightText = useMemo(() => {
    if (timeUnit === 'year') {
      // 연 모드: 가장 활발한 월
      let best = { month: 0, count: 0 };
      for (let m = 0; m < 12; m++) {
        const sum = (statsGrid[m] ?? []).reduce((a, c) => a + c.total, 0);
        if (sum > best.count) best = { month: m, count: sum };
      }
      if (best.count === 0) return '연간 기록을 모으는 중입니다';
      return `${best.month + 1}월이 가장 활발 (${best.count}건)`;
    }
    if (activities.length < 5) return '기록을 모으는 중입니다';
    const w = pickGoldenWindow(statsGrid);
    if (!w) return '활동 기록이 부족합니다';
    const period = rangeIdx === 0 ? '이 기간' : '이 기간';
    return `${period} 가장 활발: ${dayLabel(w.day)}요일 ${w.hour}–${w.hour + 2}시 (${w.count}건)`;
  }, [statsGrid, timeUnit, rangeIdx, activities.length]);

  // 셀 매칭 건수 (피드 기준) — codex 3차 P1: range 경계도 검증
  const currentRange = useMemo(() => getRangeBoundary(timeUnit, rangeIdx), [timeUnit, rangeIdx]);
  const cellMatchCount = useMemo(() => {
    if (!cellFilter) return 0;
    return activities.filter((a) => activityMatchesCell(a, timeUnit, cellFilter, currentRange)).length;
  }, [cellFilter, activities, timeUnit, currentRange]);

  return (
    <>
      <Widget
        title="최근 작업"
        icon={<Activity size={14} />}
        headerRight={<HeaderControls onOpenInsights={() => setInsightsOpen(true)} />}
      >
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

          {/* 골든타임 히트맵 (단위 통합) */}
          <div className="px-3.5 pt-3 pb-1 flex-shrink-0">
            <GoldenHeatmap
              mode={timeUnit === 'year' ? 'year' : 'week-or-month'}
              cellFilter={cellFilter}
              onCellClick={(b1, b2) => {
                if (cellFilter && cellFilter.bucket1 === b1 && cellFilter.bucket2 === b2) {
                  clearCellFilter();
                } else {
                  applyCellFilter({ bucket1: b1, bucket2: b2 });
                }
              }}
              onCellHover={(info) => {
                if (!info) { hideTooltip(); return; }
                setTooltip({
                  visible: true,
                  title: info.title,
                  cell: info.cell,
                  x: info.x,
                  y: info.y,
                });
              }}
            />
          </div>

          {/* 필터 칩 */}
          <ActivityFilterChips />

          {/* 셀 필터 배너 */}
          {cellFilter && (
            <CellFilterBanner
              filter={cellFilter}
              matchCount={cellMatchCount}
              timeUnit={timeUnit}
              onClear={clearCellFilter}
            />
          )}

          {/* 피드 라벨 */}
          <div className="px-3.5 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-text-secondary/50">
            최근 활동
          </div>

          {/* 피드 */}
          <ActivityFeed />

          {/* 셀 호버 툴팁 — Portal */}
          {tooltip.visible && createPortal(
            <div
              className="fixed z-[9999] bg-bg-card/95 border border-bg-border rounded-lg px-2.5 py-2 text-[11.5px] text-text-primary pointer-events-none shadow-xl backdrop-blur-md min-w-[120px]"
              style={{
                left: tooltip.x,
                top: tooltip.y,
                transform: 'translate(-50%, calc(-100% - 8px))',
                whiteSpace: 'nowrap',
              }}
            >
              <div className="font-semibold text-accent-sub mb-1.5">
                {tooltip.title} <span className="text-text-secondary font-normal">· 총 {tooltip.cell.total}건</span>
              </div>
              {tooltip.cell.total === 0 ? (
                <div className="text-text-secondary text-[11px]">활동 없음</div>
              ) : (
                <div className="flex flex-col gap-[3px]">
                  {TOOLTIP_GROUP_ORDER.map((g) => {
                    const c = tooltip.cell[g];
                    if (c === 0) return null;
                    return (
                      <div key={g} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                        <span
                          className="w-[7px] h-[7px] rounded-full flex-shrink-0"
                          style={{ background: GROUP_DOT_COLOR[g] }}
                        />
                        <span>{GROUP_LABEL[g]}</span>
                        <span className="text-text-primary ml-auto pl-2">{c}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>,
            document.body,
          )}
        </div>
      </Widget>

      <ActivityInsightsModal open={insightsOpen} onClose={() => setInsightsOpen(false)} />
    </>
  );
}

function HeaderControls({ onOpenInsights }: { onOpenInsights: () => void }) {
  const { timeUnit, rangeIdx, setTimeUnit, setRangeIdx, goToCurrentRange } = useActivityStore();
  const { label } = useMemo(() => getRangeBoundary(timeUnit, rangeIdx), [timeUnit, rangeIdx]);
  const todayLabel = todayLabelFor(timeUnit);
  const fwdDisabled = rangeIdx === 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setRangeIdx(rangeIdx + 1)}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-border/40 cursor-pointer transition-colors"
          title="이전 기간"
          aria-label="이전 기간"
        >
          <ChevronLeft size={14} />
        </button>
        <div
          key={`${timeUnit}-${rangeIdx}`}
          className="text-[11px] font-medium text-text-primary min-w-[110px] text-center"
        >
          {label}
        </div>
        <button
          onClick={() => setRangeIdx(rangeIdx - 1)}
          disabled={fwdDisabled}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-border/40 cursor-pointer transition-colors disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          title={fwdDisabled ? '현재 기간입니다' : '다음 기간'}
          aria-label="다음 기간"
        >
          <ChevronRight size={14} />
        </button>
        {rangeIdx > 0 && (
          <button
            onClick={goToCurrentRange}
            className="ml-1 px-1.5 py-1 rounded-md text-[10px] font-semibold text-accent-sub bg-accent/10 border border-accent/25 hover:bg-accent/18 cursor-pointer transition-colors"
            title={`${todayLabel}(으)로 즉시 이동`}
          >
            {todayLabel}
          </button>
        )}
      </div>

      <div className="flex gap-[2px] bg-bg-border/40 p-[2px] rounded-[7px]">
        {(['week', 'month', 'year'] as const).map((u) => (
          <UnitButton key={u} active={timeUnit === u} onClick={() => setTimeUnit(u)} label={u === 'week' ? '주' : u === 'month' ? '달' : '년'} />
        ))}
      </div>

      <button
        onClick={onOpenInsights}
        className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-accent-sub hover:bg-accent/10 cursor-pointer transition-colors"
        title="활동 분석 보기"
        aria-label="활동 분석 보기"
      >
        <BarChart3 size={14} />
      </button>
    </div>
  );
}

function UnitButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-[5px] text-[11px] cursor-pointer transition-all ${
        active ? 'bg-accent/22 text-accent-sub' : 'text-text-secondary hover:text-text-primary'
      }`}
      style={active ? { boxShadow: 'inset 0 0 0 1px rgba(108, 92, 231, 0.32)' } : {}}
    >
      {label}
    </button>
  );
}

function CellFilterBanner({ filter, matchCount, timeUnit, onClear }: {
  filter: CellFilter;
  matchCount: number;
  timeUnit: TimeUnit;
  onClear: () => void;
}) {
  const label = useMemo(() => {
    if (timeUnit === 'year') {
      const month = filter.bucket1 + 1; // bucket1: month idx 0-based
      const day = ['월', '화', '수', '목', '금', '토', '일'][filter.bucket2];
      return `${month}월 ${day}요일`;
    }
    const day = ['월', '화', '수', '목', '금', '토', '일'][filter.bucket1];
    return `${day} ${filter.bucket2}시`;
  }, [filter, timeUnit]);

  return (
    <div
      className="mx-3.5 mb-2 flex items-center justify-between gap-2 px-3 py-2 rounded-lg"
      style={{ background: 'rgba(253,203,110,0.10)', border: '1px solid rgba(253,203,110,0.30)' }}
    >
      <div className="flex items-center gap-2 text-[11.5px]">
        <Disc size={12} className="text-[#FDCB6E]" fill="#FDCB6E" />
        <span className="text-text-primary">
          <b>{label}</b> 활동만 강조 중
        </span>
        <span className="text-text-secondary">
          {matchCount > 0 ? `· ${matchCount}건` : '· 이 시간대엔 활동이 없어요'}
        </span>
      </div>
      <button
        onClick={onClear}
        className="text-[11px] text-text-secondary hover:text-[#FDCB6E] cursor-pointer flex items-center gap-1 px-2 py-1 rounded hover:bg-[#FDCB6E]/10 transition-colors"
      >
        전체 보기
        <X size={12} />
      </button>
    </div>
  );
}

/**
 * 활동 createdAt이 (timeUnit, cellFilter) 매칭하는지 KST 기준.
 * v1.23.0 (codex 3차 P1): 과거 range 탐색 시 잘못된 highlight 방지를 위해
 * range 경계도 함께 검증. 같은 요일·시간이어도 다른 주/달/년이면 매칭 X.
 */
export function activityMatchesCell(
  activity: { createdAt: string },
  timeUnit: TimeUnit,
  filter: CellFilter,
  range?: { startISO: string; endISO: string },
): boolean {
  const t = new Date(activity.createdAt);
  if (Number.isNaN(t.getTime())) return false;
  if (range) {
    const ms = t.getTime();
    const startMs = new Date(range.startISO).getTime();
    const endMs = new Date(range.endISO).getTime();
    if (ms < startMs || ms >= endMs) return false;
  }
  const kst = new Date(t.getTime() + 9 * 3_600_000);
  if (timeUnit === 'year') {
    const month = kst.getUTCMonth();      // 0-based
    const dow = (kst.getUTCDay() + 6) % 7; // 표시(월=0)
    return month === filter.bucket1 && dow === filter.bucket2;
  }
  const dow = (kst.getUTCDay() + 6) % 7;
  const hour = kst.getUTCHours();
  return dow === filter.bucket1 && hour === filter.bucket2;
}
