import { memo } from 'react';

/** 8방향 리사이즈 존 타입 */
export type ResizeZone = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se' | null;

/** 커서 매핑 */
export const CURSOR_MAP: Record<string, string> = {
  n: 'n-resize', s: 's-resize', w: 'w-resize', e: 'e-resize',
  nw: 'nw-resize', ne: 'ne-resize', sw: 'sw-resize', se: 'se-resize',
};

/** zone별 활성화할 edge/corner */
const ZONE_EDGES: Record<string, string[]> = {
  n: ['n'], s: ['s'], w: ['w'], e: ['e'],
  nw: ['n', 'w'], ne: ['n', 'e'], sw: ['s', 'w'], se: ['s', 'e'],
};
const ZONE_CORNERS: Record<string, string[]> = {
  nw: ['nw'], ne: ['ne'], sw: ['sw'], se: ['se'],
};

/** 변 glow 라인 */
function EdgeLine({ edge, visible, dim }: { edge: string; visible: boolean; dim?: boolean }) {
  const isH = edge === 'n' || edge === 's';

  const posStyles: Record<string, React.CSSProperties> = {
    n: { top: 0, left: '15%', right: '15%', height: 2 },
    s: { bottom: 0, left: '15%', right: '15%', height: 2 },
    w: { left: 0, top: '15%', bottom: '15%', width: 2 },
    e: { right: 0, top: '15%', bottom: '15%', width: 2 },
  };

  const opacity = !visible ? 0 : dim ? 0.35 : 0.9;

  return (
    <div
      style={{
        position: 'absolute',
        ...posStyles[edge],
        borderRadius: 1,
        background: `linear-gradient(${isH ? '90deg' : '180deg'}, transparent, rgb(var(--color-accent)) 50%, transparent)`,
        opacity,
        transform: visible ? 'scale(1)' : (isH ? 'scaleX(0.7)' : 'scaleY(0.7)'),
        transition: 'opacity 0.3s ease-out, transform 0.3s ease-out, box-shadow 0.3s ease-out',
        pointerEvents: 'none',
        boxShadow: visible && !dim ? '0 0 10px rgb(var(--color-accent) / 0.4)' : 'none',
      }}
    />
  );
}

/** 곡선 코너 glow — 위젯 border-radius를 따라가는 호(arc) 형태 */
function CornerGlow({ corner, visible, dim }: { corner: string; visible: boolean; dim?: boolean }) {
  const R = 16;       // 위젯 rounded-2xl 매칭
  const arm = 8;      // 직선 연장 길이
  const size = R + arm;
  const accent = 'rgb(var(--color-accent))';
  const thick = `2px solid ${accent}`;

  const posStyles: Record<string, React.CSSProperties> = {
    nw: { top: 0, left: 0, borderTop: thick, borderLeft: thick, borderTopLeftRadius: R },
    ne: { top: 0, right: 0, borderTop: thick, borderRight: thick, borderTopRightRadius: R },
    sw: { bottom: 0, left: 0, borderBottom: thick, borderLeft: thick, borderBottomLeftRadius: R },
    se: { bottom: 0, right: 0, borderBottom: thick, borderRight: thick, borderBottomRightRadius: R },
  };

  const opacity = !visible ? 0 : dim ? 0.35 : 0.9;

  return (
    <div
      style={{
        position: 'absolute',
        width: size,
        height: size,
        ...posStyles[corner],
        opacity,
        transform: `scale(${visible ? 1 : 0.8})`,
        transition: 'opacity 0.3s ease-out, transform 0.3s ease-out, filter 0.3s ease-out',
        pointerEvents: 'none',
        filter: visible && !dim
          ? `drop-shadow(0 0 8px ${accent.replace(')', ' / 0.4)')})`
          : 'none',
      }}
    />
  );
}

interface EdgeGlowProps {
  zone: ResizeZone;
  /** 드래그 핸들 호버 시 전체 edge/corner 은은하게 발광 */
  hovered?: boolean;
}

/** 8방향 Edge Glow + Corner Glow 표시 */
export const EdgeGlow = memo(function EdgeGlow({ zone, hovered }: EdgeGlowProps) {
  const activeEdges = zone ? (ZONE_EDGES[zone] ?? []) : [];
  const activeCorners = zone ? (ZONE_CORNERS[zone] ?? []) : [];
  const allEdges = ['n', 's', 'w', 'e'];
  const allCorners = ['nw', 'ne', 'sw', 'se'];

  return (
    <>
      {allEdges.map((ed) => {
        const isZoneActive = activeEdges.includes(ed);
        return (
          <EdgeLine
            key={ed}
            edge={ed}
            visible={isZoneActive || !!hovered}
            dim={!isZoneActive && !!hovered}
          />
        );
      })}
      {/* 코너: 드래그 핸들 호버 시 은은하게, 실제 모서리 zone일 때만 강하게 */}
      {allCorners.map((c) => {
        const isZoneActive = activeCorners.includes(c);
        return (
          <CornerGlow
            key={c}
            corner={c}
            visible={isZoneActive || !!hovered}
            dim={!isZoneActive}
          />
        );
      })}
    </>
  );
});
