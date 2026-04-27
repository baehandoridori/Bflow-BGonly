import { useActivityStore } from '@/stores/useActivityStore';
import { intensityLevel, intensityBg, intensityGlow, dayLabel, type GroupedCount } from './utils';

export interface HeatmapCellHoverInfo {
  day: number;
  hour: number;
  cell: GroupedCount;
  x: number;
  y: number;
}

interface Props {
  onCellHover?: (info: HeatmapCellHoverInfo | null) => void;
}

export function GoldenHeatmap({ onCellHover }: Props) {
  const grid = useActivityStore((s) => s.statsGrid);
  return (
    <div
      className="grid gap-[2px] items-center"
      style={{ gridTemplateColumns: '22px repeat(24, 1fr)' }}
    >
      {/* 시간 라벨 행 */}
      <div></div>
      {Array.from({ length: 24 }, (_, h) => (
        <div key={`h${h}`} className="text-[9px] text-text-secondary/50 text-center">
          {[0, 6, 12, 18].includes(h) ? h : ''}
        </div>
      ))}

      {/* 요일 × 시간 셀 */}
      {grid.map((row, d) => (
        <DayRow key={`d${d}`} dayIdx={d} row={row} onCellHover={onCellHover} />
      ))}
    </div>
  );
}

function DayRow({
  dayIdx,
  row,
  onCellHover,
}: {
  dayIdx: number;
  row: GroupedCount[];
  onCellHover?: Props['onCellHover'];
}) {
  return (
    <>
      <div className="text-[10px] text-text-secondary text-right pr-1.5">
        {dayLabel(dayIdx)}
      </div>
      {row.map((cell, h) => {
        const lv = intensityLevel(cell.total);
        // 마우스 위치를 그대로 전달 — 툴팁이 커서를 따라다니도록 (목업과 동일)
        const reportHover = (e: React.MouseEvent<HTMLDivElement>) => {
          onCellHover?.({
            day: dayIdx,
            hour: h,
            cell,
            x: e.clientX,
            y: e.clientY,
          });
        };
        return (
          <div
            key={`c${dayIdx}-${h}`}
            className="aspect-square rounded-[2px] cursor-pointer relative path-link-heatmap-cell"
            style={{
              background: intensityBg(lv),
              boxShadow: intensityGlow(lv),
              transition: 'transform 0.15s ease',
            }}
            onMouseEnter={reportHover}
            onMouseMove={reportHover}
            onMouseLeave={() => onCellHover?.(null)}
          />
        );
      })}
    </>
  );
}
