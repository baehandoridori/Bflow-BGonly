import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { MapPlanPreviewProps } from './mapCanvas';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from './types';
import { MAP_PLAN_EXTENT, cameraAngles, cameraPitchLabel } from './mapSpatial';
import {
  PLAN_FALLBACK_SIZE, PLAN_MARK, PLAN_PREVIEW_HINT, PLAN_SIDE_VIEW,
  nextPlanSelection, planCameraGlyph, planCameraReadout, planNodeCovers, planNodeLabel, planNodeSummary, planOutlinePoints, planReadoutText,
  planSelectedNode, planSideView, planUnitsPerPixel, planViewBox, planVolumeReadout,
} from './mapPlanPreview';
import type { PlanCameraGlyph, PlanReadout, PlanSize } from './mapPlanPreview';
import './backgrounds-map-plan.css';

/** `point` is where a click landed on the plan; a keyboard pick has none and takes exactly its node. */
type Activate = (id: string, cycle: boolean, point?: BackgroundPoint) => void;
type NodeProps<T extends BackgroundNode> = { node: T; scale: number; selected: boolean; onActivate: Activate };

const fixed = (value: number) => Math.round(value * 100) / 100 + 0;
const pointList = (points: BackgroundPoint[]) => points.map(point => `${fixed(point.x)},${fixed(point.y)}`).join(' ');
function clickPoint(event: ReactMouseEvent<SVGGElement>): BackgroundPoint | undefined {
  const inverse = event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
  if (!inverse) return undefined;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : undefined;
}

/** Shared behaviour of every node on the plan: a real keyboard stop that selects on click, Enter or Space. */
function nodeButton(node: BackgroundNode, selected: boolean, onActivate: Activate) {
  return {
    role: 'button', tabIndex: 0, 'aria-label': planNodeLabel(node), 'aria-current': selected ? 'true' as const : undefined,
    onClick: (event: ReactMouseEvent<SVGGElement>) => { event.stopPropagation(); onActivate(node.id, true, clickPoint(event)); },
    onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); event.stopPropagation(); onActivate(node.id, false);
    },
  };
}

const PlanShape = memo(function PlanShape({ node, scale, selected, onActivate }: NodeProps<BackgroundSpace | BackgroundSymbol>) {
  const points = planOutlinePoints(node);
  if (!points) return null;
  return <g className={`bmap-plan-node bmap-plan-${node.type}${node.locked ? ' is-locked' : ''}`} {...nodeButton(node, selected, onActivate)}>
    <title>{planNodeLabel(node)}</title>
    <polygon points={points} />
    {/* Small objects keep a target that can be hit on a small plan. */}
    {node.type === 'symbol' && <circle className="bmap-plan-hit" cx={fixed(node.x + node.width / 2)} cy={fixed(node.y + node.height / 2)} r={fixed(PLAN_MARK.dot * 1.6 * scale)} />}
  </g>;
});

/** Dot in a circle: looking straight up, towards the viewer of the plan. Cross in a circle: straight down. */
function VerticalMark({ vertical, x, y, radius }: { vertical: 'up' | 'down'; x: number; y: number; radius: number }) {
  const arm = radius * 0.52;
  return <>
    <circle className="bmap-plan-glyph-ring" cx={fixed(x)} cy={fixed(y)} r={fixed(radius)} />
    {vertical === 'up'
      ? <circle className="bmap-plan-glyph-dot" cx={fixed(x)} cy={fixed(y)} r={fixed(radius * 0.32)} />
      : <path className="bmap-plan-glyph-cross" d={`M ${fixed(x - arm)} ${fixed(y - arm)} L ${fixed(x + arm)} ${fixed(y + arm)} M ${fixed(x + arm)} ${fixed(y - arm)} L ${fixed(x - arm)} ${fixed(y + arm)}`} />}
  </>;
}

