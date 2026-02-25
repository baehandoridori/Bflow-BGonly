interface BarItem {
  label: string;
  pct: number;
  color: string;
}

interface VerticalBarProps {
  items: BarItem[];
  maxHeight?: number;
}

export function VerticalBar({ items, maxHeight = 80 }: VerticalBarProps) {
  return (
    <div className="flex items-end justify-center gap-3 h-full">
      {items.map((item, idx) => (
        <div key={idx} className="flex flex-col items-center gap-1.5">
          <span className="text-[11px] font-bold text-text-primary">
            {item.pct.toFixed(1)}%
          </span>
          <div
            className="w-8 rounded-t-md transition-all duration-700 ease-out"
            style={{
              height: `${Math.max((item.pct / 100) * maxHeight, 4)}px`,
              backgroundColor: item.color,
            }}
          />
          <span
            className="text-[11px] font-medium truncate max-w-[48px]"
            style={{ color: item.color }}
          >
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
