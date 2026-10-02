import { useActivityStore } from '@/stores/useActivityStore';
import { intensityLevel, intensityBg, intensityGlow, dayLabel, type GroupedCount } from './utils';
import type { CellFilter } from '@/types';
import type { TooltipAnchor } from '@/utils/tooltipPosition';

export interface HeatmapCellHoverInfo {
  /** 표시용 타이틀 (예: "화 14시" 또는 "5월 화요일") */
  title: string;
  cell: GroupedCount;
  /** 말풍선을 띄울 자리 — 마우스를 올려 커진 칸의 위·아래 끝과 가운데. */
  anchor: TooltipAnchor;
}

/** 마우스를 올린 칸은 1.4배로 커진다(activity-widget.css .path-link-heatmap-cell:hover). */
const HOVER_SCALE = 1.4;

/** 커진 칸 기준 말풍선 자리. 가운데는 확대해도 그대로라 rect 의 가운데를, 높이는 확대 전 크기(offsetHeight)로 잰다. */
function hoveredCellAnchor(el: HTMLElement): TooltipAnchor {
  const rect = el.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const half = (el.offsetHeight / 2) * HOVER_SCALE;
  return { x: centerX, top: centerY - half, bottom: centerY + half };
}

interface Props {
  mode: 'week-or-month' | 'year';
  cellFilter?: CellFilter | null;
  onCellClick?: (bucket1: number, bucket2: number) => void;
  onCellHover?: (info: HeatmapCellHoverInfo | null) => void;
}

const MONTH_LABEL = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

export function GoldenHeatmap({ mode, cellFilter, onCellClick, onCellHover }: Props) {
  const grid = useActivityStore((s) => s.statsGrid);

  if (mode === 'year') {
    // 12개월 × 7요일 — 행=월, 열=요일
    return (
      <div className="grid gap-[3px] items-center" style={{ gridTemplateColumns: '38px repeat(7, 1fr)' }}>
        <div></div>
        {['월','화','수','목','금','토','일'].map((d) => (
          <div key={`d-${d}`} className="text-[9.5px] text-text-secondary/55 text-center">{d}</div>
        ))}
        {grid.slice(0, 12).map((row, m) => (
          <YearRow
            key={`m${m}`}
            monthIdx={m}
            row={row}
            cellFilter={cellFilter ?? null}
            onCellClick={onCellClick}
            onCellHover={onCellHover}
          />
        ))}
      </div>
    );
  }

  // week-or-month: 7요일 × 24시간
  return (
    <div
      className="grid gap-[2px] items-center"
      style={{ gridTemplateColumns: '22px repeat(24, 1fr)' }}
    >
      <div></div>
      {Array.from({ length: 24 }, (_, h) => (
        <div key={`h${h}`} className="text-[9px] text-text-secondary/50 text-center">
          {[0, 6, 12, 18].includes(h) ? h : ''}
        </div>
      ))}
      {grid.slice(0, 7).map((row, d) => (
        <WeekRow
          key={`d${d}`}
          dayIdx={d}
          row={row}
          cellFilter={cellFilter ?? null}
          onCellClick={onCellClick}
          onCellHover={onCellHover}
        />
      ))}
    </div>
  );
}

function WeekRow({ dayIdx, row, cellFilter, onCellClick, onCellHover }: {
  dayIdx: number;
  row: GroupedCount[];
  cellFilter: CellFilter | null;
  onCellClick?: Props['onCellClick'];
  onCellHover?: Props['onCellHover'];
}) {
  return (
    <>
      <div className="text-[10px] text-text-secondary text-right pr-1.5">{dayLabel(dayIdx)}</div>
      {row.map((cell, h) => {
        const isSelected = !!cellFilter && cellFilter.bucket1 === dayIdx && cellFilter.bucket2 === h;
        return (
          <Cell
            key={`c${dayIdx}-${h}`}
            cell={cell}
            selected={isSelected}
            onClick={() => onCellClick?.(dayIdx, h)}
            onHover={(anchor) => onCellHover?.(anchor ? { title: `${dayLabel(dayIdx)} ${h}시`, cell, anchor } : null)}
          />
        );
      })}
    </>
  );
}

function YearRow({ monthIdx, row, cellFilter, onCellClick, onCellHover }: {
  monthIdx: number;
  row: GroupedCount[];
  cellFilter: CellFilter | null;
  onCellClick?: Props['onCellClick'];
  onCellHover?: Props['onCellHover'];
}) {
  return (
    <>
      <div className="text-[10px] text-text-secondary text-right pr-1.5">{MONTH_LABEL[monthIdx]}</div>
      {row.slice(0, 7).map((cell, d) => {
        const isSelected = !!cellFilter && cellFilter.bucket1 === monthIdx && cellFilter.bucket2 === d;
        return (
          <Cell
            key={`y${monthIdx}-${d}`}
            cell={cell}
            selected={isSelected}
            onClick={() => onCellClick?.(monthIdx, d)}
            onHover={(anchor) => onCellHover?.(anchor ? { title: `${MONTH_LABEL[monthIdx]} ${dayLabel(d)}요일`, cell, anchor } : null)}
          />
        );
      })}
    </>
  );
}

/*
 * 칸 하나. 마우스를 올리면 그 칸만 1.4배로 톡 커져 맨 앞으로 나오고(activity-widget.css),
 * 위젯 말풍선이 커진 칸 위 가운데에 뜬다.
 * title 속성은 두지 않는다 — 앱 전체 말풍선(따로 띄운 위젯 창에서는 회색 기본 말풍선)이 하나 더 겹쳐 떴다.
 * zIndex 는 선택된 칸에만 준다 — 다른 칸에 'auto' 를 인라인으로 박으면 hover 의 z-index 가 막힌다.
 */
function Cell({ cell, selected, onClick, onHover }: {
  cell: GroupedCount;
  selected: boolean;
  onClick?: () => void;
  onHover?: (anchor: TooltipAnchor | null) => void;
}) {
  const lv = intensityLevel(cell.total);
  return (
    <div
      className="path-link-heatmap-cell aspect-square rounded-[2px] cursor-pointer relative"
      style={{
        background: intensityBg(lv),
        boxShadow: selected
          ? '0 0 0 2px #FFE5A0, 0 0 12px rgba(253,203,110,0.5)'
          : intensityGlow(lv),
        transition: 'transform 0.15s ease',
        zIndex: selected ? 5 : undefined,
      }}
      onMouseEnter={(e) => onHover?.(hoveredCellAnchor(e.currentTarget))}
      onMouseLeave={() => onHover?.(null)}
      onClick={onClick}
    />
  );
}
