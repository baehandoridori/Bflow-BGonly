interface StatCardProps {
  value: string;
  label: string;
  subValue?: string;
  color?: string;
  pct?: number;
}

export function StatCard({ value, label, subValue, color, pct }: StatCardProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2">
      <span
        className="text-4xl font-bold"
        style={{ color: color ?? 'rgb(var(--color-accent))' }}
      >
        {value}
      </span>
      <span className="text-sm text-text-secondary">{label}</span>
      {subValue && (
        <span className="text-xs text-text-secondary/60">{subValue}</span>
      )}
      {pct !== undefined && (
        <div className="w-32 h-2 bg-bg-primary rounded-full overflow-hidden mt-1">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${pct}%`,
              backgroundColor: color ?? 'rgb(var(--color-accent))',
            }}
          />
        </div>
      )}
    </div>
  );
}
