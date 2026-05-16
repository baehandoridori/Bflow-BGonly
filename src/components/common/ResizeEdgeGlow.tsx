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

  // 단계별 시각 파라미터 — 한솔 v1.27.0 5차 보고: idle 은은한 빛이 너무 약함 + 라이트 모드 안 보임.
  // idle 의 opacity / glow / scale 강화. thickness 도 2px → 3px 로 키워서 라이트 모드에서도 잘 보임.
  const params = {
    idle: { opacity: 0.55, shadowAlpha: 0.35, glowSize: 14, thickness: 3, scale: 0.92 },
    hover: { opacity: 0.95, shadowAlpha: 0.65, glowSize: 20, thickness: 3, scale: 1 },
    drag: { opacity: 1, shadowAlpha: 0.95, glowSize: 28, thickness: 4, scale: 1 },
  }[level];

  // 라이트 모드에서도 시인성 보장 위해 drop-shadow 추가 (배경 대비가 약한 경우의 백업 레이어).
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        ...positionStyles[edge],
        // 두께를 동적으로 — idle 도 3px 로 약간 두툼하게.
        ...(isHorizontal
          ? { height: params.thickness }
          : { width: params.thickness }),
        borderRadius: 2,
        pointerEvents: 'none',
        background: `linear-gradient(${isHorizontal ? '90deg' : '180deg'}, transparent, rgb(var(--color-accent)) 50%, transparent)`,
        opacity: params.opacity,
        boxShadow: `0 0 ${params.glowSize}px rgb(var(--color-accent) / ${params.shadowAlpha})`,
        // 라이트 모드 보강 — accent 색 drop-shadow 로 한 번 더 외곽 발광.
        filter: `drop-shadow(0 0 ${Math.round(params.glowSize / 2)}px rgb(var(--color-accent) / ${params.shadowAlpha * 0.7}))`,
        transform: isHorizontal ? `scaleX(${params.scale})` : `scaleY(${params.scale})`,
        transition:
          'opacity 0.25s ease-out, transform 0.25s ease-out, box-shadow 0.25s ease-out, height 0.25s ease-out, width 0.25s ease-out',
        zIndex: 5,
      }}
    />
  );
});
