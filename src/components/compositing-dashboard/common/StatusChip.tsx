/**
 * 컴포지팅 단계 칩 — 단계 아이콘 + 라벨 + (옵션) 카운트.
 *
 * 사용처: StatusLegend, SceneCard 헤더, 모달 단계 그리드 등.
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md
 */

import type { CSSProperties } from 'react';
import {
  Square,
  Layers,
  CheckSquare,
  SlidersHorizontal,
  AlertTriangle,
  Check,
  type LucideIcon,
} from 'lucide-react';
import type { CompositingStatus } from '@/types';
import { COMPOSITING_STATUS_LABEL, COMPOSITING_STATUS_TOKEN } from '@/utils/compositingLabels';

/** 단계별 lucide 아이콘 매핑. 핸드오프 mock-data 의 icon 키와 일치. */
export const COMPOSITING_STATUS_ICON: Record<CompositingStatus, LucideIcon> = {
  batch: Square,
  combine: Layers,
  aggregated: CheckSquare,
  adjust: SlidersHorizontal,
  error: AlertTriangle,
  done: Check,
};

type ChipSize = 'sm' | 'md' | 'lg';
type ChipVariant = 'solid' | 'soft';

const SIZE_MAP: Record<ChipSize, { className: string; iconPx: number; strokeWidth: number }> = {
  sm: { className: 'px-1.5 py-0.5 text-[10px] gap-1',   iconPx: 9,  strokeWidth: 2.5 },
  md: { className: 'px-2 py-0.5 text-[11px] gap-1.5',   iconPx: 10, strokeWidth: 2.5 },
  lg: { className: 'px-3 py-1 text-xs gap-1.5',         iconPx: 12, strokeWidth: 2.4 },
};

export interface StatusChipProps {
  status: CompositingStatus;
  size?: ChipSize;
  /** solid = 단색 채움 + 흰 글자. soft = 단색 14% 배경 + 단색 글자 (기본). */
  variant?: ChipVariant;
  /** 우측에 숫자 카운트 표시. undefined 면 표시 안 함. */
  count?: number;
  /** label 숨김 — 카운트 chip 모드에서 좁게 쓸 때. */
  hideLabel?: boolean;
  /** 클릭 가능한 chip (StatusLegend filter 토글) */
  onClick?: () => void;
  /** filter 활성 상태 표시 — 보더 강조 */
  active?: boolean;
  className?: string;
}

export function StatusChip({
  status,
  size = 'md',
  variant = 'soft',
  count,
  hideLabel = false,
  onClick,
  active = false,
  className,
}: StatusChipProps) {
  const Icon = COMPOSITING_STATUS_ICON[status];
  const cssVar = COMPOSITING_STATUS_TOKEN[status];
  const label = COMPOSITING_STATUS_LABEL[status];
  const dim = SIZE_MAP[size];

  const baseStyle: CSSProperties =
    variant === 'solid'
      ? {
          backgroundColor: `var(${cssVar})`,
          color: 'white',
          fontWeight: 700,
        }
      : {
          backgroundColor: `color-mix(in srgb, var(${cssVar}) 14%, transparent)`,
          color: `var(${cssVar})`,
          fontWeight: 600,
        };

  if (active && variant === 'soft') {
    baseStyle.boxShadow = `inset 0 0 0 1px color-mix(in srgb, var(${cssVar}) 55%, transparent)`;
  }

  const Tag = onClick ? 'button' : 'span';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`inline-flex items-center rounded-full whitespace-nowrap leading-none ${
        onClick ? 'cursor-pointer transition-all hover:brightness-110' : ''
      } ${dim.className} ${className ?? ''}`}
      style={baseStyle}
      aria-pressed={onClick ? active : undefined}
    >
      <Icon size={dim.iconPx} strokeWidth={dim.strokeWidth} className="shrink-0" />
      {!hideLabel && <span>{label}</span>}
      {typeof count === 'number' && (
        <span className="tabular-nums font-bold">{count}</span>
      )}
    </Tag>
  );
}
