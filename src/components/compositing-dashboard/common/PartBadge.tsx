/**
 * 파트 배지 — A/B/C/D 글자 + 파트 색.
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md
 */

import type { CSSProperties } from 'react';
import { partCssColor } from '@/utils/compositingLabels';

type BadgeSize = 'sm' | 'md' | 'lg';

const SIZE_MAP: Record<BadgeSize, { w: number; h: number; fontSize: number; radius: number }> = {
  sm: { w: 16, h: 16, fontSize: 10, radius: 4 },
  md: { w: 20, h: 20, fontSize: 11, radius: 5 },
  lg: { w: 26, h: 26, fontSize: 13, radius: 6 },
};

export interface PartBadgeProps {
  /** 'A' | 'B' | 'C' | 'D' (대문자/소문자 모두 허용 — 표시는 항상 대문자). */
  partId: string;
  size?: BadgeSize;
  className?: string;
}

export function PartBadge({ partId, size = 'md', className }: PartBadgeProps) {
  const dim = SIZE_MAP[size];
  const color = partCssColor(partId);
  const upper = partId.toUpperCase();

  const style: CSSProperties = {
    width: dim.w,
    height: dim.h,
    fontSize: dim.fontSize,
    borderRadius: dim.radius,
    backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
    color,
    fontWeight: 800,
    letterSpacing: '0.02em',
    flexShrink: 0,
  };

  return (
    <span
      className={`inline-flex items-center justify-center leading-none ${className ?? ''}`}
      style={style}
    >
      {upper}
    </span>
  );
}