function CameraMark({ glyph, scale, emphasis = false }: { glyph: PlanCameraGlyph; scale: number; emphasis?: boolean }) {
  const { position, arrow, fan, tick } = glyph;
  return <>
    {emphasis && fan && <path className="bmap-plan-fan" d={`M ${fixed(position.x)} ${fixed(position.y)} L ${fixed(fan.from.x)} ${fixed(fan.from.y)} A ${fixed(fan.radius)} ${fixed(fan.radius)} 0 ${fan.largeArc ? 1 : 0} 1 ${fixed(fan.to.x)} ${fixed(fan.to.y)} Z`} />}
    {emphasis && <circle className="bmap-plan-ring" cx={fixed(position.x)} cy={fixed(position.y)} r={fixed((glyph.vertical ? PLAN_MARK.glyph + 2.5 : PLAN_MARK.ring) * scale)} />}
    {arrow && <>
      <line className="bmap-plan-sight" x1={fixed(arrow.start.x)} y1={fixed(arrow.start.y)} x2={fixed(arrow.tip.x)} y2={fixed(arrow.tip.y)} />
      <polygon className="bmap-plan-sight-head" points={pointList(arrow.head)} />
    </>}
    {tick && <line className="bmap-plan-tick" x1={fixed(tick.from.x)} y1={fixed(tick.from.y)} x2={fixed(tick.to.x)} y2={fixed(tick.to.y)} />}
    {glyph.vertical
      ? <VerticalMark vertical={glyph.vertical} x={position.x} y={position.y} radius={PLAN_MARK.glyph * scale} />
      : <circle className="bmap-plan-dot" cx={fixed(position.x)} cy={fixed(position.y)} r={fixed(PLAN_MARK.dot * scale)} />}
  </>;
}

const PlanCamera = memo(function PlanCamera({ node, scale, selected, onActivate }: NodeProps<BackgroundCamera>) {
  const glyph = planCameraGlyph(node, scale);
  if (!glyph) return null;
  return <g className={`bmap-plan-node bmap-plan-camera${node.locked ? ' is-locked' : ''}`} {...nodeButton(node, selected, onActivate)}>
    <title>{planNodeLabel(node)}</title>
    <circle className="bmap-plan-hit" cx={fixed(glyph.position.x)} cy={fixed(glyph.position.y)} r={fixed(PLAN_MARK.hit * scale)} />
    <CameraMark glyph={glyph} scale={scale} />
  </g>;
});

/** Arrow turned to the pitch, so up and down read without colour even where the side view is hidden. */
function PitchIcon({ pitch }: { pitch: number }) {
  const turn = Number.isFinite(pitch) ? -Math.min(90, Math.max(-90, pitch)) : 0;
  return <svg className="bmap-plan-icon" viewBox="-8 -8 16 16" aria-hidden="true" focusable="false"><g transform={`rotate(${fixed(turn)})`}><path d="M -5.5 0 H 4.5 M 1.2 -3.4 L 5 0 L 1.2 3.4" /></g></svg>;
}
function VerticalIcon({ vertical }: { vertical: 'up' | 'down' }) {
  return <svg className="bmap-plan-icon" viewBox="-9 -9 18 18" aria-hidden="true" focusable="false"><VerticalMark vertical={vertical} x={0} y={0} radius={7} /></svg>;
}

function ReadoutText({ readout, pitch }: { readout: PlanReadout; pitch?: number }) {
  return <div className="bmap-plan-text">
    <p className="bmap-plan-name"><span className="bmap-plan-kind">{readout.kind}</span><strong title={readout.name}>{readout.name}</strong></p>
    <ul className="bmap-plan-values">{readout.items.map(item => <li key={item.key} className={`is-${item.key}`} title={planReadoutText(item)}>
      {item.label && <span>{item.label} </span>}
      {item.key === 'pitch' && pitch !== undefined && <PitchIcon pitch={pitch} />}
      <strong>{item.value}</strong>
    </li>)}</ul>
  </div>;
}

