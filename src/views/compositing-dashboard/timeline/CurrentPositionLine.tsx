/**
 * Timeline "현재 진행 위치" — 마지막으로 단계 변경된 씬의 가로축 위치.
 * AE 의 CTI (current time indicator) 재라벨. 빨간 1px 세로선 + 삼각 핸들.
 * 다른 사용자가 단계 변경하면 200ms ease-out 으로 부드럽게 sliding.
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (7.5)
 */

interface CurrentPositionLineProps {
  /** 0~1 비율 — 트랙 우측 너비 안에서의 위치. */
  frac: number;
}

export function CurrentPositionLine({ frac }: CurrentPositionLineProps) {
  return (
    <div
      className="absolute top-0 bottom-0 pointer-events-none z-10"
      style={{
        left: `${Math.max(0, Math.min(1, frac)) * 100}%`,
        transition: 'left 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      aria-label="현재 진행 위치"
    >
      <div
        className="absolute inset-y-0 w-px"
        style={{
          background: 'var(--status-error)',
          boxShadow: '0 0 4px var(--status-error)',
        }}
      />
      <div
        className="absolute -translate-x-1/2"
        style={{
          top: -2,
          width: 0,
          height: 0,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: '6px solid var(--status-error)',
          filter: 'drop-shadow(0 0 3px var(--status-error))',
        }}
      />
    </div>
  );
}
