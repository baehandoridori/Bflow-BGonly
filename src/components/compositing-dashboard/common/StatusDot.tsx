/**
 * 컴포지팅 단계 점 — 카드 헤더/모달/타임라인 등에서 작게 단계를 표시.
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md
 */

import type { CSSProperties } from 'react';
import type { CompositingStatus } from '@/types';
import { COMPOSITING_STATUS_TOKEN } from '@/utils/compositingLabels';

export interface StatusDotProps {
  status: CompositingStatus;
  /** 픽셀 단위 지름. 기본 8. 6/8/10/12 권장. */
  size?: number;
  /** 활성 표시용 글로우 링 (StatusLegend hover/active 등) */
  withPulse?: boolean;
  /** ARIA 라벨이 필요한 경우 — 셀렉터 단독 표시. 보통은 인접 텍스트가 라벨이라 생략. */
  ariaLabel?: string;
  className?: string;
}

export function StatusDot({
  status,
  size = 8,
  withPulse = false,
  ariaLabel,
  className,
}: StatusDotProps) {
  const cssVar = COMPOSITING_STATUS_TOKEN[status];

  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: 999,
    backgroundColor: `var(${cssVar})`,
    flexShrink: 0,
    display: 'inline-block',
  };

  if (withPulse) {
    style.boxShadow = `0 0 0 2px color-mix(in srgb, var(${cssVar}) 25%, transparent), 0 0 8px color-mix(in srgb, var(${cssVar}) 50%, transparent)`;
  }

  return (
    <span
      className={className}
      style={style}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
    />
  );
}