function CameraReadout({ map, camera }: { map: BackgroundMap; camera: BackgroundCamera }) {
  const readout = planCameraReadout(camera), side = planSideView(map, camera), box = PLAN_SIDE_VIEW;
  const [, pitchText, heightText] = readout.items.map(planReadoutText);
  return <div className="bmap-plan-readout is-camera" role="group" aria-label="선택한 카메라">
    <ReadoutText readout={readout} pitch={readout.vertical ? (readout.vertical === 'up' ? 90 : -90) : cameraAngles(camera).pitch} />
    <figure className="bmap-plan-side">
      <svg viewBox={`0 0 ${box.width} ${box.height}`} role="img" aria-label={`옆에서 본 방향: ${pitchText}, ${heightText}`}>
        {side.room && <rect className="bmap-plan-side-room" x={box.left} y={fixed(side.room.top)} width={box.right - box.left} height={fixed(Math.max(1, side.room.bottom - side.room.top))} />}
        <line className="bmap-plan-side-floor" x1={box.left} x2={box.right} y1={fixed(side.floorY)} y2={fixed(side.floorY)} />
        {[0, 1, 2, 3, 4, 5].map(index => <line key={index} className="bmap-plan-side-hatch" x1={box.left + 12 + index * 20} x2={box.left + 6 + index * 20} y1={fixed(side.floorY)} y2={fixed(side.floorY + 6)} />)}
        <line className="bmap-plan-side-pole" x1={side.camera.x} x2={side.camera.x} y1={fixed(side.floorY)} y2={fixed(side.camera.y)} />
        <line className="bmap-plan-side-level" x1={side.camera.x} x2={side.camera.x + box.arrow + box.head} y1={fixed(side.camera.y)} y2={fixed(side.camera.y)} />
        <line className="bmap-plan-sight" x1={side.camera.x} y1={fixed(side.camera.y)} x2={fixed(side.tip.x)} y2={fixed(side.tip.y)} />
        <polygon className="bmap-plan-sight-head" points={pointList(side.head)} />
        <circle className="bmap-plan-dot" cx={side.camera.x} cy={fixed(side.camera.y)} r={box.dot} />
      </svg>
      <figcaption>옆에서 본 방향</figcaption>
    </figure>
  </div>;
}

/**
 * Companion plan next to the 3D viewport. Fully controlled: it draws the draft it is given, the
 * preview of a gizmo drag included, and keeps no map, camera or selection of its own.
 */
