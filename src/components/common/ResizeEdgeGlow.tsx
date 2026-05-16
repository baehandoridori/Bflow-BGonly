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
  /** hover 등 약한 활성 상태 */
  active?: boolean;
  /** drag 중 — 더 강한 발광 */
  strong?: boolean;
  /** 모서리 라운드 반경 (px). 발광이 코너 곡선까지 자연스럽게 이어지도록 inset 계산용 */
  radius?: number;
}

export const ResizeEdgeGlow = memo(function ResizeEdgeGlow({
  edge,
  active,
  strong,
  radius = 12,
}: ResizeEdgeGlowProps) {
  const isHorizontal = edge === 'n' || edge === 's';
  const visible = !!active;
  // 변의 양 끝 코너 곡선 안쪽으로 발광을 살짝 들이밀어 직선처럼 보이도록 — radius 의 70% 만큼 inset.
  const insetStart = `${Math.round(radius * 0.7)}px`;
  const insetEnd = insetStart;

  const positionStyles: Record<typeof edge, React.CSSProperties> = {
    n: { top: 0, left: insetStart, right: insetEnd, height: 2 },
    s: { bottom: 0, left: insetStart, right: insetEnd, height: 2 },
    w: { left: 0, top: insetStart, bottom: insetEnd, width: 2 },
    e: { right: 0, top: insetStart, bottom: insetEnd, width: 2 },
  };

  const opacity = !visible ? 0 : strong ? 1 : 0.7;
  const shadowAlpha = strong ? 0.55 : 0.35;
  const glowSize = strong ? 14 : 8;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        ...positionStyles[edge],
        borderRadius: 1,
        pointerEvents: 'none',
        background: `linear-gradient(${isHorizontal ? '90deg' : '180deg'}, transparent, rgb(var(--color-accent)) 50%, transparent)`,
        opacity,
        boxShadow: visible
          ? `0 0 ${glowSize}px rgb(var(--color-accent) / ${shadowAlpha})`
          : 'none',
        transform: visible ? 'scale(1)' : isHorizontal ? 'scaleX(0.7)' : 'scaleY(0.7)',
        transition:
          'opacity 0.25s ease-out, transform 0.25s ease-out, box-shadow 0.25s ease-out',
        zIndex: 5,
      }}
    />
  );
});
