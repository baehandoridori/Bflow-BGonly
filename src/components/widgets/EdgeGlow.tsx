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
function EdgeLine({ edge, visible }: { edge: string; visible: boolean }) {
  const isH = edge === 'n' || edge === 's';

  const posStyles: Record<string, React.CSSProperties> = {
    n: { top: 0, left: '15%', right: '15%', height: 2 },
    s: { bottom: 0, left: '15%', right: '15%', height: 2 },
    w: { left: 0, top: '15%', bottom: '15%', width: 2 },
    e: { right: 0, top: '15%', bottom: '15%', width: 2 },
  };

  return (
    <div
      style={{
        position: 'absolute',
        ...posStyles[edge],
        borderRadius: 1,
        background: `linear-gradient(${isH ? '90deg' : '180deg'}, transparent, rgb(var(--color-accent)) 50%, transparent)`,
        opacity: visible ? 0.9 : 0,
        transform: visible ? 'scale(1)' : (isH ? 'scaleX(0.4)' : 'scaleY(0.4)'),
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        pointerEvents: 'none',
        boxShadow: visible ? '0 0 10px rgb(var(--color-accent) / 0.4)' : 'none',
      }}
    />
  );
}

/** ㄴㄱ자 코너 glow SVG */
function CornerGlow({ corner, visible }: { corner: string; visible: boolean }) {
  const size = 22;
  const thick = 2.5;
  const len = 15;

  const paths: Record<string, string> = {
    nw: `M ${thick / 2} ${len} L ${thick / 2} ${thick / 2} L ${len} ${thick / 2}`,
    ne: `M ${size - len} ${thick / 2} L ${size - thick / 2} ${thick / 2} L ${size - thick / 2} ${len}`,
    sw: `M ${thick / 2} ${size - len} L ${thick / 2} ${size - thick / 2} L ${len} ${size - thick / 2}`,
    se: `M ${size - len} ${size - thick / 2} L ${size - thick / 2} ${size - thick / 2} L ${size - thick / 2} ${size - len}`,
  };

  const posMap: Record<string, React.CSSProperties> = {
    nw: { top: -2, left: -2 },
    ne: { top: -2, right: -2 },
    sw: { bottom: -2, left: -2 },
    se: { bottom: -2, right: -2 },
  };

  return (
    <svg
      width={size}
      height={size}
      style={{
        position: 'absolute',
        ...posMap[corner],
        opacity: visible ? 1 : 0,
        transform: `scale(${visible ? 1 : 0.6})`,
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        pointerEvents: 'none',
        filter: visible ? 'drop-shadow(0 0 6px rgb(var(--color-accent) / 0.5))' : 'none',
      }}
    >
      <path
        d={paths[corner]}
        fill="none"
        stroke="rgb(var(--color-accent))"
        strokeWidth={thick}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface EdgeGlowProps {
  zone: ResizeZone;
}

/** 8방향 Edge Glow + Corner Glow 표시 */
export const EdgeGlow = memo(function EdgeGlow({ zone }: EdgeGlowProps) {
  const activeEdges = zone ? (ZONE_EDGES[zone] ?? []) : [];
  const activeCorners = zone ? (ZONE_CORNERS[zone] ?? []) : [];

  return (
    <>
      {['n', 's', 'w', 'e'].map((ed) => (
        <EdgeLine key={ed} edge={ed} visible={activeEdges.includes(ed)} />
      ))}
      {['nw', 'ne', 'sw', 'se'].map((c) => (
        <CornerGlow key={c} corner={c} visible={activeCorners.includes(c)} />
      ))}
    </>
  );
});
