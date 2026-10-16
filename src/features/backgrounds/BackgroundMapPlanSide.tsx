import { useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import type { MapFieldScrub } from './mapCanvas';
import type { BackgroundCamera, BackgroundMap, BackgroundPoint } from './types';
import { PLAN_SIDE_VIEW, planSideAngle, planSideDragLevel, planSideDragPitch, planSideScale, planSideView, planSideY } from './mapPlanPreview';
import type { PlanSideScale } from './mapPlanPreview';
import { useMapScrubPointer } from './useMapScrubPointer';

const fixed = (value: number) => Math.round(value * 100) / 100 + 0;
const pointList = (points: BackgroundPoint[]) => points.map(point => `${fixed(point.x)},${fixed(point.y)}`).join(' ');

/**
 * Side view of the picked camera, drawn with its readout on the companion plan: how high the lens is and how far up or
 * down it looks. While the camera can be edited the lens is a handle: dragged up or down it changes the height, on the
 * scale the drag started on, so the floor line and the room stay where they are until it is let go. A camera that
 * cannot be edited (view mode, a locked camera, a save running) has the picture as it always was, element for element:
 * whatever the handle adds is drawn under `draggable` alone. The handle is for the pointer only; the keyboard has the
 * height field of the inspector, which holds the same number. Not wrapped in `memo`: it is drawn again whenever the
 * editor is, and that is how the held scale goes when the editor ends the drag. The tip of the sight arrow is a second
 * handle, under the same rule: dragged round the lens it changes how far up or down the camera looks, caught at level
 * and at either vertical (Shift: steps of 15°, Alt: caught nowhere). The pitch field of the inspector is its keyboard.
 */
export function BackgroundMapPlanSide({ map, camera, canEdit, scrub, label }: {
  map: BackgroundMap; camera: BackgroundCamera;
  /** Editing is allowed right now. The lens can be dragged while it is, and the camera is not locked. */
  canEdit: boolean; scrub: MapFieldScrub;
  /** What the picture says, for a reader: `옆에서 본 방향: 아래 45°, 높이 120`. */
  label: string }): JSX.Element {
  const draggable = canEdit && !camera.locked, box = PLAN_SIDE_VIEW;
  const frozen = useRef<PlanSideScale | null>(null), [, redraw] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const press = useMapScrubPointer(scrub, !draggable);
  // The scale is held only while its drag still runs. The editor can end the drag by itself (Escape, a save starting): it draws this again then.
  // It is held in a ref, not in state: the first step of a drag is drawn at once, before a state set in the same pointer event would arrive, and for that one frame the picture would be fitted anew.
  const live = frozen.current && scrub.alive() ? frozen.current : null;
  const scale = live ?? planSideScale(map, camera), side = planSideView(map, camera, scale);
  const lift = (event: ReactPointerEvent<SVGCircleElement>) => press(event, {
    field: 'elevation', axis: 'y', immediate: false,
    open: (origin, from) => {
      // The scale is taken from the map the drag starts on, not from what was drawn: a field that was being typed in has just been committed.
      const node = origin.map.nodes.find(item => item.id === camera.id), held = planSideScale(origin.map, node?.type === 'camera' ? node : camera);
      const inverse = svgRef.current?.getScreenCTM()?.inverse();
      const toY = (clientY: number) => inverse ? new DOMPoint(0, clientY).matrixTransform(inverse).y : Number.NaN;
      frozen.current = held; redraw(turn => turn + 1);
      // The lens keeps the offset it has where the drag starts: there the value is the height it started from, at any size of the picture.
      return { scale: held, start: origin.start, toY, grab: planSideY(held, origin.start) - toY(from.clientY) };
    },
    read: (drag, at) => planSideDragLevel(drag.scale, drag.toY(at.clientY) + drag.grab, drag.start),
    close: () => { frozen.current = null; redraw(turn => turn + 1); },
  });
  // A drag of the tip still runs: the tip and the pitch in the readout say so. Asked of the scrub as well, as the lift is.
  const aimed = useRef(false), aiming = aimed.current && scrub.alive();
  const aim = (event: ReactPointerEvent<SVGCircleElement>) => press(event, {
    // The tip turns round the lens: it is dragged up and down while the arrow lies nearer level, and sideways while it stands nearer upright.
    field: 'pitch', axis: Math.abs(side.head[0].y - side.camera.y) > Math.abs(side.head[0].x - side.camera.x) ? 'x' : 'y', immediate: false,
    open: (origin, from) => {
      // The lens is found on the map the drag starts on, as the lift takes its scale there: a height being typed in has just been committed.
      const node = origin.map.nodes.find(item => item.id === camera.id), lens = planSideView(origin.map, node?.type === 'camera' ? node : camera).camera;
      const inverse = svgRef.current?.getScreenCTM()?.inverse();
      const toPoint = (clientX: number, clientY: number) => inverse ? new DOMPoint(clientX, clientY).matrixTransform(inverse) : null;
      aimed.current = true; redraw(turn => turn + 1);
      // The arrow keeps the turn it has from the pointer where the drag starts, as the lens keeps its offset: a press beside the tip does not jump.
      const turn = planSideAngle(lens, toPoint(from.clientX, from.clientY));
      return { lens, toPoint, start: origin.start, grab: Number.isFinite(turn) ? origin.start - turn : 0 };
    },
    read: (drag, at) => planSideDragPitch(planSideAngle(drag.lens, drag.toPoint(at.clientX, at.clientY)) + drag.grab, drag.start, at.shiftKey, at.altKey === true),
    close: () => { aimed.current = false; redraw(turn => turn + 1); },
  });
  // The up-down mark: two small chevrons to the left of the lens, clear of its halo, in the units of the picture.
  const x0 = box.cameraX - 14, y = side.camera.y;
  // The figure as it always was, in its order. The handle adds a halo and the mark under the lens, and over everything the area that takes the press.
  return <figure className={`bmap-plan-side${draggable ? ' is-draggable' : ''}${live ? ' is-lifting' : ''}${aiming ? ' is-aiming' : ''}`}>
    <svg ref={svgRef} viewBox={`0 0 ${box.width} ${box.height}`} role="img" aria-label={label}>
      {side.room && <rect className="bmap-plan-side-room" x={box.left} y={fixed(side.room.top)} width={box.right - box.left} height={fixed(Math.max(1, side.room.bottom - side.room.top))} />}
      <line className="bmap-plan-side-floor" x1={box.left} x2={box.right} y1={fixed(side.floorY)} y2={fixed(side.floorY)} />
      {[0, 1, 2, 3, 4, 5].map(index => <line key={index} className="bmap-plan-side-hatch" x1={box.left + 12 + index * 20} x2={box.left + 6 + index * 20} y1={fixed(side.floorY)} y2={fixed(side.floorY + 6)} />)}
      <line className="bmap-plan-side-pole" x1={side.camera.x} x2={side.camera.x} y1={fixed(side.floorY)} y2={fixed(side.camera.y)} />
      <line className="bmap-plan-side-level" x1={side.camera.x} x2={side.camera.x + box.arrow + box.head} y1={fixed(side.camera.y)} y2={fixed(side.camera.y)} />
      <line className="bmap-plan-sight" x1={side.camera.x} y1={fixed(side.camera.y)} x2={fixed(side.tip.x)} y2={fixed(side.tip.y)} />
      <polygon className="bmap-plan-sight-head" points={pointList(side.head)} />
      {draggable && <circle className="bmap-plan-side-ring" cx={side.camera.x} cy={fixed(side.camera.y)} r={box.dot} />}
      {draggable && <path className="bmap-plan-side-marks" d={`M ${x0 - 3} ${fixed(y - 4)} L ${x0} ${fixed(y - 8)} L ${x0 + 3} ${fixed(y - 4)} M ${x0 - 3} ${fixed(y + 4)} L ${x0} ${fixed(y + 8)} L ${x0 + 3} ${fixed(y + 4)}`} />}
      <circle className="bmap-plan-dot" cx={side.camera.x} cy={fixed(side.camera.y)} r={box.dot} />
      {draggable && <circle className="bmap-plan-side-aim" onPointerDown={aim} cx={fixed(side.head[0].x)} cy={fixed(side.head[0].y)} r={box.dot}><title>화살표 끝을 끌어 카메라가 보는 위아래 각도 바꾸기 · Shift는 15°씩 · 끄는 도중 Esc는 취소</title></circle>}
      {draggable && <circle className="bmap-plan-side-grab" onPointerDown={lift} cx={side.camera.x} cy={fixed(side.camera.y)} r={box.dot}><title>위아래로 끌어 카메라 높이 바꾸기 · 끄는 도중 Esc는 취소</title></circle>}
    </svg>
    <figcaption>옆에서 본 방향{draggable && <span className="bmap-plan-side-tip"> · 점은 높이, 화살표 끝은 각도 조절</span>}</figcaption>
  </figure>;
}