export function BackgroundMapPlanPreview({ map, selectedId, onSelect }: MapPlanPreviewProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [size, setSize] = useState<PlanSize>(PLAN_FALLBACK_SIZE);
  const stageRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();

  // Screen size of the drawing area: markers are sized from it so they do not grow with the map.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = (width: number, height: number) => {
      const next = { width: Math.round(width), height: Math.round(height) };
      if (next.width < 1 || next.height < 1) return;
      setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    measure(stage.clientWidth, stage.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const box = entries[entries.length - 1].contentRect;
      measure(box.width, box.height);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [collapsed]);

  const selected = planSelectedNode(map, selectedId);
  const viewBox = useMemo(() => collapsed ? null : planViewBox(map, size), [collapsed, map, size]);
  const scale = viewBox ? planUnitsPerPixel(viewBox, size) : 1;
  // Latest props for the one stable click handler. Overwritten on every render and never drawn from.
  const latest = useRef({ map, selectedId, onSelect, scale });
  latest.current = { map, selectedId, onSelect, scale };
  const activate = useCallback<Activate>((id, cycle, point) => {
    const now = latest.current;
    // On a zoomed-out plan, items that overlap on screen count as one stack. Only the ones under the pointer take turns.
    const covers = point && ((node: BackgroundNode) => planNodeCovers(node, point, (node.type === 'camera' ? PLAN_MARK.hit : PLAN_MARK.dot * 1.6) * now.scale));
    now.onSelect(cycle ? nextPlanSelection(now.map, id, now.selectedId, Math.max(12, PLAN_MARK.dot * 2 * now.scale), covers) : id);
  }, []);

  const selectedGlyph = viewBox && selected?.type === 'camera' ? planCameraGlyph(selected, scale) : null;
  const selectedOutline = viewBox && selected && selected.type !== 'camera' ? planOutlinePoints(selected) : null;
  const readout = selected && selected.type !== 'camera' ? planVolumeReadout(selected) : null;

  return <aside className={`bmap-plan-preview${collapsed ? ' is-collapsed' : ''}`} aria-label="평면 보조 도면">
    <div className="bmap-plan-frame">
      <header className="bmap-plan-head">
        <button type="button" className="bmap-plan-toggle" aria-expanded={!collapsed} aria-controls={bodyId} title={collapsed ? '평면 보기 펼치기' : '평면 보기 접기'} onClick={() => setCollapsed(value => !value)}>
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M2 3.5 L5 6.5 L8 3.5" /></svg>평면 보기
        </button>
        {collapsed && selected && <span className="bmap-plan-summary" title={planNodeSummary(selected)}>{planNodeSummary(selected)}</span>}
      </header>
      <div className="bmap-plan-body" id={bodyId} hidden={collapsed}>
        {viewBox && <>
          <div className="bmap-plan-stage" ref={stageRef}>
            <svg className="bmap-plan-svg" viewBox={`${fixed(viewBox.x)} ${fixed(viewBox.y)} ${fixed(viewBox.width)} ${fixed(viewBox.height)}`} role="group" aria-label={`${map.name} 평면 보기`} onClick={() => onSelect(null)}>
              <rect className="bmap-plan-extent" x="0" y="0" width={MAP_PLAN_EXTENT.width} height={MAP_PLAN_EXTENT.height} />
              {map.imageUrl && <image className="bmap-plan-underlay" href={map.imageUrl} x="0" y="0" width={MAP_PLAN_EXTENT.width} height={MAP_PLAN_EXTENT.height} preserveAspectRatio="xMidYMid meet" />}
              {map.nodes.map(node => node.type === 'space' && <PlanShape key={node.id} node={node} scale={scale} selected={node.id === selectedId} onActivate={activate} />)}
              {map.nodes.map(node => node.type === 'symbol' && <PlanShape key={node.id} node={node} scale={scale} selected={node.id === selectedId} onActivate={activate} />)}
              {map.nodes.map(node => node.type === 'camera' && <PlanCamera key={node.id} node={node} scale={scale} selected={node.id === selectedId} onActivate={activate} />)}
              {/* The selection is redrawn on top without moving the buttons, so keyboard order and focus stay put. */}
              {selectedOutline && <g className="bmap-plan-selected" aria-hidden="true"><polygon className="bmap-plan-halo" points={selectedOutline} /><polygon className="bmap-plan-outline" points={selectedOutline} /></g>}
              {selectedGlyph && <g className="bmap-plan-selected bmap-plan-camera" aria-hidden="true"><CameraMark glyph={selectedGlyph} scale={scale} emphasis /></g>}
            </svg>
            {selectedGlyph?.vertical && <p className="bmap-plan-note"><VerticalIcon vertical={selectedGlyph.vertical} />{cameraPitchLabel(selectedGlyph.vertical === 'up' ? 90 : -90)} · 점선: 기울일 때 방향</p>}
            {selectedGlyph?.fan && <p className="bmap-plan-note"><svg className="bmap-plan-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path className="bmap-plan-fan" d="M 2 8 L 13 3 A 12 12 0 0 1 13 13 Z" /></svg>부채꼴: 방향 참고</p>}
          </div>
          {selected?.type === 'camera' ? <CameraReadout map={map} camera={selected} />
            : readout ? <div className="bmap-plan-readout is-volume" role="group" aria-label={selected?.type === 'space' ? '선택한 공간' : '선택한 기호'}><ReadoutText readout={readout} /></div>
              : <div className="bmap-plan-readout is-empty"><p className="bmap-plan-hint">{PLAN_PREVIEW_HINT}</p></div>}
        </>}
      </div>
    </div>
  </aside>;
}
