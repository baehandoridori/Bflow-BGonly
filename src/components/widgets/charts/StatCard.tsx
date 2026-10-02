import type { ReactNode } from 'react';

interface StatCardProps {
  /** 큰 숫자. 진행률이면 <RollingNumber /> 를 넘겨 막대와 같은 박자로 굴린다. */
  value: ReactNode;
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
            className="bf-progress-bar h-full rounded-full"
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
