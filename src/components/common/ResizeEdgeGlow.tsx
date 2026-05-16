import { memo } from 'react';

/**
 * v1.27.0: 패널 한 변(상/하/좌/우)에 적용하는 accent 발광 라인.
 * 대시보드 위젯 EdgeGlow 와 동일 톤 — 변 가운데에서 양 끝으로 fade 되는 accent gradient + box-shadow glow.
 *
 * 댓글 패널 / 알림 패널 등 리사이즈 핸들 hover/drag 시 사용해 스타일 통일.
 */
interface ResizeEdgeGlowProps {
  /** 어느 변. 'w' = 좌측, 'e' = 우측, 'n' = 상단, 's' = 하단 */
  edge: 'n' | 's' | 'e' | 'w';
  /**
   * 발광 강도 3단계.
   * - 'idle': 아무 상호작용 없음. 핸들 위치를 살짝 암시하는 아주 은은한 빛.
   * - 'hover': 마우스가 핸들 위. 시인성 좋은 중간 강도.
   * - 'drag': 드래그 중. 가장 강한 발광.
   *
   * 또는 active/strong boolean 으로도 호환 (legacy):
   * - active=true & strong=true → 'drag'
   * - active=true & strong=false → 'hover'
   * - active=false → 'idle'
   */
  intensity?: 'idle' | 'hover' | 'drag';
  /** legacy: hover 활성 (= intensity 'hover') */
  active?: boolean;
  /** legacy: drag 활성 (active=true 와 함께 → 'drag') */
  strong?: boolean;
  /** 모서리 라운드 반경 (px). 발광이 코너 곡선까지 자연스럽게 이어지도록 inset 계산용 */
  radius?: number;
}

export const ResizeEdgeGlow = memo(function ResizeEdgeGlow({
  edge,
  intensity,
  active,
  strong,
  radius = 12,
}: ResizeEdgeGlowProps) {
  // intensity 명시 우선, 없으면 active/strong boolean 으로 추론.
  const level: 'idle' | 'hover' | 'drag' =
    intensity ?? (strong && active ? 'drag' : active ? 'hover' : 'idle');

  const isHorizontal = edge === 'n' || edge === 's';
  // 변의 양 끝 코너 곡선 안쪽으로 발광을 살짝 들이밀어 직선처럼 보이도록 — radius 의 70% 만큼 inset.
  const insetStart = `${Math.round(radius * 0.7)}px`;
  const insetEnd = insetStart;

  const positionStyles: Record<typeof edge, React.CSSProperties> = {
    n: { top: 0, left: insetStart, right: insetEnd, height: 2 },
    s: { bottom: 0, left: insetStart, right: insetEnd, height: 2 },
    w: { left: 0, top: insetStart, bottom: insetEnd, width: 2 },
    e: { right: 0, top: insetStart, bottom: insetEnd, width: 2 },
  };

  // 단계별 시각 파라미터 — 한솔 보고: idle 도 항상 살짝 보이게, hover 는 좀 더 세게, drag 는 가장 강.
  const params = {
    idle: { opacity: 0.22, shadowAlpha: 0.12, glowSize: 6, scale: isHorizontal ? 0.85 : 0.85 },
    hover: { opacity: 0.85, shadowAlpha: 0.55, glowSize: 14, scale: 1 },
    drag: { opacity: 1, shadowAlpha: 0.85, glowSize: 22, scale: 1 },
  }[level];

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        ...positionStyles[edge],
        borderRadius: 1,
        pointerEvents: 'none',
        background: `linear-gradient(${isHorizontal ? '90deg' : '180deg'}, transparent, rgb(var(--color-accent)) 50%, transparent)`,
        opacity: params.opacity,
        boxShadow: `0 0 ${params.glowSize}px rgb(var(--color-accent) / ${params.shadowAlpha})`,
        transform: isHorizontal ? `scaleX(${params.scale})` : `scaleY(${params.scale})`,
        transition:
          'opacity 0.25s ease-out, transform 0.25s ease-out, box-shadow 0.25s ease-out',
        zIndex: 5,
      }}
    />
  );
});
