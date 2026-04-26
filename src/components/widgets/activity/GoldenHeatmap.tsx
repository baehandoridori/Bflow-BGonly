import { useActivityStore } from '@/stores/useActivityStore';
import { intensityLevel, intensityBg, intensityGlow, dayLabel } from './utils';

interface Props {
  onCellHover?: (info: { day: number; hour: number; count: number; x: number; y: number } | null) => void;
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
  row: number[];
  onCellHover?: Props['onCellHover'];
}) {
  return (
    <>
      <div className="text-[10px] text-text-secondary text-right pr-1.5">
        {dayLabel(dayIdx)}
      </div>
      {row.map((count, h) => {
        const lv = intensityLevel(count);
        const handleEnter = (e: React.MouseEvent<HTMLDivElement>) => {
          // 셀의 화면 좌상단 좌표 사용 — 호버 영역 안에서 마우스 움직여도 툴팁 위치 안정
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          onCellHover?.({
            day: dayIdx,
            hour: h,
            count,
            x: rect.left + rect.width / 2,
            y: rect.top,
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
            onMouseEnter={handleEnter}
            onMouseLeave={() => onCellHover?.(null)}
          />
        );
      })}
    </>
  );
}
