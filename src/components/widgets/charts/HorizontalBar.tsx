interface BarItem {
  label: string;
  value: number;
  total: number;
  pct: number;
  color: string;
}

interface HorizontalBarProps {
  items: BarItem[];
  showValues?: boolean;
}

export function HorizontalBar({ items, showValues = true }: HorizontalBarProps) {
  return (
    <div className="flex flex-col gap-3 justify-center h-full">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-3">
          <span
            className="text-xs font-medium w-14 text-right truncate"
            style={{ color: item.color }}
          >
            {item.label}
          </span>
          <div className="flex-1 h-5 bg-bg-primary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${item.pct}%`,
                backgroundColor: item.color,
              }}
            />
          </div>
          {showValues && (
            <span className="text-xs text-text-secondary w-20 text-right">
              {item.value}/{item.total} ({item.pct.toFixed(1)}%)
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
