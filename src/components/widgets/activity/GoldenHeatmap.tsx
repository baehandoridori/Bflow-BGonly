import { useActivityStore } from '@/stores/useActivityStore';
import { intensityLevel, intensityBg, intensityGlow, dayLabel, type GroupedCount } from './utils';
import type { CellFilter } from '@/types';

export interface HeatmapCellHoverInfo {
  /** 표시용 타이틀 (예: "화 14시" 또는 "5월 화요일") */
  title: string;
  cell: GroupedCount;
  x: number;
  y: number;
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
            title={`${dayLabel(dayIdx)} ${h}시`}
            onClick={() => onCellClick?.(dayIdx, h)}
            onHover={(e) => onCellHover?.(e ? { title: `${dayLabel(dayIdx)} ${h}시`, cell, x: e.clientX, y: e.clientY } : null)}
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
            title={`${MONTH_LABEL[monthIdx]} ${dayLabel(d)}요일`}
            onClick={() => onCellClick?.(monthIdx, d)}
            onHover={(e) => onCellHover?.(e ? { title: `${MONTH_LABEL[monthIdx]} ${dayLabel(d)}요일`, cell, x: e.clientX, y: e.clientY } : null)}
          />
        );
      })}
    </>
  );
}

function Cell({ cell, selected, title, onClick, onHover }: {
  cell: GroupedCount;
  selected: boolean;
  title: string;
  onClick?: () => void;
  onHover?: (e: React.MouseEvent | null) => void;
}) {
  const lv = intensityLevel(cell.total);
  const reportHover = (e: React.MouseEvent<HTMLDivElement>) => onHover?.(e);
  return (
    <div
      title={title}
      className="aspect-square rounded-[2px] cursor-pointer relative"
      style={{
        background: intensityBg(lv),
        boxShadow: selected
          ? '0 0 0 2px #FFE5A0, 0 0 12px rgba(253,203,110,0.5)'
          : intensityGlow(lv),
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        zIndex: selected ? 5 : 'auto',
      }}
      onMouseEnter={reportHover}
      onMouseMove={reportHover}
      onMouseLeave={() => onHover?.(null)}
      onClick={onClick}
    />
  );
}
