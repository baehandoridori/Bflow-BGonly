import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { MAP_EDIT_MARK, planNodeHandles } from './mapPlanEdit';
import type { PlanVertexHandles } from './mapPlanEdit';
import type { PlanRect } from './mapPlanSelect';
import type { SnapGuide } from './mapSnap';
import type { BackgroundNode } from './types';

/** The lines a drag is stuck to. Each runs a little past both of its ends, by the same length on screen at any zoom. */
export function MapSnapGuides({ guides, scale }: { guides: readonly SnapGuide[]; scale: number }): JSX.Element | null {
  if (!guides.length) return null;
  const overhang = MAP_EDIT_MARK.guideOverhang * scale;
  return <g className="bmap-snap-guides" pointerEvents="none" aria-hidden="true">
    {guides.map((guide, index) => guide.axis === 'x'
      ? <line key={index} x1={guide.at} x2={guide.at} y1={guide.from - overhang} y2={guide.to + overhang} />
      : <line key={index} x1={guide.from - overhang} x2={guide.to + overhang} y1={guide.at} y2={guide.at} />)}
  </g>;
}

/**
 * The selection box while it is dragged, in plan coordinates. It draws what it is given. A path, not a `<rect>`: a
 * rect with no width or no height is not drawn at all, and a box dragged along one line must still show its line.
 */
export function MapMarquee({ rect }: { rect: PlanRect }): JSX.Element {
  return <path className="bmap-marquee" d={`M ${rect.left} ${rect.top} H ${rect.right} V ${rect.bottom} H ${rect.left} Z`} pointerEvents="none" aria-hidden="true" />;
}

/** Rotate and resize handles of the selected node. Their sizes come from `planNodeHandles`, so they stay the same on screen at any zoom. */
export function MapNodeHandles({ node, scale, vertexHandles, onHandleDown }: {
  node: BackgroundNode; scale: number; vertexHandles: boolean;
  onHandleDown(event: ReactPointerEvent<SVGElement>, handle: 'resize' | 'rotate'): void }): JSX.Element {
  // The kind of the handles follows the type of the node; the checks on `kind` below only narrow the type.
  const handles = planNodeHandles(node, scale, vertexHandles);
  if (node.type === 'camera') {
    // The handle stays on the stored direction, also when the camera looks straight up or down.
    return <g className="bmap-handles" data-camera-color={node.color} transform={`translate(${node.x} ${node.y}) rotate(${node.angle})`}>
      {handles.kind === 'camera' && <>
        {handles.guide && <line className="bmap-camera-guide" x1={handles.guide.from} y1="0" x2={handles.guide.to} y2="0" />}
        <circle className="bmap-camera-direction" cx={handles.distance} cy="0" r={handles.radius} onPointerDown={event => onHandleDown(event, 'rotate')} />
      </>}
    </g>;
  }
  const { width, height } = node;
  return <g className="bmap-handles" transform={`translate(${node.x} ${node.y}) rotate(${node.rotation} ${width / 2} ${height / 2})`}>
    {handles.kind === 'box' && <>
      <line x1={width / 2} x2={width / 2} y1="0" y2={-handles.lift} />
      <circle className="bmap-rotate-handle" cx={width / 2} cy={-handles.lift} r={handles.radius} onPointerDown={event => onHandleDown(event, 'rotate')} />
      {/* A square that stepped outside the corner keeps a short stem to it. */}
      {handles.resize?.shifted && <line x1={width} y1={height} x2={handles.resize.x} y2={handles.resize.y} />}
      {handles.resize && <rect className="bmap-resize-handle" x={handles.resize.x} y={handles.resize.y} width={handles.resize.size} height={handles.resize.size} onPointerDown={event => onHandleDown(event, 'resize')} />}
    </>}
  </g>;
}

/**
 * Point handles of the selected polygon, in plan coordinates (outside the turned group of the space): a + in the
 * middle of each edge that has room for one, and over them a dot on every point. The first circle of a handle is
 * the wider area that takes the press; the second is what shows.
 */
export function MapVertexHandles({ handles, scale, activeIndex, onHandleDown }: {
  handles: PlanVertexHandles; scale: number; activeIndex: number | null;
  onHandleDown(event: ReactPointerEvent<SVGElement>, handle: { index: number; insert: boolean }): void }): JSX.Element {
  const hit = MAP_EDIT_MARK.vertexHit * scale, arm = MAP_EDIT_MARK.edge * scale / 2;
  return <g className="bmap-vertex-handles" aria-hidden="true">
    {handles.edges.map(({ index, point }) => <g key={index} className="bmap-vertex-add" onPointerDown={event => onHandleDown(event, { index, insert: true })}>
      <circle cx={point.x} cy={point.y} r={hit} />
      <circle cx={point.x} cy={point.y} r={MAP_EDIT_MARK.edge * scale} />
      <path d={`M ${point.x - arm} ${point.y} H ${point.x + arm} M ${point.x} ${point.y - arm} V ${point.y + arm}`} />
    </g>)}
    {handles.vertices.map((point, index) => <g key={index} className={`bmap-vertex-handle${index === activeIndex ? ' is-active' : ''}`} onPointerDown={event => onHandleDown(event, { index, insert: false })}>
      <circle cx={point.x} cy={point.y} r={hit} />
      <circle cx={point.x} cy={point.y} r={MAP_EDIT_MARK.vertex * scale} />
    </g>)}
  </g>;
}
